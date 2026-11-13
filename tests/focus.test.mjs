// Run: npm test   (or node --test tests/focus.test.mjs)
// lib/focus.js: focus blocks (start, stop, the log, the streak), closing
// distraction apps through Claw, and holding alerts during a block or
// quiet hours until they can arrive together.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.ARIA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "aria-focus-"));
process.env.ARIA_TZ = "America/New_York";
const F = await import("../lib/focus.js");

const NOW = Date.parse("2026-11-09T20:00:00Z"); // Mon 3pm in New York
const MIN = 60_000;
const DAY = 86400_000;

function setup(deps = {}, state = {}) {
  const got = { notified: [], delivered: [], closed: [] };
  F.init(
    {
      notify: (a) => got.notified.push(a),
      deliver: (a) => got.delivered.push(a),
      closeApp: async (app) => {
        got.closed.push(app);
        return app === "Discord" ? "closed Discord (Discord.exe)" : `not running: ${app}`;
      },
      ...deps,
    },
    { start: false },
  );
  F._reset(state);
  return got;
}

test("a block: starts, closes the listed apps, runs out, is logged, and says so", async () => {
  const got = setup({}, { settings: { apps: ["Discord", "Spotify"] } });
  const s = await F.start({ minutes: 25, goal: "essay draft" }, NOW);
  assert.deepEqual(got.closed, ["Discord", "Spotify"]);
  assert.deepEqual(s.closed, ["Discord"], "only what was actually closed");
  assert.equal(F.active(NOW + 10 * MIN).leftMs, 15 * MIN);
  await assert.rejects(F.start({ minutes: 10 }, NOW + MIN), /Already focusing on essay draft: 24 min left/);
  F.tick(NOW + 24 * MIN);
  assert.equal(got.notified.length, 0);
  F.tick(NOW + 25 * MIN);
  assert.equal(F.active(NOW + 25 * MIN), null);
  assert.equal(got.notified[0].title, "Focus block done: 25 min on essay draft");
  assert.equal(got.notified[0].urgent, true);
  assert.match(got.notified[0].text, /Today: 25 min in 1 block\./);
  assert.deepEqual(F.sessions().map((x) => [x.minutes, x.completed]), [[25, true]]);
});

test("stopping early logs the minutes done; under a minute isn't a session", async () => {
  setup();
  await F.start({ minutes: 50 }, NOW);
  assert.equal(F.stop({}, NOW + 12 * MIN).minutes, 12);
  await F.start({ minutes: 50 }, NOW + 20 * MIN);
  F.stop({}, NOW + 20 * MIN + 20_000);
  assert.equal(F.sessions().length, 1);
  assert.equal(F.stop(), null, "nothing running");
  await assert.rejects(F.start({ minutes: 0 }, NOW), /1 to 240/);
  await assert.rejects(F.start({ minutes: 500 }, NOW), /1 to 240/);
});

test("stats: today, the week, and a streak that holds until today is over", () => {
  const at = (daysAgo, minutes) => ({ id: `s${daysAgo}`, goal: "", planned: minutes, minutes, startedAt: NOW - daysAgo * DAY, endedAt: NOW - daysAgo * DAY + minutes * MIN, completed: true });
  setup({}, { sessions: [at(4, 30), at(2, 25), at(1, 50), at(1, 10)] });
  let st = F.stats(NOW);
  assert.equal(st.todayMin, 0);
  assert.equal(st.weekMin, 115);
  assert.equal(st.streak, 2, "yesterday and the day before; today not broken yet");
  assert.deepEqual(st.week.map((d) => d.minutes), [0, 0, 30, 0, 25, 60, 0]);
  setup({}, { sessions: [at(2, 25), at(1, 50), at(0, 20)] });
  st = F.stats(NOW);
  assert.equal(st.streak, 3);
  assert.equal(st.todaySessions, 1);
});

test("alerts are held during a block and come back as one digest; urgent ones aren't held", async () => {
  const got = setup();
  assert.equal(F.hold({ title: "PR merged" }, NOW), false, "nothing holding: goes through");
  await F.start({ minutes: 25 }, NOW);
  assert.equal(F.hold({ title: "PR merged", text: "o/r#7", icon: "🔔" }, NOW + MIN), true);
  assert.equal(F.hold({ title: "Price dropped", text: "$19" }, NOW + 2 * MIN), true);
  assert.equal(F.hold({ title: "Reminder: call mom", urgent: true }, NOW + 3 * MIN), false);
  assert.equal(F.heldCount(), 2);
  F.tick(NOW + 10 * MIN);
  assert.equal(got.delivered.length, 0, "still focusing");
  F.tick(NOW + 25 * MIN);
  assert.equal(got.delivered.length, 1);
  assert.equal(got.delivered[0].title, "2 things while you were focused");
  assert.match(got.delivered[0].text, /\*\*PR merged\*\* — o\/r#7\n.*\*\*Price dropped\*\* — \$19/);
  assert.equal(F.heldCount(), 0);
  // The digest itself is never held again.
  await F.start({ minutes: 5 }, NOW + 30 * MIN);
  assert.equal(F.hold(got.delivered[0], NOW + 31 * MIN), false);
});

test("holdAlerts off: a block doesn't hold anything", async () => {
  setup({}, { settings: { holdAlerts: false } });
  await F.start({ minutes: 25 }, NOW);
  assert.equal(F.hold({ title: "x" }, NOW + MIN), false);
});

test("quiet hours wrap midnight, and one held alert is delivered as itself", () => {
  const got = setup({}, { settings: { quiet: { enabled: true, from: 22, to: 7 } } });
  assert.equal(F.inWindow(23, 22, 7), true);
  assert.equal(F.inWindow(3, 22, 7), true);
  assert.equal(F.inWindow(7, 22, 7), false);
  assert.equal(F.inWindow(12, 9, 17), true);
  assert.equal(F.inWindow(12, 5, 5), false, "same hour both ends = never");
  const night = Date.parse("2026-11-10T04:30:00Z"); // 11:30pm in New York
  assert.equal(F.quietNow(NOW), false);
  assert.equal(F.quietNow(night), true);
  assert.equal(F.hold({ title: "Watcher: page changed", text: "diff", icon: "👁", link: "https://x.com" }, night), true);
  F.tick(night + 60 * MIN);
  assert.equal(got.delivered.length, 0);
  F.tick(Date.parse("2026-11-10T12:05:00Z")); // 7:05am
  assert.deepEqual(got.delivered, [{ title: "Watcher: page changed", text: "diff", icon: "👁", link: "https://x.com", digest: true }]);
});

test("the tool: start in any order, stop, apps, quiet hours", async () => {
  setup();
  assert.equal(await F.runFocusTool("focus start", "essay | 40", NOW), "Focus block started: 40 min on essay. I'll hold alerts until it ends.");
  assert.match(await F.runFocusTool("focus", "", NOW + 10 * MIN), /^Focusing on essay: 30 of 40 min left\./);
  assert.match(await F.runFocusTool("focus start", "5", NOW + MIN), /^Couldn't do that: Already focusing/);
  assert.equal(await F.runFocusTool("focus stop", "", NOW + 15 * MIN), "Stopped after 15 of 40 min on essay. Logged.");
  assert.equal(await F.runFocusTool("focus stop", "", NOW + 16 * MIN), "There's no focus block running.");
  assert.equal(await F.runFocusTool("focus apps", 'Discord, Spo"tify; calc', NOW), "When a focus block starts I'll close: Discord, Spotify calc.");
  assert.equal(await F.runFocusTool("focus apps", "none", NOW), "A focus block won't close any apps.");
  assert.match(await F.runFocusTool("focus quiet", "22-7", NOW), /^Quiet hours set: 22:00 to 7:00\./);
  assert.equal(F.settings().quiet.enabled, true);
  assert.match(await F.runFocusTool("focus quiet", "25-7", NOW), /^Usage/);
  assert.equal(await F.runFocusTool("focus quiet", "off", NOW), "Quiet hours are off.");
  // No relay: the block starts and closes nothing.
  F.init({ closeApp: null }, { start: false });
  F._reset({ settings: { apps: ["Discord"] } });
  assert.equal(await F.runFocusTool("focus start", "", NOW), "Focus block started: 25 min. I'll hold alerts until it ends.");
});
