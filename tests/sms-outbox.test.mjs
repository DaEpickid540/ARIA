// Run: npm test   (or node --test tests/sms-outbox.test.mjs)
// lib/sms-outbox.js: ARIA's own texts go to the owner's conversation once,
// never before an owner is known, and never again after a restart.
import test from "node:test";
import assert from "node:assert/strict";
import { createOutbox } from "../lib/sms-outbox.js";

function rig({ disk = {}, waiting = [] } = {}) {
  const sent = [];
  const logs = [];
  let clock = 1_000_000;
  const box = createOutbox({
    load: (n) => (disk[n] ? JSON.parse(disk[n]) : null),
    save: (n, o) => (disk[n] = JSON.stringify(o)),
    fetchOutbox: async () => waiting,
    send: async (thread, text) => sent.push([thread, text]),
    toParts: (t) => t.split("|"),
    log: (m) => logs.push(m),
    now: () => clock,
  });
  return { box, sent, logs, disk, waiting, tick: (ms) => (clock += ms) };
}

test("nothing goes out until a conversation has unlocked, and it says so once", async () => {
  const r = rig({ waiting: [{ key: "chat_briefings:1", text: "debrief" }] });
  assert.equal(await r.box.deliver(), 0);
  assert.equal(await r.box.deliver(), 0);
  assert.equal(r.sent.length, 0);
  assert.equal(r.logs.length, 1);
  assert.match(r.logs[0], /text the password/);
});

test("once there's an owner: each message once, split into parts", async () => {
  const r = rig({ waiting: [{ key: "a:1", text: "one|two" }, { key: "b:2", text: "three" }] });
  assert.deepEqual(r.box.rememberOwner("thread-9"), { previous: null });
  assert.equal(r.box.rememberOwner("thread-9"), false, "same owner: nothing to save");
  assert.equal(await r.box.deliver(), 2);
  assert.deepEqual(r.sent, [["thread-9", "one"], ["thread-9", "two"], ["thread-9", "three"]]);
  assert.equal(await r.box.deliver(), 0);
  assert.equal(r.sent.length, 3);
});

test("a restart remembers the owner and what was sent; the first run doesn't text old messages", async () => {
  const disk = {};
  const first = rig({ disk, waiting: [{ key: "a:1", text: "x" }] });
  first.box.rememberOwner("t1");
  await first.box.deliver();
  const since = JSON.parse(disk.outbox).since;
  assert.equal(since, 1_000_000, "since = the first run's start");
  const again = rig({ disk, waiting: [{ key: "a:1", text: "x" }, { key: "c:3", text: "new" }] });
  assert.equal(again.box.owner().threadId, "t1");
  await again.box.deliver();
  assert.deepEqual(again.sent, [["t1", "new"]]);
  assert.equal(JSON.parse(disk.outbox).since, since);
});

test("marked sent before sending: a send that throws isn't retried into a duplicate", async () => {
  const disk = {};
  let calls = 0;
  const box = createOutbox({
    load: (n) => (disk[n] ? JSON.parse(disk[n]) : null),
    save: (n, o) => (disk[n] = JSON.stringify(o)),
    fetchOutbox: async () => [{ key: "a:1", text: "x" }],
    send: async () => {
      calls++;
      throw new Error("Google Voice didn't accept the message");
    },
  });
  box.rememberOwner("t");
  await assert.rejects(box.deliver());
  await box.deliver();
  assert.equal(calls, 1);
});

test("the sent list forgets keys after two days", async () => {
  const r = rig({ waiting: [{ key: "a:1", text: "x" }] });
  r.box.rememberOwner("t");
  await r.box.deliver();
  r.tick(3 * 24 * 3600_000);
  r.waiting.length = 0;
  r.waiting.push({ key: "b:2", text: "y" });
  await r.box.deliver();
  assert.deepEqual(Object.keys(JSON.parse(r.disk.outbox).sent), ["b:2"]);
});

test("more than a handful in a day: all go out, and 'since' moves forward", async () => {
  const waiting = Array.from({ length: 14 }, (_, i) => ({ key: `chat_alerts:${i}`, at: 2_000_000 + i * 60_000, text: `alert ${i}` }));
  const r = rig({ waiting });
  r.box.rememberOwner("t");
  assert.equal(await r.box.deliver(), 14);
  assert.equal(r.sent.length, 14);
  const since = JSON.parse(r.disk.outbox).since;
  assert.equal(since, 2_000_000 + 13 * 60_000 - 10 * 60_000, "ten minutes behind the newest, for late chat sync");
  assert.equal(await r.box.deliver(), 0, "the margin doesn't resend");
});

test("a new owner reports the previous one, so the hook can tell it", () => {
  const r = rig();
  assert.deepEqual(r.box.rememberOwner("a"), { previous: null });
  assert.deepEqual(r.box.rememberOwner("b"), { previous: "a" });
  assert.equal(r.box.rememberOwner("b"), false);
});

test("texts ARIA sent unprompted are remembered per conversation across restarts", async () => {
  const disk = {};
  const a = rig({ disk, waiting: [{ key: "a:1", at: 5, text: "one|two" }] });
  a.box.rememberOwner("t");
  await a.box.deliver();
  a.box.recordUnprompted("old", "moved notice");
  const b = rig({ disk });
  assert.deepEqual(b.box.unprompted("t"), ["one", "two"]);
  assert.deepEqual(b.box.unprompted("old"), ["moved notice"]);
  assert.deepEqual(b.box.unprompted("nobody"), []);
});
