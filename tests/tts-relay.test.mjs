// Run: npm test   (or node --test tests/tts-relay.test.mjs)
// lib/tts-relay.js: the PC's voice reaches a cloud ARIA. One Express app
// plays the cloud (it has no voice of its own); the PC side is the real
// hook with a fake synthesizer, connecting to it over HTTP.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import * as relay from "../lib/tts-relay.js";
import { mountTtsRoutes, cloudTarget } from "../lib/tts.js";

const VOICES = [{ id: "af_heart", label: "Heart" }];
let server, BASE, hook;
const said = [];

const until = async (fn, ms = 4000) => {
  const t = Date.now();
  while (!fn()) {
    if (Date.now() - t > ms) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 20));
  }
};

before(async () => {
  // Checked first: the next line turns this process into a "public deploy".
  assert.equal(cloudTarget({}), null, "no cloud configured");
  assert.equal(cloudTarget({ ARIA_CLOUD_URL: "https://x.example" }), null, "no key");
  assert.equal(cloudTarget({ ARIA_CLOUD_URL: "x.example", ARIA_RELAY_KEY: "k" }), null, "not a URL");
  assert.equal(cloudTarget({ ARIA_CLOUD_URL: "https://x.example/", ARIA_RELAY_KEY: "k", ARIA_TTS: "off" }), null);
  assert.deepEqual(cloudTarget({ ARIA_CLOUD_URL: "https://x.example/", ARIA_RELAY_KEY: "k" }), {
    cloudUrl: "https://x.example",
    key: "k",
  });
  assert.equal(
    cloudTarget({ ARIA_CLOUD_URL: "https://x.example", ARIA_RELAY_KEY: "k", ARIA_MACHINE_SECRET: "m" }).key,
    "m",
    "the desktop app's own key wins",
  );

  process.env.ARIA_PUBLIC = "true"; // the cloud: lib/tts.js ▸ enabled() is false
  const app = express();
  app.use(express.json({ limit: "50mb" }));
  mountTtsRoutes(app);
  await new Promise((r) => (server = app.listen(0, "127.0.0.1", r)));
  BASE = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  hook?.stop();
  relay._reset();
  server?.close();
  server?.closeAllConnections?.();
  delete process.env.ARIA_PUBLIC;
});

const speak = (body) =>
  fetch(`${BASE}/api/tts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

test("with no PC connected the cloud has no voice", async () => {
  assert.deepEqual(await (await fetch(`${BASE}/api/tts/status`)).json(), { available: false, voices: [] });
  assert.equal((await speak({ text: "hello" })).status, 404);
});

test("a PC connects out, and the cloud speaks with its voice", async () => {
  hook = relay.startVoiceHook({
    cloudUrl: BASE + "/",
    key: "",
    deviceId: "voice-test",
    voices: VOICES,
    log: () => {},
    synthesize: async (text, opts) => {
      if (text === "boom") throw new Error("model fell over");
      said.push({ text, ...opts });
      return Buffer.from(`RIFF:${text}`);
    },
  });
  await until(relay.connected);

  const st = await (await fetch(`${BASE}/api/tts/status`)).json();
  assert.equal(st.available, true);
  assert.ok(st.relayed, "says it comes from a PC");
  assert.deepEqual(st.voices, VOICES);

  const r = await speak({ text: "Good morning.", voice: "af_heart", speed: 1.2 });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-type"), "audio/wav");
  assert.equal(Buffer.from(await r.arrayBuffer()).toString(), "RIFF:Good morning.");
  assert.deepEqual(said.at(-1), { text: "Good morning.", voice: "af_heart", speed: 1.2 });
});

test("sentences asked for together all come back, each with its own audio", async () => {
  const parts = ["One.", "Two.", "Three."];
  const out = await Promise.all(parts.map((text) => speak({ text }).then((r) => r.text())));
  assert.deepEqual(out, parts.map((p) => `RIFF:${p}`));
});

test("a failure on the PC comes back as an error, not a hang", async () => {
  const r = await speak({ text: "boom" });
  assert.equal(r.status, 500);
  assert.match((await r.json()).error, /model fell over/);
});

test("only the PC a job went to may answer it", async () => {
  const p = relay.synthesize("mine");
  const forged = await fetch(`${BASE}/api/tts/relay/result`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceId: "someone-else", id: "tj_guess", wav: "AAAA" }),
  });
  assert.equal((await forged.json()).ok, false);
  assert.equal((await p).toString(), "RIFF:mine");
});

test("when the PC leaves, the voice goes with it", async () => {
  hook.stop();
  hook = null;
  await until(() => !relay.connected());
  assert.equal((await (await fetch(`${BASE}/api/tts/status`)).json()).available, false);
  await assert.rejects(relay.synthesize("anyone?"), /No PC voice connected/);
});
