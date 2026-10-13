// Run: npm test   (or node --test tests/selftest.test.mjs)
// lib/selftest.js: checks run at once with time limits, the report puts
// what's broken first, and node --test output is read back.
import test from "node:test";
import assert from "node:assert/strict";
import { runChecks, summarize, parseTestOutput } from "../lib/selftest.js";

test("checks run in parallel; a throw or a hang fails that check only", async () => {
  const started = Date.now();
  const r = await runChecks(
    [
      { id: "a", group: "Models", name: "Groq", run: async () => ({ status: "ok", detail: "answered in 300 ms" }) },
      { id: "b", group: "Models", name: "DeepSeek", run: async () => { throw new Error("401 bad key"); }, fix: "Check DEEPSEEK_KEY" },
      { id: "c", group: "PC", name: "Relay", run: () => new Promise(() => {}), timeoutMs: 150 },
      { id: "d", group: "PC", name: "Hook", run: async () => ({ status: "weird" }) },
      { id: "e", group: "Sync", name: "Firestore", run: async () => ({ status: "off", detail: "not set up" }) },
    ],
    { timeoutMs: 1000 },
  );
  assert.ok(Date.now() - started < 900, "the hang didn't hold up the rest");
  assert.deepEqual(r.map((x) => x.status), ["ok", "fail", "fail", "fail", "off"]);
  assert.equal(r[1].detail, "401 bad key");
  assert.equal(r[1].fix, "Check DEEPSEEK_KEY");
  assert.match(r[2].detail, /no answer in 0s/);
});

test("the report: headline, then broken first; fixes only where something's wrong", () => {
  const s = summarize([
    { group: "Models", name: "Groq", status: "ok", detail: "answered", fix: "never shown" },
    { group: "PC", name: "Relay", status: "warn", detail: "not connected", fix: "Turn on PC control" },
    { group: "Models", name: "DeepSeek", status: "fail", detail: "401", fix: "Check DEEPSEEK_KEY" },
    { group: "Sync", name: "Firestore", status: "off", detail: "not set up" },
  ]);
  assert.equal(
    s,
    [
      "✗ 1 thing broken, 1 to look at (1 fine).",
      "✗ Models · DeepSeek: 401 → Check DEEPSEEK_KEY",
      "⚠ PC · Relay: not connected → Turn on PC control",
      "✓ Models · Groq: answered",
      "○ Sync · Firestore: not set up",
    ].join("\n"),
  );
  assert.match(summarize([{ group: "a", name: "b", status: "ok", detail: "" }]), /^✓ All 1 checks passed\./);
});

test("node --test output: counts and the failing tests' names", () => {
  const out = `✔ one (1.2ms)
✖ grades: the tool (3.4ms)
✔ two (0.5ms)
ℹ tests 3
ℹ suites 0
ℹ pass 2
ℹ fail 1
✖ failing tests:

test at tests\\grades.test.mjs:80:1
✖ grades: the tool (3.4ms)
  AssertionError [ERR_ASSERTION]: nope`;
  assert.deepEqual(parseTestOutput(out), { tests: 3, pass: 2, fail: 1, failing: ["grades: the tool"] });
  assert.deepEqual(parseTestOutput("ℹ tests 5\nℹ pass 5\nℹ fail 0"), { tests: 5, pass: 5, fail: 0, failing: [] });
  assert.deepEqual(parseTestOutput("garbage"), { tests: null, pass: null, fail: null, failing: [] });
});
