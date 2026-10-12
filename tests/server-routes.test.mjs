// Run: npm test   (or node --test tests/server-routes.test.mjs)
// Starts the real server.js on a spare port with an empty data folder and no
// keys, and checks the routes pages depend on: chat sync, the crawler and
// calendar endpoints, health, Link Mode, and the cross-site guard.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = new URL("..", import.meta.url);
const PORT = 41000 + Math.floor(Math.random() * 2000);
const BASE = `http://127.0.0.1:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "aria-test-"));

let server;
let log = "";

test.before(async () => {
  // A clean environment: no provider keys, no Firestore, no owner, so the
  // local API is open the way the desktop app's is.
  const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, PORT: String(PORT), ARIA_DATA_DIR: dataDir, ARIA_ENV_FILE: path.join(dataDir, "none.env") };
  server = spawn(process.execPath, ["server.js"], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
  server.stdout.on("data", (d) => (log += d));
  server.stderr.on("data", (d) => (log += d));
  const until = Date.now() + 30_000;
  while (Date.now() < until) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`server didn't start:\n${log.slice(-2000)}`);
});

test.after(() => {
  server?.kill();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const post = (p, body, headers = {}) =>
  fetch(`${BASE}${p}`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
const getJson = async (p) => (await fetch(`${BASE}${p}`)).json();

test("health reports chat sync off without FIREBASE_SERVICE_ACCOUNT", async () => {
  const h = await getJson("/api/health");
  assert.equal(h.ok, true);
  assert.equal(h.chatSync, "off");
});

test("saveChats merges: newer wins, stale copies and bad ids don't get in", async () => {
  const now = Date.now();
  await post("/api/saveChats", { chats: [{ id: `chat_${now}`, title: "first", messages: [], updatedAt: now }], deleted: [] });
  // Another device, older copy of the same chat, plus a malformed id.
  await post("/api/saveChats", {
    chats: [
      { id: `chat_${now}`, title: "stale", messages: [], updatedAt: now - 1000 },
      { id: "chat_x');alert(1);//", title: "evil", messages: [], updatedAt: now },
    ],
    deleted: [],
  });
  const { chats } = await getJson("/api/loadChats");
  assert.deepEqual(chats.map((c) => c.id), [`chat_${now}`]);
  assert.equal(chats[0].title, "first");
});

test("a deleted chat stays deleted when a stale device saves it again", async () => {
  const id = `chat_${Date.now()}_del`;
  await post("/api/saveChats", { chats: [{ id, title: "doomed", messages: [], updatedAt: 1000 }], deleted: [] });
  await post("/api/saveChats", { chats: [], deleted: [{ id, at: 2000 }] });
  await post("/api/saveChats", { chats: [{ id, title: "zombie", messages: [], updatedAt: 1500 }], deleted: [] });
  const { chats, deleted } = await getJson("/api/loadChats");
  assert.ok(!chats.some((c) => c.id === id));
  assert.ok(deleted.includes(id));
});

test("crawl: needs a URL, refuses private ones", async () => {
  assert.deepEqual(await (await post("/api/crawl", {})).json(), { error: "No URL." });
  for (const url of ["http://127.0.0.1:3717/api/health", "localhost", "http://192.168.1.1/"]) {
    const r = await (await post("/api/crawl", { url })).json();
    assert.match(r.error, /blocked/, url);
  }
});

test("calendar: says it isn't configured instead of failing", async () => {
  const r = await getJson("/api/calendar/events");
  assert.match(r.error, /not configured/i);
});

test("Link Mode: a device that registers is listed", async () => {
  await post("/api/link/register", { id: "dev_test", name: "Test phone", ua: "Android" });
  const { devices } = await getJson("/api/link/devices");
  assert.ok(devices.some((d) => d.id === "dev_test" && d.name === "Test phone"));
});

test("another website can't use the local API", async () => {
  const r = await post("/api/saveChats", { chats: [], deleted: [] }, { Origin: "https://evil.example" });
  assert.equal(r.status, 403);
  const c = await post("/api/claw", { input: "open calc", mode: "direct" }, { Origin: "https://evil.example" });
  assert.equal(c.status, 403);
});

test("chat without a message gets an answer, not a crash", async () => {
  const r = await (await post("/api/chat", { history: [] }, { "x-no-stream": "1" })).json();
  assert.equal(r.reply, "No message received.");
});
