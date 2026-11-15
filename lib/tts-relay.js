// lib/tts-relay.js — ARIA's PC voice, from wherever ARIA runs
// ═══════════════════════════════════════════════════════════════════
//
// WHY THIS EXISTS
//   Kokoro runs on your PC (lib/tts.js). The hosted site could only use it
//   when it was open on that same PC, by calling 127.0.0.1 directly. From a
//   phone, or any other machine, Render and the Firebase site had no way to
//   reach it. So the ARIA server on your PC connects OUT to the cloud one
//   (like claw-relay.js and aria-ollama-hook.js: nothing to port-forward),
//   collects the sentences to speak, and posts the audio back.
//
// TWO HALVES, ONE FILE
//   Cloud side:  mountTtsRelayRoutes(app), connected(), voices(), synthesize()
//   PC side:     startVoiceHook({ cloudUrl, key, synthesize, voices })
//
// PROTOCOL (all under /api/tts/relay/ — relay-key auth, see lib/auth.js)
//   POST register   {deviceId, hostname, voices}
//   GET  jobs       ?deviceId=…  long-poll, held up to 25s → {jobs: [...]}
//   POST result     {deviceId, id, wav: <base64>} or {deviceId, id, error}
//   POST unregister {deviceId}
//   A PC that hasn't polled for 60s is dropped and its jobs fail.
// ═══════════════════════════════════════════════════════════════════

import crypto from "crypto";
import os from "os";

const POLL_HOLD_MS = 25 * 1000;
const STALE_MS = 60 * 1000;
// One or two sentences on a CPU: about real time, plus a cold model load.
const JOB_TIMEOUT_MS = 90 * 1000;
const MAX_WAV_BYTES = 12 * 1024 * 1024;

const hooks = new Map(); // deviceId → { hostname, voices, lastSeen, parked, queue }
const pending = new Map(); // job id → { deviceId, resolve, reject, timer }

const live = () =>
  [...hooks.entries()]
    .filter(([, h]) => Date.now() - h.lastSeen < STALE_MS)
    .sort((a, b) => b[1].lastSeen - a[1].lastSeen);

function drop(deviceId, why) {
  const h = hooks.get(deviceId);
  if (!h) return;
  hooks.delete(deviceId);
  try { h.parked?.json({ jobs: [] }); } catch {}
  for (const [id, j] of pending) {
    if (j.deviceId !== deviceId) continue;
    pending.delete(id);
    clearTimeout(j.timer);
    j.reject(new Error(`The voice on ${h.hostname} ${why}`));
  }
}

setInterval(() => {
  for (const [id, h] of hooks) if (Date.now() - h.lastSeen >= STALE_MS) drop(id, "went offline");
}, 15 * 1000).unref();

export const connected = () => live().length > 0;
export const voices = () => live()[0]?.[1].voices || [];
export const hostname = () => live()[0]?.[1].hostname || null;

/**
 * Speak one chunk on the connected PC.
 * @returns {Promise<Buffer>} a WAV
 */
export function synthesize(text, { voice, speed } = {}) {
  const hit = live()[0];
  if (!hit) return Promise.reject(new Error("No PC voice connected"));
  const [deviceId, h] = hit;
  const id = "tj_" + crypto.randomBytes(6).toString("hex");
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`The voice on ${h.hostname} took too long`));
    }, JOB_TIMEOUT_MS);
    pending.set(id, { deviceId, resolve, reject, timer });
    const job = { id, text: String(text || "").slice(0, 600), voice, speed };
    if (h.parked) {
      const res = h.parked;
      h.parked = null;
      res.json({ jobs: [job] });
    } else {
      h.queue.push(job);
    }
  });
}

/** Mounts /api/tts/relay/{register,jobs,result,unregister}. */
export function mountTtsRelayRoutes(app) {
  app.post("/api/tts/relay/register", (req, res) => {
    const { deviceId, hostname: host, voices: list } = req.body || {};
    if (!deviceId || !Array.isArray(list)) return res.status(400).json({ error: "bad_register" });
    const clean = list
      .filter((v) => v && typeof v.id === "string")
      .slice(0, 100)
      .map((v) => ({ id: v.id.slice(0, 40), label: String(v.label || v.id).slice(0, 80) }));
    const name = String(host || deviceId).slice(0, 80);
    const h = hooks.get(deviceId);
    if (h) Object.assign(h, { hostname: name, voices: clean, lastSeen: Date.now() });
    else {
      hooks.set(deviceId, { hostname: name, voices: clean, lastSeen: Date.now(), parked: null, queue: [] });
      console.log(`[TTS] PC voice connected: ${name} (${clean.length} voice(s))`);
    }
    res.json({ ok: true });
  });

  app.get("/api/tts/relay/jobs", (req, res) => {
    const h = hooks.get(String(req.query.deviceId || ""));
    if (!h) return res.json({ needsRegister: true, jobs: [] });
    h.lastSeen = Date.now();
    if (h.queue.length) return res.json({ jobs: h.queue.splice(0) });
    try { h.parked?.json({ jobs: [] }); } catch {}
    h.parked = res;
    const timer = setTimeout(() => {
      if (h.parked !== res) return;
      h.parked = null;
      h.lastSeen = Date.now();
      res.json({ jobs: [] });
    }, POLL_HOLD_MS);
    res.on("close", () => {
      clearTimeout(timer);
      if (h.parked === res) h.parked = null;
    });
  });

  app.post("/api/tts/relay/result", (req, res) => {
    const { deviceId, id, wav, error } = req.body || {};
    const j = pending.get(id);
    // Only the PC the job went to may answer it.
    if (!j || j.deviceId !== deviceId) return res.json({ ok: false, error: "unknown_job" });
    pending.delete(id);
    clearTimeout(j.timer);
    const h = hooks.get(deviceId);
    if (h) h.lastSeen = Date.now();
    if (error) j.reject(new Error(String(error).slice(0, 300)));
    else {
      const buf = typeof wav === "string" ? Buffer.from(wav, "base64") : null;
      if (!buf?.length) j.reject(new Error("The PC sent no audio"));
      else if (buf.length > MAX_WAV_BYTES) j.reject(new Error("The PC sent too much audio"));
      else j.resolve(buf);
    }
    res.json({ ok: true });
  });

  app.post("/api/tts/relay/unregister", (req, res) => {
    const id = req.body?.deviceId;
    const name = hooks.get(id)?.hostname;
    drop(id, "disconnected");
    if (name) console.log(`[TTS] PC voice disconnected: ${name}`);
    res.json({ ok: true });
  });
}

/** Tests only. */
export function _reset() {
  for (const id of [...hooks.keys()]) drop(id, "reset");
}

/* ══════════════════════════════════════════════════════════════════
   PC SIDE — runs inside the ARIA server on your PC
   ══════════════════════════════════════════════════════════════════ */

/**
 * Connects this PC's voice to a cloud ARIA and serves its requests until
 * stop() is called. Never throws: a cloud that is down or refuses the key
 * is retried with a growing pause.
 * @returns {{ stop: () => void }}
 */
export function startVoiceHook({
  cloudUrl,
  key,
  synthesize: speak,
  voices: list,
  deviceId = `voice-${os.hostname()}`,
  log = console.log,
}) {
  const base = String(cloudUrl || "").replace(/\/+$/, "");
  let running = true;
  let state = ""; // last thing logged, so a long outage is one line
  const say = (s) => {
    if (s !== state) log(`[TTS] ${s}`);
    state = s;
  };
  const headers = { "Content-Type": "application/json", ...(key ? { "x-aria-relay-key": key } : {}) };
  const post = (p, body, ms = 15000) =>
    fetch(`${base}/api/tts/relay/${p}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ deviceId, ...body }),
      signal: AbortSignal.timeout(ms),
    });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms).unref?.());

  async function register() {
    const r = await post("register", { hostname: os.hostname(), voices: list });
    if (r.status === 401 || r.status === 403) throw new Error("the cloud refused this PC's key");
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
  }

  async function run(job) {
    try {
      const wav = await speak(job.text, { voice: job.voice, speed: job.speed });
      await post("result", { id: job.id, wav: Buffer.from(wav).toString("base64") }, 30000);
    } catch (e) {
      await post("result", { id: job.id, error: e.message }).catch(() => {});
    }
  }

  (async () => {
    let registered = false;
    let fails = 0;
    while (running) {
      try {
        if (!registered) {
          await register();
          registered = true;
          say(`This PC's voice is available on ${base}`);
        }
        const r = await fetch(`${base}/api/tts/relay/jobs?deviceId=${encodeURIComponent(deviceId)}`, {
          headers,
          signal: AbortSignal.timeout(POLL_HOLD_MS + 10000),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const d = await r.json();
        fails = 0;
        if (d.needsRegister) registered = false; // the cloud restarted
        // One at a time, in order: lib/tts.js serializes generation anyway.
        for (const job of d.jobs || []) await run(job);
      } catch (e) {
        if (!running) break;
        registered = false;
        say(`Can't reach ${base} for the voice relay (${e.message}); retrying.`);
        await sleep(Math.min(3000 * 2 ** fails++, 60000));
      }
    }
  })();

  return {
    stop() {
      running = false;
      post("unregister", {}, 3000).catch(() => {});
    },
  };
}
