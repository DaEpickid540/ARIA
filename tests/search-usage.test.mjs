// Run: npm test   (or node --test tests/search-usage.test.mjs)
// lib/search.js (one search over chats, memory, notes, todos, flashcards,
// routines, reminders) and lib/usage.js (what the models were asked and how
// they answered).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.ARIA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "aria-su-"));
process.env.ARIA_TZ = "America/New_York";
const { searchAll, terms, snippet, formatHits } = await import("../lib/search.js");
const U = await import("../lib/usage.js");

const NOW = Date.parse("2026-11-09T20:00:00Z");
const DAY = 86400_000;
const SRC = {
  chats: [
    { id: "chat_1", title: "Mason Navigator kiosk", updatedAt: NOW - 20 * DAY, messages: [
      { role: "user", content: "How should the kiosk find the shortest path between rooms?", timestamp: NOW - 20 * DAY },
      { role: "aria", content: "Breadth-first search works since every hallway segment costs the same. BFS pathfinding from the kiosk's node gives the shortest route.", timestamp: NOW - 20 * DAY },
    ] },
    { id: "chat_2", title: "Dinner ideas", updatedAt: NOW - DAY, messages: [
      { role: "user", content: "what can I make with chickpeas", timestamp: NOW - DAY },
      { role: "aria", content: [{ type: "text", text: "not a string" }], timestamp: NOW - DAY },
    ] },
    { id: "chat_3", title: "Pathfinding homework", updatedAt: NOW, messages: [] },
  ],
  memories: [{ text: "Sarvin's ESP32 speaker uses an I2S DAC", timestamp: NOW - 3 * DAY }, "Favourite pathfinding algorithm: A*"],
  notes: [{ text: "Buy solder and heat shrink", created: "3:45:10 PM" }],
  todos: [{ text: "Finish kiosk QR codes", done: false }],
  cards: [{ id: "c1", deck: "Bio", front: "What is ATP?", back: "The cell's energy currency", created: NOW - 2 * DAY }],
  routines: [{ name: "backup-file", description: "Copies a file into D:\\Backup", steps: ['shell: copy "{{file}}" "D:\\Backup\\"'], updatedAt: NOW - 5 * DAY }],
  reminders: [{ id: "r1", text: "email Mr. Patel about the kiosk demo", at: NOW + DAY, created: NOW }],
};
const kinds = (q, o) => searchAll(q, SRC, { now: NOW, ...o }).map((h) => h.kind);

test("every word has to appear, in any order; quotes keep a phrase", () => {
  assert.deepEqual(terms('kiosk "shortest path"  KIOSK'), ["kiosk", "shortest path"]);
  const hits = searchAll("path kiosk shortest", SRC, { now: NOW });
  assert.deepEqual(hits.map((h) => h.id), ["chat_1"]);
  assert.equal(hits[0].msgIndex, 0, "the message that has all three words");
  assert.match(hits[0].snippet, /^You: How should the kiosk find the shortest path/);
  assert.deepEqual(searchAll('"shortest route"', SRC, { now: NOW }).map((h) => h.msgIndex), [1]);
  assert.deepEqual(searchAll("kiosk unicorn", SRC, { now: NOW }), []);
  assert.deepEqual(searchAll("  ", SRC), []);
});

test("it reaches every store, and a note with a text time isn't lost", () => {
  assert.deepEqual(kinds("kiosk").sort(), ["chat", "reminder", "todo"]);
  assert.deepEqual(kinds("solder"), ["note"]);
  assert.deepEqual(kinds("atp"), ["card"]);
  assert.deepEqual(kinds("backup"), ["routine"]);
  assert.deepEqual(kinds("esp32"), ["memory"]);
  assert.deepEqual(kinds("kiosk", { kinds: ["todo"] }), ["todo"]);
  assert.deepEqual(kinds("chickpeas"), ["chat"], "a message that isn't text is skipped, not a crash");
});

test("ranking: a title match and recency lift a hit; a chat with no matching message still shows by title", () => {
  const hits = searchAll("pathfinding", SRC, { now: NOW });
  assert.deepEqual(hits.map((h) => h.id), ["chat_3", "chat_1", "1"]);
  assert.equal(hits[0].snippet, "Pathfinding homework");
  assert.equal(searchAll("kiosk", SRC, { now: NOW, limit: 1 }).length, 1);
});

test("snippets are cut around the match, on word boundaries", () => {
  const long = "alpha ".repeat(60) + "the needle is here " + "omega ".repeat(60);
  const s = snippet(long, ["needle"], 80);
  assert.match(s, /^…alpha .*the needle is here.*…$/);
  assert.ok(s.length <= 84);
  assert.equal(snippet("short text", ["x"]), "short text");
});

test("the tool's reply names where each hit is from, or says there's nothing", () => {
  const text = formatHits("kiosk", searchAll("kiosk", SRC, { now: NOW }), { now: NOW });
  assert.match(text, /^3 matches for "kiosk":/);
  assert.match(text, /\[Chat: Mason Navigator kiosk\] \(20 days ago\) You: How should the kiosk/);
  assert.match(text, /\[Reminder\] \(today\) email Mr\. Patel/);
  assert.match(formatHits("zzz", []), /^Nothing in ARIA's chats, memory, notes/);
});

test("usage: calls, failures and speed per model and per day", async () => {
  U._reset();
  const msgs = [{ role: "user", content: "x".repeat(400) }, { role: "user", content: [{ type: "text", text: "y".repeat(40) }, { type: "image_url", image_url: { url: "data:..." } }] }];
  assert.equal(U.messageChars(msgs), 440);
  assert.equal(await U.metered({ provider: "groq", model: "llama-3.3", messages: msgs }, async () => "z".repeat(80)), "z".repeat(80));
  await assert.rejects(U.metered({ provider: "groq", model: "llama-3.3", messages: msgs }, async () => {
    throw new Error("HTTP 429");
  }), /429/);
  // A provider that isn't set up answers with a warning string: a failure.
  await U.metered({ provider: "nvidia", model: "", messages: [] }, async () => "⚠ NEMOTRON_NVIDIA not set.");
  U.record({ provider: "gemini", model: "flash", ms: 900, inChars: 4000, outChars: 2000, at: NOW - 2 * DAY });

  const s = U.summary({ days: 7 });
  assert.equal(s.total.calls, 4);
  assert.equal(s.total.fails, 2);
  assert.equal(s.total.failRate, 50);
  const groq = s.models.find((m) => m.key === "groq/llama-3.3");
  assert.deepEqual([groq.calls, groq.fails, groq.inTok, groq.outTok], [2, 1, 220, 20]);
  assert.equal(s.models.find((m) => m.provider === "nvidia").failRate, 100);
  assert.equal(s.series.length, 7);
  assert.match(s.recentFailures[0].error, /NEMOTRON|429/);
  assert.match(U.runUsageTool("usage", "7"), /Last 7 days: 4 calls, 2 failed \(50%\)/);
  U._reset();
  assert.equal(U.runUsageTool("usage", ""), "No model calls recorded in the last 7 days.");
});

test("usage: a streamed reply is counted when it ends, and an empty one is a failure", async () => {
  U._reset();
  async function* deltas() {
    yield "Hello";
    yield ", world";
  }
  const up = U.meteredStream({ provider: "openrouter", model: "llama", messages: [{ role: "user", content: "hi" }] }, { deltas: deltas(), note: "n" });
  assert.equal(up.note, "n");
  let text = "";
  for await (const d of up.deltas) text += d;
  assert.equal(text, "Hello, world");
  async function* nothing() {}
  for await (const _ of U.meteredStream({ provider: "openrouter", model: "llama", messages: [] }, { deltas: nothing() }).deltas);
  const m = U.summary({ days: 1 }).models[0];
  assert.deepEqual([m.calls, m.fails, m.outTok], [2, 1, 3]);
  assert.equal(U.meteredStream({}, null), null, "a provider that doesn't stream");
});
