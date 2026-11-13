// Run: npm test   (or node --test tests/reminders.test.mjs)
// lib/reminders.js: the ways people say a time, repeating reminders, and
// firing. Clock times are the owner's zone (America/New_York here), not the
// machine's.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.ARIA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "aria-rem-"));
process.env.ARIA_TZ = "America/New_York";
const R = await import("../lib/reminders.js");

// Monday 9 Nov 2026, 3:00pm in New York (EST, UTC−5).
const NOW = Date.parse("2026-11-09T20:00:00Z");
const MIN = 60_000;
const HOUR = 60 * MIN;
const iso = (t) => new Date(t).toISOString();
const when = (s) => iso(R.parseWhen(s, NOW).at);

test("durations: in 20m, 1h 30m, bare '90s'", () => {
  assert.equal(R.parseWhen("in 20m", NOW).at, NOW + 20 * MIN);
  assert.equal(R.parseWhen("in 1h 30m", NOW).at, NOW + 90 * MIN);
  assert.equal(R.parseWhen("90s", NOW).at, NOW + 90_000);
  assert.equal(R.parseWhen("in 2 hours and 15 minutes", NOW).at, NOW + 135 * MIN);
  assert.equal(R.durationOf("3 days"), 3 * 24 * HOUR);
  assert.equal(R.durationOf("soon"), null);
});

test("clock times are the next time the clock reads that, in the owner's zone", () => {
  assert.equal(when("5pm"), "2026-11-09T22:00:00.000Z", "5pm today is still ahead");
  assert.equal(when("at 2pm"), "2026-11-10T19:00:00.000Z", "2pm has passed: tomorrow");
  assert.equal(when("17:30"), "2026-11-09T22:30:00.000Z");
  assert.equal(when("noon"), "2026-11-10T17:00:00.000Z");
  assert.equal(when("tonight"), "2026-11-10T01:00:00.000Z", "8pm");
  assert.equal(when("tomorrow 8am"), "2026-11-10T13:00:00.000Z");
  assert.equal(when("tomorrow"), "2026-11-10T14:00:00.000Z", "9am when no time is said");
});

test("days and dates", () => {
  assert.equal(when("fri 3pm"), "2026-11-13T20:00:00.000Z");
  assert.equal(when("monday 9am"), "2026-11-16T14:00:00.000Z", "today is Monday and 9am has passed: next week");
  assert.equal(when("2026-11-12 14:00"), "2026-11-12T19:00:00.000Z");
  assert.equal(when("11/12 2pm"), "2026-11-12T19:00:00.000Z");
  assert.equal(when("1/5 9am"), "2027-01-05T14:00:00.000Z", "a date already past this year means next year's");
});

test("a clock time lands on the right hour across a DST change", () => {
  // 8 March 2026: clocks go forward at 2am in New York.
  const before = Date.parse("2026-03-07T20:00:00Z");
  assert.equal(iso(R.parseWhen("tomorrow 9am", before).at), "2026-03-08T13:00:00.000Z", "9am EDT, not 10am");
});

test("what isn't a time is refused with examples, not guessed", () => {
  for (const bad of ["", "soon", "5", "25:00", "13pm", "every", "today 1pm"]) assert.throws(() => R.parseWhen(bad, NOW), /Try:|When\?|already passed/, bad);
  assert.throws(() => R.parseWhen("every 10s", NOW), /once a minute/);
  assert.throws(() => R.parseWhen("2020-01-01", NOW), /already passed/);
});

test("repeating: every day / weekday / monday / 2h", () => {
  let r = R.parseWhen("every day 7am", NOW);
  assert.deepEqual(r.repeat, { kind: "daily", h: 7, min: 0 });
  assert.equal(iso(r.at), "2026-11-10T12:00:00.000Z");
  r = R.parseWhen("every weekday 7:30", NOW);
  assert.equal(r.repeat.kind, "weekdays");
  // From Friday evening the next weekday is Monday.
  const fri = Date.parse("2026-11-13T23:00:00Z");
  assert.equal(iso(R.nextRepeat({ at: fri, repeat: r.repeat }, fri)), "2026-11-16T12:30:00.000Z");
  r = R.parseWhen("every mon 9am", NOW);
  assert.deepEqual(r.repeat, { kind: "weekly", dow: 1, h: 9, min: 0 });
  assert.equal(iso(r.at), "2026-11-16T14:00:00.000Z");
  r = R.parseWhen("every 2h", NOW);
  assert.deepEqual(r.repeat, { kind: "every", ms: 2 * HOUR });
  assert.equal(R.describeRepeat({ kind: "weekly", dow: 5, h: 15, min: 30 }), "every Friday at 3:30pm");
  // After a long sleep an "every" reminder skips ahead, staying on its beat.
  assert.equal(R.nextRepeat({ at: NOW, repeat: { kind: "every", ms: HOUR } }, NOW + 5.5 * HOUR), NOW + 6 * HOUR);
});

test("firing: one-offs go, repeats move on, and a late one says so", () => {
  R._reset([]);
  const fired = [];
  R.init({ notify: (a) => fired.push(a) }, { start: false });
  R._reset([]);
  const once = R.add({ when: "in 20m", text: "take the pizza out" }, NOW);
  const daily = R.add({ when: "every day 4pm", text: "stretch" }, NOW);
  assert.deepEqual(R.tick(NOW + 5 * MIN), []);
  R.tick(NOW + 21 * MIN);
  assert.equal(fired.length, 1);
  assert.equal(fired[0].title, "Reminder: take the pizza out");
  assert.equal(fired[0].urgent, true, "a reminder you set rings through quiet hours");
  assert.equal(fired[0].reminder.id, once.id);
  assert.deepEqual(R.list().map((r) => r.text), ["stretch"]);
  R.tick(NOW + HOUR + MIN); // 4:01pm
  assert.equal(fired[1].title, "Reminder: stretch");
  assert.equal(iso(R.list()[0].at), "2026-11-10T21:00:00.000Z", "tomorrow, same time");
  assert.equal(R.list()[0].id, daily.id);
  // The server was off when it was due.
  R.add({ text: "late one", at: NOW + 2 * HOUR }, NOW);
  R.tick(NOW + 8 * HOUR);
  assert.match(fired.at(-1).text, /was due today at 5pm/);
  assert.equal(R.fmtWhen(NOW + 2 * HOUR, NOW + 10 * HOUR), "yesterday at 5pm");
});

test("the tool: when | what, either way round, plain sentences, cancel by a word", () => {
  R._reset([]);
  assert.equal(R.runReminderTool("remind", "in 20m | take the pizza out", NOW), 'Okay: "take the pizza out" in 20 min (3:20pm).');
  assert.match(R.runReminderTool("remind", "call mom | tomorrow 8am", NOW), /"call mom" tomorrow at 8am/);
  assert.match(R.runReminderTool("remind", "in 2 hours to check the oven", NOW), /"check the oven" today at 5pm/);
  assert.match(R.runReminderTool("remind", "every weekday 7am | pack gym bag", NOW), /then every weekday at 7am/);
  assert.match(R.runReminderTool("remind", "whenever | x", NOW), /^Couldn't set that: I couldn't read "whenever"/);
  assert.match(R.runReminderTool("remind list", "", NOW), /- take the pizza out — in 20 min \(3:20pm\)\n- check the oven/);
  assert.equal(R.runReminderTool("remind cancel", "pizza", NOW), "Cancelled: take the pizza out.");
  assert.match(R.runReminderTool("remind cancel", "nonsense", NOW), /^No reminder matches/);
  assert.match(R.runReminderTool("remind cancel", "", NOW), /Cancel which one/);
  assert.equal(R.runReminderTool("remind cancel", "all", NOW), "Cleared 3 reminders.");
  assert.equal(R.runReminderTool("remind", "", NOW), "No reminders set.");
});

test("snooze brings a rung reminder back; reminders survive a restart", () => {
  R._reset([]);
  const r = R.add({ when: "in 5m", text: "stand up" }, NOW);
  assert.equal(R.snooze(r.id, 10, NOW).at, NOW + 10 * MIN, "still listed: moved");
  R.tick(NOW + 11 * MIN);
  assert.equal(R.list().length, 0);
  const again = R.snooze({ text: "stand up" }, 15, NOW + 11 * MIN);
  assert.equal(again.at, NOW + 26 * MIN, "already rung: a new one with the same words");
  R.init({}, { start: false }); // reads data/reminders.json again
  assert.deepEqual(R.list().map((x) => x.text), ["stand up"]);
  assert.equal(R.fmtWhen(NOW + 3 * 24 * HOUR, NOW), "Thu, Nov 12 at 3pm");
});
