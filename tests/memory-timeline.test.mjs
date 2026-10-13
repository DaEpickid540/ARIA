// Run: npm test   (or node --test tests/memory-timeline.test.mjs)
// lib/memory-timeline.js: when and where each fact was learned, correcting
// and forgetting the right one, and spotting facts that disagree.
import test from "node:test";
import assert from "node:assert/strict";
import * as mt from "../lib/memory-timeline.js";

const mem = () => ({ facts: ["User's name is Sarvin", "User plays violin"], sessions: [] });

test("repair: objects from the old Settings bug become text again, keeping their date", () => {
  const m = {
    facts: ["User's name is Sarvin", { id: 1, text: "User likes Bach", createdAt: 1700000000000, source: "manual", category: "note" }, { text: "user likes bach!" }, "", 42, "User's name is Sarvin"],
    meta: { "gone fact": { at: 1 } },
  };
  assert.equal(mt.repair(m), true);
  assert.deepEqual(m.facts, ["User's name is Sarvin", "User likes Bach"]);
  assert.deepEqual(m.meta, { "user likes bach": { at: 1700000000000, source: "manual", category: "note" } });
  assert.equal(mt.repair(m), false, "already consistent");
});

test("learned facts carry their chat and the line that taught them; newest first", () => {
  const m = mem();
  mt.repair(m);
  assert.equal(mt.addFact(m, "User is in AP Bio", { source: "chat", chatId: "chat_1", quote: "ugh   AP Bio test tomorrow", at: 2000 }), true);
  assert.equal(mt.addFact(m, "user is in ap bio.", { at: 3000 }), false, "duplicate");
  mt.addFact(m, "User's favorite color is red", { source: "manual", at: 1000 });
  const tl = mt.timeline(m);
  assert.deepEqual(tl.map((x) => [x.fact, x.at, x.source]), [
    ["User is in AP Bio", 2000, "chat"],
    ["User's favorite color is red", 1000, "manual"],
    ["User plays violin", null, "unknown"],
    ["User's name is Sarvin", null, "unknown"],
  ]);
  assert.equal(tl[0].quote, "ugh AP Bio test tomorrow");
  assert.equal(tl[0].chatId, "chat_1");
  assert.deepEqual(tl.map((x) => x.category), ["school", "likes", "music", "identity"]);
});

test("correct: keeps the date, notes what it was; refuses stale or duplicate edits", () => {
  const m = mem();
  mt.addFact(m, "User is 15", { at: 5000 });
  mt.editFact(m, 2, "User is 16", "User is 15");
  assert.equal(m.facts[2], "User is 16");
  const e = mt.timeline(m).find((x) => x.fact === "User is 16");
  assert.equal(e.at, 5000);
  assert.equal(e.was, "User is 15");
  assert.ok(e.editedAt);
  assert.throws(() => mt.editFact(m, 2, "x", "User is 15"), /changed since you loaded it/);
  assert.throws(() => mt.editFact(m, 2, "User plays violin", "User is 16"), /already remembers/);
  assert.throws(() => mt.editFact(m, 2, "  ", "User is 16"), /can't be empty/);
  assert.throws(() => mt.editFact(m, 9, "x"), /isn't there/);
});

test("forget: only the fact you saw", () => {
  const m = mem();
  assert.throws(() => mt.forgetFact(m, 0, "User plays violin"), /changed since/);
  assert.equal(mt.forgetFact(m, 1, "User plays violin"), "User plays violin");
  assert.deepEqual(m.facts, ["User's name is Sarvin"]);
});

test("conflicts: two answers to one question", () => {
  const m = { facts: ["User's name is Sarvin", "User's favourite color is blue", "User's favorite color is red.", "User is 15 years old", "User is 16", "User's name is Sarvin S", "User likes red"] };
  const c = mt.conflicts(m);
  assert.deepEqual(
    c.map((x) => [x.subject, x.facts.map((f) => f.index)]),
    [
      ["name", [0, 5]],
      ["favorite color", [1, 2]],
      ["age", [3, 4]],
    ],
  );
  assert.deepEqual(mt.conflicts(mem()), []);
});
