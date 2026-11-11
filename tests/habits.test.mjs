// Run: npm test   (or node --test tests/habits.test.mjs)
// lib/habits.js: Daily Rings — check-ins in the owner's day, streaks that
// survive until the day is over, and the ACTION: rings tool.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

process.env.ARIA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "aria-rings-"));
const hb = await import("../lib/habits.js");

const DAY = 86400_000;
// 9 PM in New York on Mon Oct 12, 2026 (01:00 UTC on the 13th).
const NOW = Date.parse("2026-10-13T01:00:00Z");
const TZ = "America/New_York";

test.beforeEach(() => hb._reset([]));

test("dayKey is the owner's day, not UTC's, and steps back across a DST change", () => {
  assert.equal(hb.dayKey(NOW, 0, TZ), "2026-10-12");
  assert.equal(hb.dayKey(NOW, 1, TZ), "2026-10-11");
  // Clocks fall back on Nov 1, 2026: a 25-hour day must not repeat a date.
  const afterDst = Date.parse("2026-11-02T15:00:00Z");
  assert.deepEqual([0, 1, 2].map((b) => hb.dayKey(afterDst, b, TZ)), ["2026-11-02", "2026-11-01", "2026-10-31"]);
});

test("a ring closes when the count reaches its target, and can be taken back", () => {
  const h = hb.addHabit("Water", { target: 3, now: NOW });
  hb.checkIn(h.id, { now: NOW, tz: TZ });
  hb.checkIn("water", { amount: 1, now: NOW, tz: TZ });
  let v = hb.view(hb.find("Water"), NOW, TZ);
  assert.deepEqual([v.count, v.done, Math.round(v.fill * 100)], [2, false, 67]);
  hb.checkIn("wat", { now: NOW, tz: TZ });
  v = hb.view(hb.find("Water"), NOW, TZ);
  assert.deepEqual([v.count, v.done, v.streak], [3, true, 1]);
  hb.checkIn("Water", { amount: -5, now: NOW, tz: TZ });
  assert.equal(hb.view(hb.find("Water"), NOW, TZ).count, 0, "never below zero");
});

test("the streak holds while today is still open, and breaks after a missed day", () => {
  const log = { "2026-10-11": 1, "2026-10-10": 1, "2026-10-09": 1, "2026-10-06": 1, "2026-10-05": 1, "2026-10-04": 1, "2026-10-03": 1 };
  hb._reset([{ id: "h1", name: "Read", target: 1, createdAt: NOW - 30 * DAY, log }]);
  const h = hb.find("h1");
  assert.equal(hb.streak(h, NOW, TZ), 3, "yesterday back to the 9th; today not done yet");
  assert.equal(hb.bestStreak(h), 4);
  hb.toggle("h1", { now: NOW, tz: TZ });
  assert.equal(hb.streak(h, NOW, TZ), 4);
  assert.equal(hb.streak(h, NOW + 2 * DAY, TZ), 0, "a whole day missed");
  hb.toggle("h1", { now: NOW, tz: TZ });
  assert.equal(hb.view(h, NOW, TZ).done, false, "toggle reopens a closed ring");
});

test("summary: percent is the average fill, and the line names what's open", () => {
  hb.addHabit("Read", { now: NOW - 5 * DAY });
  hb.addHabit("Water", { target: 4, now: NOW - 5 * DAY });
  hb.toggle("Read", { now: NOW, tz: TZ });
  hb.checkIn("Water", { amount: 2, now: NOW, tz: TZ });
  const s = hb.summary(NOW, TZ);
  assert.deepEqual([s.total, s.done, s.percent], [2, 1, 75]);
  assert.equal(s.line, "Rings: 1/2 closed today. Still open: Water (2/4).");
  hb.checkIn("Water", { amount: 2, now: NOW, tz: TZ });
  assert.equal(hb.todayLine(NOW, TZ), "Rings: all 2 closed today.");
  assert.equal(hb.perfectStreak(NOW, TZ), 1);
  assert.equal(hb.summary(NOW, TZ).habits[0].week.length, 7);
});

test("a ring added today doesn't break the every-ring streak of earlier days", () => {
  hb._reset([{ id: "h1", name: "Read", target: 1, createdAt: NOW - 10 * DAY, log: { "2026-10-11": 1, "2026-10-10": 1 } }]);
  hb.addHabit("Stretch", { now: NOW });
  assert.equal(hb.perfectStreak(NOW, TZ), 2);
});

test("names are unique, trimmed and capped; targets are clamped", () => {
  const h = hb.addHabit("  Deep   work  ", { target: 500, now: NOW });
  assert.deepEqual([h.name, h.target], ["Deep work", hb.MAX_TARGET]);
  assert.throws(() => hb.addHabit("deep work"), /already/);
  assert.throws(() => hb.addHabit("   "), /name/);
  assert.equal(hb.editHabit(h.id, { name: "Focus", target: 0 }).target, 1);
  for (let i = 1; i < hb.MAX_HABITS; i++) hb.addHabit("ring " + i);
  assert.throws(() => hb.addHabit("one too many"), /limit/);
  assert.equal(hb.removeHabit("Focus").name, "Focus");
  assert.equal(hb.removeHabit("nope"), null);
});

test("ACTION: rings — add, done, undo, list, remove", () => {
  assert.match(hb.runHabitTool("rings", "", NOW), /No rings yet/);
  assert.match(hb.runHabitTool("rings add", "Water | 2", NOW), /Added the ring "Water" \(2 a day\)/);
  assert.match(hb.runHabitTool("habits add", "Read", NOW), /Added the ring "Read"/);
  assert.match(hb.runHabitTool("rings done", "water", NOW), /"Water": 1\/2 today/);
  assert.match(hb.runHabitTool("ring done", "Water", NOW), /closed for today — streak 1 day\./);
  assert.match(hb.runHabitTool("rings undo", "Water", NOW), /back to 1\/2/);
  const list = hb.runHabitTool("rings list", "", NOW);
  assert.match(list, /○ Water: 1\/2 today/);
  assert.match(list, /○ Read: 0\/1 today/);
  assert.match(hb.runHabitTool("rings done", "juggling", NOW), /No such ring/);
  assert.match(hb.runHabitTool("rings remove", "Read", NOW), /Removed the ring "Read"/);
  assert.match(hb.runHabitTool("rings frobnicate", "", NOW), /use list, add, done, undo or remove/);
});
