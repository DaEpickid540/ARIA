// Run: npm test   (or node --test tests/triggers.test.mjs)
// lib/triggers.js: parsing rules, time windows across midnight, firing on
// arrival vs nagging, clock rules once a day, stale or idle context.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.ARIA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "aria-trig-"));
process.env.ARIA_TZ = "America/New_York";
const T = await import("../lib/triggers.js");

const TZ = "America/New_York";
// Wall-clock New York time → instant (EDT in October: UTC−4).
const ny = (d, h, m = 0) => Date.UTC(2026, 9, d, h + 4, m);
// 12 Oct 2026 is a Monday.

let fired = [];
function setup() {
  T._reset();
  fs.rmSync(path.join(process.env.ARIA_DATA_DIR, "triggers.json"), { force: true });
  fired = [];
  T.init({ fire: (r, ctx) => fired.push({ id: r.id, ctx }) }, { start: false });
}
const flush = () => new Promise((r) => setImmediate(r));
const report = async (app, title, now, idleSec = 0) => {
  await T.reportContext({ app, title, idleSec }, now);
  await flush();
};

test("times, days and the tool's key: value format", () => {
  assert.equal(T.parseClock("23:00"), 1380);
  assert.equal(T.parseClock("11pm"), 1380);
  assert.equal(T.parseClock("7:30 am"), 450);
  assert.equal(T.parseClock("12am"), 0);
  assert.equal(T.parseClock("noon"), 720);
  assert.equal(T.parseClock("25:00"), null);
  assert.equal(T.parseClock("13pm"), null);
  assert.deepEqual(T.parseDays("weekdays"), [1, 2, 3, 4, 5]);
  assert.deepEqual(T.parseDays("mon, wed and fri"), [1, 3, 5]);
  assert.equal(T.parseDays("every day"), null);
  assert.throws(() => T.parseDays("someday"), /isn't a day/);

  const s = T.parseTriggerInput("app: Visual Studio Code | after: 11pm | before: 5am | say: Commit and sleep. | every: 30m | nag");
  assert.deepEqual(s.when, { app: "Visual Studio Code", from: 1380, to: 300 });
  assert.equal(s.then.kind, "say");
  assert.equal(s.cooldownMin, 30);
  assert.equal(s.nag, true);
  assert.throws(() => T.parseTriggerInput("app: x | colour: red | say: hi"), /Unknown part/);
  assert.throws(() => T.parseTriggerInput("app: x | after: late | say: hi"), /isn't a time/);
});

test("a rule needs a when and a what", () => {
  setup();
  assert.throws(() => T.createTrigger({ when: { app: "code" } }), /Say what to do/);
  assert.throws(() => T.createTrigger({ then: { kind: "say", text: "hi" } }), /Say when/);
  assert.throws(() => T.createTrigger({ when: { app: "x", at: 600 }, then: { kind: "say", text: "hi" } }), /not both/);
});

test("windows can wrap midnight", () => {
  assert.equal(T.inWindow(23 * 60 + 30, 1380, 300), true);
  assert.equal(T.inWindow(2 * 60, 1380, 300), true);
  assert.equal(T.inWindow(12 * 60, 1380, 300), false);
  assert.equal(T.inWindow(600, 540, 1020), true);
});

test("app rule: fires on arrival in the window, not again while it stays, again after leaving + cooldown", async () => {
  setup();
  T.createTrigger(T.parseTriggerInput("app: visual studio code | after: 11pm | before: 5am | say: Bed."));
  await report("Code.exe", "main.js - Visual Studio Code", ny(12, 22, 50)); // too early
  assert.equal(fired.length, 0);
  await report("Code.exe", "main.js - Visual Studio Code", ny(12, 23, 5));
  assert.equal(fired.length, 1);
  assert.equal(fired[0].ctx, undefined, "the window title never reaches what fires");
  await report("Code.exe", "server.js - Visual Studio Code", ny(12, 23, 30)); // still there
  assert.equal(fired.length, 1, "not a nag: once per arrival");
  await report("chrome.exe", "YouTube", ny(12, 23, 40));
  await report("Code.exe", "x - Visual Studio Code", ny(12, 23, 45)); // back, but inside the cooldown
  assert.equal(fired.length, 1);
  await report("chrome.exe", "YouTube", ny(13, 0, 10));
  await report("Code.exe", "x - Visual Studio Code", ny(13, 0, 20)); // back after an hour
  assert.equal(fired.length, 2);
});

test("a nag repeats every cooldown while it stays true", async () => {
  setup();
  T.createTrigger(T.parseTriggerInput("app: code | after: 11pm | before: 5am | say: Bed. | every: 30m | nag"));
  for (const m of [0, 10, 20, 31, 45, 62]) await report("Code.exe", "VS Code", ny(12, 23, 0) + m * 60_000);
  assert.equal(fired.length, 3, "at 0, 31 and 62 minutes");
});

test("the window's day is the night it started: Friday's 11 PM–5 AM still counts at 1 AM Saturday", async () => {
  setup();
  T.createTrigger(T.parseTriggerInput("app: code | after: 11pm | before: 5am | days: fri | say: Weekend."));
  await report("Code.exe", "VS Code", ny(17, 1, 0)); // Saturday 1 AM, Friday night
  assert.equal(fired.length, 1);
  setup();
  T.createTrigger(T.parseTriggerInput("app: code | after: 11pm | before: 5am | days: fri | say: Weekend."));
  await report("Code.exe", "VS Code", ny(16, 1, 0)); // Friday 1 AM = Thursday night
  assert.equal(fired.length, 0);
});

test("idle at the keyboard, or no report for a minute, isn't 'in the app'", async () => {
  setup();
  T.createTrigger(T.parseTriggerInput("app: code | say: hi"));
  await report("Code.exe", "VS Code", ny(12, 12), 20 * 60);
  assert.equal(fired.length, 0);
  assert.equal(T.matches(T.listTriggers()[0], { app: "Code.exe", title: "", idleSec: 0, at: ny(12, 12) }, ny(12, 12) + 5 * 60_000, TZ), false);
});

test("browser tabs match on the window title", async () => {
  setup();
  T.createTrigger(T.parseTriggerInput("app: schoology | ask: What's due today?"));
  await report("msedge.exe", "Home | Schoology - Microsoft Edge", ny(12, 15));
  assert.equal(fired.length, 1);
});

test("clock rule: once at that minute, on the right days, even if the tick sees the minute twice", async () => {
  setup();
  T.createTrigger(T.parseTriggerInput("at: 7:30am | days: weekdays | say: Morning."));
  await T.evaluate(ny(12, 7, 29), TZ);
  await T.evaluate(ny(12, 7, 30), TZ);
  await T.evaluate(ny(12, 7, 30) + 30_000, TZ);
  await flush();
  assert.equal(fired.length, 1);
  await T.evaluate(ny(17, 7, 30), TZ); // Saturday
  await flush();
  assert.equal(fired.length, 1);
  await T.evaluate(ny(19, 7, 30), TZ); // next Monday
  await flush();
  assert.equal(fired.length, 2);
});

test("the relay is only asked for context while an app rule is on; paused rules don't fire", async () => {
  setup();
  assert.equal(T.wantsContext(), false);
  T.createTrigger(T.parseTriggerInput("at: 9am | say: x"));
  assert.equal(T.wantsContext(), false);
  const r = T.createTrigger(T.parseTriggerInput("app: code | say: y"));
  assert.equal(T.wantsContext(), true);
  T.setActive(r.id, false);
  assert.equal(T.wantsContext(), false);
  await report("Code.exe", "VS Code", ny(12, 12));
  assert.equal(fired.length, 0);
});

test("tool: create, list, remove; errors explain the format", () => {
  setup();
  assert.match(T.runTriggerTool("trigger", "app: code | after: 11pm | before: 5am | say: Bed."), /^Set t1: when "code" is in front, 11:00 PM–5:00 AM → I'll say "Bed\."\. It needs PC control on/);
  assert.match(T.runTriggerTool("trigger list", ""), /t1 \[on\] when "code" is in front/);
  assert.match(T.runTriggerTool("trigger", "say: hi"), /^No trigger set: Say when/);
  assert.equal(T.runTriggerTool("trigger stop", "t1"), "Removed t1.");
  assert.equal(T.runTriggerTool("trigger list", ""), "No triggers.");
});

test("two PCs: one in the app counts, and their alternating reports don't make it a nag", async () => {
  setup();
  T.createTrigger(T.parseTriggerInput("app: code | say: x | every: 5m"));
  for (let m = 0; m < 20; m++) {
    await T.reportContext({ app: "Code.exe", title: "VS Code", device: "desktop" }, ny(12, 12, m));
    await T.reportContext({ app: "chrome.exe", title: "YouTube", device: "laptop" }, ny(12, 12, m) + 30_000);
    await flush();
  }
  assert.equal(fired.length, 1);
});

test("'after 11pm' alone means the night; 'after 3pm' alone means the rest of the day", () => {
  setup();
  const night = T.createTrigger(T.parseTriggerInput("app: code | after: 11pm | say: x"));
  assert.deepEqual([night.when.from, night.when.to], [1380, 300]);
  assert.match(night.description, /11:00 PM–5:00 AM/);
  const aft = T.createTrigger(T.parseTriggerInput("app: chrome | after: 3pm | say: y"));
  assert.equal(aft.when.to, 1440);
  assert.throws(() => T.createTrigger(T.parseTriggerInput("at: 9am | after: 8am | say: z")), /one or the other/);
  assert.deepEqual(T.parseDays("weekdays and sat"), [1, 2, 3, 4, 5, 6]);
});

test("a clock rule still fires a few minutes late (restart, sleeping server), once", async () => {
  setup();
  T.createTrigger(T.parseTriggerInput("at: 7:30am | say: Morning."));
  await T.evaluate(ny(12, 7, 36), TZ);
  await T.evaluate(ny(12, 7, 38), TZ);
  await flush();
  assert.equal(fired.length, 1);
  await T.evaluate(ny(13, 7, 45), TZ); // past the grace: missed
  await flush();
  assert.equal(fired.length, 1);
});

test("the PC is only asked for context while a window is open or about to open, and only for the rules' words", () => {
  setup();
  T.createTrigger(T.parseTriggerInput("app: Visual Studio Code | after: 11pm | before: 5am | say: Bed."));
  assert.equal(T.wantsContext(ny(12, 15, 0), TZ), false, "3 PM: nothing to watch for");
  assert.equal(T.wantsContext(ny(12, 22, 55), TZ), true, "five minutes before the window");
  assert.equal(T.wantsContext(ny(13, 1, 0), TZ), true);
  assert.deepEqual(T.contextMatchWords(), ["visual studio code"]);
});

test("a clock rule made a few minutes after its time waits for tomorrow", async () => {
  setup();
  const realNow = Date.now;
  // Pretend it's 7:34 AM on Monday in New York.
  Date.now = () => ny(12, 7, 34);
  try {
    T.createTrigger(T.parseTriggerInput("at: 7:30am | say: Morning."));
  } finally {
    Date.now = realNow;
  }
  await T.evaluate(ny(12, 7, 35), TZ);
  await flush();
  assert.equal(fired.length, 0);
  await T.evaluate(ny(13, 7, 30), TZ);
  await flush();
  assert.equal(fired.length, 1);
});
