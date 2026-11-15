// Run: npm test   (or node --test tests/hud-backup.test.mjs)
// lib/hud.js (what needs attention, and the spoken status report),
// lib/claw-history.js (the flight recorder) and lib/backup.js (one file
// that holds everything, and a restore that can be undone).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "aria-hb-"));
process.env.ARIA_DATA_DIR = DIR;
process.env.ARIA_TZ = "America/New_York";
const H = await import("../lib/hud.js");
const C = await import("../lib/claw-history.js");
const B = await import("../lib/backup.js");
const { clawInputOf } = await import("../lib/routines.js");

const NOW = Date.parse("2026-11-09T20:00:00Z"); // Mon 3pm in New York
const MIN = 60_000;

test("priorities: approvals first, then warnings, then what's coming up", () => {
  const list = H.priorities(
    {
      confirms: 1,
      tasks: { running: 2, awaiting: 1 },
      cpu: 95,
      mem: 40,
      focus: { active: { leftMs: 12 * MIN, goal: "essay" }, held: 3 },
      reminders: [{ text: "pizza", at: NOW + 10 * MIN }, { text: "dentist", at: NOW + 5 * 3600_000 }, { text: "next week", at: NOW + 6 * 86400_000 }],
      grades: { line: "AP Bio needs 95/100 on Unit 2 Test", margin: -5 },
      cards: { due: 12 },
      watchers: 4,
      usage: { calls: 10, failRate: 40 },
    },
    NOW,
  );
  assert.deepEqual(list.map((p) => p.level), ["alert", "alert", "warn", "warn", "info", "warn", "info", "warn", "info", "info", "info", "info"]);
  assert.equal(list[0].text, "1 action waiting for your OK");
  assert.equal(list[2].text, "CPU at 95%");
  assert.equal(list[4].text, "Focus: 12 min left on essay");
  assert.equal(list[5].text, "pizza — in 10 min (3:10pm)");
  assert.ok(!list.some((p) => /next week/.test(p.text)), "only the next 24 hours");
  assert.equal(H.overall(list), "ALERT");
  assert.deepEqual(H.priorities({}, NOW), [{ level: "ok", icon: "check2-circle", text: "Nothing needs you right now." }]);
  assert.equal(H.overall(H.priorities({ mem: 93 }, NOW)), "ATTENTION");
  assert.equal(H.overall(H.priorities({ cards: { due: 2 } }, NOW)), "NOMINAL");
});

test("status report: short spoken sentences, and nothing it didn't measure", () => {
  assert.equal(
    H.statusReport({ cpu: 12, mem: 48, relay: { connected: true, name: "DESKTOP" }, model: { label: "Gemini (flash)" }, usage: { calls: 14, avgMs: 1840 } }, NOW),
    "Good afternoon. All systems nominal. Processor at 12 percent, memory at 48 percent. PC control is online on DESKTOP. Thinking with Gemini (flash). 14 model calls today, averaging 1.8 seconds.",
  );
  const r = H.statusReport({ relay: { connected: false }, confirms: 2, reminders: [{ text: "pizza", at: NOW + 10 * MIN }] }, NOW);
  assert.equal(r, "Good afternoon. Something needs your approval. PC control is offline. 2 actions waiting for your OK. pizza, in 10 min (3:10pm).");
  assert.doesNotMatch(r, /percent|Thinking with|\*\*/);
  assert.equal(H.greeting(Date.parse("2026-11-09T08:00:00Z")), "Working late");
  assert.equal(H.greeting(Date.parse("2026-11-09T14:00:00Z")), "Good morning");
});

test("the load history keeps ten minutes and reports average and peak", () => {
  H._reset();
  for (let i = 0; i < 130; i++) H.sample({ cpu: i % 2 ? 80 : 20, mem: null, at: NOW + i * 5000 });
  assert.equal(H.history().length, H.MAX_SAMPLES);
  assert.deepEqual(H.trend("cpu"), { avg: 50, peak: 80 });
  assert.deepEqual(H.trend("mem"), { avg: null, peak: null });
});

test("flight recorder: commands, their results, and a run of them as routine steps", () => {
  C._reset();
  C.record({ id: "a", type: "launch_app", app: "Notepad" }, { deviceId: "pc", at: NOW });
  C.record({ id: "b", type: "type", text: "hello" }, { at: NOW + 1000 });
  C.record({ id: "c", type: "shell", cmd: "del x" }, { at: NOW + 2000 });
  C.record({ id: "d", type: "hotkey", keys: ["ctrl", "s"] }, { at: NOW + 3000 });
  C.record({ id: "e", type: "continuous_screen" }, { at: NOW + 3500 });
  C.result("a", "launched Notepad", NOW + 400);
  C.result("c", "ERROR: access denied", NOW + 2600);
  C.result("zzz", "ignored");
  const l = C.list();
  assert.deepEqual(l.map((e) => e.summary), ["hotkey: ctrl+s", "shell: del x", "type: hello", "launch_app: Notepad"]);
  assert.deepEqual([l[3].result, l[3].ms, l[3].failed], ["launched Notepad", 400, false]);
  assert.equal(l[1].failed, true);
  // The failed step and anything with no text form are left out.
  assert.deepEqual(C.stepsOf(["a", "b", "c", "d"], clawInputOf), ["open: Notepad", "type: hello", "hotkey: ctrl+s"]);
  assert.deepEqual(C.stats(NOW + 5000), { today: 4, failed: 1, last: l[0] });
});

test("flight recorder: a screen watch is one line, and only the last 300 are kept", () => {
  C._reset();
  for (let i = 0; i < 5; i++) C.record({ id: `s${i}`, type: "screenshot" }, { at: NOW + i * 4000 });
  assert.equal(C.list().length, 1);
  assert.equal(C.list()[0].count, 5);
  C.result("s4", "screenshot");
  assert.equal(C.list()[0].result, "screenshot");
  for (let i = 0; i < 320; i++) C.record({ id: `k${i}`, type: "hotkey", keys: ["a"] }, { at: NOW + 60_000 + i });
  assert.equal(C.list(999).length, C.MAX_ENTRIES);
});

test("backup: holds the data files, leaves out sign-in data and anything that looks like a key", () => {
  B.init({ dir: DIR, start: false });
  fs.writeFileSync(path.join(DIR, "chats.json"), JSON.stringify({ chats: [{ id: "chat_1" }] }));
  fs.writeFileSync(path.join(DIR, "grades.json"), JSON.stringify({ classes: [] }));
  fs.writeFileSync(path.join(DIR, "owners.json"), JSON.stringify({ owners: ["secret"] }));
  fs.writeFileSync(path.join(DIR, "api-keys.json"), JSON.stringify({ k: "sk-123" }));
  fs.writeFileSync(path.join(DIR, "gvoice-seen.json"), "{}");
  fs.writeFileSync(path.join(DIR, "vectors.json"), "[]");
  fs.writeFileSync(path.join(DIR, "broken.json"), "{not json");
  fs.writeFileSync(path.join(DIR, "notes.txt"), "not json at all");
  const b = B.bundle(NOW);
  assert.deepEqual(Object.keys(b.files), ["chats.json", "grades.json"]);
  assert.deepEqual(b.skipped.sort(), ["api-keys.json", "broken.json", "gvoice-seen.json", "owners.json", "vectors.json"]);
  for (const n of ["../x.json", "a/b.json", "owners.json", "session-store.json", "my_tokens.json", "x.txt", ".json"]) assert.equal(B.allowed(n), false, n);
  for (const n of ["chats.json", "skills-prefs.json", "claw-history.json", "monkeys.json"]) assert.equal(B.allowed(n), true, n);
});

test("backup: a daily snapshot, rotated; restore saves what was there first and refuses odd names", () => {
  B.init({ dir: DIR, start: false });
  const day = 86400_000;
  for (let i = 0; i < 9; i++) B.writeSnapshot(NOW + i * day);
  const snaps = B.listSnapshots().filter((s) => !s.safety);
  assert.equal(snaps.length, B.KEEP_DAILY);
  assert.equal(B.tick(NOW + 8 * day), null, "today's is already there");
  assert.ok(B.tick(NOW + 9 * day));

  const doc = B.bundle(NOW);
  doc.files["grades.json"] = { classes: [{ id: "ap-bio" }] };
  doc.files["owners.json"] = { owners: ["attacker"] };
  doc.files["../evil.json"] = { x: 1 };
  fs.writeFileSync(path.join(DIR, "chats.json"), JSON.stringify({ chats: [] })); // changed since the backup
  const out = B.restore(doc, { now: NOW });
  assert.deepEqual(out.restored.sort(), ["chats.json", "grades.json"]);
  assert.deepEqual(out.refused.sort(), ["../evil.json", "owners.json"]);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(DIR, "chats.json"), "utf8")), { chats: [{ id: "chat_1" }] });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(DIR, "owners.json"), "utf8")), { owners: ["secret"] }, "sign-in data untouched");
  assert.ok(!fs.existsSync(path.join(DIR, "..", "evil.json")));
  // What was there before the restore can be had back.
  const safety = B.readSnapshot(out.safety);
  assert.deepEqual(safety.files["chats.json"], { chats: [] });
  assert.deepEqual(B.restore(doc, { only: ["grades.json"], now: NOW + 1 }).restored, ["grades.json"]);

  assert.throws(() => B.restore({ hello: 1 }), /isn't an ARIA backup/);
  assert.throws(() => B.restore({ app: "aria", kind: "backup", version: 2, files: {} }), /version 2/);
  assert.throws(() => B.restore({ app: "aria", kind: "backup", version: 1, files: { "owners.json": {} } }), /Nothing in that backup/);
  assert.throws(() => B.readSnapshot("../../etc/passwd"), /No such backup/);
  assert.throws(() => B.restore(doc, { only: ["nope.json"] }), /None of the chosen files/);
});
