// lib/practice.js — the practice log: what you played, how long, at what
// tempo, and how each piece is coming along
// ═══════════════════════════════════════════════════════════════════
//
// A session is { piece, instrument, minutes, bpm?, note?, at }. It comes from
// the Practice panel (its timer fills the minutes, its metronome the tempo)
// or from telling ARIA "practiced the Bach for 30 minutes at 72" (ACTION:
// practice log). The tuner, metronome and tempo check run in the browser
// (public/js/practiceAudio.js); only the log lives here.
//
// stats() is what ARIA and the briefing read: today, the last 7 days, the
// streak (days in a row with any practice, in the owner's time zone), and
// per piece: total time, last played, and the tempo then vs now.
// ═══════════════════════════════════════════════════════════════════

import fs from "fs";
import path from "path";
import { DATA_DIR } from "./paths.js";
import { dateKey } from "./clock.js";

const FILE = path.join(DATA_DIR, "practice.json");
const MAX_SESSIONS = 2000; // years of daily practice; oldest go first

let _sessions = [];

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, "utf8"));
    _sessions = Array.isArray(raw.sessions) ? raw.sessions : [];
  } catch {
    _sessions = [];
  }
}
function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE + ".tmp", JSON.stringify({ sessions: _sessions, updatedAt: Date.now() }));
    fs.renameSync(FILE + ".tmp", FILE);
  } catch (e) {
    console.warn("[practice] save failed:", e.message);
  }
}

const key = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const DAY = 86400_000;

/** Adds a session. Minutes 1–600; bpm 20–400 when given. */
export function logSession({ piece, instrument = "", minutes, bpm = null, note = "", at = Date.now() }) {
  const p = String(piece || "").trim().slice(0, 80);
  const m = Math.round(Number(minutes));
  if (!p) throw new Error("What did you practise? (a piece, or scales, technique…)");
  if (!(m >= 1 && m <= 600)) throw new Error("Minutes should be between 1 and 600.");
  const b = bpm == null || bpm === "" ? null : Math.round(Number(bpm));
  if (b != null && !(b >= 20 && b <= 400)) throw new Error("Tempo should be between 20 and 400 BPM.");
  // Same spelling as the piece's earlier sessions, so "bach partita" and
  // "Bach Partita" are one piece.
  const prev = _sessions.find((s) => key(s.piece) === key(p));
  const s = {
    id: `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    piece: prev ? prev.piece : p,
    instrument: String(instrument || prev?.instrument || "").trim().slice(0, 30),
    minutes: m,
    ...(b != null ? { bpm: b } : {}),
    ...(note ? { note: String(note).trim().slice(0, 300) } : {}),
    at: Number(at) || Date.now(),
  };
  _sessions.push(s);
  if (_sessions.length > MAX_SESSIONS) _sessions = _sessions.slice(-MAX_SESSIONS);
  save();
  return s;
}

export function removeSession(id) {
  const i = _sessions.findIndex((s) => s.id === id);
  if (i < 0) return false;
  _sessions.splice(i, 1);
  save();
  return true;
}

export const listSessions = (limit = 50) => _sessions.slice(-limit).reverse();

/** Days in a row with practice, ending today (or yesterday, if today has none yet). */
export function streak(sessions, now = Date.now(), tz) {
  const days = new Set(sessions.map((s) => dateKey(s.at, tz)));
  // Walk back over calendar days ("2026-10-12" → "2026-10-11"), not 24 h
  // steps, so DST and the time of day can't skip or repeat one.
  const prev = (k) => new Date(Date.UTC(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10) - 1)).toISOString().slice(0, 10);
  let k = dateKey(now, tz);
  if (!days.has(k)) k = prev(k); // today isn't over: yesterday's streak still counts
  let n = 0;
  while (days.has(k)) {
    n++;
    k = prev(k);
  }
  return n;
}

/** Everything ARIA needs to say how practice is going. */
export function stats(sessions = _sessions, now = Date.now(), tz) {
  const today = dateKey(now, tz);
  const todayMin = sessions.filter((s) => dateKey(s.at, tz) === today).reduce((a, s) => a + s.minutes, 0);
  const weekMin = sessions.filter((s) => s.at > now - 7 * DAY).reduce((a, s) => a + s.minutes, 0);
  const byPiece = new Map();
  for (const s of [...sessions].sort((a, b) => a.at - b.at)) {
    const k = key(s.piece);
    const p = byPiece.get(k) || { piece: s.piece, instrument: s.instrument, minutes: 0, sessions: 0, first: s.at, last: s.at, firstBpm: null, lastBpm: null, lastNote: "" };
    p.minutes += s.minutes;
    p.sessions++;
    p.last = s.at;
    if (s.bpm) {
      if (p.firstBpm == null) p.firstBpm = s.bpm;
      p.lastBpm = s.bpm;
    }
    if (s.note) p.lastNote = s.note;
    byPiece.set(k, p);
  }
  const pieces = [...byPiece.values()].sort((a, b) => b.last - a.last);
  return { todayMin, weekMin, streak: streak(sessions, now, tz), pieces };
}

const fmtMin = (m) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}` : `${m}m`);
const daysAgo = (t, now) => {
  const d = Math.floor((now - t) / DAY);
  return d <= 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`;
};

/** The log in words, for ARIA and the briefing. */
export function summary(sessions = _sessions, now = Date.now(), tz) {
  if (!sessions.length) return "No practice logged yet.";
  const st = stats(sessions, now, tz);
  const lines = [`Today: ${fmtMin(st.todayMin)} · last 7 days: ${fmtMin(st.weekMin)} · streak: ${st.streak} day${st.streak === 1 ? "" : "s"}`];
  for (const p of st.pieces.slice(0, 8)) {
    const tempo = p.lastBpm ? (p.firstBpm && p.firstBpm !== p.lastBpm ? ` · tempo ${p.firstBpm}→${p.lastBpm}` : ` · ${p.lastBpm} BPM`) : "";
    lines.push(`${p.piece}${p.instrument ? ` (${p.instrument})` : ""}: ${fmtMin(p.minutes)} over ${p.sessions} session${p.sessions === 1 ? "" : "s"}, last ${daysAgo(p.last, now)}${tempo}${p.lastNote ? ` · last note: ${p.lastNote}` : ""}`);
  }
  // Pieces not touched in a week, worth a nudge.
  const stale = st.pieces.filter((p) => now - p.last > 7 * DAY).map((p) => p.piece);
  if (stale.length) lines.push(`Not played in over a week: ${stale.slice(0, 5).join(", ")}`);
  return lines.join("\n");
}

/** One piece's sessions, newest first, in words. */
export function pieceHistory(piece, now = Date.now()) {
  const k = key(piece);
  const list = _sessions.filter((s) => key(s.piece).includes(k)).sort((a, b) => b.at - a.at);
  if (!list.length) return `Nothing logged for "${piece}".`;
  return [
    `${list[0].piece}: ${list.length} session${list.length === 1 ? "" : "s"}`,
    ...list.slice(0, 15).map((s) => `• ${daysAgo(s.at, now)}: ${fmtMin(s.minutes)}${s.bpm ? ` at ${s.bpm} BPM` : ""}${s.note ? ` — ${s.note}` : ""}`),
  ].join("\n");
}

/**
 * ACTION: practice                                         the summary
 * ACTION: practice log | Bach Partita 2 | 30 | 72 | violin | shifts in m.12 clean now
 *                        piece | minutes | bpm | instrument | note (all but the first two optional)
 * ACTION: practice piece | Bach                             one piece's history
 */
export function runPracticeTool(name, input, now = Date.now()) {
  const sub = String(name || "").toLowerCase().replace(/^practi[cs]e\s*/, "").trim();
  const p = String(input || "").split("|").map((x) => x.trim());
  try {
    if (!sub || sub === "summary" || sub === "list") return summary(_sessions, now);
    if (sub === "log") {
      const minutes = parseFloat(String(p[1] || "").replace(/min.*$/i, ""));
      const bpm = p[2] ? parseFloat(p[2]) : null;
      const s = logSession({ piece: p[0], minutes, bpm: Number.isFinite(bpm) ? bpm : null, instrument: p[3] || "", note: p[4] || "" });
      const st = stats(_sessions, now);
      return `Logged ${fmtMin(s.minutes)} on ${s.piece}${s.bpm ? ` at ${s.bpm} BPM` : ""}. Today: ${fmtMin(st.todayMin)}, streak ${st.streak} day${st.streak === 1 ? "" : "s"}.`;
    }
    if (sub === "piece") return pieceHistory(p[0], now);
    return "practice: use summary, log or piece.";
  } catch (e) {
    return `⚠ ${e.message}`;
  }
}

export function init() {
  load();
}

/** Tests only. */
export function _reset(list = []) {
  _sessions = list;
}
