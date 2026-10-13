// lib/flashcards.js — spaced repetition: cards come back just before you'd
// forget them
// ═══════════════════════════════════════════════════════════════════
//
// Cards are { deck, front, back } plus their schedule. They come from a quiz
// in chat ("save the ones I missed as flashcards" → ACTION: flashcards add),
// from pasting Q/A lines into the Flashcards panel, or from ARIA making a
// deck from your notes. Reviewing a card grades it Again / Hard / Good /
// Easy, and SM-2 (the algorithm Anki grew from) picks the next date:
//
//   again   back in 10 minutes; the card starts over, and gets a bit harder
//   hard    a little longer than last time
//   good    1 day, then 3, then the last gap × the card's ease (2.5 to start)
//   easy    longer still, and the card gets easier
//
// "Due today" is the owner's day (lib/clock.js), so the morning briefing on
// Render counts the same cards the PC does.
// ═══════════════════════════════════════════════════════════════════

import fs from "fs";
import path from "path";
import { DATA_DIR } from "./paths.js";
import { dayBounds } from "./clock.js";

const FILE = path.join(DATA_DIR, "flashcards.json");
const MAX_CARDS = 5000;
const DAY = 86400_000;
const MIN = 60_000;
export const RELEARN_MS = 10 * MIN;

let _cards = [];

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, "utf8"));
    _cards = Array.isArray(raw.cards) ? raw.cards : [];
  } catch {
    _cards = [];
  }
}
function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE + ".tmp", JSON.stringify({ cards: _cards, updatedAt: Date.now() }));
    fs.renameSync(FILE + ".tmp", FILE);
  } catch (e) {
    console.warn("[flashcards] save failed:", e.message);
  }
}

const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
const deckKey = (s) => norm(s).replace(/[^a-z0-9 ]/g, "");

/* ── scheduling (pure) ───────────────────────────────────────── */

export const GRADES = ["again", "hard", "good", "easy"];

/**
 * The card's schedule after one review. Pure: returns new fields.
 * @param {{ ease?: number, interval?: number, reps?: number, lapses?: number }} card
 * @param {"again"|"hard"|"good"|"easy"} grade
 * @returns {{ ease, interval, reps, lapses, due }}  interval in days (0 = relearning)
 */
export function schedule(card, grade, now = Date.now()) {
  if (!GRADES.includes(grade)) throw new Error(`Grade must be one of ${GRADES.join(", ")}.`);
  let ease = card.ease || 2.5;
  let interval = card.interval || 0;
  let reps = card.reps || 0;
  let lapses = card.lapses || 0;
  if (grade === "again") {
    return { ease: Math.max(1.3, ease - 0.2), interval: 0, reps: 0, lapses: lapses + (reps > 0 ? 1 : 0), due: now + RELEARN_MS };
  }
  if (grade === "hard") {
    ease = Math.max(1.3, ease - 0.15);
    interval = reps === 0 ? 1 : Math.max(interval + 1, Math.round(interval * 1.2));
  } else if (grade === "good") {
    interval = reps === 0 ? 1 : reps === 1 ? 3 : Math.max(interval + 1, Math.round(interval * ease));
  } else {
    ease += 0.15;
    interval = reps === 0 ? 3 : Math.max(interval + 2, Math.round(interval * ease * 1.3));
  }
  interval = Math.min(interval, 365);
  return { ease: Math.round(ease * 100) / 100, interval, reps: reps + 1, lapses, due: now + interval * DAY };
}

/** What each button would do, for the review screen: { again: "10m", hard: "2d", … }. */
export function preview(card, now = Date.now()) {
  const out = {};
  for (const g of GRADES) {
    const s = schedule(card, g, now);
    const ms = s.due - now;
    out[g] = ms < DAY ? `${Math.round(ms / MIN)}m` : ms < 60 * DAY ? `${Math.round(ms / DAY)}d` : ms < 365 * DAY ? `${Math.round(ms / (30 * DAY))}mo` : `${Math.round(ms / (365 * DAY))}y`;
  }
  return out;
}

/* ── parsing cards out of text ───────────────────────────────── */

/**
 * Cards in pasted or generated text. One card per line (or per ";;"):
 *   front => back      front :: back      front<TAB>back
 * or Q:/A: pairs over two lines ("Q: What is ATP?" / "A: The cell's energy currency").
 */
export function parseCards(text) {
  const cards = [];
  const chunks = String(text || "")
    .split(/\r?\n|;;/)
    .map((x) => x.trim())
    .filter(Boolean);
  for (let i = 0; i < chunks.length; i++) {
    const line = chunks[i].replace(/^(\d+[.)]|[-*•])\s+/, "");
    const q = line.match(/^(?:q(?:uestion)?|front)\s*\d*\s*[:.)-]\s*(.+)$/i);
    if (q) {
      const a = (chunks[i + 1] || "").replace(/^(\d+[.)]|[-*•])\s+/, "").match(/^(?:a(?:nswer)?|back)\s*\d*\s*[:.)-]\s*(.+)$/i);
      if (a) {
        cards.push({ front: q[1].trim(), back: a[1].trim() });
        i++;
      }
      continue;
    }
    const m = line.match(/^(.+?)\s*(?:=>|::|\t)\s*(.+)$/);
    if (m) cards.push({ front: m[1].trim(), back: m[2].trim() });
  }
  return cards.filter((c) => c.front && c.back).map((c) => ({ front: c.front.slice(0, 500), back: c.back.slice(0, 1000) }));
}

/* ── the deck ────────────────────────────────────────────────── */

/** Adds cards to a deck; a card whose front is already in that deck is skipped. */
export function addCards(deck, cards, { source = "manual", now = Date.now() } = {}) {
  const d = String(deck || "").trim().slice(0, 60);
  if (!d) throw new Error("Which deck? (a class or topic, like Bio or Spanish)");
  // Keep the deck's existing spelling.
  const name = _cards.find((c) => deckKey(c.deck) === deckKey(d))?.deck || d;
  const have = new Set(_cards.filter((c) => deckKey(c.deck) === deckKey(d)).map((c) => norm(c.front)));
  if (_cards.length + cards.length > MAX_CARDS) throw new Error(`That would be over ${MAX_CARDS} cards; delete an old deck first.`);
  const added = [];
  for (const c of cards) {
    if (!c?.front || !c?.back || have.has(norm(c.front))) continue;
    have.add(norm(c.front));
    const card = {
      id: `c${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      deck: name,
      front: String(c.front).slice(0, 500),
      back: String(c.back).slice(0, 1000),
      ease: 2.5,
      interval: 0,
      reps: 0,
      lapses: 0,
      due: now, // new cards are due straight away
      createdAt: now,
      source,
    };
    _cards.push(card);
    added.push(card);
  }
  if (added.length) save();
  return { added, skipped: cards.length - added.length, deck: name };
}

export function getCard(id) {
  return _cards.find((c) => c.id === id) || null;
}

/** Grades one review and schedules the card. */
export function review(id, grade, now = Date.now()) {
  const c = getCard(id);
  if (!c) throw new Error(`No card "${id}".`);
  Object.assign(c, schedule(c, grade, now), { lastReview: now });
  save();
  return c;
}

/** Cards due by the end of the owner's today, soonest first (optionally one deck). */
export function dueCards({ deck = "", now = Date.now(), tz, limit = 200 } = {}) {
  const end = dayBounds(now, tz).tomorrow;
  return _cards
    .filter((c) => c.due < end && (!deck || deckKey(c.deck) === deckKey(deck)))
    .sort((a, b) => a.due - b.due)
    .slice(0, limit);
}

/** Per deck: total, due today, new (never reviewed), and how well it's sticking. */
export function decks(now = Date.now(), tz) {
  const end = dayBounds(now, tz).tomorrow;
  const map = new Map();
  for (const c of _cards) {
    const k = deckKey(c.deck);
    const d = map.get(k) || { deck: c.deck, total: 0, due: 0, fresh: 0, mature: 0 };
    d.total++;
    if (c.due < end) d.due++;
    if (!c.reps && !c.lastReview) d.fresh++;
    if (c.interval >= 21) d.mature++;
    map.set(k, d);
  }
  return [...map.values()].sort((a, b) => b.due - a.due || a.deck.localeCompare(b.deck));
}

export function removeCard(id) {
  const i = _cards.findIndex((c) => c.id === id);
  if (i < 0) return false;
  _cards.splice(i, 1);
  save();
  return true;
}

export function removeDeck(deck) {
  const before = _cards.length;
  _cards = _cards.filter((c) => deckKey(c.deck) !== deckKey(deck));
  if (_cards.length !== before) save();
  return before - _cards.length;
}

export function editCard(id, { front, back }) {
  const c = getCard(id);
  if (!c) throw new Error(`No card "${id}".`);
  if (front != null && String(front).trim()) c.front = String(front).trim().slice(0, 500);
  if (back != null && String(back).trim()) c.back = String(back).trim().slice(0, 1000);
  save();
  return c;
}

/** One line for the briefing / ARIA: "12 flashcards due: Bio 8, Spanish 4". */
export function dueLine(now = Date.now(), tz) {
  const ds = decks(now, tz).filter((d) => d.due);
  if (!ds.length) return _cards.length ? "No flashcards due today." : "";
  const n = ds.reduce((a, d) => a + d.due, 0);
  return `${n} flashcard${n === 1 ? "" : "s"} due today: ${ds.map((d) => `${d.deck} ${d.due}`).join(", ")}`;
}

/* ── the tool: ACTION: flashcards … ──────────────────────────── */

/**
 * ACTION: flashcards                                     what's due, per deck
 * ACTION: flashcards add | Bio | What is ATP? => The cell's energy currency ;; Where is the Krebs cycle? => Mitochondrial matrix
 * ACTION: flashcards due | Bio                           due cards (id, front, back) to quiz in chat
 * ACTION: flashcards grade | c1x2y3 | good               after the owner answers one in chat
 */
export function runFlashcardTool(name, input, now = Date.now()) {
  const sub = String(name || "").toLowerCase().replace(/^flash ?cards?\s*/, "").trim();
  const p = String(input || "").split("|").map((x) => x.trim());
  try {
    if (!sub || sub === "list" || sub === "decks") {
      const ds = decks(now);
      if (!ds.length) return "No flashcards yet.";
      return [dueLine(now), ...ds.map((d) => `${d.deck}: ${d.total} cards, ${d.due} due, ${d.fresh} new, ${d.mature} learned well`)].join("\n");
    }
    if (sub === "add") {
      const cards = parseCards(p.slice(1).join("|"));
      if (!p[0] || !cards.length) return "Usage: flashcards add | <deck> | front => back ;; front => back";
      const { added, skipped, deck } = addCards(p[0], cards, { source: "chat", now });
      return `Added ${added.length} card${added.length === 1 ? "" : "s"} to ${deck}${skipped ? ` (${skipped} already there)` : ""}. They're due now: review in Tools → Flashcards, or say "quiz me on my ${deck} flashcards".`;
    }
    if (sub === "due") {
      const due = dueCards({ deck: p[0] || "", now, limit: 10 });
      if (!due.length) return `Nothing due${p[0] ? ` in ${p[0]}` : ""}. ${dueLine(now)}`.trim();
      return [
        `${due.length} due${p[0] ? ` in ${due[0].deck}` : ""}. Ask them one at a time, wait for the answer, then grade it (ACTION: flashcards grade | <id> | again/hard/good/easy):`,
        ...due.map((c) => `[${c.id}] (${c.deck}) Q: ${c.front} — A: ${c.back}`),
      ].join("\n");
    }
    if (sub === "grade") {
      const g = String(p[1] || "").toLowerCase();
      const c = review(p[0], g, now);
      const days = c.interval ? `${c.interval} day${c.interval === 1 ? "" : "s"}` : "10 minutes";
      return `Graded ${g}: "${c.front.slice(0, 60)}" comes back in ${days}.`;
    }
    return "flashcards: use list, add, due or grade.";
  } catch (e) {
    return `⚠ ${e.message}`;
  }
}

export const listCards = (deck = "") => _cards.filter((c) => !deck || deckKey(c.deck) === deckKey(deck));

export function init() {
  load();
}

/** Tests only. */
export function _reset(list = []) {
  _cards = list;
}
