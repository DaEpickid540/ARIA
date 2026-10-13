// lib/sms-outbox.js — texts ARIA starts herself (evening debrief, alerts)
// ═══════════════════════════════════════════════════════════════════
//
// aria-voice-hook.js only ever answered texts. This lets it send first:
// the server files a message with `sms: true` (any server — chat sync brings
// it over), GET /api/sms/outbox lists the last day's, and the hook texts
// each one once to the owner's conversation.
//
//   Owner     the conversation that last unlocked with the password. Until
//             one has, nothing is sent (there's nowhere safe to send it).
//   Once      what has been sent is remembered by key on disk, marked BEFORE
//             sending, so a crash mid-send never repeats a text. The first
//             run starts "since" at now, so it doesn't text yesterday.
//
// Network, disk and Google Voice are injected; tests use fakes.
// ═══════════════════════════════════════════════════════════════════

const KEEP_SENT_MS = 2 * 24 * 3600_000;
const SYNC_LAG_MS = 10 * 60_000;

/**
 * @param {object} o
 *   load(name) → object|null, save(name, obj)   persistence ("owner", "outbox")
 *   fetchOutbox(since) → [{ key, at, text }]    GET /api/sms/outbox
 *   send(threadId, text)                        one text, already plain and short
 *   toParts(text) → string[]                    plain-text + split, from the hook
 *   log(msg)
 */
export function createOutbox({ load, save, fetchOutbox, send, toParts = (t) => [t], log = () => {}, now = Date.now }) {
  let owner = load("owner"); // { threadId, at }
  const state = load("outbox") || { since: now(), sent: {} };
  save("outbox", state); // the first run's "since" sticks
  let warned = false;

  /**
   * The conversation that just unlocked becomes where ARIA's texts go.
   * Returns the previous one when it moved (the hook tells it so: a
   * password used on another phone shouldn't redirect texts silently).
   */
  function rememberOwner(threadId) {
    if (!threadId || owner?.threadId === threadId) return false;
    const previous = owner?.threadId || null;
    owner = { threadId, at: now() };
    save("owner", owner);
    return { previous };
  }

  /**
   * Texts ARIA sent on her own, per conversation (the last 20), kept on disk
   * so that after a restart the hook still knows they weren't replies.
   */
  function recordUnprompted(threadId, text) {
    const list = ((state.unprompted ||= {})[threadId] ||= []);
    list.push(text);
    if (list.length > 20) list.splice(0, list.length - 20);
    save("outbox", state);
  }
  const unprompted = (threadId) => state.unprompted?.[threadId] || [];

  /** Sends whatever is waiting. Returns how many messages went out. */
  async function deliver() {
    const messages = (await fetchOutbox(state.since)) || [];
    const fresh = messages.filter((m) => m?.key && typeof m.text === "string" && !state.sent[m.key]);
    if (!fresh.length) return 0;
    if (!owner?.threadId) {
      if (!warned) log("ARIA has texts to send, but no conversation has unlocked yet — text the password once so I know where to send them.");
      warned = true;
      return 0;
    }
    let n = 0;
    for (const m of fresh) {
      state.sent[m.key] = now();
      // Forward past what's handled, so the server's list keeps moving. Ten
      // minutes behind it, because a message another server filed can reach
      // this one through chat sync after a newer local one; the sent keys
      // stop anything in that margin going out twice.
      if (typeof m.at === "number") state.since = Math.max(state.since, m.at - SYNC_LAG_MS);
      save("outbox", state);
      for (const part of toParts(m.text)) {
        await send(owner.threadId, part);
        recordUnprompted(owner.threadId, part);
      }
      n++;
    }
    const cutoff = now() - KEEP_SENT_MS;
    for (const [k, at] of Object.entries(state.sent)) if (at < cutoff) delete state.sent[k];
    save("outbox", state);
    return n;
  }

  return { rememberOwner, deliver, recordUnprompted, unprompted, owner: () => owner };
}
