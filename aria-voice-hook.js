#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
//  ARIA VOICE HOOK — gives ARIA a phone number through Google Voice
//  Runs on YOUR machine (like claw-relay.js). Drives voice.google.com in a
//  real browser with Playwright, passes texts to ARIA, texts the replies back.
//
//  Setup:
//    npm install                        (playwright-core; uses your installed
//                                        Edge/Chrome, downloads no browser)
//    put ARIA_SMS_PASSWORD=… in .env    (8+ chars — what you text to unlock)
//    node aria-voice-hook.js https://your-aria.onrender.com --key=<ARIA_ACCESS_KEY>
//    → first run: sign in to Google Voice in the window that opens
//
//  Options:
//    --key=…          ARIA_ACCESS_KEY (or the env var); needed if the server has one
//    --idle=5         minutes of quiet before a conversation locks again
//    --allow=+1555…   comma-separated numbers allowed to unlock; others ignored
//    --browser=…      msedge | chrome | chromium  (default: msedge on Windows,
//                     chrome elsewhere; chromium needs `npx playwright-core install chromium`)
//    --browser-path=… a specific browser executable instead
//    --headless       no window — sign in once without it first
//    --profile=…      browser profile dir (default data/gvoice-profile). It holds
//                     your Google login cookies: don't share or commit it.
//
//  Lock rules (password, idle timeout, lockout) live in lib/sms-gate.js.
//  Everything that knows Google Voice's page structure is in SEL below —
//  when Google changes the UI, that's the part to fix.
// ═══════════════════════════════════════════════════════════════

import { readFileSync, writeFileSync, renameSync, mkdirSync } from "fs";
import crypto from "crypto";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import { createSmsGate } from "./lib/sms-gate.js";
import { stripThinking } from "./lib/think.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// .env beside this file; variables already set in the shell win.
try { process.loadEnvFile(path.join(__dirname, ".env")); } catch {}

const _args = process.argv.slice(2);
const flag = (name) => {
  const hit = _args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  return hit.includes("=") ? hit.slice(hit.indexOf("=") + 1) : true;
};

const SERVER_URL = _args.find((a) => !a.startsWith("--")) || "http://localhost:3000";
const ACCESS_KEY = flag("key") || process.env.ARIA_ACCESS_KEY || "";
// Env only — a password on the command line lands in shell history and ps.
// Trimmed like the texts it's compared with, so a stray space in .env can't
// make it impossible to unlock.
const PASSWORD = (process.env.ARIA_SMS_PASSWORD || "").trim();
const IDLE_MIN = Number(flag("idle") ?? process.env.ARIA_SMS_IDLE_MIN ?? 5);
const ALLOW = String(flag("allow") || process.env.ARIA_SMS_ALLOW || "")
  .split(",")
  .map(last10)
  .filter(Boolean);
const PLATFORM = os.platform();
const BROWSER = flag("browser") || (PLATFORM === "win32" ? "msedge" : "chrome");
const BROWSER_PATH = flag("browser-path") || "";
const HEADLESS = flag("headless") === true;
const DATA_DIR = path.join(__dirname, "data");
const PROFILE_DIR = path.resolve(flag("profile") || path.join(DATA_DIR, "gvoice-profile"));
const SEEN_FILE = path.join(DATA_DIR, "gvoice-seen.json");
// Only ever changed to point at a mock page when testing.
const GV_URL = process.env.ARIA_GVOICE_URL || "https://voice.google.com/u/0/messages";

const POLL_MS = 3000; // how often the inbox is checked
const MAX_SMS_CHARS = 1000; // longer replies are split across texts…
const MAX_SMS_PARTS = 5; // …up to this many
const SEND_GAP_MS = 1200; // between consecutive texts
const HISTORY_MSGS = 20; // per conversation, sent to /api/chat
const CHAT_TIMEOUT_MS = 3 * 60 * 1000; // Claw steps can take a while
const RELOAD_EVERY_MS = 30 * 60 * 1000; // keep a long-lived tab fresh
const NEW_MSG_CAP = 10; // most unseen texts handled from one thread at once
// Runaway guard: more replies than this to one thread in a minute means
// something is answering itself. That thread is muted for 5 minutes.
const BURST_MAX = 8;

// ── Google Voice page structure ───────────────────────────────
// From GV's web app as of mid-2026 (cross-checked against two open-source
// GV automations). Each entry is a comma list: the first match wins.
const SEL = {
  threadItem: "gv-message-thread-list-item",
  threadItemFallback: "li.list-item",
  message: "gv-message-item",
  messageText: "gv-annotation.content, .subject-content-container",
  // An incoming message's aria-label reads "Message from <who>, <text>, <date>,
  // <time>."; ours read "Message from you, …". The bubble container also
  // carries an `outgoing` class.
  messageContainer: ".full-container",
  threadDetails: "gv-thread-details",
  threadHeader: "gv-thread-details-header",
  input:
    'textarea.message-input, textarea[placeholder*="Type a message" i], textarea[aria-label*="Type a message" i]',
  send: 'button[aria-label*="Send message" i], [role="button"][aria-label*="Send message" i], button[gv-test-id*="send-message" i]',
};

if (!PASSWORD) {
  console.error("[VOICE] Set ARIA_SMS_PASSWORD (in .env or the environment) — it's what you text to unlock ARIA.");
  process.exit(1);
}
if (PASSWORD.length < 8) {
  // Anyone can text the number, and an unlocked ARIA can run commands on this
  // PC. A short PIN is one patient stranger away from that.
  console.error("[VOICE] ARIA_SMS_PASSWORD must be at least 8 characters.");
  process.exit(1);
}
if (!(IDLE_MIN > 0)) {
  console.error("[VOICE] --idle must be a positive number of minutes.");
  process.exit(1);
}

const gate = createSmsGate({ password: PASSWORD, idleMs: IDLE_MIN * 60 * 1000 });
const IDLE_LABEL = `${IDLE_MIN} min`;

let running = true;
let context = null;

console.log(`
╔═══════════════════════════════════════════════╗
║  ARIA VOICE HOOK  v1.0                        ║
║  Server : ${SERVER_URL.slice(0, 36).padEnd(36)}║
║  Browser: ${(BROWSER_PATH ? "custom" : BROWSER).padEnd(36)}║
║  Idle   : ${`locks after ${IDLE_LABEL}`.padEnd(36)}║
║  Allow  : ${(ALLOW.length ? `${ALLOW.length} number(s)` : "any number with the password").padEnd(36)}║
╚═══════════════════════════════════════════════╝

  Press Ctrl+C to stop.
`);

// ── Per-conversation memory (in memory only, like the lock) ───
const sessions = new Map(); // threadId → { history, pendingConfirm, sent, sentAt, mutedUntil }
function session(id) {
  let s = sessions.get(id);
  if (!s) {
    s = { history: [], pendingConfirm: null, sent: [], sentAt: [], mutedUntil: 0 };
    sessions.set(id, s);
  }
  return s;
}

// ── Messages already dealt with (on disk, so a restart doesn't redo them) ──
let seen = {};
try { seen = JSON.parse(readFileSync(SEEN_FILE, "utf8")); } catch {}
function markSeen(id, fps) {
  const arr = (seen[id] ||= []);
  for (const fp of fps) if (!arr.includes(fp)) arr.push(fp);
  if (arr.length > 300) arr.splice(0, arr.length - 300);
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    const tmp = SEEN_FILE + ".tmp";
    writeFileSync(tmp, JSON.stringify(seen));
    renameSync(tmp, SEEN_FILE);
  } catch (e) {
    console.warn("[VOICE] Couldn't save seen-message state:", e.message);
  }
}

// ── Browser ───────────────────────────────────────────────────
async function launch() {
  let chromium;
  try {
    ({ chromium } = await import("playwright-core"));
  } catch {
    console.error("[VOICE] playwright-core is missing — run `npm install` in the ARIA folder.");
    process.exit(1);
  }
  mkdirSync(PROFILE_DIR, { recursive: true });
  try {
    context = await chromium.launchPersistentContext(PROFILE_DIR, {
      headless: HEADLESS,
      ...(BROWSER_PATH
        ? { executablePath: BROWSER_PATH }
        : BROWSER === "chromium"
          ? {}
          : { channel: BROWSER }),
      viewport: { width: 1280, height: 900 },
      // Google's sign-in refuses browsers that announce they're automated.
      ignoreDefaultArgs: ["--enable-automation"],
      args: ["--disable-blink-features=AutomationControlled"],
    });
  } catch (e) {
    console.error(`[VOICE] Couldn't start the browser: ${e.message.split("\n")[0]}`);
    console.error(
      "        Try --browser=chrome, --browser=msedge, or --browser-path=<browser .exe>. " +
        "If the profile is in use, close the other window using it.",
    );
    process.exit(1);
  }
  context.on("close", () => shutdown("Browser closed"));
  const [page, ...extra] = context.pages().length ? context.pages() : [await context.newPage()];
  await Promise.all(extra.map((p) => p.close().catch(() => {})));
  page.setDefaultTimeout(15000);
  return page;
}

function isSignedIn(url) {
  try {
    const u = new URL(url);
    return u.origin === new URL(GV_URL).origin && u.pathname.startsWith("/u/");
  } catch {
    return false;
  }
}

async function ensureSignedIn(page) {
  if (isSignedIn(page.url())) return;
  if (HEADLESS) {
    console.error("[VOICE] Google Voice isn't signed in. Run once without --headless and sign in in the window.");
    await shutdown("signed out");
  }
  console.log("[VOICE] Sign in to Google Voice in the browser window — waiting…");
  // Any tab counts: Google's sign-in can finish in a tab of its own, which
  // used to leave this waiting forever on the first one. Once the profile
  // has a session, reloading the inbox in this tab picks it up.
  while (!isSignedIn(page.url())) {
    await new Promise((r) => setTimeout(r, 2000));
    if (context.pages().some((p) => p !== page && isSignedIn(p.url()))) await openInbox(page);
  }
  console.log("[VOICE] Signed in ✓");
  if (!new URL(page.url()).pathname.includes("/messages")) await openInbox(page);
}

async function openInbox(page) {
  await page.goto(GV_URL, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
}

// ── Reading the inbox ─────────────────────────────────────────
// Each visible conversation row, as text. A row's text includes its latest
// message preview, so a row whose text we haven't seen before has news.
function snapshot(page) {
  return page.evaluate((sel) => {
    let rows = [...document.querySelectorAll(sel.threadItem)];
    if (!rows.length) rows = [...document.querySelectorAll(sel.threadItemFallback)];
    return rows
      .filter((el) => el.getClientRects().length)
      .slice(0, 30)
      .map((el) => (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 400))
      .filter(Boolean);
  }, SEL);
}

async function openThread(page, sig) {
  const found = await page.evaluate(
    ({ sel, sig }) => {
      document.querySelectorAll("[data-aria-hook]").forEach((el) => el.removeAttribute("data-aria-hook"));
      let rows = [...document.querySelectorAll(sel.threadItem)];
      if (!rows.length) rows = [...document.querySelectorAll(sel.threadItemFallback)];
      const row = rows.find(
        (el) => (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 400) === sig,
      );
      if (!row) return false;
      row.setAttribute("data-aria-hook", "1");
      return true;
    },
    { sel: SEL, sig },
  );
  if (!found) return false; // changed again since the snapshot; next pass gets it
  const row = page.locator('[data-aria-hook="1"]');
  const btn = row.locator('[role="button"]').first();
  await ((await btn.count()) ? btn : row).click({ timeout: 5000 });
  await page.waitForFunction(() => /[?&]itemId=/.test(location.href), null, { timeout: 8000 });
  await page.waitForSelector(SEL.message, { timeout: 8000 }).catch(() => {});
  return true;
}

// The open conversation as rendered: its id (from the URL), the header, and
// every message.
function readPane(page) {
  return page.evaluate((sel) => {
    const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();
    const itemId = decodeURIComponent((location.href.match(/[?&]itemId=([^&#]+)/) || [])[1] || "");
    const scope = document.querySelector(sel.threadDetails) || document;
    const header = clean(scope.querySelector(sel.threadHeader)?.textContent);
    const repeats = new Map();
    const messages = [...scope.querySelectorAll(sel.message)].map((el) => {
      const aria = clean(el.getAttribute("aria-label"));
      const box = el.querySelector(sel.messageContainer) || el;
      const outgoing =
        /\boutgoing\b/.test(String(box.className || "")) || /^Message from you\b/i.test(aria);
      const text = clean(el.querySelector(sel.messageText)?.textContent);
      // Identity for "already handled": direction, the clock time from the
      // label (not the date — GV may relabel "Today" once the day ends), the
      // text, and which repeat this is, so the password sent twice in one
      // minute is still two messages.
      const time = (aria.match(/\d{1,2}:\d{2}(?:\s*[AP]M)?/gi) || []).pop() || "";
      const base = `${outgoing ? ">" : "<"}${time}|${text || aria}`;
      const n = (repeats.get(base) || 0) + 1;
      repeats.set(base, n);
      return { outgoing, text, fp: `${base}#${n}` };
    });
    return { itemId, header, messages };
  }, SEL);
}

// After a click the URL flips to the new thread before the message pane
// re-renders. Reading the old pane under the new id would hand one sender's
// texts to another sender's unlocked session, so the pane only counts once
// it (a) has swapped away from what was showing before the click, (b) ends
// with the message the clicked row previews, (c) names the same number as
// the id, where the header shows one — and reads the same twice in a row.
async function readThread(page, sig, before) {
  const alnum = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const rowText = alnum(sig);
  let last = null;
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    await sleep(400);
    const cur = await readPane(page);
    const swapped =
      cur.itemId === before.itemId || JSON.stringify(cur.messages) !== JSON.stringify(before.messages);
    const lastText = alnum(cur.messages.at(-1)?.text).slice(0, 12);
    const matchesRow = !lastText || rowText.includes(lastText);
    const headerNum = last10(cur.header);
    const matchesId = !headerNum || !last10(cur.itemId) || headerNum === last10(cur.itemId);
    const ok = cur.itemId && cur.messages.length && swapped && matchesRow && matchesId;
    if (ok && last && JSON.stringify(cur) === JSON.stringify(last)) {
      // Fingerprints get saved to disk and contain the text — the password
      // included — so only a hash of each is kept.
      for (const m of cur.messages)
        m.fp = crypto.createHash("sha256").update(m.fp).digest("hex").slice(0, 24);
      return cur;
    }
    last = ok ? cur : null;
  }
  throw new Error("the open conversation never matched the row that was clicked");
}

// ── Sending ───────────────────────────────────────────────────
function threadUrl(id) {
  return `${GV_URL}?itemId=${encodeURIComponent(id)}`;
}

async function sendText(page, threadId, text) {
  // Never type into a conversation other than the one being answered.
  const openId = decodeURIComponent((page.url().match(/[?&]itemId=([^&#]+)/) || [])[1] || "");
  if (openId !== threadId) {
    await page.goto(threadUrl(threadId), { waitUntil: "domcontentloaded" });
  }
  const box = page.locator(`${SEL.input} >> visible=true`).first();
  await box.waitFor({ timeout: 10000 });
  await box.fill(text);
  const send = page.locator(`${SEL.send} >> visible=true`).first();
  if (await send.count()) await send.click({ timeout: 5000 });
  else await box.press("Enter");
  // GV clears the box once it has taken the message.
  const deadline = Date.now() + 8000;
  while ((await box.inputValue().catch(() => "")) !== "") {
    if (Date.now() > deadline) throw new Error("Google Voice didn't accept the message");
    await sleep(250);
  }
  const s = session(threadId);
  s.sent.push(norm(text));
  if (s.sent.length > 30) s.sent.shift();
  await sleep(SEND_GAP_MS);
}

async function sendAll(page, threadId, parts) {
  const s = session(threadId);
  s.sentAt = s.sentAt.filter((t) => Date.now() - t < 60000);
  if (s.sentAt.length >= BURST_MAX) {
    s.mutedUntil = Date.now() + 5 * 60 * 1000;
    console.error(`[VOICE] ${mask(threadId)}: ${BURST_MAX}+ replies in a minute — muting it for 5 min.`);
    return;
  }
  s.sentAt.push(Date.now());
  for (const part of parts) await sendText(page, threadId, part);
  gate.touch(threadId);
}

// ── ARIA ──────────────────────────────────────────────────────
async function api(pathname, body) {
  const r = await fetch(new URL(pathname, SERVER_URL), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-no-stream": "1", // one JSON reply instead of an SSE stream
      ...(ACCESS_KEY ? { Authorization: `Bearer ${ACCESS_KEY}` } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
  });
  if (r.status === 401) throw new Error("ARIA rejected the access key (--key / ARIA_ACCESS_KEY)");
  if (!r.ok) throw new Error(`ARIA answered HTTP ${r.status}`);
  return r.json();
}

async function askAria(threadId, text) {
  const s = session(threadId);
  const data = await api("/api/chat", {
    message: text,
    history: s.history.slice(-HISTORY_MSGS),
    chatId: `sms-${threadId}`,
    channel: "sms",
  });
  const bubbles = (Array.isArray(data.replies) && data.replies.length ? data.replies : [data.reply || ""])
    .map((b) => plain(stripThinking(b)))
    .filter(Boolean);
  if (typeof data.imageUrl === "string" && /^https?:/.test(data.imageUrl)) bubbles.push(data.imageUrl);
  if (data.visual) bubbles.push("(I made a visual for this — open ARIA to see it.)");
  if (!bubbles.length) bubbles.push("(ARIA sent back an empty reply.)");

  s.pendingConfirm = null;
  if (data.confirm?.id) {
    s.pendingConfirm = data.confirm.id;
    bubbles[bubbles.length - 1] += "\n\nReply YES to run it or NO to cancel.";
  }
  s.history.push({ role: "user", content: text }, { role: "assistant", content: bubbles.join("\n\n") });
  return toParts(bubbles);
}

// A held Claw action (see /api/confirm) approved or refused by text.
async function answerConfirm(threadId, approved) {
  const s = session(threadId);
  const id = s.pendingConfirm;
  s.pendingConfirm = null;
  const r = await api("/api/confirm", { id, approved });
  const reply = !r.ok
    ? `Couldn't: ${r.error || "unknown error"}`
    : approved
      ? plain(`Done (${r.queued}).\n${r.output || ""}`)
      : "Cancelled.";
  s.history.push({ role: "user", content: approved ? "yes" : "no" }, { role: "assistant", content: reply });
  return toParts([reply]);
}

// ── Handling one conversation ─────────────────────────────────
async function handleThread(page, sig) {
  const before = await readPane(page);
  if (!(await openThread(page, sig))) return;
  const t = await readThread(page, sig, before);
  const id = t.itemId;
  const s = session(id);
  const allFps = t.messages.map((m) => m.fp);

  const phone = last10(id) || last10(t.header);
  if ((ALLOW.length && !ALLOW.includes(phone)) || s.mutedUntil > Date.now()) {
    markSeen(id, allFps); // dropped, not deferred
    return;
  }

  // Unanswered texts: after our last reply, not handled before, and not an
  // echo of something we sent (in case GV stops marking ours as outgoing).
  const done = new Set(seen[id] || []);
  const lastOut = t.messages.map((m) => m.outgoing).lastIndexOf(true);
  const fresh = t.messages
    .slice(lastOut + 1)
    .filter((m) => !done.has(m.fp) && m.text && !s.sent.includes(norm(m.text)))
    .slice(-NEW_MSG_CAP);
  markSeen(id, allFps);
  if (!fresh.length) return;

  // Run every text through the lock first, in order; merge back-to-back texts
  // for ARIA into one question.
  const steps = [];
  for (const m of fresh) {
    const g = gate.receive(id, m.text);
    if (g.action === "ignore") {
      // Content deliberately not logged: a locked thread's texts may be
      // password attempts.
      console.log(`[VOICE] ${mask(id)}: ignored (${g.reason})`);
      continue;
    }
    const prev = steps[steps.length - 1];
    if (g.action === "forward" && prev?.action === "forward" && !yesNo(prev.text) && !yesNo(m.text))
      prev.text += "\n" + m.text;
    else steps.push({ action: g.action, text: m.text });
  }

  for (const step of steps) {
    let parts;
    switch (step.action) {
      case "unlocked":
        console.log(`[VOICE] ${mask(id)}: 🔓 unlocked`);
        parts = [`🔓 Unlocked. I lock again after ${IDLE_LABEL} of quiet — text "lock" to lock now.`];
        break;
      case "still_unlocked":
        parts = ["🔓 Already unlocked."];
        break;
      case "locked_notice":
        console.log(`[VOICE] ${mask(id)}: locked (idle) — sent notice`);
        parts = [`🔒 Locked after ${IDLE_LABEL} of quiet. Text the password to unlock.`];
        s.pendingConfirm = null;
        break;
      case "locked":
        console.log(`[VOICE] ${mask(id)}: 🔒 locked on request`);
        parts = ["🔒 Locked."];
        s.pendingConfirm = null;
        break;
      case "forward": {
        console.log(`[VOICE] ${mask(id)} → ARIA: ${step.text.slice(0, 80)}`);
        const answer = s.pendingConfirm && yesNo(step.text);
        try {
          parts = answer ? await answerConfirm(id, answer === "yes") : await askAria(id, step.text);
        } catch (e) {
          console.error(`[VOICE] ARIA request failed: ${e.message}`);
          parts = [`⚠ Couldn't reach ARIA (${e.message}).`];
        }
        break;
      }
    }
    if (parts?.length) await sendAll(page, id, parts);
  }
}

// ── Main loop ─────────────────────────────────────────────────
async function main() {
  // Catch a wrong key now rather than on the first text.
  try {
    const r = await fetch(new URL("/api/auth/status", SERVER_URL), {
      headers: ACCESS_KEY ? { Authorization: `Bearer ${ACCESS_KEY}` } : {},
    });
    const st = await r.json();
    if (st.required && !st.authenticated) {
      console.error("[VOICE] ARIA needs its access key: pass --key=<ARIA_ACCESS_KEY> or set ARIA_ACCESS_KEY.");
      process.exit(1);
    }
    console.log("[VOICE] ARIA server reachable ✓");
  } catch (e) {
    console.warn(`[VOICE] Can't reach ${SERVER_URL} yet (${e.message}) — carrying on; texts will say so.`);
  }

  const page = await launch();
  await openInbox(page);
  await ensureSignedIn(page);
  await page.waitForSelector(`${SEL.threadItem}, ${SEL.threadItemFallback}`, { timeout: 20000 }).catch(() => {});

  // Whatever is in the inbox now is history. Only rows that change after
  // this point get looked at, so starting up doesn't sweep the whole inbox.
  // (Texts that arrived while the hook was off are still read once their
  // thread next changes — and meet a lock, since every thread starts locked.)
  let baseline = new Set(await snapshot(page));
  const failures = new Map(); // row text → failed attempts
  let lastReload = Date.now();
  console.log(`[VOICE] Watching ${baseline.size} conversation(s) for new texts ✓`);

  while (running) {
    await sleep(POLL_MS);
    try {
      await ensureSignedIn(page);
      if (Date.now() - lastReload > RELOAD_EVERY_MS) {
        await openInbox(page);
        lastReload = Date.now();
      }
      const rows = await snapshot(page);
      const changed = rows.filter((sig) => !baseline.has(sig)).slice(0, 5);
      const handled = new Set();
      for (const sig of changed) {
        if (!running) break;
        try {
          await handleThread(page, sig);
          handled.add(sig);
        } catch (e) {
          const n = (failures.get(sig) || 0) + 1;
          failures.set(sig, n);
          console.warn(`[VOICE] Conversation failed (attempt ${n}/3): ${e.message.split("\n")[0]}`);
          if (n >= 3) handled.add(sig); // give up on it rather than retry forever
        }
      }
      // Keep only rows still on screen, so the set can't grow without bound.
      // Rows that changed but weren't handled stay out of it and come back
      // next pass. Our own reply changes a row too, which costs one extra
      // look at that thread and finds nothing new.
      baseline = new Set(rows.filter((sig) => baseline.has(sig) || handled.has(sig)));
      for (const sig of failures.keys()) if (!rows.includes(sig)) failures.delete(sig);
    } catch (e) {
      if (!running) break;
      console.warn("[VOICE] Poll error:", e.message.split("\n")[0]);
      await sleep(5000);
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────
function last10(s) {
  const d = String(s || "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : "";
}

function mask(id) {
  const p = last10(id);
  return p ? `…${p.slice(-4)}` : String(id).slice(0, 12);
}

function norm(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

function yesNo(text) {
  const t = norm(text).toLowerCase().replace(/[.!]+$/, "");
  if (/^(yes|y|approve|approved|do it|go ahead)$/.test(t)) return "yes";
  if (/^(no|n|cancel|deny|don't)$/.test(t)) return "no";
  return null;
}

// Texts show markdown as literal symbols; keep the words, drop the markup.
function plain(s) {
  return String(s || "")
    .replace(/<\/?message>/gi, "")
    .replace(/```[\w-]*\n?/g, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, "$1 ($2)")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitSms(text) {
  const parts = [];
  let rest = text;
  while (rest.length > MAX_SMS_CHARS) {
    let cut = rest.lastIndexOf("\n", MAX_SMS_CHARS);
    if (cut < MAX_SMS_CHARS / 2) cut = rest.lastIndexOf(". ", MAX_SMS_CHARS) + 1;
    if (cut < MAX_SMS_CHARS / 2) cut = rest.lastIndexOf(" ", MAX_SMS_CHARS);
    if (cut <= 0) cut = MAX_SMS_CHARS;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

function toParts(bubbles) {
  const parts = bubbles.flatMap(splitSms);
  if (parts.length <= MAX_SMS_PARTS) return parts;
  const kept = parts.slice(0, MAX_SMS_PARTS);
  kept[MAX_SMS_PARTS - 1] += "\n\n(…cut short — the rest is in ARIA.)";
  return kept;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function shutdown(reason) {
  if (!running) return;
  running = false;
  console.log(`\n[VOICE] ${reason} — shutting down.`);
  setTimeout(() => process.exit(0), 3000).unref();
  await context?.close().catch(() => {});
  process.exit(0);
}
process.on("SIGINT", () => shutdown("Received SIGINT"));
process.on("SIGTERM", () => shutdown("Received SIGTERM"));

main().catch((e) => {
  console.error("[VOICE] Fatal:", e.message);
  process.exit(1);
});
