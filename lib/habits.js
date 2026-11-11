// lib/habits.js — Daily Rings: the handful of things you want to do every
// day, and the streak you keep by doing them
// ═══════════════════════════════════════════════════════════════════
//
// A ring is { name, target } — "Read" once a day, "Water" 8 times a day.
// Checking in adds to today's count; the ring closes when the count reaches
// the target. Close every ring and the day counts toward the streak.
//
// Rings come from the Daily Rings panel, the home screen's core (the inner
// ring fills as they close), or chat and text ("I read today" → ACTION:
// rings done | Read).
//
// "Today" is the owner's day (lib/clock.js), so a check-in texted at 11 PM
// lands on the same day the PC shows.
// ═══════════════════════════════════════════════════════════════════

import fs from "fs";
import path from "path";
import { DATA_DIR } from "./paths.js";
import { dayBounds, dateKey } from "./clock.js";

const FILE = path.join(DATA_DIR, "habits.json");
const DAY = 86400_000;
export const MAX_HABITS = 12;
export const MAX_TARGET = 99;
const KEEP_DAYS = 400;

let _habits = [];

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, "utf8"));
    _habits = Array.isArray(raw.habits) ? raw.habits : [];
  } catch {
    _habits = [];
  }
}
function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE + ".tmp", JSON.stringify({ habits: _habits, updatedAt: Date.now() }));
    fs.renameSync(FILE + ".tmp", FILE);
  } catch (e) {
    console.warn("[habits] save failed:", e.message);
  }
}

const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
const newId = () => "h" + Math.random().toString(36).slice(2, 8);

/* ── days (pure) ─────────────────────────────────────────────── */

/** The date key `back` days before the owner's today. Noon-anchored, so a
 *  23- or 25-hour DST day can't skip or repeat a date. */
export function dayKey(now = Date.now(), back = 0, tz) {
  const noon = dayBounds(now, tz).start + DAY / 2;
  return dateKey(noon - back * DAY, tz);
}

const countOn = (h, key) => Number(h.log?.[key]) || 0;
const closedOn = (h, key) => countOn(h, key) >= (h.target || 1);

/**
 * Days in a row this ring was closed, ending today — or yesterday, when
 * today's isn't closed yet (the streak isn't lost until the day is over).
 */
export function streak(h, now = Date.now(), tz) {
  let back = closedOn(h, dayKey(now, 0, tz)) ? 0 : 1;
  let n = 0;
  while (n < KEEP_DAYS && closedOn(h, dayKey(now, back, tz))) {
    n++;
    back++;
  }
  return n;
}

/** The longest run of closed days anywhere in the log. */
export function bestStreak(h) {
  const days = Object.keys(h.log || {})
    .filter((k) => closedOn(h, k))
    .sort();
  let best = 0, run = 0, prev = null;
  for (const k of days) {
    const t = Date.parse(k + "T12:00:00Z");
    run = prev != null && Math.round((t - prev) / DAY) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = t;
  }
  return best;
}

/** The last 7 days, oldest first: how full the ring was each day (0–1). */
export function week(h, now = Date.now(), tz) {
  const out = [];
  for (let back = 6; back >= 0; back--) {
    const key = dayKey(now, back, tz);
    out.push({ day: key, fill: Math.min(1, countOn(h, key) / (h.target || 1)) });
  }
  return out;
}

/* ── the list ────────────────────────────────────────────────── */

/** A ring by id, exact name, then a name that starts with / contains it. */
export function find(ref) {
  const q = norm(ref);
  if (!q) return null;
  return (
    _habits.find((h) => h.id === ref) ||
    _habits.find((h) => norm(h.name) === q) ||
    _habits.find((h) => norm(h.name).startsWith(q)) ||
    _habits.find((h) => norm(h.name).includes(q) || q.includes(norm(h.name))) ||
    null
  );
}

function cleanTarget(t) {
  const n = Math.round(Number(t));
  return Number.isFinite(n) && n >= 1 ? Math.min(MAX_TARGET, n) : 1;
}

export function addHabit(name, { target = 1, now = Date.now() } = {}) {
  const clean = String(name || "").replace(/\s+/g, " ").trim().slice(0, 40);
  if (!clean) throw new Error("A ring needs a name.");
  if (_habits.some((h) => norm(h.name) === norm(clean))) throw new Error(`There's already a ring called "${clean}".`);
  if (_habits.length >= MAX_HABITS) throw new Error(`That's the limit (${MAX_HABITS} rings). Remove one first.`);
  const h = { id: newId(), name: clean, target: cleanTarget(target), createdAt: now, log: {} };
  _habits.push(h);
  save();
  return h;
}

export function editHabit(ref, { name, target } = {}) {
  const h = find(ref);
  if (!h) throw new Error("No such ring.");
  if (name != null) {
    const clean = String(name).replace(/\s+/g, " ").trim().slice(0, 40);
    if (!clean) throw new Error("A ring needs a name.");
    if (_habits.some((o) => o !== h && norm(o.name) === norm(clean))) throw new Error(`There's already a ring called "${clean}".`);
    h.name = clean;
  }
  if (target != null) h.target = cleanTarget(target);
  save();
  return h;
}

export function removeHabit(ref) {
  const h = find(ref);
  if (!h) return null;
  _habits = _habits.filter((x) => x !== h);
  save();
  return h;
}

/**
 * Adds `amount` to today's count (negative takes it back). Never below 0,
 * and never above 10× the target, so a stuck key can't write nonsense.
 */
export function checkIn(ref, { amount = 1, now = Date.now(), tz } = {}) {
  const h = find(ref);
  if (!h) throw new Error("No such ring.");
  const key = dayKey(now, 0, tz);
  const step = Math.round(Number(amount)) || 1;
  const next = Math.max(0, Math.min(h.target * 10, countOn(h, key) + step));
  h.log = h.log || {};
  if (next) h.log[key] = next;
  else delete h.log[key];
  prune(h, now, tz);
  save();
  return h;
}

/** Closes the ring for today if it's open, reopens it (count 0) if closed. */
export function toggle(ref, { now = Date.now(), tz } = {}) {
  const h = find(ref);
  if (!h) throw new Error("No such ring.");
  const key = dayKey(now, 0, tz);
  h.log = h.log || {};
  if (closedOn(h, key)) delete h.log[key];
  else h.log[key] = h.target;
  prune(h, now, tz);
  save();
  return h;
}

function prune(h, now, tz) {
  const keys = Object.keys(h.log || {});
  if (keys.length <= KEEP_DAYS) return;
  const cutoff = dayKey(now, KEEP_DAYS, tz);
  for (const k of keys) if (k < cutoff) delete h.log[k];
}

/* ── what the panel, the home core and ARIA read ─────────────── */

export function view(h, now = Date.now(), tz) {
  const count = countOn(h, dayKey(now, 0, tz));
  return {
    id: h.id,
    name: h.name,
    target: h.target,
    count,
    done: count >= h.target,
    fill: Math.min(1, count / h.target),
    streak: streak(h, now, tz),
    best: bestStreak(h),
    week: week(h, now, tz),
  };
}

/** Days in a row EVERY ring was closed (rings added later don't break it). */
export function perfectStreak(now = Date.now(), tz) {
  if (!_habits.length) return 0;
  const allClosed = (back) => {
    const key = dayKey(now, back, tz);
    const live = _habits.filter((h) => dayKey(h.createdAt, 0, tz) <= key);
    return live.length > 0 && live.every((h) => closedOn(h, key));
  };
  let back = allClosed(0) ? 0 : 1;
  let n = 0;
  while (n < KEEP_DAYS && allClosed(back)) {
    n++;
    back++;
  }
  return n;
}

export function summary(now = Date.now(), tz) {
  const habits = _habits.map((h) => view(h, now, tz));
  const total = habits.length;
  const done = habits.filter((h) => h.done).length;
  // The average fill, not just closed/total: 4 of 8 glasses moves the ring.
  const percent = total ? Math.round((habits.reduce((a, h) => a + h.fill, 0) / total) * 100) : 0;
  return { habits, total, done, percent, perfectStreak: perfectStreak(now, tz), day: dayKey(now, 0, tz), line: line(habits) };
}

function line(habits) {
  if (!habits.length) return "";
  const open = habits.filter((h) => !h.done);
  if (!open.length) return `Rings: all ${habits.length} closed today.`;
  const left = open.map((h) => (h.target > 1 ? `${h.name} (${h.count}/${h.target})` : h.name)).join(", ");
  return `Rings: ${habits.length - open.length}/${habits.length} closed today. Still open: ${left}.`;
}

/** One line for the briefing and the debrief; "" when there are no rings. */
export function todayLine(now = Date.now(), tz) {
  return line(_habits.map((h) => view(h, now, tz)));
}

/* ── ACTION: rings ───────────────────────────────────────────── */

export function runHabitTool(name, input, now = Date.now()) {
  const sub = String(name || "").toLowerCase().replace(/^(rings?|habits?)\s*/, "").trim();
  const p = String(input || "").split("|").map((x) => x.trim());
  try {
    if (!sub || sub === "list") {
      const s = summary(now);
      if (!s.total) return 'No rings yet. Add one: rings add | <name> | <times a day>.';
      return [
        s.line,
        ...s.habits.map((h) => `${h.done ? "●" : "○"} ${h.name}: ${h.count}/${h.target} today, streak ${h.streak} day${h.streak === 1 ? "" : "s"} (best ${h.best})`),
        s.perfectStreak ? `Every ring closed ${s.perfectStreak} day${s.perfectStreak === 1 ? "" : "s"} running.` : "",
      ].filter(Boolean).join("\n");
    }
    if (sub === "add") {
      if (!p[0]) return "Usage: rings add | <name> | <times a day, default 1>";
      const h = addHabit(p[0], { target: p[1] || 1, now });
      return `Added the ring "${h.name}"${h.target > 1 ? ` (${h.target} a day)` : ""}.`;
    }
    if (sub === "done" || sub === "check") {
      if (!p[0]) return "Usage: rings done | <name> | <how many, default 1>";
      const amount = Math.round(Number(p[1])) || 1;
      const h = checkIn(p[0], { amount, now });
      const v = view(h, now);
      const left = todayLine(now);
      return v.done
        ? `"${v.name}" is closed for today — streak ${v.streak} day${v.streak === 1 ? "" : "s"}. ${left}`
        : `"${v.name}": ${v.count}/${v.target} today. ${left}`;
    }
    if (sub === "undo") {
      if (!p[0]) return "Usage: rings undo | <name>";
      const h = checkIn(p[0], { amount: -(Math.round(Number(p[1])) || 1), now });
      const v = view(h, now);
      return `"${v.name}" is back to ${v.count}/${v.target} today.`;
    }
    if (sub === "remove" || sub === "delete") {
      const h = removeHabit(p[0]);
      return h ? `Removed the ring "${h.name}".` : "No such ring.";
    }
    return "rings: use list, add, done, undo or remove.";
  } catch (e) {
    return `rings: ${e.message}`;
  }
}

export function init() {
  load();
}

/** Tests only. */
export function _reset(list = []) {
  _habits = list;
}
