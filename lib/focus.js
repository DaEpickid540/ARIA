// lib/focus.js — focus sessions, and holding alerts while you're heads-down
// ═══════════════════════════════════════════════════════════════════
//
// A focus session is a block of minutes with a goal ("25 on the essay").
// Starting one can close the apps you listed as distractions (through
// Claw's close:, which asks an app's windows to close rather than killing
// it), and holds ARIA's own alerts until the block ends. The log of
// sessions gives today / this week / streak, which the HUD and the
// briefing read.
//
// Quiet hours are the same holding, by the clock: between `from` and `to`
// alerts wait and arrive as one digest afterwards. Anything marked urgent
// (a reminder you set for that very time, a routine that failed) goes
// straight through either way.
// ═══════════════════════════════════════════════════════════════════

import fs from "fs";
import path from "path";
import { DATA_DIR } from "./paths.js";
import { TZ, zoned, dateKey } from "./clock.js";

const FILE = path.join(DATA_DIR, "focus.json");
const MAX_SESSIONS = 1000;
const MAX_HELD = 100;
const MIN = 60_000;
const DAY = 86400_000;

const DEFAULTS = {
  apps: [], // closed when a session starts
  holdAlerts: true,
  quiet: { enabled: false, from: 22, to: 7 },
};

let _state = { active: null, sessions: [], held: [], settings: structuredClone(DEFAULTS) };
let _deps = { notify: () => {}, deliver: () => {}, closeApp: null };
let _timer = null;

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, "utf8"));
    _state = {
      active: raw.active || null,
      sessions: Array.isArray(raw.sessions) ? raw.sessions : [],
      held: Array.isArray(raw.held) ? raw.held : [],
      settings: mergeSettings(raw.settings),
    };
  } catch {
    _state = { active: null, sessions: [], held: [], settings: structuredClone(DEFAULTS) };
  }
}
function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE + ".tmp", JSON.stringify(_state, null, 1));
    fs.renameSync(FILE + ".tmp", FILE);
  } catch (e) {
    console.warn("[focus] save failed:", e.message);
  }
}

const hour = (h, dflt) => (Number.isFinite(+h) && h !== "" && h != null ? Math.min(23, Math.max(0, Math.round(+h))) : dflt);
function mergeSettings(s = {}) {
  const apps = (Array.isArray(s?.apps) ? s.apps : String(s?.apps || "").split(","))
    .map((a) => String(a).replace(/["'`$&|;<>^()\r\n]/g, "").trim().slice(0, 60))
    .filter(Boolean);
  return {
    apps: [...new Set(apps)].slice(0, 20),
    holdAlerts: s?.holdAlerts !== false,
    quiet: {
      enabled: !!s?.quiet?.enabled,
      from: hour(s?.quiet?.from, DEFAULTS.quiet.from),
      to: hour(s?.quiet?.to, DEFAULTS.quiet.to),
    },
  };
}

export const settings = () => structuredClone(_state.settings);
export function setSettings(patch = {}) {
  _state.settings = mergeSettings({
    ..._state.settings,
    ...patch,
    quiet: { ..._state.settings.quiet, ...(patch.quiet || {}) },
  });
  save();
  return settings();
}

/* ── quiet hours ─────────────────────────────────────────────── */

/** Is hour-of-day `h` inside from→to (which may wrap midnight)? */
export function inWindow(h, from, to) {
  if (from === to) return false;
  return from < to ? h >= from && h < to : h >= from || h < to;
}
export function quietNow(now = Date.now(), tz = TZ) {
  const q = _state.settings.quiet;
  return q.enabled && inWindow(zoned(now, tz).h, q.from, q.to);
}

/** Why alerts are being held right now, or null when they aren't. */
export function holdReason(now = Date.now()) {
  if (_state.active && _state.settings.holdAlerts && _state.active.endsAt > now) return "focus";
  if (quietNow(now)) return "quiet";
  return null;
}

/**
 * Called for every alert before it's filed. True = held; it comes back in
 * the digest. Urgent alerts are never held.
 */
export function hold(alert, now = Date.now()) {
  if (!alert || alert.urgent || alert.digest) return false;
  const why = holdReason(now);
  if (!why) return false;
  _state.held.push({ title: String(alert.title || "").slice(0, 200), text: String(alert.text || "").slice(0, 600), icon: alert.icon || "🔔", link: alert.link || "", at: now, why });
  if (_state.held.length > MAX_HELD) _state.held = _state.held.slice(-MAX_HELD);
  save();
  return true;
}

export const heldCount = () => _state.held.length;

/** Everything held, as one alert; empties the list. Null when nothing was held. */
export function digest(now = Date.now()) {
  const held = _state.held;
  if (!held.length) return null;
  _state.held = [];
  save();
  const why = held.every((h) => h.why === "focus") ? "while you were focused" : "during quiet hours";
  return {
    title: held.length === 1 ? held[0].title : `${held.length} things ${why}`,
    text: held.length === 1 ? held[0].text : held.map((h) => `${h.icon} **${h.title}**${h.text ? ` — ${h.text.split("\n")[0].slice(0, 160)}` : ""}`).join("\n"),
    icon: held.length === 1 ? held[0].icon : "📥",
    link: held.length === 1 ? held[0].link : "",
    digest: true,
  };
}

/* ── sessions ────────────────────────────────────────────────── */

export const active = (now = Date.now()) => (_state.active && _state.active.endsAt > now ? { ..._state.active, leftMs: _state.active.endsAt - now } : null);

/** Starts a block. Closes the distraction apps when a relay is there to do it. */
export async function start({ minutes = 25, goal = "" } = {}, now = Date.now()) {
  const m = Math.round(Number(minutes));
  if (!(m >= 1 && m <= 240)) throw new Error("A focus block is 1 to 240 minutes.");
  if (active(now)) throw new Error(`Already focusing${_state.active.goal ? ` on ${_state.active.goal}` : ""}: ${Math.ceil((_state.active.endsAt - now) / MIN)} min left. Stop it first.`);
  _state.active = {
    id: `f${now.toString(36)}`,
    goal: String(goal || "").replace(/\s+/g, " ").trim().slice(0, 120),
    minutes: m,
    startedAt: now,
    endsAt: now + m * MIN,
    closed: [],
  };
  save();
  const closed = [];
  if (_deps.closeApp)
    for (const app of _state.settings.apps) {
      try {
        const out = String((await _deps.closeApp(app)) ?? "");
        if (/^closed /i.test(out)) closed.push(app);
      } catch {}
    }
  if (_state.active) {
    _state.active.closed = closed;
    save();
  }
  return { ...active(now), closed };
}

/** Ends the block now. `completed` false = stopped early (still logged, with the minutes done). */
export function stop({ completed = false } = {}, now = Date.now()) {
  const a = _state.active;
  if (!a) return null;
  const done = Math.max(0, Math.min(a.minutes, Math.round((Math.min(now, a.endsAt) - a.startedAt) / MIN)));
  const session = { id: a.id, goal: a.goal, planned: a.minutes, minutes: done, startedAt: a.startedAt, endedAt: Math.min(now, a.endsAt), completed: !!completed };
  _state.active = null;
  // Under a minute is a misclick, not a session.
  if (done >= 1) _state.sessions.push(session);
  if (_state.sessions.length > MAX_SESSIONS) _state.sessions = _state.sessions.slice(-MAX_SESSIONS);
  save();
  return session;
}

/** today / last 7 days / streak (days in a row with a session, the owner's days). */
export function stats(now = Date.now(), tz = TZ) {
  const today = dateKey(now, tz);
  const byDay = new Map();
  for (const s of _state.sessions) {
    const k = dateKey(s.startedAt, tz);
    byDay.set(k, (byDay.get(k) || 0) + s.minutes);
  }
  let weekMin = 0;
  const week = [];
  for (let i = 6; i >= 0; i--) {
    const k = dateKey(now - i * DAY, tz);
    const m = byDay.get(k) || 0;
    weekMin += m;
    week.push({ day: k, minutes: m });
  }
  // The streak holds through today even before today's first session.
  let streak = 0;
  for (let i = byDay.has(today) ? 0 : 1; i < 400; i++) {
    if (!byDay.has(dateKey(now - i * DAY, tz))) break;
    streak++;
  }
  const todaySessions = _state.sessions.filter((s) => dateKey(s.startedAt, tz) === today);
  return { todayMin: byDay.get(today) || 0, todaySessions: todaySessions.length, weekMin, week, streak, total: _state.sessions.length };
}

export const sessions = (n = 20) => _state.sessions.slice(-n).reverse();

/** Ends a block that ran out, and hands back held alerts once nothing holds them. */
export function tick(now = Date.now()) {
  const a = _state.active;
  if (a && a.endsAt <= now) {
    const s = stop({ completed: true }, now);
    const st = stats(now);
    try {
      _deps.notify({
        title: `Focus block done: ${s.minutes} min${s.goal ? ` on ${s.goal}` : ""}`,
        text: `Today: ${st.todayMin} min in ${st.todaySessions} block${st.todaySessions === 1 ? "" : "s"}${st.streak > 1 ? ` · ${st.streak}-day streak` : ""}.`,
        icon: "🎯",
        urgent: true,
        focusDone: true,
      });
    } catch {}
  }
  if (_state.held.length && !holdReason(now)) {
    const d = digest(now);
    if (d)
      try {
        _deps.deliver(d);
      } catch {}
  }
}

export function summary(now = Date.now()) {
  const a = active(now);
  const st = stats(now);
  const lines = [];
  if (a) lines.push(`Focusing${a.goal ? ` on ${a.goal}` : ""}: ${Math.ceil(a.leftMs / MIN)} of ${a.minutes} min left.`);
  else lines.push("Not in a focus block.");
  lines.push(`Today: ${st.todayMin} min in ${st.todaySessions} block${st.todaySessions === 1 ? "" : "s"} · last 7 days: ${st.weekMin} min · streak: ${st.streak} day${st.streak === 1 ? "" : "s"}.`);
  const s = _state.settings;
  if (s.apps.length) lines.push(`Closes when a block starts: ${s.apps.join(", ")}.`);
  if (s.quiet.enabled) lines.push(`Quiet hours: ${s.quiet.from}:00–${s.quiet.to}:00${quietNow(now) ? " (on now)" : ""}.`);
  if (_state.held.length) lines.push(`${_state.held.length} alert${_state.held.length === 1 ? "" : "s"} held for later.`);
  return lines.join("\n");
}

/**
 * ACTION: focus start | 25 | essay draft
 * ACTION: focus stop
 * ACTION: focus                       (where things stand)
 * ACTION: focus apps | Discord, Spotify
 * ACTION: focus quiet | 22-7          (or: off)
 */
export async function runFocusTool(name, input, now = Date.now()) {
  const sub = String(name).toLowerCase().replace(/^focus\s*/, "").trim();
  const arg = String(input || "").trim();
  try {
    if (!sub || sub === "status" || sub === "summary") return summary(now);
    if (sub === "start") {
      const parts = arg.split("|").map((s) => s.trim());
      // "25 | essay", "essay | 25", "essay", or nothing.
      let minutes = 25;
      let goal = "";
      for (const p of parts) {
        if (/^\d+(\s*(m|min|mins|minutes))?$/i.test(p)) minutes = parseInt(p, 10);
        else if (p) goal = goal ? `${goal} ${p}` : p;
      }
      const s = await start({ minutes, goal }, now);
      return `Focus block started: ${s.minutes} min${s.goal ? ` on ${s.goal}` : ""}.${s.closed.length ? ` Closed ${s.closed.join(", ")}.` : ""}${_state.settings.holdAlerts ? " I'll hold alerts until it ends." : ""}`;
    }
    if (/^(stop|end|cancel)$/.test(sub)) {
      const s = stop({ completed: false }, now);
      if (!s) return "There's no focus block running.";
      return s.minutes >= 1 ? `Stopped after ${s.minutes} of ${s.planned} min${s.goal ? ` on ${s.goal}` : ""}. Logged.` : "Stopped (under a minute, so not logged).";
    }
    if (sub === "apps") {
      const s = setSettings({ apps: /^(none|clear|off)$/i.test(arg) ? [] : arg.split(",") });
      return s.apps.length ? `When a focus block starts I'll close: ${s.apps.join(", ")}.` : "A focus block won't close any apps.";
    }
    if (sub === "quiet") {
      if (/^(off|none|disable)$/i.test(arg)) {
        setSettings({ quiet: { enabled: false } });
        return "Quiet hours are off.";
      }
      const m = /^(\d{1,2})\s*(?:-|–|to)\s*(\d{1,2})$/.exec(arg);
      if (!m || +m[1] > 23 || +m[2] > 23) return "Usage: focus quiet | 22-7   (hours, 0–23), or: focus quiet | off";
      const s = setSettings({ quiet: { enabled: true, from: +m[1], to: +m[2] } });
      return `Quiet hours set: ${s.quiet.from}:00 to ${s.quiet.to}:00. Alerts in that time arrive together afterwards; reminders you set still ring.`;
    }
    return "Usage: focus start | <minutes> | <goal> · focus stop · focus · focus apps | <names> · focus quiet | 22-7";
  } catch (e) {
    return `Couldn't do that: ${e.message}`;
  }
}

export function init(deps = {}, { start: run = true, everyMs = 15_000 } = {}) {
  _deps = { ..._deps, ...deps };
  load();
  clearInterval(_timer);
  if (run) {
    _timer = setInterval(() => tick(), everyMs);
    _timer.unref?.();
  }
}

export function _reset(state = {}) {
  _state = { active: null, sessions: [], held: [], settings: structuredClone(DEFAULTS), ...state };
  if (state.settings) _state.settings = mergeSettings(state.settings);
}
