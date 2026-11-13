// lib/reminders.js — "remind me in 20 minutes", "every weekday at 7am"
// ═══════════════════════════════════════════════════════════════════
//
// A reminder is { id, text, at, repeat?, created }. It comes from telling
// ARIA (ACTION: remind | in 20m | take the pizza out), from the Reminders
// panel or from the HUD. The server keeps the clock, so it fires whether or
// not a page is open, and survives a restart (data/reminders.json).
//
// The old `timer` tool was a setTimeout that logged to the console and was
// gone on restart; this is what "set a timer" means now.
//
// parseWhen() reads the ways people say a time:
//   in 20m · in 1h 30m · 90s · 5pm · 17:30 · noon · tonight
//   tomorrow 8am · fri 3pm · 2026-11-12 14:00 · 11/12 2pm
//   every day 7am · every weekday 7:30 · every mon 9am · every 2h
// Clock times are the owner's time zone (lib/clock.js), not the server's.
// ═══════════════════════════════════════════════════════════════════

import fs from "fs";
import path from "path";
import { DATA_DIR } from "./paths.js";
import { TZ, zoned, zonedMidnight } from "./clock.js";

const FILE = path.join(DATA_DIR, "reminders.json");
export const MAX_REMINDERS = 200;
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

let _list = [];
let _deps = { notify: () => {} };
let _timer = null;

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, "utf8"));
    _list = Array.isArray(raw.reminders) ? raw.reminders : [];
  } catch {
    _list = [];
  }
}
function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE + ".tmp", JSON.stringify({ reminders: _list }, null, 1));
    fs.renameSync(FILE + ".tmp", FILE);
  } catch (e) {
    console.warn("[reminders] save failed:", e.message);
  }
}

/* ── time ────────────────────────────────────────────────────── */

/** The instant of h:min on y-m-d in `tz` (right on DST-change days too). */
export function localTime(y, m, d, h, min = 0, tz = TZ) {
  let t = zonedMidnight(y, m, d, tz) + h * HOUR + min * MIN;
  // Midnight + h hours is off by one on the day the clocks change.
  const z = zoned(t, tz);
  const drift = (h * 60 + min) - (z.h * 60 + z.min);
  if (drift && Math.abs(drift) <= 120) t += drift * MIN;
  return t;
}

/** Day of week (0 = Sunday) of instant `t` in `tz`. */
export function weekday(t, tz = TZ) {
  const z = zoned(t, tz);
  return new Date(Date.UTC(z.y, z.m - 1, z.d)).getUTCDay();
}

/** "5pm", "5:30 pm", "17:30", "noon" → { h, min }, or null. */
function clockOf(s) {
  const t = String(s).trim().toLowerCase();
  if (t === "noon") return { h: 12, min: 0 };
  if (t === "midnight") return { h: 0, min: 0 };
  if (t === "morning") return { h: 9, min: 0 };
  if (t === "afternoon") return { h: 15, min: 0 };
  if (t === "evening" || t === "tonight") return { h: 20, min: 0 };
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?$/.exec(t);
  if (!m) return null;
  let h = +m[1];
  const min = m[2] ? +m[2] : 0;
  const ap = m[3]?.[0];
  if (ap && (h < 1 || h > 12)) return null;
  if (ap === "p" && h < 12) h += 12;
  if (ap === "a" && h === 12) h = 0;
  // A bare "5" is not a time; "17" or "5:00" is.
  if (!ap && !m[2] && h < 13) return null;
  return h <= 23 && min <= 59 ? { h, min } : null;
}

/** "20m", "1h 30m", "2 hours", "90 sec" → ms, or null. */
export function durationOf(s) {
  const t = String(s).trim().toLowerCase().replace(/\band\b|,/g, " ");
  if (!t) return null;
  let ms = 0;
  let rest = t;
  const re = /^\s*(\d+(?:\.\d+)?)\s*(s|sec|secs|seconds?|m|min|mins|minutes?|h|hr|hrs|hours?|d|days?|w|wk|weeks?)\b/;
  let m;
  let any = false;
  while ((m = re.exec(rest))) {
    const n = +m[1];
    const u = m[2][0];
    ms += n * (u === "s" ? 1000 : u === "m" ? MIN : u === "h" ? HOUR : u === "d" ? DAY : 7 * DAY);
    rest = rest.slice(m[0].length);
    any = true;
  }
  return any && !rest.trim() ? Math.round(ms) : null;
}

const dayIndex = (w) => {
  const k = String(w).toLowerCase().slice(0, 3);
  return DAYS.indexOf(k);
};
const DAY_WORD = "(sun|mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat)[a-z]*";

/**
 * When a phrase means, from `now`.
 * @returns {{ at: number, repeat?: object }} repeat is { kind: "daily" |
 *   "weekdays" | "weekly", h, min, dow? } or { kind: "every", ms }.
 * Throws a sentence that says what it could not read.
 */
export function parseWhen(input, now = Date.now(), tz = TZ) {
  const raw = String(input || "").trim().toLowerCase().replace(/\s+/g, " ").replace(/^(at|on|for)\s+/, "");
  if (!raw) throw new Error("When? Try: in 20m, 5pm, tomorrow 8am, every weekday 7am.");
  const z = zoned(now, tz);
  const at = (addDays, c) => localTime(z.y, z.m, z.d + addDays, c.h, c.min, tz);
  /** The next time the clock reads `c`: today if still ahead, else tomorrow. */
  const nextClock = (c) => (at(0, c) > now ? at(0, c) : at(1, c));
  const fail = () => {
    throw new Error(`I couldn't read "${input}" as a time. Try: in 20m, 5pm, tomorrow 8am, fri 3pm, every weekday 7am.`);
  };

  // ── repeating ──
  const rep = /^(?:every|each)\s+(.+)$/.exec(raw) || (/^daily\b/.test(raw) ? [null, "day " + raw.slice(5).trim()] : null);
  if (rep) {
    const r = rep[1].trim();
    const dur = durationOf(r) ?? durationOf("1 " + r);
    if (dur != null && !/^(day|weekday)/.test(r)) {
      if (dur < MIN) throw new Error("A repeating reminder can't be more often than once a minute.");
      return { at: now + dur, repeat: { kind: "every", ms: dur } };
    }
    let m = /^(day|weekday|weekdays)(?:\s+(?:at\s+)?(.+))?$/.exec(r);
    if (m) {
      const c = m[2] ? clockOf(m[2]) : { h: 9, min: 0 };
      if (!c) fail();
      const repeat = { kind: m[1] === "day" ? "daily" : "weekdays", ...c };
      return { at: nextRepeat({ at: now, repeat }, now, tz), repeat };
    }
    m = new RegExp(`^${DAY_WORD}(?:\\s+(?:at\\s+)?(.+))?$`).exec(r);
    if (m) {
      const c = m[2] ? clockOf(m[2]) : { h: 9, min: 0 };
      if (!c) fail();
      const repeat = { kind: "weekly", dow: dayIndex(m[1]), ...c };
      return { at: nextRepeat({ at: now, repeat }, now, tz), repeat };
    }
    fail();
  }

  // ── in 20m / 20 min ──
  const dur = durationOf(raw.replace(/^in\s+/, ""));
  if (dur != null) {
    if (dur < 1000) fail();
    if (dur > 366 * DAY) throw new Error("That's more than a year away.");
    return { at: now + dur };
  }

  // ── today / tonight / tomorrow [time] ──
  let m = /^(today|tonight|tomorrow|tmrw)(?:\s+(?:at\s+)?(.+))?$/.exec(raw);
  if (m) {
    const tonight = m[1] === "tonight";
    const c = m[2] ? clockOf(m[2]) : tonight ? { h: 20, min: 0 } : { h: 9, min: 0 };
    if (!c) fail();
    // "tonight 8" style times were refused above; "tonight 8pm" is fine.
    const t = at(/^t(omorrow|mrw)/.test(m[1]) ? 1 : 0, c);
    if (t <= now) throw new Error(`${m[1]} at that time has already passed.`);
    return { at: t };
  }

  // ── fri 3pm ──
  m = new RegExp(`^(?:next\\s+)?${DAY_WORD}(?:\\s+(?:at\\s+)?(.+))?$`).exec(raw);
  if (m) {
    const c = m[2] ? clockOf(m[2]) : { h: 9, min: 0 };
    if (!c) fail();
    const today = weekday(now, tz);
    let add = (dayIndex(m[1]) - today + 7) % 7;
    if (add === 0 && at(0, c) <= now) add = 7;
    return { at: at(add, c) };
  }

  // ── 2026-11-12 14:00 / 11/12 2pm ──
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ t]+(?:at\s+)?(.+))?$/.exec(raw) || null;
  let ymd = m ? { y: +m[1], mo: +m[2], d: +m[3], rest: m[4] } : null;
  if (!ymd) {
    m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?:\s+(?:at\s+)?(.+))?$/.exec(raw);
    if (m) {
      let y = m[3] ? +m[3] : z.y;
      if (y < 100) y += 2000;
      ymd = { y, mo: +m[1], d: +m[2], rest: m[4], noYear: !m[3] };
    }
  }
  if (ymd) {
    const c = ymd.rest ? clockOf(ymd.rest) : { h: 9, min: 0 };
    if (!c || ymd.mo < 1 || ymd.mo > 12 || ymd.d < 1 || ymd.d > 31) fail();
    let t = localTime(ymd.y, ymd.mo, ymd.d, c.h, c.min, tz);
    // "11/12" said in December means next year's.
    if (t <= now && ymd.noYear) t = localTime(ymd.y + 1, ymd.mo, ymd.d, c.h, c.min, tz);
    if (t <= now) throw new Error("That date has already passed.");
    return { at: t };
  }

  // ── 5pm ──
  const c = clockOf(raw);
  if (c) return { at: nextClock(c) };
  return fail();
}

/** When a repeating reminder is next due after `now`. */
export function nextRepeat(r, now = Date.now(), tz = TZ) {
  const rep = r.repeat;
  if (!rep) return null;
  if (rep.kind === "every") {
    // Catch up in one step after a long sleep, staying on the same beat.
    const missed = Math.max(0, Math.floor((now - r.at) / rep.ms));
    return r.at + (missed + 1) * rep.ms;
  }
  const z = zoned(now, tz);
  for (let add = 0; add <= 8; add++) {
    const t = localTime(z.y, z.m, z.d + add, rep.h, rep.min, tz);
    if (t <= now) continue;
    const dow = weekday(t, tz);
    if (rep.kind === "weekdays" && (dow === 0 || dow === 6)) continue;
    if (rep.kind === "weekly" && dow !== rep.dow) continue;
    return t;
  }
  return now + DAY;
}

export function describeRepeat(rep) {
  if (!rep) return "";
  if (rep.kind === "every") return `every ${fmtDuration(rep.ms)}`;
  const t = fmtClock(rep.h, rep.min);
  if (rep.kind === "daily") return `every day at ${t}`;
  if (rep.kind === "weekdays") return `every weekday at ${t}`;
  return `every ${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][rep.dow]} at ${t}`;
}

const fmtClock = (h, min) => `${h % 12 || 12}${min ? ":" + String(min).padStart(2, "0") : ""}${h < 12 ? "am" : "pm"}`;

export function fmtDuration(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
  return `${Math.round(h / 24)} days`;
}

/** "in 20 min (5:40pm)" / "tomorrow at 8am" / "Fri Nov 13 at 3pm". */
export function fmtWhen(at, now = Date.now(), tz = TZ) {
  const z = zoned(at, tz);
  const clockStr = fmtClock(z.h, z.min);
  const left = at - now;
  if (left < 90 * MIN && left > 0) return `in ${fmtDuration(left)} (${clockStr})`;
  const today = zoned(now, tz);
  const dayDiff = Math.round((zonedMidnight(z.y, z.m, z.d, tz) - zonedMidnight(today.y, today.m, today.d, tz)) / DAY);
  if (dayDiff === 0) return `today at ${clockStr}`;
  if (dayDiff === 1) return `tomorrow at ${clockStr}`;
  if (dayDiff === -1) return `yesterday at ${clockStr}`;
  const label = new Date(Date.UTC(z.y, z.m - 1, z.d)).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  return `${label} at ${clockStr}`;
}

/* ── the list ────────────────────────────────────────────────── */

export function add({ when, text, at = null, repeat = null }, now = Date.now()) {
  const what = String(text || "").replace(/\s+/g, " ").trim().slice(0, 300);
  if (!what) throw new Error("Remind you of what?");
  if (_list.length >= MAX_REMINDERS) throw new Error(`That's ${MAX_REMINDERS} reminders already. Clear some first.`);
  const w = at != null ? { at: Number(at), repeat } : parseWhen(when, now);
  if (!(w.at > now - 1000)) throw new Error("That time has already passed.");
  const r = {
    id: `r${now.toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    text: what,
    at: w.at,
    ...(w.repeat ? { repeat: w.repeat } : {}),
    created: now,
  };
  _list.push(r);
  save();
  return r;
}

export const list = () => [..._list].sort((a, b) => a.at - b.at).map((r) => ({ ...r }));
export const upcoming = (n = 5) => list().slice(0, n);

export function remove(id) {
  const i = _list.findIndex((r) => r.id === id);
  if (i < 0) return false;
  _list.splice(i, 1);
  save();
  return true;
}

/** Push a reminder back (the toast's Snooze). A fired one-off comes back. */
export function snooze(idOrReminder, minutes = 10, now = Date.now()) {
  const mins = Math.max(1, Math.min(24 * 60, Math.round(Number(minutes)) || 10));
  const existing = typeof idOrReminder === "string" ? _list.find((r) => r.id === idOrReminder) : null;
  if (existing && !existing.repeat) {
    existing.at = now + mins * MIN;
    save();
    return { ...existing };
  }
  const text = existing?.text || idOrReminder?.text;
  if (!text) return null;
  return add({ text, at: now + mins * MIN }, now);
}

/** By id, or by words in its text ("cancel the pizza one"). */
export function find(q) {
  const s = String(q || "").trim().toLowerCase();
  if (!s) return null;
  return _list.find((r) => r.id === s) || _list.find((r) => r.text.toLowerCase().includes(s)) || null;
}

/** Fires what's due. Returns the reminders that fired. */
export function tick(now = Date.now()) {
  const due = _list.filter((r) => r.at <= now);
  if (!due.length) return [];
  for (const r of due) {
    // Due long ago = the server was off at the time; say so rather than
    // announcing an 8am reminder at 3pm as if it were on time.
    const late = now - r.at > 10 * MIN ? ` (was due ${fmtWhen(r.at, now)})` : "";
    try {
      _deps.notify({ title: `Reminder: ${r.text}`, text: late.trim(), icon: "⏰", urgent: true, reminder: { id: r.id, text: r.text, repeat: !!r.repeat } });
    } catch (e) {
      console.warn("[reminders] notify failed:", e.message);
    }
    if (r.repeat) r.at = nextRepeat(r, now);
  }
  _list = _list.filter((r) => r.repeat || r.at > now);
  save();
  return due;
}

export function summary(now = Date.now()) {
  const l = list();
  if (!l.length) return "No reminders set.";
  return l.map((r) => `- ${r.text} — ${fmtWhen(r.at, now)}${r.repeat ? ` (${describeRepeat(r.repeat)})` : ""}`).join("\n");
}

/**
 * ACTION: remind | in 20m | take the pizza out
 * ACTION: remind | every weekday 7am | pack gym bag
 * ACTION: remind list
 * ACTION: remind cancel | pizza
 */
export function runReminderTool(name, input, now = Date.now()) {
  const sub = String(name).toLowerCase().replace(/^(remind(er)?s?|timer)\s*/, "").trim();
  const arg = String(input || "").trim();
  try {
    if (sub === "list" || (!sub && !arg)) return summary(now);
    if (/^(cancel|remove|delete|stop|clear)$/.test(sub)) {
      if (!arg || /^all$/i.test(arg)) {
        if (!/^all$/i.test(arg)) return "Cancel which one? Say a word from it, or 'all'.";
        const n = _list.length;
        _list = [];
        save();
        return `Cleared ${n} reminder${n === 1 ? "" : "s"}.`;
      }
      const r = find(arg);
      if (!r) return `No reminder matches "${arg}".\n${summary(now)}`;
      remove(r.id);
      return `Cancelled: ${r.text}.`;
    }
    // "<when> | <what>"; a model sometimes sends them the other way round.
    let [when, ...rest] = arg.split("|").map((s) => s.trim());
    let text = rest.join(" | ");
    if (!text) {
      // "in 20m take the pizza out": the longest leading part that reads as a time.
      const words = arg.split(/\s+/);
      for (let i = Math.min(words.length - 1, 6); i >= 1; i--) {
        try {
          parseWhen(words.slice(0, i).join(" "), now);
          when = words.slice(0, i).join(" ");
          text = words.slice(i).join(" ").replace(/^(to|that)\s+/i, "");
          break;
        } catch {}
      }
      if (!text) return "Usage: remind | <when> | <what>   e.g. remind | in 20m | take the pizza out";
    } else {
      try {
        parseWhen(when, now);
      } catch (e) {
        try {
          parseWhen(text, now);
          [when, text] = [text, when];
        } catch {
          throw e;
        }
      }
    }
    const r = add({ when, text }, now);
    return `Okay: "${r.text}" ${fmtWhen(r.at, now)}${r.repeat ? `, then ${describeRepeat(r.repeat)}` : ""}.`;
  } catch (e) {
    return `Couldn't set that: ${e.message}`;
  }
}

export function init(deps = {}, { start = true, everyMs = 15_000 } = {}) {
  _deps = { ..._deps, ...deps };
  load();
  clearInterval(_timer);
  if (start) {
    _timer = setInterval(() => tick(), everyMs);
    _timer.unref?.();
  }
}

export function _reset(list = []) {
  _list = list;
}
