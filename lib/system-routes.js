// system-routes.js — what this machine is and what's running on it
//
// Small read-only routes the home screen and the model switcher poll:
//   /api/ollama/*, /api/lmstudio/*   is a local model server up, and what it has
//   /api/system                      real host specs and load
//   /api/ping                        the smallest reply there is, for timing
//   /api/speedtest/down              random bytes, for measuring the link
//
// Moved out of server.js unchanged. Nothing here reads or changes ARIA's
// own state.

import os from "os";
import crypto from "crypto";
import * as ollamaRelay from "./ollama-relay.js";

// CPU use needs two samples of the per-core time counters. The previous one
// is kept, so each call reports usage since the last call instead of
// blocking to take a second sample. (The HUD in server.js keeps its own
// previous sample: two readers of one counter would each measure only the
// gap since the other.)
let _prevCpuSample = null;

export function sampleCpuTimes() {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const c of cpus) {
    for (const k of Object.keys(c.times)) total += c.times[k];
    idle += c.times.idle;
  }
  return { idle, total, at: Date.now() };
}

export function cpuUsagePercent() {
  const now = sampleCpuTimes();
  const prev = _prevCpuSample;
  _prevCpuSample = now;
  // No prior sample, or the counters went backwards (host resumed from sleep).
  if (!prev || now.total <= prev.total) return null;
  const idleDelta = now.idle - prev.idle;
  const totalDelta = now.total - prev.total;
  return Math.max(0, Math.min(100, Math.round((1 - idleDelta / totalDelta) * 100)));
}

// Prime the sampler so the first request has something to diff against.
_prevCpuSample = sampleCpuTimes();

export function mountSystemRoutes(app) {
  /* ============================================================
     OLLAMA — local LLM status + model listing
     ============================================================ */
  app.get("/api/ollama/status", async (req, res) => {
    const hook = ollamaRelay.status();
    if (hook.connected)
      return res.json({
        running: true,
        via: "hook",
        url: `${hook.hostname} (aria-ollama-hook)`,
        models: hook.models,
        details: hook.details,
      });
    const url = process.env.OLLAMA_URL || "http://localhost:11434";
    try {
      const r = await fetch(`${url}/api/tags`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!r.ok)
        return res.json({ running: false, url, error: `HTTP ${r.status}` });
      const d = await r.json();
      const models = (d.models || []).map((m) => m.name);
      res.json({ running: true, url, models });
    } catch (e) {
      res.json({ running: false, url, error: e.message });
    }
  });

  app.get("/api/ollama/models", async (req, res) => {
    const hook = ollamaRelay.status();
    if (hook.connected) return res.json({ models: hook.models, via: "hook", url: hook.hostname });
    const url = process.env.OLLAMA_URL || "http://localhost:11434";
    try {
      const r = await fetch(`${url}/api/tags`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!r.ok) return res.json({ models: [], error: `HTTP ${r.status}` });
      const d = await r.json();
      res.json({ models: (d.models || []).map((m) => m.name), url });
    } catch (e) {
      res.json({ models: [], error: e.message, url });
    }
  });

  /* ============================================================
     LM STUDIO — local OpenAI-compatible server (default port 1234)
     ============================================================ */
  app.get("/api/lmstudio/status", async (req, res) => {
    const url = process.env.LMSTUDIO_URL || "http://localhost:1234";
    try {
      const r = await fetch(`${url}/v1/models`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!r.ok)
        return res.json({ running: false, url, error: `HTTP ${r.status}` });
      const d = await r.json();
      const models = (d.data || []).map((m) => m.id);
      res.json({ running: true, url, models });
    } catch (e) {
      res.json({ running: false, url, error: e.message });
    }
  });

  app.get("/api/lmstudio/models", async (req, res) => {
    const url = process.env.LMSTUDIO_URL || "http://localhost:1234";
    try {
      const r = await fetch(`${url}/v1/models`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!r.ok) return res.json({ models: [], error: `HTTP ${r.status}` });
      const d = await r.json();
      res.json({ models: (d.data || []).map((m) => m.id), url });
    } catch (e) {
      res.json({ models: [], error: e.message, url });
    }
  });

  /* ══════════════════════════════════════════════════════════════
     SYSTEM INFO — real host specs
     The home dashboard used to read navigator.hardwareConcurrency and
     navigator.deviceMemory, which report the *browser's* view: deviceMemory
     is capped at 8 and rounded to a power of two, so a 32GB machine showed
     "~8GB". The server runs on the host, so it can just ask the OS.
     ══════════════════════════════════════════════════════════════ */

  app.get("/api/system", (_, res) => {
    const cpus = os.cpus();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();

    // loadavg is a Unix concept; Windows always returns [0, 0, 0], so omit it
    // there rather than rendering three zeroes as if they meant something.
    const load = os.loadavg();
    const hasLoad = load.some((n) => n > 0);

    res.json({
      ok: true,
      host: {
        platform: os.platform(),
        release: os.release(),
        arch: os.arch(),
        hostname: os.hostname(),
        uptimeSec: Math.round(os.uptime()),
      },
      cpu: {
        model: (cpus[0]?.model || "Unknown CPU").replace(/\s+/g, " ").trim(),
        cores: cpus.length,
        speedMhz: cpus[0]?.speed || null,
        usagePercent: cpuUsagePercent(),
        loadAvg: hasLoad ? load.map((n) => Number(n.toFixed(2))) : null,
      },
      memory: {
        totalBytes: totalMem,
        freeBytes: freeMem,
        usedBytes: totalMem - freeMem,
        usedPercent: Math.round(((totalMem - freeMem) / totalMem) * 100),
      },
      process: {
        node: process.version,
        uptimeSec: Math.round(process.uptime()),
        rssBytes: process.memoryUsage().rss,
      },
    });
  });

  /* ── Latency probe ──
     Deliberately the smallest possible response: the home dashboard times the
     round trip, so any body size here shows up as latency. */
  app.get("/api/ping", (_, res) => {
    res.set("Cache-Control", "no-store");
    // A 204 would be the honest status, but Chrome logs bodyless responses as
    // net::ERR_ABORTED in devtools even though the fetch resolves fine — five of
    // those per measurement is a lot of red for a healthy probe. One byte costs
    // nothing and keeps the console readable.
    res.type("text/plain").send("1");
  });

  /* ── Throughput fallback ──
     Used when the internet speed test can't reach its endpoint, so the card can
     still report the link between this browser and the ARIA host. The payload is
     crypto-random because compressible bytes would measure gzip, not bandwidth. */
  const SPEEDTEST_MAX_BYTES = 25 * 1024 * 1024;

  app.get("/api/speedtest/down", (req, res) => {
    const requested = parseInt(req.query.bytes, 10);
    const bytes = Math.min(
      Number.isFinite(requested) && requested > 0 ? requested : 1024 * 1024,
      SPEEDTEST_MAX_BYTES,
    );

    res.set({
      "Content-Type": "application/octet-stream",
      "Content-Length": String(bytes),
      "Cache-Control": "no-store",
    });

    // Stream in chunks so a 25MB request doesn't allocate 25MB up front, and
    // respect backpressure so a slow client doesn't balloon the send buffer.
    const CHUNK = 64 * 1024;
    let sent = 0;
    const pump = () => {
      while (sent < bytes) {
        const size = Math.min(CHUNK, bytes - sent);
        sent += size;
        if (!res.write(crypto.randomBytes(size))) {
          res.once("drain", pump);
          return;
        }
      }
      res.end();
    };
    // `close` also fires after a normal response, so destroying unconditionally
    // would tear down a healthy keep-alive socket — the client saw that as
    // ERR_CONNECTION_RESET, and every follow-up request paid a fresh handshake,
    // which skews the very measurement this endpoint exists to serve.
    req.on("close", () => {
      if (!res.writableEnded) res.destroy();
    });
    pump();
  });
}
