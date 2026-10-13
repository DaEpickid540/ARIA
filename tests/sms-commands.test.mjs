// Run: npm test   (or node --test tests/sms-commands.test.mjs)
// lib/sms-commands.js: which texts are quick commands, and the status text.
import test from "node:test";
import assert from "node:assert/strict";
import { parseSmsCommand, statusText, fmtUptime } from "../lib/sms-commands.js";

test("quick commands are exact; everything else is a message for ARIA", () => {
  assert.deepEqual(parseSmsCommand("Screen"), { cmd: "screen", arg: "" });
  assert.deepEqual(parseSmsCommand("show me my screen!"), { cmd: "screen", arg: "" });
  assert.deepEqual(parseSmsCommand("status"), { cmd: "status", arg: "" });
  assert.deepEqual(parseSmsCommand("lock my pc"), { cmd: "lock", arg: "" });
  assert.deepEqual(parseSmsCommand("?"), { cmd: "help", arg: "" });
  assert.deepEqual(parseSmsCommand("fix"), { cmd: "fix", arg: "" });
  assert.deepEqual(parseSmsCommand("fix my screen"), { cmd: "fix", arg: "" });
  assert.deepEqual(parseSmsCommand("fix: VS Code won't build"), { cmd: "fix", arg: "VS Code won't build" });
  assert.deepEqual(parseSmsCommand("run backup-file C:\\a.txt"), { cmd: "run", arg: "backup-file | C:\\a.txt" });
  assert.deepEqual(parseSmsCommand("run backup-file for each: a, b"), { cmd: "run", arg: "backup-file | for each: a, b" });
  for (const t of ["fixed it, thanks", "what's on my screen right now?", "screen time today?", "status of my order", "running late", "lock in", ""])
    assert.equal(parseSmsCommand(t), null, t);
});

test("status reads plainly, and leaves out what it doesn't know", () => {
  const s = statusText({ relay: true, killed: false, app: "Code.exe", cpu: 37.4, memUsedPct: 61, uptimeSec: 3 * 3600 + 12 * 60, watchers: 2, triggers: 1, pending: 1, tasks: 0 });
  assert.equal(s, "PC: connected ✓\nIn front: Code.exe\nCPU 37% · RAM 61% · up 3h 12m\n2 watchers · 1 trigger\n1 action waiting for your OK.");
  assert.equal(statusText({ relay: false }), "PC: not connected (Claw relay off, or the PC is asleep).");
  assert.equal(fmtUptime(90061), "1d 1h");
});
