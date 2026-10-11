// Run: npm test   (or node --test tests/chat-sync.test.mjs)
// The merge rules every server and page relies on (lib/chat-sync.js): the
// newer copy of a chat wins, deletions leave markers that stale copies can't
// get past, and malformed ids never get in.
import test from "node:test";
import assert from "node:assert/strict";
import { newer, mergeInto, validChatId } from "../lib/chat-sync.js";

const store = (chats = [], deleted = {}) => ({ chats, deleted });
const chat = (id, updatedAt, extra = {}) => ({ id, updatedAt, title: id, messages: [], ...extra });

test("newer: a stamped copy beats an older or unstamped one", () => {
  assert.equal(newer(chat("a", 2), chat("a", 1)), true);
  assert.equal(newer(chat("a", 1), chat("a", 2)), false);
  assert.equal(newer(chat("a", 1), undefined), true);
  // From a page older than sync: never overwrites a stamped chat.
  assert.equal(newer({ id: "a" }, chat("a", 5)), false);
  // Two unstamped copies: the incoming one wins only if it differs.
  assert.equal(newer({ id: "a", title: "x" }, { id: "a", title: "y" }), true);
  assert.equal(newer({ id: "a", title: "x" }, { id: "a", title: "x" }), false);
});

test("mergeInto: new chats are added and reported", () => {
  const s = store([chat("chat_1", 1)]);
  const changed = mergeInto(s, [chat("chat_2", 5)]);
  assert.deepEqual(changed.map((c) => c.id), ["chat_2"]);
  assert.deepEqual(s.chats.map((c) => c.id).sort(), ["chat_1", "chat_2"]);
});

test("mergeInto: the newer copy of a chat replaces the older", () => {
  const s = store([chat("chat_1", 1, { title: "old" })]);
  mergeInto(s, [chat("chat_1", 2, { title: "new" })]);
  assert.equal(s.chats[0].title, "new");
  const changed = mergeInto(s, [chat("chat_1", 1, { title: "stale" })]);
  assert.equal(changed.length, 0);
  assert.equal(s.chats[0].title, "new");
});

test("mergeInto: a deletion removes the chat and leaves a marker", () => {
  const s = store([chat("chat_1", 1)]);
  const changed = mergeInto(s, [], [{ id: "chat_1", at: 10 }]);
  assert.deepEqual(changed, [{ id: "chat_1", deleted: true, updatedAt: 10 }]);
  assert.equal(s.chats.length, 0);
  assert.equal(s.deleted.chat_1, 10);
});

test("mergeInto: a device still holding a deleted chat can't bring it back", () => {
  const s = store([], { chat_1: 10 });
  const changed = mergeInto(s, [chat("chat_1", 9)]);
  assert.equal(changed.length, 0);
  assert.equal(s.chats.length, 0);
});

test("mergeInto: a chat edited after its deletion comes back", () => {
  const s = store([], { chat_1: 10 });
  mergeInto(s, [chat("chat_1", 11)]);
  assert.equal(s.chats.length, 1);
  assert.equal(s.deleted.chat_1, undefined);
});

test("mergeInto: a delete older than the last edit loses to the edit", () => {
  const s = store([chat("chat_1", 20)]);
  const changed = mergeInto(s, [], [{ id: "chat_1", at: 10 }]);
  assert.equal(changed.length, 0);
  assert.equal(s.chats.length, 1);
});

test("mergeInto: an older repeat of a delete is ignored", () => {
  const s = store([], { chat_1: 10 });
  assert.equal(mergeInto(s, [], [{ id: "chat_1", at: 5 }]).length, 0);
  assert.equal(s.deleted.chat_1, 10);
});

test("mergeInto: malformed ids are refused, chats and deletions alike", () => {
  const s = store([chat("chat_1", 1)]);
  const changed = mergeInto(
    s,
    [chat("chat_bad');alert(1);//", 5), chat("", 5), { title: "no id" }, null],
    [{ id: "chat_1'><img>", at: 99 }, "../etc"],
  );
  assert.equal(changed.length, 0);
  assert.deepEqual(s.chats.map((c) => c.id), ["chat_1"]);
  assert.deepEqual(s.deleted, {});
});

test("validChatId: the ids ARIA makes pass, anything that could escape doesn't", () => {
  for (const ok of ["chat_1791756958971", "chat_1791756958971_sms", "chat_briefings", "a.b-c_d"])
    assert.equal(validChatId(ok), true, ok);
  for (const bad of ["", "x".repeat(121), "a b", "a'b", 'a"b', "a<b", "a/b", 42, null, undefined])
    assert.equal(validChatId(bad), false, String(bad));
});

test("mergeInto: chats stay newest first (ids are chat_<time>)", () => {
  const s = store();
  mergeInto(s, [chat("chat_100", 1), chat("chat_300", 1), chat("chat_200", 1)]);
  assert.deepEqual(s.chats.map((c) => c.id), ["chat_300", "chat_200", "chat_100"]);
});
