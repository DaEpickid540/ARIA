// lib/triggers.js — "when I'm in X (at Y o'clock), do Z": rules that fire on
// what the PC is doing or on the clock
// ═══════════════════════════════════════════════════════════════════
//
// Two kinds of rule:
//   App rules    "when Visual Studio Code is in front after 11 PM, nag me".
//                The Claw relay reports the foreground app and window title
//                (only while some rule needs it: see wantsContext()). A rule
//                fires when its app comes to the front inside its time window,
//                and again only after its cooldown, or every cooldown while it
//                stays there if it's a nag.
//   Clock rules  "at 7:30 on weekdays, tell me what's due". Once a day at
//                that minute, in the owner's time zone (lib/clock.js).
//
// What a rule does is either `say` (a fixed message, filed as an alert) or
// `ask` (a prompt ARIA answers with read-only tools, then files). server.js
// injects both through init({ fire }), so this file only decides WHEN.
//
// Window titles are the owner's own screen. They never reach a model unless
// an `ask` rule fires, and then only the matched app name and title.
// ═══════════════════════════════════════════════════════════════════

import fs from "fs";
import path from "path";
import { DATA_DIR } from "./paths.js";
import { TZ, zoned, dateKey } from "./clock.js";

const FILE = path.join(DATA_DIR, "triggers.json");
export const MAX_TRIGGERS = 30;
export const DEFAULT_COOLDOWN_MIN = 60;
const CONTEXT_STALE_MS = 60_000; // no report for a minute: the PC isn't telling us anything
const IDLE_LIMIT_S = 10 * 60; // nobody at the keyboard for 10 min: an open app isn't "using" it
const TICK_MS = 30_000;
const CLOCK_GRACE_MIN = 10; // a clock rule missed by a restart or a sleeping server still fires this late
const CONTEXT_LEAD_MIN = 10; // start asking for the foreground app this long before a window opens
const EVENING_FROM = 18 * 60; // "after 11pm" with no "before" means the night…
const NIGHT_END = 5 * 60; // …so it runs until 5 AM

let _rules = [];
let _counter = 1;
let _deps = null;
let _timer = null;
let _saveTimer = null;
const _contexts = new Map(); // device → { app, title, idleSec, at, device }: each PC reports its own
const DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/* ── persistence ─────────────────────────────────────────────── */
function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, "utf8"));
    _rules = Array.isArray(raw.rules) ? raw.rules : [];
    _counter = raw.counter || _rules.length + 1;
  } catch {
    _rules = [];
  }
}
function save() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(flushSync, 300);
}
export function flushSync() {
  clearTimeout(_saveTimer);
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE + ".tmp", JSON.stringify({ counter: _counter, rules: _rules }));
    fs.renameSync(FILE + ".tmp", FILE);
  } catch (e) {
    console.warn("[triggers] save failed:", e.message);
  }
}

/* ── parsing ─────────────────────────────────────────────────── */

/** "23:00", "11pm", "7:30 am", "noon" → minutes after midnight, or null. */
export function parseClock(s) {
  const t = String(s ?? "").toLowerCase().trim();
  if (t === "noon") return 12 * 60;
  if (t === "midnight") return 0;
  const m = t.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?$/);
  if (!m) return null;
  let h = +m[1];
  const min = +(m[2] || 0);
  if (min > 59) return null;
  if (m[3]) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (m[3][0] === "p" ? 12 : 0);
  } else if (h > 23) return null;
  return h * 60 + min;
}
const fmtClock = (min) => {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};

/** "weekdays", "weekends", "mon,wed,fri", "every day" → [0–6] or null for every day. */
export function parseDays(s) {
  const t = String(s ?? "").toLowerCase().trim();
  if (!t || /^(every ?day|daily|all|any)$/.test(t)) return null;
  if (/^week ?days?$/.test(t)) return [1, 2, 3, 4, 5];
  if (/^week ?ends?$/.test(t)) return [0, 6];
  const out = new Set();
  for (const part of t.replace(/\bweek (days?|ends?)\b/g, "week$1").split(/[\s,/&+]+|\band\b/).filter(Boolean)) {
    if (/^weekdays?$/.test(part)) [1, 2, 3, 4, 5].forEach((d) => out.add(d));
    else if (/^weekends?$/.test(part)) [0, 6].forEach((d) => out.add(d));
    else {
      const i = DAY_NAMES.findIndex((d) => part.startsWith(d));
      if (i < 0) throw new Error(`"${part}" isn't a day.`);
      out.add(i);
    }
  }
  return out.size ? [...out].sort() : null;
}

/**
 * The tool's input: "key: value" parts separated by "|".
 *   app: Visual Studio Code | after: 11pm | before: 5am | days: weekdays | say: Go to bed | every: 30m | nag
 *   at: 7:30am | days: weekdays | ask: What's due today?
 */
export function parseTriggerInput(input) {
  const spec = { when: {}, then: null, nag: false, cooldownMin: null, label: "" };
  for (const raw of String(input || "").split("|").map((p) => p.trim()).filter(Boolean)) {
    if (/^(nag|keep nagging|repeat)$/i.test(raw)) {
      spec.nag = true;
      continue;
    }
    const m = raw.match(/^([a-z ]+?)\s*:\s*([\s\S]+)$/i);
    if (!m) throw new Error(`"${raw}" should be "key: value" (app, after, before, at, days, say, ask, every).`);
    const key = m[1].toLowerCase().trim();
    const val = m[2].trim();
    if (key === "app" || key === "when" || key === "window") spec.when.app = val.slice(0, 80);
    else if (key === "after" || key === "from") spec.when.from = clockOrThrow(val);
    else if (key === "before" || key === "until" || key === "to") spec.when.to = clockOrThrow(val);
    else if (key === "at") spec.when.at = clockOrThrow(val);
    else if (key === "days" || key === "on") spec.when.days = parseDays(val);
    else if (key === "say" || key === "tell me" || key === "message") spec.then = { kind: "say", text: val.slice(0, 500) };
    else if (key === "ask" || key === "do") spec.then = { kind: "ask", text: val.slice(0, 500) };
    else if (key === "every" || key === "cooldown") spec.cooldownMin = minutesOrThrow(val);
    else if (key === "name" || key === "label") spec.label = val.slice(0, 60);
    else throw new Error(`Unknown part "${key}". Use app, after, before, at, days, say, ask, every, name.`);
  }
  return spec;
}
function clockOrThrow(v) {
  const c = parseClock(v);
  if (c == null) throw new Error(`"${v}" isn't a time of day (try 23:00 or 11pm).`);
  return c;
}
function minutesOrThrow(v) {
  const m = String(v).toLowerCase().trim().match(/^(\d+)\s*(m|min|mins|minutes?|h|hrs?|hours?)?$/);
  if (!m) throw new Error(`"${v}" isn't a number of minutes or hours.`);
  const n = +m[1] * ((m[2] || "m")[0] === "h" ? 60 : 1);
  return Math.min(24 * 60, Math.max(5, n));
}

/** Checks a spec and fills in defaults. Throws with a sentence the user can act on. */
export function normalise(spec) {
  const when = { ...(spec.when || {}) };
  if (!spec.then?.text) throw new Error("Say what to do: say: <message> or ask: <question for ARIA>.");
  if (when.app == null && when.at == null) throw new Error("Say when: app: <an app or site in the window title>, or at: <time>.");
  if (when.app != null && when.at != null) throw new Error("Use app with after/before, or at on its own — not both.");
  if (when.at != null && (when.from != null || when.to != null)) throw new Error("at is a moment; after/before are a window for app rules. Use one or the other.");
  // "after 11pm" means the night, not the hour before midnight.
  if (when.from != null && when.to == null) when.to = when.from >= EVENING_FROM ? NIGHT_END : 24 * 60;
  if (when.app != null && !String(when.app).trim()) throw new Error("app: needs a name.");
  if ((when.from == null) !== (when.to == null) && when.app == null)
    throw new Error("after/before go with app:.");
  return {
    when: {
      ...(when.app != null ? { app: String(when.app).trim().toLowerCase() } : {}),
      ...(when.from != null ? { from: when.from } : {}),
      ...(when.to != null ? { to: when.to } : {}),
      ...(when.at != null ? { at: when.at } : {}),
      days: Array.isArray(when.days) && when.days.length && when.days.length < 7 ? when.days : null,
    },
    then: { kind: spec.then.kind === "ask" ? "ask" : "say", text: String(spec.then.text).trim() },
    nag: !!spec.nag && when.app != null,
    cooldownMin: spec.cooldownMin == null ? DEFAULT_COOLDOWN_MIN : Math.min(24 * 60, Math.max(5, +spec.cooldownMin || DEFAULT_COOLDOWN_MIN)),
    label: String(spec.label || "").trim().slice(0, 60),
  };
}

/** A rule in words: "VS Code in front, 11:00 PM–5:00 AM, weekdays". */
export function describe(r) {
  const w = r.when;
  const list = (w.days || []).join(",");
  const days = !w.days
    ? ""
    : list === "1,2,3,4,5"
      ? " on weekdays"
      : list === "0,6"
        ? " on weekends"
        : ` on ${w.days.map((d) => DAY_NAMES[d][0].toUpperCase() + DAY_NAMES[d].slice(1)).join(", ")}`;
  if (w.at != null) return `at ${fmtClock(w.at)}${days || " every day"}`;
  const win = w.from != null || w.to != null ? `, ${fmtClock(w.from ?? 0)}–${fmtClock(w.to ?? 0)}` : "";
  return `when "${w.app}" is in front${win}${days}`;
}

/* ── matching ────────────────────────────────────────────────── */

/** Is minute-of-day `m` inside [from, to)? Windows may wrap midnight (23:00–05:00). */
export function inWindow(m, from, to) {
  if (from == null && to == null) return true;
  const f = from ?? 0;
  const t = to ?? 24 * 60;
  return f <= t ? m >= f && m < t : m >= f || m < t;
}

/** The day a wrapping window started on: 1 AM in a 23:00–05:00 window belongs to the night before. */
function windowDay(z, w) {
  const dow = new Date(Date.UTC(z.y, z.m - 1, z.d)).getUTCDay();
  const m = z.h * 60 + z.min;
  if (w.from != null && w.to != null && w.from > w.to && m < w.to) return (dow + 6) % 7;
  return dow;
}

function appMatches(rule, ctx, now) {
  if (!ctx || now - ctx.at > CONTEXT_STALE_MS) return false;
  if ((ctx.idleSec || 0) > IDLE_LIMIT_S) return false;
  const hay = `${ctx.app || ""} ${ctx.title || ""}`.toLowerCase();
  return hay.includes(rule.when.app);
}

/** Whether `rule` holds at `now` with context `ctx`. Exported for tests. */
export function matches(rule, ctx, now = Date.now(), tz = TZ) {
  const z = zoned(now, tz);
  const w = rule.when;
  const m = z.h * 60 + z.min;
  if (w.at != null) {
    const dow = new Date(Date.UTC(z.y, z.m - 1, z.d)).getUTCDay();
    // From that minute for a few more: a restart or a sleeping server would
    // otherwise lose it for the day (once a day is enforced by the caller).
    return m >= w.at && m < w.at + CLOCK_GRACE_MIN && (!w.days || w.days.includes(dow));
  }
  if (!windowOpen(w, z)) return false;
  // Several PCs can report; the rule holds when any of them is in the app.
  const all = ctx === undefined ? [..._contexts.values()] : [ctx];
  return all.some((c) => appMatches(rule, c, now));
}

function windowOpen(w, z) {
  if (!inWindow(z.h * 60 + z.min, w.from, w.to)) return false;
  return !w.days || w.days.includes(windowDay(z, w));
}

/* ── evaluation ──────────────────────────────────────────────── */
let _evaluating = false;

/** Looks at every active rule once. Fires the ones that should. */
export async function evaluate(now = Date.now(), tz = TZ) {
  if (_evaluating) return [];
  _evaluating = true;
  const fired = [];
  try {
    for (const r of _rules) {
      if (!r.active) continue;
      const on = matches(r, undefined, now, tz);
      const was = !!r.lastMatch;
      r.lastMatch = on;
      if (!on) continue;
      let go;
      if (r.when.at != null) {
        // Once a day at that minute (the tick may see the minute twice).
        go = r.lastFiredDay !== dateKey(now, tz);
      } else {
        const cooled = now - (r.lastFired || 0) >= r.cooldownMin * 60_000;
        go = cooled && (!was || r.nag); // on arrival; again only if it's a nag
      }
      if (!go) continue;
      r.lastFired = now;
      r.lastFiredDay = dateKey(now, tz);
      r.fired = (r.fired || 0) + 1;
      fired.push(r);
    }
    if (fired.length) save();
  } finally {
    _evaluating = false;
  }
  // Outside the loop: an `ask` can take a while, and must not hold up others.
  for (const r of fired) {
    Promise.resolve()
      .then(() => _deps?.fire?.(publicRule(r)))
      .catch((e) => console.warn(`[triggers] ${r.id} failed:`, e.message));
  }
  return fired.map((r) => r.id);
}

/**
 * What the PC is doing, from the Claw relay's heartbeat. App rules are
 * checked straight away, so arriving in an app fires within a heartbeat.
 */
export function reportContext({ app = "", title = "", idleSec = 0, device = "" } = {}, now = Date.now()) {
  const key = String(device || "default").slice(0, 120);
  _contexts.set(key, {
    app: String(app).slice(0, 120),
    title: String(title).slice(0, 300),
    idleSec: Math.max(0, Number(idleSec) || 0),
    device: key,
    at: now,
  });
  for (const [k, c] of _contexts) if (now - c.at > 10 * CONTEXT_STALE_MS) _contexts.delete(k);
  if (_rules.some((r) => r.active && r.when.app != null)) return evaluate(now);
  return Promise.resolve([]);
}

/** The most recent fresh report from any device, or null. */
export function currentContext(now = Date.now()) {
  let best = null;
  for (const c of _contexts.values()) if (now - c.at <= CONTEXT_STALE_MS && (!best || c.at > best.at)) best = c;
  return best;
}

/**
 * Whether the relay should report the foreground app: only while some app
 * rule's window is open, or opens within CONTEXT_LEAD_MIN. A rule for 11 PM
 * doesn't have the PC streaming what's in front all afternoon.
 */
export function wantsContext(now = Date.now(), tz = TZ) {
  const soon = zoned(now + CONTEXT_LEAD_MIN * 60_000, tz);
  const z = zoned(now, tz);
  return _rules.some((r) => r.active && r.when.app != null && (windowOpen(r.when, z) || windowOpen(r.when, soon)));
}

/**
 * The words app rules look for. The relay sends a window's title only when
 * it contains one of them, so an email subject or a private tab's name never
 * leaves the PC unless a rule is about it.
 */
export const contextMatchWords = () => [...new Set(_rules.filter((r) => r.active && r.when.app != null).map((r) => r.when.app))];

/* ── the list ────────────────────────────────────────────────── */
export const listTriggers = () => _rules.map(publicRule);
export const getTrigger = (id) => _rules.find((r) => r.id === id) || null;
export function publicRule(r) {
  return { ...r, description: describe(r) };
}

export function createTrigger(spec) {
  const n = normalise(spec);
  if (_rules.filter((r) => r.active).length >= MAX_TRIGGERS) throw new Error(`Already ${MAX_TRIGGERS} triggers — remove one first.`);
  const r = {
    id: `t${_counter++}`,
    ...n,
    label: n.label || (n.then.kind === "say" ? n.then.text.slice(0, 40) : `Ask: ${n.then.text.slice(0, 35)}`),
    active: true,
    createdAt: Date.now(),
    fired: 0,
  };
  skipIfInGrace(r);
  _rules.push(r);
  save();
  return publicRule(r);
}

/**
 * A clock rule made (or switched back on) a few minutes after its time
 * would fire at once through the late-firing grace. That grace is for
 * missed runs, not new ones: count today as done.
 */
function skipIfInGrace(r, now = Date.now()) {
  if (r.when.at == null) return;
  const z = zoned(now, TZ);
  const m = z.h * 60 + z.min;
  if (m >= r.when.at && m < r.when.at + CLOCK_GRACE_MIN) r.lastFiredDay = dateKey(now, TZ);
}

export function removeTrigger(id) {
  const i = _rules.findIndex((r) => r.id === id);
  if (i < 0) return false;
  _rules.splice(i, 1);
  save();
  return true;
}

export function setActive(id, active) {
  const r = getTrigger(id);
  if (!r) return null;
  if (active && !r.active && _rules.filter((x) => x.active).length >= MAX_TRIGGERS)
    throw new Error(`Already ${MAX_TRIGGERS} triggers — remove one first.`);
  if (active && !r.active) skipIfInGrace(r);
  r.active = !!active;
  r.lastMatch = false;
  save();
  return publicRule(r);
}

/* ── setup ───────────────────────────────────────────────────── */
/** deps: { fire(rule, ctx) } */
export function init(deps, { start = true } = {}) {
  _deps = deps;
  load();
  if (start && !_timer) {
    // Clock rules need a clock; app rules are also checked on each report.
    _timer = setInterval(() => evaluate().catch(() => {}), TICK_MS);
    _timer.unref?.();
  }
}

/** Tests only. */
export function _reset() {
  clearInterval(_timer);
  clearTimeout(_saveTimer);
  _timer = null;
  _rules = [];
  _counter = 1;
  _contexts.clear();
}

/** The tool: "ACTION: trigger | …", "trigger list |", "trigger stop | t2". */
export function runTriggerTool(name, input) {
  const sub = name.replace(/^trigger\s*/, "").trim();
  const arg = String(input || "").trim();
  if (sub === "list" || (!sub && /^list$/i.test(arg))) {
    const all = listTriggers();
    if (!all.length) return "No triggers.";
    return all
      .map((r) => `${r.id} [${r.active ? "on" : "off"}] ${r.description} → ${r.then.kind}: ${r.then.text}` +
        `${r.nag ? ` (nag every ${r.cooldownMin}m)` : ""} · fired ${r.fired || 0}×`)
      .join("\n");
  }
  if (sub === "stop" || sub === "remove" || sub === "delete") {
    const id = arg.match(/t\d+/i)?.[0]?.toLowerCase();
    if (!id) return "Which one? Give its id (see trigger list).";
    return removeTrigger(id) ? `Removed ${id}.` : `No trigger ${id}.`;
  }
  try {
    const r = createTrigger(parseTriggerInput(arg));
    const relayNote = r.when.app != null
      ? " It needs PC control on (the Claw relay reports which app is in front); the window title is matched, so a browser tab's site name works too."
      : "";
    return `Set ${r.id}: ${r.description} → ${r.then.kind === "say" ? `I'll say "${r.then.text}"` : `I'll answer "${r.then.text}"`}` +
      `${r.nag ? `, and repeat every ${r.cooldownMin} min while it stays true` : ""}.${relayNote}`;
  } catch (e) {
    return `No trigger set: ${e.message} Format: ACTION: trigger | app: <name> | after: 11pm | before: 5am | say: <message>  — or —  ACTION: trigger | at: 7:30am | days: weekdays | ask: <question>`;
  }
}
