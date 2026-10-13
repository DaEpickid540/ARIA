// Run: npm test   (or node --test tests/flashcards.test.mjs)
// lib/flashcards.js: SM-2 scheduling, cards out of pasted/quiz text, what's
// due in the owner's day, and the ACTION: flashcards tool.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

process.env.ARIA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "aria-cards-"));
const fc = await import("../lib/flashcards.js");

const DAY = 86400_000;
// 9 PM in New York on Mon Oct 12, 2026 (01:00 UTC on the 13th).
const NOW = Date.parse("2026-10-13T01:00:00Z");
const TZ = "America/New_York";

test("SM-2: good grows 1 → 3 → ×ease; again resets to 10 minutes and lowers ease", () => {
  let c = { ease: 2.5, interval: 0, reps: 0 };
  c = fc.schedule(c, "good", NOW);
  assert.deepEqual([c.interval, c.reps, c.due], [1, 1, NOW + DAY]);
  c = fc.schedule(c, "good", NOW);
  assert.equal(c.interval, 3);
  c = fc.schedule(c, "good", NOW);
  assert.equal(c.interval, 8, "3 × 2.5, rounded");
  const lapsed = fc.schedule(c, "again", NOW);
  assert.deepEqual([lapsed.interval, lapsed.reps, lapsed.lapses, lapsed.ease], [0, 0, 1, 2.3]);
  assert.equal(lapsed.due, NOW + fc.RELEARN_MS);
  // Ease never drops below 1.3, and intervals cap at a year.
  let hard = { ease: 1.35, interval: 300, reps: 9 };
  hard = fc.schedule(hard, "hard", NOW);
  assert.equal(hard.ease, 1.3);
  assert.equal(fc.schedule({ ease: 3, interval: 200, reps: 9 }, "easy", NOW).interval, 365);
  assert.throws(() => fc.schedule(c, "meh"), /Grade must be/);
});

test("the buttons show what they'd do", () => {
  assert.deepEqual(fc.preview({ ease: 2.5, interval: 0, reps: 0 }, NOW), { again: "10m", hard: "1d", good: "1d", easy: "3d" });
  assert.deepEqual(fc.preview({ ease: 2.5, interval: 10, reps: 4 }, NOW), { again: "10m", hard: "12d", good: "25d", easy: "34d" });
});

test("cards out of text: arrows, double colons, tabs, Q/A pairs, numbered lists", () => {
  const cards = fc.parseCards(
    [
      "1. What is ATP? => The cell's energy currency",
      "- mitosis :: cell division making two identical cells",
      "hola\thello",
      "Q: Where is the Krebs cycle?",
      "A: The mitochondrial matrix",
      "Question 2) What is osmosis?",
      "Answer: water moving across a membrane",
      "just a sentence with no answer",
      "Q: orphan question",
    ].join("\n"),
  );
  assert.deepEqual(cards, [
    { front: "What is ATP?", back: "The cell's energy currency" },
    { front: "mitosis", back: "cell division making two identical cells" },
    { front: "hola", back: "hello" },
    { front: "Where is the Krebs cycle?", back: "The mitochondrial matrix" },
    { front: "What is osmosis?", back: "water moving across a membrane" },
  ]);
  assert.equal(fc.parseCards("a => b ;; c => d").length, 2, "one line, ;; between cards");
});

test("decks: duplicates skipped, the first spelling kept, due counted in the owner's day", () => {
  fc._reset();
  const { added } = fc.addCards("Bio", fc.parseCards("ATP => energy ;; DNA => genes"), { now: NOW });
  assert.equal(added.length, 2);
  const again = fc.addCards("bio", fc.parseCards("atp => energy!! ;; RNA => messenger"), { now: NOW });
  assert.deepEqual([again.added.length, again.skipped, again.deck], [1, 1, "Bio"]);
  fc.addCards("Spanish", fc.parseCards("perro => dog"), { now: NOW });
  assert.equal(fc.dueCards({ now: NOW, tz: TZ }).length, 4, "new cards are due straight away");
  // Review all of Bio as good: due tomorrow, so not due today any more.
  for (const c of fc.dueCards({ deck: "BIO", now: NOW, tz: TZ })) fc.review(c.id, "good", NOW);
  assert.equal(fc.dueCards({ now: NOW, tz: TZ }).length, 1);
  assert.equal(fc.dueLine(NOW, TZ), "1 flashcard due today: Spanish 1");
  // Tomorrow morning in New York the Bio cards are back.
  assert.equal(fc.dueCards({ now: NOW + 12 * 3600_000, tz: TZ }).length, 4);
  const d = fc.decks(NOW, TZ);
  assert.deepEqual(d.map((x) => [x.deck, x.total, x.due, x.fresh]), [["Spanish", 1, 1, 1], ["Bio", 3, 0, 0]]);
  // A card due at 11 PM tonight counts as today's.
  fc._reset([{ id: "x", deck: "D", front: "f", back: "b", due: NOW + 2 * 3600_000, interval: 1, reps: 1 }]);
  assert.equal(fc.dueCards({ now: NOW, tz: TZ }).length, 1);
});

test("the tool: add from a quiz, list what's due, grade after the answer", () => {
  fc._reset();
  assert.match(fc.runFlashcardTool("flashcards add", "Bio | What is ATP? => energy ;; Where is DNA? => nucleus", NOW), /^Added 2 cards to Bio\./);
  assert.match(fc.runFlashcardTool("flashcards add", "Bio | nothing here", NOW), /^Usage/);
  const due = fc.runFlashcardTool("flashcards due", "bio", NOW);
  assert.match(due, /^2 due in Bio\./);
  const id = due.match(/\[(c[a-z0-9]+)\]/)[1];
  assert.match(fc.runFlashcardTool("flashcards grade", `${id} | good`, NOW), /comes back in 1 day\.$/);
  assert.match(fc.runFlashcardTool("flashcards grade", `${id} | again`, NOW), /comes back in 10 minutes\.$/);
  assert.match(fc.runFlashcardTool("flashcards grade", "nope | good", NOW), /⚠ No card/);
  assert.match(fc.runFlashcardTool("flashcards", "", NOW), /Bio: 2 cards, 2 due, 1 new/);
  assert.equal(fc.removeDeck("BIO"), 2);
  assert.equal(fc.runFlashcardTool("flashcards", "", NOW), "No flashcards yet.");
});

test("saved and loaded back", () => {
  fc._reset();
  fc.addCards("Chem", [{ front: "H2O", back: "water" }], { now: NOW });
  fc._reset();
  fc.init();
  assert.equal(fc.listCards("chem").length, 1);
  const c = fc.listCards()[0];
  fc.editCard(c.id, { back: "water (dihydrogen monoxide)" });
  assert.equal(fc.getCard(c.id).back, "water (dihydrogen monoxide)");
  assert.equal(fc.removeCard(c.id), true);
});
