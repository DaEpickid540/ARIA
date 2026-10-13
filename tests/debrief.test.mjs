// Run: npm test   (or node --test tests/debrief.test.mjs)
// lib/debrief.js: which of the day's records count as done, slipped and
// tomorrow, and that nothing outside them reaches the write-up.
import test from "node:test";
import assert from "node:assert/strict";
import { gatherDay, fallbackDebrief, debriefPrompt, emptyDay, dayBounds, lastFiled } from "../lib/debrief.js";
import { dateKey, zoned } from "../lib/clock.js";

// Tuesday 13 Oct 2026, 9 PM in New York (01:00 UTC on the 14th), whatever
// zone this machine is in.
const TZ = "America/New_York";
const NOW = Date.UTC(2026, 9, 14, 1, 0);
const { start, tomorrow } = dayBounds(NOW, TZ);
const H = 3600_000;

const day = () =>
  gatherDay({
    now: NOW,
    tz: TZ,
    todos: [
      { text: "Physics lab writeup", done: true, createdAt: start - 48 * H, doneAt: start + 15 * H },
      { text: "Old thing done last week", done: true, createdAt: start - 200 * H, doneAt: start - 100 * H },
      { text: "Email Mr. Lee", done: false, createdAt: start - 30 * H },
      { text: "Practice scales", done: false, createdAt: start + 9 * H },
      { text: "Legacy todo", done: false }, // no timestamps: from before they were kept
    ],
    tasks: [
      { title: "Study guide: thermodynamics", status: "done", finishedAt: start + 12 * H },
      { title: "Yesterday's task", status: "done", finishedAt: start - 5 * H },
      { title: "Scrape prices", status: "failed", created: start - 5 * H },
    ],
    chats: [
      { id: "a", title: "Calc homework", messages: [{ role: "user", timestamp: start + 16 * H }, { role: "aria", timestamp: start + 16 * H }, { role: "user", timestamp: start + 17 * H }] },
      { id: "b", title: "Old chat", messages: [{ role: "user", timestamp: start - 30 * H }] },
      { id: "chat_briefings", briefings: true, title: "🌅", messages: [{ role: "aria", timestamp: start + 8 * H }] },
      { id: "chat_alerts", alerts: true, title: "🔔", messages: [{ role: "aria", content: "🔔 **o/r#7: it's merged**\n\nmerged", timestamp: start + 14 * H }] },
    ],
    events: [
      { title: "Orchestra", start: new Date(tomorrow + 15 * H).toISOString(), allDay: false },
      { title: "Bio test", start: new Date(tomorrow + 8 * H).toISOString(), allDay: false },
      { title: "Spirit day", start: dayKey(tomorrow), allDay: true },
      { title: "Today's thing", start: new Date(start + 10 * H).toISOString(), allDay: false },
    ],
  });

const dayKey = (t) => dateKey(t, TZ);

test("done, slipped and added-today are told apart by timestamps", () => {
  const f = day();
  assert.deepEqual(f.doneToday, ["Physics lab writeup"]);
  assert.deepEqual(f.slipped, ["Email Mr. Lee", "Legacy todo"]);
  assert.deepEqual(f.addedToday, ["Practice scales"]);
  assert.deepEqual(f.tasksDone, ["Study guide: thermodynamics"]);
  assert.deepEqual(f.tasksStuck, ["Scrape prices (failed)"]);
});

test("today's conversations and alerts; server-filed chats aren't conversations", () => {
  const f = day();
  assert.deepEqual(f.talked, [{ title: "Calc homework", n: 2 }]);
  assert.deepEqual(f.alerts, ["🔔 o/r#7: it's merged"]);
});

test("tomorrow: only tomorrow, in time order, first timed block picked", () => {
  const f = day();
  assert.deepEqual(f.tomorrow.map((e) => e.title), ["Spirit day", "Bio test", "Orchestra"]);
  assert.equal(f.firstBlock.title, "Bio test");
  assert.ok(!f.tomorrow.some((e) => e.title === "Today's thing"));
});

test("no calendar is said, not guessed", () => {
  const f = gatherDay({ now: NOW, tz: TZ, events: null });
  assert.equal(f.tomorrow, null);
  assert.match(debriefPrompt(f), /calendar not connected/);
});

test("the fallback write-up uses only the facts", () => {
  const text = fallbackDebrief(day());
  assert.match(text, /You finished 2 things today/);
  assert.match(text, /Slipped: Email Mr\. Lee; Legacy todo/);
  assert.match(text, /Tomorrow: .*Bio test first/);
  assert.match(text, /Start with: Email Mr\. Lee/);
  assert.ok(!/Old thing done last week|Yesterday's task/.test(text));
});

test("an empty day is recognised, and the SMS prompt asks for plain text", () => {
  assert.equal(emptyDay(gatherDay({ now: NOW, tz: TZ, events: [] })), true);
  assert.equal(emptyDay(day()), false);
  assert.match(debriefPrompt(day(), { sms: true }), /plain text, no markdown/);
});

test("an empty day written on request says so plainly", () => {
  assert.match(fallbackDebrief(gatherDay({ now: NOW, tz: TZ, events: null })), /Quiet day on record.*Connect Google Calendar/);
});

test("the owner's day, not the server's: 9 PM in New York is still the 13th on a UTC server", () => {
  const b = dayBounds(NOW, TZ);
  assert.equal(new Date(b.start).toISOString(), "2026-10-13T04:00:00.000Z");
  assert.equal(zoned(NOW, TZ).h, 21);
  assert.equal(dateKey(NOW, "UTC"), "2026-10-14", "UTC already thinks it's tomorrow");
  assert.equal(gatherDay({ now: NOW, tz: TZ }).date, "Tuesday, October 13");
  // The day DST ends is 25 hours long.
  const fall = dayBounds(Date.UTC(2026, 10, 1, 16), TZ);
  assert.equal((fall.tomorrow - fall.start) / 3600_000, 25);
});

test("briefing and debrief stand-downs each look at their own kind", () => {
  const chat = {
    messages: [
      { channel: "briefing", timestamp: 100 },
      { channel: "debrief", scheduled: true, timestamp: 200 },
      { channel: "debrief", timestamp: 300 }, // "Write one now"
    ],
  };
  assert.equal(lastFiled(chat, "briefing"), 100, "last night's debrief doesn't count as this morning's briefing");
  assert.equal(lastFiled(chat, "debrief"), 200, "a manual debrief doesn't cancel the scheduled one");
  assert.equal(lastFiled(null, "briefing"), 0);
});

test("only recently stuck tasks are news", () => {
  const f = gatherDay({
    now: NOW,
    tz: TZ,
    tasks: [
      { title: "Failed six weeks ago", status: "failed", created: start - 42 * 24 * H },
      { title: "Failed yesterday", status: "failed", created: start - 20 * H },
    ],
  });
  assert.deepEqual(f.tasksStuck, ["Failed yesterday (failed)"]);
  assert.equal(emptyDay(gatherDay({ now: NOW, tz: TZ, tasks: [{ title: "x", status: "failed", created: 1 }], events: [] })), true);
});

test("a task that got stuck today counts even if it was made last week; a trip running through tomorrow counts", () => {
  const f = gatherDay({
    now: NOW,
    tz: TZ,
    tasks: [{ title: "Old task, failed today", status: "failed", created: start - 7 * 24 * H, changedAt: start + 10 * H }],
    events: [{ title: "Band trip", start: dayKey(start), end: dayKey(tomorrow + 48 * H), allDay: true }],
  });
  assert.deepEqual(f.tasksStuck, ["Old task, failed today (failed)"]);
  assert.deepEqual(f.tomorrow.map((e) => e.title), ["Band trip"]);
});
