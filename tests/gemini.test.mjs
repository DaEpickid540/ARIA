// Run: npm test   (or node --test tests/gemini.test.mjs)
// lib/gemini.js: several keys taken in turn, a rate-limited or refused key
// skipped, and the newest Flash model picked from Google's list.
import test from "node:test";
import assert from "node:assert/strict";
import * as G from "../lib/gemini.js";

const env = (v) => {
  const saved = { a: process.env.GEMINI_API_KEYS, b: process.env.GEMINI_API_KEY, m: process.env.GEMINI_MODEL };
  if (v.keys === undefined) delete process.env.GEMINI_API_KEYS;
  else process.env.GEMINI_API_KEYS = v.keys;
  if (v.key === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = v.key;
  if (v.model === undefined) delete process.env.GEMINI_MODEL;
  else process.env.GEMINI_MODEL = v.model;
  G._reset();
  return () => {
    for (const [k, val] of [["GEMINI_API_KEYS", saved.a], ["GEMINI_API_KEY", saved.b], ["GEMINI_MODEL", saved.m]])
      if (val === undefined) delete process.env[k];
      else process.env[k] = val;
    G._reset();
  };
};

const ok = (text) => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: text } }] }), text: async () => "" });
const fail = (status, body = "", retryAfter = null) => ({ ok: false, status, text: async () => body, headers: { get: (h) => (h === "retry-after" ? retryAfter : null) } });

test("keys: a list and a single key, merged, de-duplicated, any separator", () => {
  assert.deepEqual(G.keys({ GEMINI_API_KEYS: "AIzaA1, AIzaB2;AIzaC3\nAIzaA1", GEMINI_API_KEY: "AIzaD4" }), ["AIzaA1", "AIzaB2", "AIzaC3", "AIzaD4"]);
  assert.deepEqual(G.keys({}), []);
  assert.equal(G.configured({ GEMINI_API_KEY: "x" }), true);
});

test("each call starts with the next key, so the load spreads", async () => {
  const restore = env({ keys: "k1-aaaa,k2-bbbb,k3-cccc", model: "gemini-test" });
  try {
    const used = [];
    const fetchImpl = async (url, o) => {
      used.push(o.headers.Authorization.slice(-4));
      return ok("hi");
    };
    for (let i = 0; i < 4; i++) assert.equal(await G.chat([{ role: "user", content: "x" }], { fetchImpl }), "hi");
    assert.deepEqual(used, ["aaaa", "bbbb", "cccc", "aaaa"]);
  } finally {
    restore();
  }
});

test("a rate-limited key is skipped straight away and rests; a refused key rests longer; a bad request isn't the key's fault", async () => {
  const restore = env({ keys: "k1-aaaa,k2-bbbb,k3-cccc", model: "gemini-test" });
  try {
    const fetchImpl = async (url, o) => {
      const k = o.headers.Authorization.slice(-4);
      if (k === "aaaa") return fail(429, '{"error":{"status":"RESOURCE_EXHAUSTED"}}', "30");
      if (k === "bbbb") return fail(400, '{"error":{"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT"}}');
      return ok("from c");
    };
    assert.equal(await G.chat([], { fetchImpl }), "from c");
    const st = G.keyStatus();
    assert.equal(st[0].resting.why, "rate limit");
    assert.ok(st[0].resting.seconds <= 30 && st[0].resting.seconds > 25);
    assert.equal(st[1].resting.why, "key refused");
    assert.equal(st[2].resting, null);
    // Next calls go only to the key that works.
    const used = [];
    await G.chat([], { fetchImpl: async (u, o) => (used.push(o.headers.Authorization.slice(-4)), ok("ok")) });
    assert.deepEqual(used, ["cccc"]);

    // A malformed request fails at once instead of burning through every key.
    G._reset();
    let calls = 0;
    await assert.rejects(
      G.chat([], { fetchImpl: async () => (calls++, fail(400, '{"error":{"message":"Invalid JSON payload"}}')) }),
      /Gemini HTTP 400/,
    );
    assert.equal(calls, 1);
  } finally {
    restore();
  }
});

test("every key busy: a clear error naming each key by its last four", async () => {
  const restore = env({ keys: "k1-aaaa,k2-bbbb", model: "gemini-test" });
  try {
    await assert.rejects(G.chat([], { fetchImpl: async () => fail(429, "quota") }), /Every Gemini key is busy.*…aaaa.*…bbbb/);
    // All resting: the next call still tries the one that frees up first.
    let calls = 0;
    assert.equal(await G.chat([], { fetchImpl: async () => (calls++, ok("back")) }), "back");
    assert.equal(calls, 1);
  } finally {
    restore();
  }
  await assert.rejects(G.chat([]), /No Gemini key/);
});

test("model: newest stable Flash from Google's list; GEMINI_MODEL wins; the list is cached", async () => {
  assert.deepEqual(
    G.rankModels([
      { name: "models/gemini-2.5-flash", supportedGenerationMethods: ["generateContent"] },
      { name: "models/gemini-3.8-flash", supportedGenerationMethods: ["generateContent", "countTokens"] },
      { name: "models/gemini-3.1-pro", supportedGenerationMethods: ["generateContent"] },
      { name: "models/gemini-3-flash-preview", supportedGenerationMethods: ["generateContent"] },
      { name: "models/gemini-3.5-flash-lite", supportedGenerationMethods: ["generateContent"] },
      { name: "models/gemini-embedding-001", supportedGenerationMethods: ["embedContent"] },
      { name: "models/gemini-3.8-flash-image", supportedGenerationMethods: ["generateContent"] },
      { name: "models/gemini-2.5-flash-preview-tts", supportedGenerationMethods: ["generateContent"] },
    ]),
    ["gemini-3.8-flash", "gemini-2.5-flash", "gemini-3.1-pro", "gemini-3.5-flash-lite", "gemini-3-flash-preview"],
  );

  let restore = env({ keys: "k1-aaaa" });
  try {
    let listed = 0;
    let model;
    const fetchImpl = async (url, o) => {
      if (url.includes("/models?")) {
        listed++;
        return { ok: true, json: async () => ({ models: [{ name: "models/gemini-9-flash" }, { name: "models/gemini-8-flash" }] }) };
      }
      model = JSON.parse(o.body).model;
      return ok("hi");
    };
    await G.chat([], { fetchImpl });
    await G.chat([], { fetchImpl });
    assert.equal(model, "gemini-9-flash");
    assert.equal(listed, 1, "cached");
    await G.chat([], { fetchImpl, model: "gemini-3.1-pro" });
    assert.equal(model, "gemini-3.1-pro");
  } finally {
    restore();
  }
  restore = env({ keys: "k1-aaaa", model: "gemini-pinned" });
  try {
    assert.equal(await G.defaultModel(), "gemini-pinned");
  } finally {
    restore();
  }
});

test("judge: retry hints are read; other errors aren't blamed on the key", () => {
  assert.equal(G.judge(429, "", "12").rest, 12_000);
  assert.equal(G.judge(429, '"retryDelay": "40s"').rest, 40_000);
  assert.equal(G.judge(429, "").rest, 60_000);
  assert.equal(G.judge(403, "PERMISSION_DENIED").why, "key refused");
  assert.equal(G.judge(500, "internal"), null);
  assert.equal(G.judge(404, "model not found"), null);
});
