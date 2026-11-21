// lib/journal.js — Journal & Mood: one entry a day, how it went (1–5) and
// a few lines about it
// ═══════════════════════════════════════════════════════════════════
//
// An entry is { mood, note, updatedAt } under its date key ("2026-11-20").
// One per day: writing again today updates today's entry. A mood is 1–5
// (rough, low, okay, good, great), or null when there's only a note.
// #words in a note are tags ("#gym #exam"), counted over the last month.
//
// Entries come from the Journal panel (Tools → Journal) or chat ("today was
// a 4, finally finished the essay" → ACTION: journal log | 4 | finally
// finished the essay). The evening debrief reads today's line.
//
// "Today" is the owner's day (lib/clock.js), like Daily Rings.
// ═══════════════════════════════════════════════════════════════════

import fs from "fs";
import path from "path";
import { DATA_DIR } from "./paths.js";
import { dayBounds, dateKey } from "./clock.js";

const FILE = path.join(DATA_DIR, "journal.json");
const DAY = 86400_000;
export const MAX_NOTE = 2000;
export const KEEP_DAYS = 730;
export const MOODS = ["", "rough", "low", "okay", "good", "great"];
const KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

let _entries = {};

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, "utf8"));
    _entries = raw && typeof raw.entries === "object" && raw.entries ? raw.entries : {};
  } catch {
    _entries = {};
  }
}
function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE + ".tmp", JSON.stringify({ entries: _entries, updatedAt: Date.now() }));
    fs.renameSync(FILE + ".tmp", FILE);
  } catch (e) {
    console.warn("[journal] save failed:", e.message);
  }
}

/* ── days and values (pure) ──────────────────────────────────── */

/** The date key `back` days before the owner's today (noon-anchored, DST-safe). */
export function dayKey(now = Date.now(), back = 0, tz) {
  const noon = dayBounds(now, tz).start + DAY / 2;
  return dateKey(noon - back * DAY, tz);
}

/** 1–5, or null for "no mood". Accepts "4", 4, "4/5", "good", "great". */
export function cleanMood(m) {
  if (m == null || m === "") return null;
  const s = String(m).trim().toLowerCase();
  const word = MOODS.indexOf(s);
  if (word > 0) return word;
  const n = Math.round(parseFloat(s));
  if (!Number.isFinite(n) || n < 1 || n > 5) throw new Error("A mood is 1 to 5 (rough, low, okay, good, great).");
  return n;
}

export function cleanNote(n) {
  return String(n ?? "").replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").trim().slice(0, MAX_NOTE);
}

/** "today", "yesterday", "3 days ago" or "2026-11-19" → a date key; null if unreadable. */
export function resolveDay(ref, now = Date.now(), tz) {
  const s = String(ref ?? "").trim().toLowerCase();
  if (!s || s === "today") return dayKey(now, 0, tz);
  if (s === "yesterday") return dayKey(now, 1, tz);
  const ago = /^(\d{1,3})\s*days?\s*ago$/.exec(s);
  if (ago) return dayKey(now, +ago[1], tz);
  if (KEY_RE.test(s) && !Number.isNaN(Date.parse(s + "T12:00:00Z"))) return s;
  return null;
}

export function tagsOf(note) {
  return [...new Set([...String(note || "").matchAll(/(?:^|\s)#([a-z][\w-]{0,29})/gi)].map((m) => m[1].toLowerCase()))];
}

/* ── writing ─────────────────────────────────────────────────── */

/**
 * Writes the entry for `day` (default today). `mood` undefined leaves the
 * mood as it was; null clears it. `append` adds the note as a new line
 * instead of replacing it. An entry with no mood and no note is removed.
 */
export function write({ day, mood, note, append = false, now = Date.now(), tz } = {}) {
  const key = resolveDay(day, now, tz);
  if (!key) throw new Error("That day isn't one I can read. Use today, yesterday, or YYYY-MM-DD.");
  if (key > dayKey(now, 0, tz)) throw new Error("That day hasn't happened yet.");
  const prev = _entries[key] || { mood: null, note: "" };
  const next = { ...prev };
  if (mood !== undefined) next.mood = cleanMood(mood);
  if (note !== undefined) {
    const n = cleanNote(note);
    next.note = append && prev.note && n ? cleanNote(prev.note + "\n" + n) : append && !n ? prev.note : n;
  }
  next.updatedAt = now;
  if (next.mood == null && !next.note) delete _entries[key];
  else _entries[key] = next;
  prune(now, tz);
  save();
  return key;
}

export function remove(day, { now = Date.now(), tz } = {}) {
  const key = resolveDay(day, now, tz);
  if (!key || !_entries[key]) return null;
  const e = _entries[key];
  delete _entries[key];
  save();
  return { day: key, ...e };
}

function prune(now, tz) {
  const keys = Object.keys(_entries);
  if (keys.length <= KEEP_DAYS) return;
  const cutoff = dayKey(now, KEEP_DAYS, tz);
  for (const k of keys) if (k < cutoff) delete _entries[k];
}

export function get(day, now = Date.now(), tz) {
  const key = resolveDay(day, now, tz);
  return key && _entries[key] ? { day: key, ..._entries[key] } : null;
}

/* ── reading ─────────────────────────────────────────────────── */

/** Days in a row with an entry, ending today — or yesterday while today is still blank. */
export function streak(now = Date.now(), tz) {
  let back = _entries[dayKey(now, 0, tz)] ? 0 : 1;
  let n = 0;
  while (n < KEEP_DAYS && _entries[dayKey(now, back, tz)]) {
    n++;
    back++;
  }
  return n;
}

/** The longest run of consecutive days with an entry. */
export function bestStreak() {
  let best = 0, run = 0, prev = null;
  for (const k of Object.keys(_entries).sort()) {
    const t = Date.parse(k + "T12:00:00Z");
    run = prev != null && Math.round((t - prev) / DAY) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = t;
  }
  return best;
}

/** Mean mood over the `days` days ending `back` days ago; null with no moods. */
export function average(now = Date.now(), { days = 7, back = 0, tz } = {}) {
  const moods = [];
  for (let i = back; i < back + days; i++) {
    const m = _entries[dayKey(now, i, tz)]?.mood;
    if (m) moods.push(m);
  }
  return moods.length ? Math.round((moods.reduce((a, b) => a + b, 0) / moods.length) * 10) / 10 : null;
}

/** This week against last week: "up", "down" or "steady" (null without both). */
export function trend(now = Date.now(), tz) {
  const a = average(now, { days: 7, back: 0, tz });
  const b = average(now, { days: 7, back: 7, tz });
  if (a == null || b == null) return null;
  return a - b >= 0.5 ? "up" : b - a >= 0.5 ? "down" : "steady";
}

/** The last `n` days, oldest first: { day, mood } (mood null when blank or unrated). */
export function strip(now = Date.now(), n = 14, tz) {
  const out = [];
  for (let back = n - 1; back >= 0; back--) {
    const key = dayKey(now, back, tz);
    out.push({ day: key, mood: _entries[key]?.mood ?? null, wrote: !!_entries[key] });
  }
  return out;
}

/** The most used tags in the last 30 days, busiest first. */
export function topTags(now = Date.now(), tz, limit = 6) {
  const cutoff = dayKey(now, 29, tz);
  const counts = new Map();
  for (const [k, e] of Object.entries(_entries)) {
    if (k < cutoff) continue;
    for (const t of tagsOf(e.note)) counts.set(t, (counts.get(t) || 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([tag, n]) => ({ tag, n }));
}

/** Entries newest first; `q` filters to notes containing it (case-insensitive). */
export function recent({ limit = 10, q = "" } = {}) {
  const needle = String(q || "").toLowerCase().trim();
  return Object.keys(_entries)
    .sort()
    .reverse()
    .map((k) => ({ day: k, mood: _entries[k].mood ?? null, note: _entries[k].note || "" }))
    .filter((e) => !needle || e.note.toLowerCase().includes(needle))
    .slice(0, limit);
}

const moodWord = (m) => (m ? `${m}/5 (${MOODS[m]})` : "no mood given");
const clip = (s, n) => {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
};

export function summary(now = Date.now(), tz) {
  const today = get("today", now, tz);
  return {
    day: dayKey(now, 0, tz),
    today,
    streak: streak(now, tz),
    best: bestStreak(),
    average7: average(now, { days: 7, tz }),
    trend: trend(now, tz),
    strip: strip(now, 14, tz),
    tags: topTags(now, tz),
    recent: recent({ limit: 10 }),
    total: Object.keys(_entries).length,
    line: todayLine(now, tz),
  };
}

/** One line for the debrief; "" when today has no entry. */
export function todayLine(now = Date.now(), tz) {
  const e = get("today", now, tz);
  if (!e) return "";
  return `Journal today: mood ${moodWord(e.mood)}${e.note ? ` — "${clip(e.note, 200)}"` : ""}.`;
}

/* ── ACTION: journal ─────────────────────────────────────────── */

export function runJournalTool(name, input, now = Date.now()) {
  const sub = String(name || "").toLowerCase().replace(/^(journal|mood)\s*/, "").trim();
  const p = String(input || "").split("|").map((x) => x.trim());
  try {
    if (!sub || sub === "summary") {
      const s = summary(now);
      if (!s.total) return "The journal is empty. Log today: journal log | <mood 1-5> | <a few words>.";
      const lines = [
        s.today ? `Today: mood ${moodWord(s.today.mood)}${s.today.note ? ` — ${clip(s.today.note, 160)}` : ""}` : "Nothing written today yet.",
        `Streak: ${s.streak} day${s.streak === 1 ? "" : "s"} (best ${s.best}).`,
        s.average7 != null ? `Average mood, last 7 days: ${s.average7}/5${s.trend ? `, ${s.trend} on the week before` : ""}.` : "",
        s.tags.length ? `Tags this month: ${s.tags.map((t) => `#${t.tag} ×${t.n}`).join(", ")}.` : "",
        "Recent:",
        ...s.recent.slice(0, 5).map((e) => `- ${e.day}: ${e.mood ? e.mood + "/5" : "–"}${e.note ? ` ${clip(e.note, 100)}` : ""}`),
      ];
      return lines.filter(Boolean).join("\n");
    }
    if (sub === "log" || sub === "add" || sub === "write") {
      // log | <mood> | <note> | <day>; add | <note> appends to today.
      if (sub === "add") {
        if (!p[0]) return "Usage: journal add | <text to add to today's entry>";
        const key = write({ note: p[0], append: true, now });
        return `Added to the ${key} entry.`;
      }
      if (!p[0] && !p[1]) return "Usage: journal log | <mood 1-5> | <a few words> | <day, default today>";
      const key = write({ mood: p[0] === "" ? undefined : p[0], note: p[1] || undefined, day: p[2] || undefined, now });
      const e = get(key, now);
      const s = streak(now);
      return `Logged ${key}: mood ${moodWord(e.mood)}. Journal streak ${s} day${s === 1 ? "" : "s"}.`;
    }
    if (sub === "show" || sub === "read") {
      const e = get(p[0] || "today", now);
      if (!e) return `No entry for ${resolveDay(p[0] || "today", now) || p[0]}.`;
      return `${e.day} — mood ${moodWord(e.mood)}\n${e.note || "(no note)"}`;
    }
    if (sub === "find" || sub === "search") {
      if (!p[0]) return "Usage: journal find | <word>";
      const hits = recent({ limit: 8, q: p[0] });
      return hits.length
        ? hits.map((e) => `- ${e.day} (${e.mood ? e.mood + "/5" : "–"}): ${clip(e.note, 140)}`).join("\n")
        : `No entries mention "${p[0]}".`;
    }
    if (sub === "remove" || sub === "delete") {
      const e = remove(p[0] || "today", { now });
      return e ? `Removed the ${e.day} entry.` : "No entry for that day.";
    }
    return "journal: use summary, log, add, show, find or remove.";
  } catch (e) {
    return `journal: ${e.message}`;
  }
}

export function init() {
  load();
}

/** Tests only. */
export function _reset(entries = {}) {
  _entries = entries;
}
