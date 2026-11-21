// Run: npm test   (or node --test tests/journal.test.mjs)
// lib/journal.js: Journal & Mood — one entry per owner's day, streaks,
// averages and trend, and the ACTION: journal tool.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

process.env.ARIA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "aria-journal-"));
const j = await import("../lib/journal.js");

// 9 PM in New York on Mon Oct 12, 2026 (01:00 UTC on the 13th).
const NOW = Date.parse("2026-10-13T01:00:00Z");
const TZ = "America/New_York";

test.beforeEach(() => j._reset({}));

test("today is the owner's day, and day refs resolve against it", () => {
  assert.equal(j.resolveDay("today", NOW, TZ), "2026-10-12");
  assert.equal(j.resolveDay("yesterday", NOW, TZ), "2026-10-11");
  assert.equal(j.resolveDay("3 days ago", NOW, TZ), "2026-10-09");
  assert.equal(j.resolveDay("2026-09-01", NOW, TZ), "2026-09-01");
  assert.equal(j.resolveDay("someday", NOW, TZ), null);
});

test("moods accept numbers and words, and reject the rest", () => {
  assert.equal(j.cleanMood("4"), 4);
  assert.equal(j.cleanMood("great"), 5);
  assert.equal(j.cleanMood("3/5"), 3);
  assert.equal(j.cleanMood(null), null);
  assert.throws(() => j.cleanMood(9), /1 to 5/);
});

test("one entry a day: writing again updates it, append adds a line, empty removes it", () => {
  j.write({ mood: 3, note: "ok day", now: NOW, tz: TZ });
  j.write({ mood: 4, now: NOW, tz: TZ });
  assert.deepEqual([j.get("today", NOW, TZ).mood, j.get("today", NOW, TZ).note], [4, "ok day"]);
  j.write({ note: "ran 5k", append: true, now: NOW, tz: TZ });
  assert.equal(j.get("today", NOW, TZ).note, "ok day\nran 5k");
  j.write({ mood: null, note: "", now: NOW, tz: TZ });
  assert.equal(j.get("today", NOW, TZ), null);
  assert.throws(() => j.write({ day: "2026-10-20", mood: 3, now: NOW, tz: TZ }), /hasn't happened/);
});

test("streak survives until the day is over; best finds the longest run", () => {
  for (const back of [1, 2, 3, 6, 7]) j.write({ day: j.dayKey(NOW, back, TZ), mood: 3, now: NOW, tz: TZ });
  assert.equal(j.streak(NOW, TZ), 3, "today blank: counts from yesterday");
  j.write({ mood: 5, now: NOW, tz: TZ });
  assert.equal(j.streak(NOW, TZ), 4);
  assert.equal(j.bestStreak(), 4);
});

test("average, trend, strip and tags", () => {
  for (let back = 0; back < 7; back++)
    j.write({ day: j.dayKey(NOW, back, TZ), mood: 4, note: back % 2 ? "#gym" : "#exam prep", now: NOW, tz: TZ });
  for (let back = 7; back < 14; back++) j.write({ day: j.dayKey(NOW, back, TZ), mood: 2, now: NOW, tz: TZ });
  assert.equal(j.average(NOW, { tz: TZ }), 4);
  assert.equal(j.trend(NOW, TZ), "up");
  const s = j.strip(NOW, 14, TZ);
  assert.equal(s.length, 14);
  assert.deepEqual([s[0].mood, s.at(-1).mood, s.at(-1).day], [2, 4, "2026-10-12"]);
  assert.deepEqual(j.topTags(NOW, TZ).map((t) => t.tag), ["exam", "gym"]);
});

test("ACTION: journal logs, reads, finds and removes", () => {
  assert.match(j.runJournalTool("journal", "", NOW), /empty/);
  assert.match(j.runJournalTool("journal log", "4 | finished the essay", NOW), /mood 4\/5 \(good\)/);
  assert.match(j.runJournalTool("journal add", "then slept", NOW), /Added/);
  assert.match(j.runJournalTool("journal show", "", NOW), /finished the essay\nthen slept/);
  assert.match(j.runJournalTool("journal find", "ESSAY", NOW), /finished the essay/);
  assert.match(j.runJournalTool("journal log", "11 | nope", NOW), /1 to 5/);
  assert.match(j.runJournalTool("journal", "", NOW), /Streak: 1 day/);
  assert.match(j.todayLine(NOW), /mood 4\/5/);
  assert.match(j.runJournalTool("journal remove", "today", NOW), /Removed/);
  assert.equal(j.todayLine(NOW), "");
});
