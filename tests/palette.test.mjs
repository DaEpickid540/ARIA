// Run: npm test   (or node --test tests/palette.test.mjs)
// public/js/paletteCore.js: what the command palette matches, in what
// order, and the ">" / "?" prefixes.
import test from "node:test";
import assert from "node:assert/strict";
import { fuzzy, rank, parseQuery, highlight } from "../public/js/paletteCore.js";

const ITEMS = [
  { label: "Flashcards" },
  { label: "Daily Rings", keywords: ["habits", "streaks"] },
  { label: "Fix my screen" },
  { label: "Settings", keywords: ["preferences", "theme"] },
  { label: "Arena (models compete)" },
  { label: "Claw: emergency stop", keywords: ["kill switch"] },
  { label: "Practice (tuner, metronome)" },
];
const top = (q) => rank(ITEMS, q)[0]?.item.label;

test("letters must appear in order; a miss is null", () => {
  assert.ok(fuzzy("flsh", "Flashcards"));
  assert.equal(fuzzy("xyz", "Flashcards"), null);
  assert.equal(fuzzy("sdrac", "Flashcards"), null, "order matters");
  assert.equal(fuzzy("flashcardsandmore", "Flashcards"), null);
  assert.deepEqual(fuzzy("", "anything"), { score: 0, idx: [] });
});

test("a substring beats scattered letters, and a word start beats mid-word", () => {
  assert.ok(fuzzy("ring", "Daily Rings").score > fuzzy("ring", "Recurring items").score);
  assert.ok(fuzzy("set", "Settings").score > fuzzy("set", "Reset").score);
  assert.ok(fuzzy("flash", "Flashcards").score > fuzzy("flash", "Fix lag as shown").score);
  assert.deepEqual(fuzzy("ring", "Daily Rings").idx, [6, 7, 8, 9]);
});

test("initials find a multi-word command", () => {
  assert.deepEqual(fuzzy("dr", "Daily Rings").idx, [0, 6]);
  assert.equal(top("dr"), "Daily Rings");
  assert.equal(top("fms"), "Fix my screen");
});

test("rank: best first, keywords count, spaces in the query don't", () => {
  assert.equal(top("flash"), "Flashcards");
  assert.equal(top("habits"), "Daily Rings");
  assert.equal(top("kill"), "Claw: emergency stop");
  assert.equal(top("daily rings"), "Daily Rings");
  assert.equal(top("metro"), "Practice (tuner, metronome)");
  assert.deepEqual(rank(ITEMS, "qqq"), []);
  assert.equal(rank(ITEMS, "").length, ITEMS.length, "no query: everything, in order");
  assert.equal(rank(ITEMS, "", 3).length, 3);
});

test("a label match outranks the same word as a keyword", () => {
  const items = [{ label: "Appearance", keywords: ["theme"] }, { label: "Theme picker" }];
  assert.equal(rank(items, "theme")[0].item.label, "Theme picker");
});

test("prefixes: > is Claw, ? is ask, anything else is a search", () => {
  assert.deepEqual(parseQuery("> open spotify"), { mode: "claw", text: "open spotify" });
  assert.deepEqual(parseQuery("?what is ATP"), { mode: "ask", text: "what is ATP" });
  assert.deepEqual(parseQuery("  flash "), { mode: "search", text: "flash" });
  assert.deepEqual(parseQuery(">"), { mode: "claw", text: "" });
  assert.deepEqual(parseQuery(""), { mode: "search", text: "" });
});

test("highlight wraps runs of matched letters and escapes the rest", () => {
  assert.equal(highlight("Daily Rings", [0, 6]), "<mark>D</mark>aily <mark>R</mark>ings");
  assert.equal(highlight("Flashcards", [0, 1, 2]), "<mark>Fla</mark>shcards");
  assert.equal(highlight("a<b>&c", []), "a&lt;b&gt;&amp;c");
});
