// Run: npm test   (or node --test tests/arena.test.mjs)
// lib/arena.js: who competes and who judges, the judge's verdict read
// defensively, and the win tally.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

process.env.ARIA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "aria-arena-"));
const arena = await import("../lib/arena.js");

const GROQ = { provider: "groq", model: null, label: "Groq Llama 3.3" };
const OR = { provider: "openrouter", model: "x/free", label: "OpenRouter x" };
const DS = { provider: "deepseek", model: null, label: "DeepSeek" };

test("lineup: different models when there are several, a judge who didn't compete", () => {
  const l = arena.pickLineup([GROQ, OR, DS], { count: 2 });
  assert.deepEqual(l.contenders.map((c) => c.name), ["Solver (Groq Llama 3.3)", "Checker (OpenRouter x)"]);
  assert.equal(l.judge.label, "DeepSeek");
  assert.equal(l.sameModel, false);
  // One model: it competes against itself with different approaches, and judges.
  const solo = arena.pickLineup([GROQ], { count: 3 });
  assert.deepEqual(solo.contenders.map((c) => c.approach.name), ["Solver", "Checker", "Skeptic"]);
  assert.equal(solo.judge.label, "Groq Llama 3.3");
  assert.equal(solo.sameModel, true);
  assert.equal(arena.pickLineup([GROQ, OR], { count: 9 }).contenders.length, 3, "three at most");
  assert.throws(() => arena.pickLineup([]), /No AI provider/);
});

test("verdict: JSON in prose or after <think>, names matched loosely, correctness counts double", () => {
  const names = ["Solver (Groq Llama 3.3)", "Checker (OpenRouter x)"];
  const raw = `<think>{"nope":1}</think>Here's my verdict:\n{"scores":[{"name":"Solver","correctness":4,"completeness":9,"clarity":9,"notes":"sign error"},{"name":"Checker (OpenRouter x)","correctness":9,"completeness":7,"clarity":7,"notes":"right"}],"winner":"checker","why":"B is right.","answer":"x = 4","mistakes":["Solver dropped a minus sign in step 2"]}`;
  const v = arena.parseVerdict(raw, names);
  assert.equal(v.winner, "Checker (OpenRouter x)");
  assert.deepEqual(v.scores.map((s) => [s.name, s.total]), [["Solver (Groq Llama 3.3)", 26], ["Checker (OpenRouter x)", 32]]);
  assert.equal(v.answer, "x = 4");
  assert.equal(v.mistakes.length, 1);
  // A winner the judge made up: the top score wins instead.
  const v2 = arena.parseVerdict(raw.replace('"winner":"checker"', '"winner":"Agent 7"'), names);
  assert.equal(v2.winner, "Checker (OpenRouter x)");
  // An even score with no named winner is a tie.
  const even = `{"scores":[{"name":"${names[0]}","correctness":8,"completeness":8,"clarity":8},{"name":"${names[1]}","correctness":8,"completeness":8,"clarity":8}]}`;
  assert.equal(arena.parseVerdict(even, names).winner, "tie");
  assert.equal(arena.parseVerdict(`{"scores":[{"name":"x","correctness":99}]}`, names), null, "nobody it knows");
  assert.equal(arena.parseVerdict("I think B wins", names), null);
  assert.equal(arena.parseVerdict(`{"scores":[{"name":"${names[0]}","correctness":99,"completeness":-3,"clarity":"7"}]}`, names).scores[0].total, 27, "clamped to 0-10");
});

test("prompts carry the question, the others' answers, and the exact names", () => {
  const l = arena.pickLineup([GROQ, OR]);
  const [a, b] = l.contenders.map((c, i) => ({ ...c, answer: `answer ${i}` }));
  const rb = arena.rebuttalMessages("What is 2+2?", a, [b]);
  assert.match(rb[1].content, /QUESTION:\nWhat is 2\+2\?[\s\S]*YOUR ANSWER:\nanswer 0[\s\S]*CHECKER \(OPENROUTER X\)'S ANSWER:\nanswer 1/);
  const j = arena.judgeMessages("Q", [{ ...a, rebuttal: "still 4" }, b]);
  assert.match(j[0].content, /"Solver \(Groq Llama 3\.3\)", "Checker \(OpenRouter x\)"/);
  assert.match(j[1].content, /AFTER READING THE OTHERS:\nstill 4/);
  assert.match(arena.contenderSystem(a), /FINAL ANSWER:/);
});

test("tally: only bouts between different models count; history keeps the newest", () => {
  arena._reset();
  const l = arena.pickLineup([GROQ, OR]);
  arena.record({ id: "1", question: "q", contenders: l.contenders, verdict: { winner: l.contenders[1].name } });
  arena.record({ id: "2", question: "q", contenders: l.contenders, verdict: { winner: "tie" } });
  const solo = arena.pickLineup([GROQ]);
  arena.record({ id: "3", question: "q", contenders: solo.contenders, verdict: { winner: solo.contenders[0].name } });
  assert.deepEqual(arena.tally(), [
    { label: "OpenRouter x", plays: 2, wins: 1, rate: 50 },
    { label: "Groq Llama 3.3", plays: 2, wins: 0, rate: 0 },
  ]);
  assert.deepEqual(arena.history().map((b) => b.id), ["3", "2", "1"]);
  arena._reset();
  arena.init();
  assert.equal(arena.history().length, 3, "saved to arena.json");
});
