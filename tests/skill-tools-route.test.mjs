// Run: npm test   (or node --test tests/skill-tools-route.test.mjs)
// A skill's tool through a real chat turn, against a stand-in Ollama that
// always reaches for it: told about it and allowed only while the skill is
// on (or the message triggers it).
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = new URL("..", import.meta.url);
const PORT = 45000 + Math.floor(Math.random() * 2000);
const BASE = `http://127.0.0.1:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "aria-skill-route-"));

// The stand-in model: asks for the chord tool, then repeats what came back.
const prompts = [];
const fake = http.createServer((req, res) => {
  let body = "";
  req.on("data", (d) => (body += d));
  req.on("end", () => {
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/api/tags") return res.end(JSON.stringify({ models: [{ name: "fake:1b", details: {} }] }));
    if (req.url === "/api/show") return res.end(JSON.stringify({ capabilities: ["completion"] }));
    if (req.url !== "/api/chat") return res.writeHead(404).end("{}");
    const { messages } = JSON.parse(body || "{}");
    const last = String(messages.at(-1)?.content || "");
    const result = last.match(/\[TOOL RESULT for "[^"]+"\]:\s*([\s\S]*)/);
    if (!result) prompts.push(String(messages[0]?.content || ""));
    const content = result ? `Got: ${result[1].trim().split("\n")[0]}` : "ACTION: chord | Cmaj7";
    res.end(JSON.stringify({ message: { role: "assistant", content }, done: true }));
  });
});

let server;
let log = "";
test.before(async () => {
  await new Promise((r) => fake.listen(0, "127.0.0.1", r));
  server = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      PORT: String(PORT),
      ARIA_DATA_DIR: dataDir,
      ARIA_ENV_FILE: path.join(dataDir, "none.env"),
      OLLAMA_URL: `http://127.0.0.1:${fake.address().port}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
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
  fake.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const chat = (message) =>
  fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-no-stream": "1" },
    body: JSON.stringify({ message, provider: "ollama", model: "fake:1b", history: [] }),
  }).then((r) => r.json());

test("skill off and not triggered: not offered, and the call is refused", async () => {
  const r = await chat("spell Cmaj7 for me");
  assert.match(r.reply, /^Got: The music-theory skill is off, so its chord tool isn't available/, log.slice(-1500));
  assert.doesNotMatch(prompts.at(-1), /ACTION: chord \|/);
});

test("the message triggers the skill: offered, and it runs", async () => {
  const r = await chat("what notes are in a Cmaj7 chord?");
  assert.match(prompts.at(-1), /This skill's tool \(same ACTION format\):\nACTION: chord \| Cmaj7 \| Bbm7b5 C\/E/);
  assert.equal(r.reply, "Got: Cmaj7: C E G B", log.slice(-1500));
});

test("skill switched on: works without a trigger word", async () => {
  await fetch(`${BASE}/api/skills/music-theory/activate`, { method: "POST" });
  const r = await chat("spell Cmaj7 for me");
  assert.equal(r.reply, "Got: Cmaj7: C E G B");
});
