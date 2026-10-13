// lib/grades.js — the gradebook: where each class stands, which one is
// closest to slipping below an A, and what the next assignment needs
// ═══════════════════════════════════════════════════════════════════
//
// A class is either
//   weighted   categories with a weight each (Tests 50%, Quizzes 30%, HW 20%)
//              and the points earned/possible in each, or
//   points     one pool of earned/possible points,
// plus upcoming assignments (title, points, category, due date). Grades come
// from the owner: the Grades panel, or telling ARIA "I got 41/50 on the bio
// quiz" (ACTION: grades score). There's no Schoology sync: its API needs a
// key the school hands out.
//
// The maths is all here and pure: percent(), needed(), atRisk(). Nothing is
// guessed: a class with no points yet has no percent, and needed() says when
// the target can't be reached on that assignment.
// ═══════════════════════════════════════════════════════════════════

import fs from "fs";
import path from "path";
import { DATA_DIR } from "./paths.js";

const FILE = path.join(DATA_DIR, "grades.json");
export const DEFAULT_TARGET = 90; // an A, unless the class says otherwise

let _book = { classes: [], target: DEFAULT_TARGET, updatedAt: 0 };

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, "utf8"));
    _book = { classes: Array.isArray(raw.classes) ? raw.classes : [], target: Number(raw.target) || DEFAULT_TARGET, updatedAt: raw.updatedAt || 0 };
  } catch {
    _book = { classes: [], target: DEFAULT_TARGET, updatedAt: 0 };
  }
}
function save() {
  _book.updatedAt = Date.now();
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE + ".tmp", JSON.stringify(_book, null, 1));
    fs.renameSync(FILE + ".tmp", FILE);
  } catch (e) {
    console.warn("[grades] save failed:", e.message);
  }
}

const num = (x) => (Number.isFinite(+x) ? +x : 0);
const round1 = (x) => Math.round(x * 10) / 10;
export const slug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

/* ── maths ───────────────────────────────────────────────────── */

/**
 * The class's percent now, or null with nothing graded. Weighted classes
 * use only categories that have points (renormalised), the way most
 * gradebooks show a running grade.
 */
export function percent(c) {
  if (Array.isArray(c.categories) && c.categories.length) {
    let w = 0;
    let sum = 0;
    for (const k of c.categories) {
      if (num(k.possible) > 0) {
        w += num(k.weight);
        sum += num(k.weight) * (num(k.earned) / num(k.possible));
      }
    }
    return w > 0 ? round1((sum / w) * 100) : null;
  }
  return num(c.possible) > 0 ? round1((num(c.earned) / num(c.possible)) * 100) : null;
}

/** The class's target percent (its own, or the book's). */
export const targetOf = (c, book = _book) => num(c.target) || num(book.target) || DEFAULT_TARGET;

/**
 * The score (in points, and as a percent of the assignment) the next
 * assignment needs for the class to be at `target` afterwards.
 * @returns {{ points, pct, possible: boolean, already: boolean }}
 *   possible=false: even full marks won't get there. already=true: a zero
 *   would still leave it at or above the target.
 */
export function needed(c, a, target = targetOf(c)) {
  const P = num(a.points);
  if (P <= 0) throw new Error("The assignment needs a points value.");
  const t = target / 100;
  let x; // points needed on this assignment
  if (Array.isArray(c.categories) && c.categories.length) {
    const cat = c.categories.find((k) => slug(k.name) === slug(a.category)) || null;
    if (!cat) throw new Error(`"${c.name}" has no category "${a.category}". Categories: ${c.categories.map((k) => k.name).join(", ")}.`);
    // Categories counted after this assignment: those with points, plus this one.
    const counted = c.categories.filter((k) => num(k.possible) > 0 || k === cat);
    const W = counted.reduce((s, k) => s + num(k.weight), 0);
    const others = counted.filter((k) => k !== cat).reduce((s, k) => s + num(k.weight) * (num(k.earned) / num(k.possible)), 0);
    // others + w_c * (e_c + x) / (p_c + P) >= t * W
    const wc = num(cat.weight);
    if (wc <= 0) throw new Error(`"${cat.name}" has no weight.`);
    x = ((t * W - others) * (num(cat.possible) + P)) / wc - num(cat.earned);
  } else {
    // (e + x) / (p + P) >= t
    x = t * (num(c.possible) + P) - num(c.earned);
  }
  const points = Math.max(0, Math.ceil(x * 10) / 10);
  return { points, pct: round1((points / P) * 100), possible: x <= P, already: x <= 0 };
}

/** Classes by how close they are to (or how far below) their target: the riskiest first. */
export function atRisk(book = _book) {
  return book.classes
    .map((c) => ({ c, pct: percent(c), target: targetOf(c, book) }))
    .filter((x) => x.pct != null)
    .map((x) => ({ ...x, margin: round1(x.pct - x.target) }))
    .sort((a, b) => a.margin - b.margin);
}

/** The next upcoming assignment of a class (soonest due; undated last). */
export function nextAssignment(c, now = Date.now()) {
  return (c.upcoming || [])
    .filter((a) => !a.due || new Date(a.due).getTime() >= now - 24 * 3600_000)
    .sort((a, b) => (a.due ? new Date(a.due).getTime() : Infinity) - (b.due ? new Date(b.due).getTime() : Infinity))[0] || null;
}

/** The headline: the class closest to the line and what its next assignment needs. */
export function focus(book = _book, now = Date.now()) {
  const ranked = atRisk(book);
  if (!ranked.length) return null;
  const top = ranked[0];
  const next = nextAssignment(top.c, now);
  let need = null;
  if (next) {
    try {
      need = needed(top.c, next, top.target);
    } catch {}
  }
  return { cls: top.c, pct: top.pct, target: top.target, margin: top.margin, next, need };
}

/** The gradebook in words, for ARIA (and the briefing). */
export function summary(book = _book, now = Date.now()) {
  const ranked = atRisk(book);
  if (!book.classes.length) return "No classes in the gradebook yet.";
  const lines = ranked.map(
    ({ c, pct, target, margin }) => `${c.name}: ${pct}% (${margin >= 0 ? `${margin} above` : `${-margin} BELOW`} the ${target}% line)`,
  );
  const ungraded = book.classes.filter((c) => percent(c) == null).map((c) => c.name);
  if (ungraded.length) lines.push(`No grades yet: ${ungraded.join(", ")}`);
  const f = focus(book, now);
  if (f?.next && f.need) {
    // A due date is a calendar day ("2026-10-20" = UTC midnight): read it in UTC
    // or it shows as the day before west of Greenwich.
    const due = f.next.due ? ` (due ${new Date(f.next.due).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })})` : "";
    lines.push(
      `Focus: ${f.cls.name}. Next: ${f.next.title}${due}, ${f.next.points} pts — ` +
        (f.need.already
          ? `stays above ${f.target}% whatever happens.`
          : f.need.possible
            ? `needs ${f.need.points}/${f.next.points} (${f.need.pct}%) to be at ${f.target}% after it.`
            : `can't reach ${f.target}% on this one alone (would need ${f.need.points}/${f.next.points}); every point still helps.`),
    );
  } else if (f) lines.push(`Focus: ${f.cls.name} (no upcoming assignment entered).`);
  return lines.join("\n");
}

/* ── the book ────────────────────────────────────────────────── */
export const getBook = () => JSON.parse(JSON.stringify(_book));
export const getClass = (name) => _book.classes.find((c) => c.id === slug(name) || slug(c.name) === slug(name)) || null;

function cleanClass(c, prev = null) {
  const name = String(c.name || prev?.name || "").trim().slice(0, 60);
  if (!name) throw new Error("A class needs a name.");
  const cats = Array.isArray(c.categories)
    ? c.categories
        .map((k) => ({ name: String(k.name || "").trim().slice(0, 40), weight: num(k.weight), earned: num(k.earned), possible: num(k.possible) }))
        .filter((k) => k.name)
    : prev?.categories || [];
  const out = {
    id: prev?.id || slug(name),
    name,
    ...(num(c.target ?? prev?.target) ? { target: num(c.target ?? prev?.target) } : {}),
    ...(cats.length ? { categories: cats } : { earned: num(c.earned ?? prev?.earned), possible: num(c.possible ?? prev?.possible) }),
    upcoming: (Array.isArray(c.upcoming) ? c.upcoming : prev?.upcoming || [])
      .map((a) => ({ title: String(a.title || "").trim().slice(0, 80), points: num(a.points), ...(a.category ? { category: String(a.category).slice(0, 40) } : {}), ...(a.due ? { due: String(a.due).slice(0, 30) } : {}) }))
      .filter((a) => a.title && a.points > 0)
      .slice(0, 30),
    source: c.source || prev?.source || "manual",
  };
  for (const k of out.categories || []) {
    if (k.earned < 0 || k.possible < 0 || k.weight < 0) throw new Error(`"${k.name}": numbers can't be negative.`);
  }
  return out;
}

/** Adds or replaces a class (by name). */
export function upsertClass(c) {
  const prev = getClass(c.id || c.name);
  const next = cleanClass(c, prev);
  const i = prev ? _book.classes.indexOf(prev) : -1;
  if (i >= 0) _book.classes[i] = next;
  else _book.classes.push(next);
  save();
  return next;
}

export function removeClass(name) {
  const c = getClass(name);
  if (!c) return false;
  _book.classes.splice(_book.classes.indexOf(c), 1);
  save();
  return true;
}

export function setTarget(t) {
  const v = num(t);
  if (v < 50 || v > 100) throw new Error("The target should be a percent between 50 and 100.");
  _book.target = v;
  save();
}

/**
 * A graded assignment: its points go into the class (and category), and
 * it leaves the upcoming list if it was there.
 */
export function recordScore(className, { title = "", earned, possible, category = "" }) {
  const c = getClass(className);
  if (!c) throw new Error(`No class "${className}". Classes: ${_book.classes.map((x) => x.name).join(", ") || "none yet"}.`);
  const e = num(earned);
  const p = num(possible);
  if (p <= 0 || e < 0) throw new Error("A score needs points earned and points possible (like 41/50).");
  if (c.categories?.length) {
    const cat = c.categories.find((k) => slug(k.name) === slug(category)) ||
      (c.upcoming || []).map((a) => slug(a.title) === slug(title) && c.categories.find((k) => slug(k.name) === slug(a.category))).find(Boolean);
    if (!cat) throw new Error(`Which category? ${c.name} has ${c.categories.map((k) => k.name).join(", ")}.`);
    cat.earned = num(cat.earned) + e;
    cat.possible = num(cat.possible) + p;
  } else {
    c.earned = num(c.earned) + e;
    c.possible = num(c.possible) + p;
  }
  if (title) c.upcoming = (c.upcoming || []).filter((a) => slug(a.title) !== slug(title));
  save();
  return { cls: c, pct: percent(c) };
}

/** An upcoming assignment, so needed() has something to work out. */
export function addUpcoming(className, { title, points, category = "", due = "" }) {
  const c = getClass(className);
  if (!c) throw new Error(`No class "${className}". Classes: ${_book.classes.map((x) => x.name).join(", ") || "none yet"}.`);
  const a = { title: String(title || "").trim().slice(0, 80), points: num(points) };
  if (!a.title || a.points <= 0) throw new Error("An assignment needs a title and a points value.");
  if (c.categories?.length) {
    const cat = c.categories.find((k) => slug(k.name) === slug(category));
    if (!cat) throw new Error(`Which category? ${c.name} has ${c.categories.map((k) => k.name).join(", ")}.`);
    a.category = cat.name;
  }
  if (due) {
    if (!/^\d{4}-\d{2}-\d{2}/.test(due) || Number.isNaN(new Date(due).getTime())) throw new Error(`"${due}" isn't a date (use YYYY-MM-DD).`);
    a.due = String(due).slice(0, 10);
  }
  c.upcoming = [...(c.upcoming || []).filter((x) => slug(x.title) !== slug(a.title)), a].slice(-30);
  save();
  return a;
}

/* ── the tool: ACTION: grades … ──────────────────────────────── */

/** "Tests 50, Quizzes 30, Homework 20" → categories (weights, no points yet). */
export function parseWeights(s) {
  const cats = String(s || "")
    .split(/[,;]/)
    .map((x) => x.trim().match(/^(.+?)\s*[:=]?\s*(\d+(?:\.\d+)?)\s*%?$/))
    .filter(Boolean)
    .map((m) => ({ name: m[1].trim(), weight: +m[2], earned: 0, possible: 0 }));
  return cats;
}

/** "41/50", "41 / 50", "41 out of 50" → { earned, possible } or null. */
export function parseScore(s) {
  const m = String(s || "").match(/(\d+(?:\.\d+)?)\s*(?:\/|out of|of)\s*(\d+(?:\.\d+)?)/i);
  return m ? { earned: +m[1], possible: +m[2] } : null;
}

const parts = (input) => String(input || "").split("|").map((x) => x.trim());

/**
 * ACTION: grades                                   the summary + focus
 * ACTION: grades class | Bio | Tests 50, Quizzes 30, HW 20   (weights optional)
 * ACTION: grades score | Bio | 41/50 | Quiz 3 | Quizzes      (title, category optional)
 * ACTION: grades add | Bio | Unit 4 Test | 100 | Tests | 2026-10-20
 * ACTION: grades need | Bio                         what its next assignment needs
 * ACTION: grades remove | Bio
 */
export function runGradesTool(name, input, now = Date.now()) {
  const sub = String(name || "").toLowerCase().replace(/^grades?\s*/, "").trim();
  const p = parts(input);
  try {
    if (!sub || sub === "list" || sub === "summary") return summary(_book, now);
    if (sub === "class") {
      if (!p[0]) return "Usage: grades class | <name> | <Category weight, …> (weights optional)";
      const cats = parseWeights(p[1]);
      const prev = getClass(p[0]);
      // Re-declaring weights keeps the points already in a category.
      const merged = cats.map((k) => {
        const old = prev?.categories?.find((x) => slug(x.name) === slug(k.name));
        return old ? { ...k, earned: old.earned, possible: old.possible } : k;
      });
      const c = upsertClass({ name: p[0], ...(cats.length ? { categories: merged } : {}) });
      return `${prev ? "Updated" : "Added"} ${c.name}` + (c.categories ? ` (${c.categories.map((k) => `${k.name} ${k.weight}%`).join(", ")}).` : " (one points pool).");
    }
    if (sub === "score") {
      const sc = parseScore(p[1]);
      if (!p[0] || !sc) return "Usage: grades score | <class> | <earned>/<possible> | <title> | <category>";
      const { cls, pct } = recordScore(p[0], { ...sc, title: p[2] || "", category: p[3] || "" });
      return `Recorded ${sc.earned}/${sc.possible} in ${cls.name}. It's at ${pct}% now (target ${targetOf(cls)}%).`;
    }
    if (sub === "add") {
      if (!p[0] || !p[1]) return "Usage: grades add | <class> | <title> | <points> | <category> | <YYYY-MM-DD>";
      const a = addUpcoming(p[0], { title: p[1], points: parseFloat(p[2]), category: p[3] || "", due: p[4] || "" });
      const c = getClass(p[0]);
      const n = needed(c, a);
      return `Added ${a.title} (${a.points} pts) to ${c.name}. ` + needLine(c, a, n);
    }
    if (sub === "need") {
      const c = getClass(p[0]);
      if (!c) return `No class "${p[0]}". Classes: ${_book.classes.map((x) => x.name).join(", ") || "none yet"}.`;
      const a = nextAssignment(c, now);
      if (!a) return `${c.name} has no upcoming assignment entered. Add one: grades add | ${c.name} | <title> | <points>`;
      return needLine(c, a, needed(c, a));
    }
    if (sub === "remove" || sub === "delete") return removeClass(p[0]) ? `Removed ${p[0]}.` : `No class "${p[0]}".`;
    return "grades: use summary, class, score, add, need or remove.";
  } catch (e) {
    return `⚠ ${e.message}`;
  }
}

/** One line on what an assignment needs. */
export function needLine(c, a, n, target = targetOf(c)) {
  if (n.already) return `${c.name} stays at ${target}%+ whatever you get on ${a.title}.`;
  if (!n.possible) return `${a.title} can't get ${c.name} to ${target}% on its own (it would need ${n.points}/${a.points}); every point still helps.`;
  return `${c.name} needs ${n.points}/${a.points} (${n.pct}%) on ${a.title} to be at ${target}% after it.`;
}

export function init() {
  load();
}

/** Tests only. */
export function _reset() {
  _book = { classes: [], target: DEFAULT_TARGET, updatedAt: 0 };
}
