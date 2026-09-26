// lib/sms-gate.js — the password lock in front of ARIA's phone number
// ═══════════════════════════════════════════════════════════════════
//
// WHY THIS EXISTS
//   aria-voice-hook.js puts ARIA behind a Google Voice number, and ARIA can
//   run shell commands on the PC through Claw. A phone number is public —
//   anyone can text it, and SMS sender IDs can be spoofed — so nothing a
//   conversation sends reaches ARIA until that conversation has texted the
//   password, and the unlock lapses after a few quiet minutes.
//
// RULES (each conversation thread is locked or unlocked on its own)
//   Locked    Only the exact password does anything. Every other text is
//             dropped without a reply, so a stranger learns nothing, not even
//             that something is listening. Each one counts as a miss: 5 misses
//             and the thread is ignored for 15 minutes, password included.
//   Unlocked  Texts go to ARIA. The password itself never does.
//   Idle      No traffic either way for idleMs (default 5 min) → locked. The
//             next text gets a single "locked" notice — only a thread that was
//             unlocked before is told why ARIA went quiet.
//   "lock"    Locks immediately.
//
//   State is in memory only: restarting the hook locks everything.
// ═══════════════════════════════════════════════════════════════════

import crypto from "crypto";

// Hashing both sides gives timingSafeEqual equal-length inputs whatever was
// typed, so response time says nothing about how close a guess was.
const digest = (s) => crypto.createHash("sha256").update(String(s)).digest();

export function createSmsGate({
  password,
  idleMs = 5 * 60 * 1000,
  maxMisses = 5,
  lockoutMs = 15 * 60 * 1000,
  now = Date.now,
} = {}) {
  if (!password) throw new Error("sms-gate: password required");
  const want = digest(password);
  const threads = new Map(); // threadId → state

  const isPassword = (text) => crypto.timingSafeEqual(digest(text), want);

  function state(id) {
    let s = threads.get(id);
    if (!s) {
      s = { unlocked: false, lastActive: 0, misses: 0, blockedUntil: 0, lapsed: false };
      threads.set(id, s);
    }
    return s;
  }

  // Idle expiry is checked lazily, whenever the thread is next looked at.
  function expire(s, t) {
    if (s.unlocked && t - s.lastActive >= idleMs) {
      s.unlocked = false;
      s.lapsed = true;
    }
  }

  /**
   * Decide what one incoming text does.
   * @returns {{ action: "ignore" | "unlocked" | "still_unlocked" | "locked_notice" | "locked" | "forward", reason?: string }}
   *   Only "forward" may be passed on to ARIA. Everything else is answered (or
   *   not) by the hook itself.
   */
  function receive(id, text) {
    const t = now();
    const s = state(id);
    expire(s, t);
    if (s.blockedUntil > t) return { action: "ignore", reason: "lockout" };
    const msg = String(text ?? "").trim();

    if (!s.unlocked) {
      if (msg && isPassword(msg)) {
        Object.assign(s, { unlocked: true, lastActive: t, misses: 0, lapsed: false });
        return { action: "unlocked" };
      }
      s.misses++;
      if (s.misses >= maxMisses) {
        Object.assign(s, { misses: 0, blockedUntil: t + lockoutMs, lapsed: false });
        return { action: "ignore", reason: "lockout_started" };
      }
      if (s.lapsed) {
        s.lapsed = false;
        return { action: "locked_notice" };
      }
      return { action: "ignore", reason: "locked" };
    }

    s.lastActive = t;
    if (isPassword(msg)) return { action: "still_unlocked" };
    if (/^lock[.!]?$/i.test(msg)) {
      s.unlocked = false; // asked for, so no "locked" notice later
      return { action: "locked" };
    }
    return { action: "forward" };
  }

  /** ARIA answered — counts as activity, so a slow reply doesn't eat the window. */
  function touch(id) {
    const s = threads.get(id);
    if (s?.unlocked) s.lastActive = now();
  }

  function isUnlocked(id) {
    const s = threads.get(id);
    if (!s) return false;
    expire(s, now());
    return s.unlocked;
  }

  return { receive, touch, isUnlocked };
}
