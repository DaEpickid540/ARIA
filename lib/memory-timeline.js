// lib/memory-timeline.js — what ARIA has learned about you, and when
// ═══════════════════════════════════════════════════════════════════
//
// memory.json's facts stay plain strings (the prompt, the briefing and the
// Memory panel all read them that way). Next to them, `meta` remembers per
// fact when it was learned, how (from a chat, typed in by hand, or from
// before this existed), the chat it came from and the line that taught it.
// Keyed by the fact's normalised text, so a reorder can't mismatch them.
//
// Edits and forgets name the fact by index AND its current text, so two
// tabs (or the PC and the cloud) can't delete the wrong one.
//
// conflicts() spots facts that can't both be true ("User's name is Sam" /
// "User's name is Sammy"), so the timeline can ask which one to keep.
// ═══════════════════════════════════════════════════════════════════

export const keyOf = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** A fact as a string. Old clients sent objects ({ text, … }); this recovers their text. */
export function factText(f) {
  if (typeof f === "string") return f.trim();
  if (f && typeof f === "object" && typeof f.text === "string") return f.text.trim();
  return "";
}

/**
 * Makes memory consistent: facts are non-empty unique strings, meta has an
 * entry only for facts that exist. Returns true if anything changed.
 */
export function repair(mem) {
  const before = JSON.stringify([mem.facts, mem.meta]);
  const meta = mem.meta && typeof mem.meta === "object" ? mem.meta : {};
  const seen = new Set();
  const facts = [];
  for (const f of Array.isArray(mem.facts) ? mem.facts : []) {
    const t = factText(f).slice(0, 300);
    const k = keyOf(t);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    facts.push(t);
    // An object from an old client carried its own date and source.
    if (!meta[k] && f && typeof f === "object") {
      meta[k] = { at: Number(f.createdAt) || null, source: f.source === "auto" ? "chat" : "manual", ...(f.category ? { category: String(f.category) } : {}) };
    }
  }
  for (const k of Object.keys(meta)) if (!seen.has(k)) delete meta[k];
  mem.facts = facts;
  mem.meta = meta;
  return JSON.stringify([mem.facts, mem.meta]) !== before;
}

/** Records how a fact was learned. info: { source: "chat"|"manual", chatId?, quote?, at? } */
export function noteLearned(mem, fact, info = {}) {
  mem.meta ||= {};
  const k = keyOf(fact);
  if (!k) return;
  mem.meta[k] = {
    at: info.at || Date.now(),
    source: info.source || "chat",
    ...(info.chatId ? { chatId: String(info.chatId).slice(0, 80) } : {}),
    ...(info.quote ? { quote: String(info.quote).replace(/\s+/g, " ").trim().slice(0, 200) } : {}),
    ...(info.category ? { category: String(info.category).slice(0, 30) } : {}),
  };
}

/** Adds a fact (if new) with where it came from. Returns false for a duplicate. */
export function addFact(mem, text, info = {}) {
  const t = factText(text).slice(0, 300);
  if (!keyOf(t) || mem.facts.some((f) => keyOf(f) === keyOf(t))) return false;
  mem.facts.push(t);
  noteLearned(mem, t, info);
  return true;
}

function locate(mem, index, expect) {
  const i = Number(index);
  if (!Number.isInteger(i) || i < 0 || i >= mem.facts.length) throw new Error("That memory isn't there any more. Refresh and try again.");
  if (expect != null && keyOf(mem.facts[i]) !== keyOf(expect)) throw new Error("That memory changed since you loaded it. Refresh and try again.");
  return i;
}

/** Corrects a fact in place; it keeps its date, and the correction is noted. */
export function editFact(mem, index, text, expect) {
  const i = locate(mem, index, expect);
  const t = factText(text).slice(0, 300);
  if (!keyOf(t)) throw new Error("A memory can't be empty. Use Forget to remove it.");
  const dup = mem.facts.findIndex((f, j) => j !== i && keyOf(f) === keyOf(t));
  if (dup >= 0) throw new Error("ARIA already remembers that.");
  const old = mem.facts[i];
  const m = mem.meta?.[keyOf(old)] || { at: null, source: "unknown" };
  delete mem.meta?.[keyOf(old)];
  mem.facts[i] = t;
  mem.meta ||= {};
  mem.meta[keyOf(t)] = { ...m, editedAt: Date.now(), was: old.slice(0, 200) };
  return t;
}

/** Forgets one fact. */
export function forgetFact(mem, index, expect) {
  const i = locate(mem, index, expect);
  const [gone] = mem.facts.splice(i, 1);
  delete mem.meta?.[keyOf(gone)];
  return gone;
}

/* ── reading it back ─────────────────────────────────────────── */

const CATEGORIES = [
  ["identity", /\b(name|age|years? old|born|birthday|lives?|from|pronouns?|nickname)\b/i],
  ["music", /\b(piano|violin|viola|cello|guitar|drums?|instrument|orchestra|band|music|practi[cs]e|recital)\b/i],
  ["school", /\b(school|class(es)?|grade|teacher|homework|exam|test|course|ap |college|gpa|study|studies|major|semester)\b/i],
  ["people", /\b(friend|mom|dad|mother|father|brother|sister|girlfriend|boyfriend|family|parents?|cousin|teammate)\b/i],
  ["work", /\b(job|work(s|ing)? (at|for|on)|intern|boss|company|business)\b/i],
  ["projects", /\b(project|building|repo|app|code|coding|github|esp32|arduino|server|website)\b/i],
  ["health", /\b(allerg|diet|sleep|workout|gym|run(s|ning)?|lift|vegetarian|vegan|medication)\b/i],
  ["likes", /\b(likes?|loves?|prefers?|favou?rite|enjoys?|hates?|dislikes?|into)\b/i],
  ["goals", /\b(wants? to|goal|plans? to|hopes? to|trying to|aims?)\b/i],
];

/** A best guess at what a fact is about, for filtering. */
export function categorize(fact) {
  for (const [name, re] of CATEGORIES) if (re.test(fact)) return name;
  return "other";
}

/**
 * Every fact with its story, newest first; facts from before the timeline
 * existed come last (their date is unknown).
 */
export function timeline(mem) {
  return mem.facts
    .map((fact, index) => {
      const m = mem.meta?.[keyOf(fact)] || {};
      return {
        index,
        fact,
        at: m.at || null,
        source: m.source || "unknown",
        chatId: m.chatId || null,
        quote: m.quote || "",
        category: m.category || categorize(fact),
        editedAt: m.editedAt || null,
        was: m.was || "",
      };
    })
    .sort((a, b) => (b.at || 0) - (a.at || 0) || b.index - a.index);
}

// "User's name is Sam" / "The user's favorite color is blue" / "Sarvin's age is 16":
// the subject before " is ", when the thing is single-valued.
const SINGLE = /^(?:the )?(?:user|[a-z]+)['’]s (name|full name|age|birthday|school|grade|favou?rite [a-z]+(?: [a-z]+)?|best friend|girlfriend|boyfriend|middle name|last name|hometown|city|time ?zone|major|job|instrument|main instrument) (?:is|=) (.+)$/i;
const AGE = /^(?:the )?user is (\d{1,2}) ?(?:years? old)?\.?$/i;

/** Pairs of facts that look like two answers to one question. */
export function conflicts(mem) {
  const bySubject = new Map();
  mem.facts.forEach((f, index) => {
    let subject = null;
    const m = f.trim().replace(/\.$/, "").match(SINGLE);
    if (m) subject = m[1].toLowerCase().replace("favourite", "favorite");
    else if (AGE.test(f.trim())) subject = "age";
    if (!subject) return;
    const list = bySubject.get(subject) || [];
    list.push({ index, fact: f });
    bySubject.set(subject, list);
  });
  return [...bySubject.entries()].filter(([, l]) => l.length > 1).map(([subject, facts]) => ({ subject, facts }));
}
