// Run: npm test   (or node --test tests/arena-route.test.mjs)
// A whole arena bout through the real server.js, against a stand-in Ollama
// that answers as the contenders, the rebuttals and the judge.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = new URL("..", import.meta.url);
const PORT = 43000 + Math.floor(Math.random() * 2000);
const BASE = `http://127.0.0.1:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "aria-arena-route-"));

// The stand-in Ollama: one model; what it says depends on who's asking.
const seen = { contender: 0, rebuttal: 0, judge: 0 };
const fake = http.createServer((req, res) => {
  let body = "";
  req.on("data", (d) => (body += d));
  req.on("end", () => {
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/api/tags") return res.end(JSON.stringify({ models: [{ name: "fake:1b", details: {} }] }));
    if (req.url === "/api/show") return res.end(JSON.stringify({ capabilities: ["completion"] }));
    if (req.url !== "/api/chat") return res.writeHead(404).end("{}");
    const { messages } = JSON.parse(body || "{}");
    const sys = String(messages?.[0]?.content || "");
    let content;
    if (/judge of an answer arena/.test(sys)) {
      seen.judge++;
      const names = [...sys.matchAll(/"((?:Solver|Checker|Skeptic) \([^"]+\))"/g)].map((m) => m[1]);
      content = JSON.stringify({
        scores: names.map((n) => ({ name: n, correctness: n.startsWith("Solver") ? 10 : 3, completeness: 8, clarity: 8, notes: "ok" })),
        winner: names[0],
        why: "Solver got 4.",
        answer: "2 + 2 = 4",
        mistakes: ["Checker said 5"],
      });
    } else if (/in an answer arena\. Read the other/.test(sys)) {
      seen.rebuttal++;
      content = "The other answer has an arithmetic slip.\nFINAL ANSWER: 4";
    } else {
      seen.contender++;
      content = /You are Checker/.test(sys) ? "Counting up: 5.\nFINAL ANSWER: 5" : "2 + 2 = 4.\nFINAL ANSWER: 4";
    }
    res.end(JSON.stringify({ message: { role: "assistant", content }, done: true }));
  });
});

let server;
let log = "";
test.before(async () => {
  await new Promise((r) => fake.listen(0, "127.0.0.1", r));
  const env = {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    PORT: String(PORT),
    ARIA_DATA_DIR: dataDir,
    ARIA_ENV_FILE: path.join(dataDir, "none.env"),
    OLLAMA_URL: `http://127.0.0.1:${fake.address().port}`,
  };
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
  fake.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("a bout streams lineup → answers → rebuttals → verdict, and is filed", async () => {
  const r = await fetch(`${BASE}/api/arena`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: "What is 2+2?" }) });
  assert.equal(r.headers.get("content-type"), "application/x-ndjson; charset=utf-8");
  const events = (await r.text()).trim().split("\n").map((l) => JSON.parse(l));
  const types = events.map((e) => e.type).filter((t) => t !== "step");
  assert.deepEqual(types, ["lineup", "answer", "answer", "rebuttal", "rebuttal", "verdict", "done"], log.slice(-1500));
  const lineup = events[0];
  assert.deepEqual(lineup.contenders.map((c) => c.name), ["Solver (PC fake:1b)", "Checker (PC fake:1b)"]);
  assert.equal(lineup.sameModel, true);
  const verdict = events.find((e) => e.type === "verdict").verdict;
  assert.equal(verdict.winner, "Solver (PC fake:1b)");
  assert.equal(verdict.answer, "2 + 2 = 4");
  assert.deepEqual([seen.contender, seen.rebuttal, seen.judge], [2, 2, 1]);
  const g = await (await fetch(`${BASE}/api/arena`)).json();
  assert.equal(g.history.length, 1);
  assert.equal(g.history[0].verdict.winner, "Solver (PC fake:1b)");
  assert.deepEqual(g.tally, [], "one model against itself doesn't count toward the tally");
});

test("the chat tool sums the bout up; an empty question is refused", async () => {
  const t = await (await fetch(`${BASE}/api/tool`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tool: "arena", input: "What is 2+2?" }) })).json();
  assert.match(t.output, /^ARENA — Solver \(PC fake:1b\) vs Checker \(PC fake:1b\); judged by PC fake:1b\.\nWinner: Solver \(PC fake:1b\)\./);
  assert.match(t.output, /Mistakes found: Checker said 5/);
  assert.equal((await fetch(`${BASE}/api/arena`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status, 400);
});
