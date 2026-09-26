#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
//  ARIA OLLAMA HOOK — lets ARIA use the Ollama models on YOUR machine
//  Runs next to Ollama (like claw-relay.js), zero npm installs. It connects
//  OUT to ARIA and collects work, so a cloud deploy can use your local models
//  with nothing port-forwarded. Pick the model in ARIA's model switcher.
//
//  Usage:
//    node aria-ollama-hook.js https://your-aria.onrender.com --key=<ARIA_RELAY_KEY>
//
//  Options:
//    --ollama=http://localhost:11434   where Ollama listens (or OLLAMA_URL)
//    --ctx=16384   context window per request. ARIA's system prompt alone is
//                  ~3k tokens and Ollama's default on GPUs under 24 GB is 4k,
//                  which leaves no room for the conversation. Bigger costs
//                  VRAM; 0 = use Ollama's own setting.
//
//  Server side: lib/ollama-relay.js.
// ═══════════════════════════════════════════════════════════════

import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// .env beside this file; variables already set in the shell win.
try { process.loadEnvFile(path.join(__dirname, ".env")); } catch {}

const _args = process.argv.slice(2);
const flag = (name) => _args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

const SERVER_URL = _args.find((a) => !a.startsWith("--")) || "http://localhost:3000";
const RELAY_KEY = flag("key") || process.env.ARIA_RELAY_KEY || process.env.ARIA_ACCESS_KEY || "";
const OLLAMA = (flag("ollama") || process.env.OLLAMA_URL || "http://localhost:11434").replace(/\/+$/, "");
const CTX = Number(flag("ctx") ?? 16384);
const DEVICE_ID = `ollama-${os.hostname()}`;
const MODELS_EVERY_MS = 30 * 1000; // pick up `ollama pull`s without a restart
const JOB_TIMEOUT_MS = 4.5 * 60 * 1000; // just under the server's 5 min

if (!Number.isInteger(CTX) || CTX < 0) {
  console.error("[OLLAMA] --ctx must be a whole number of tokens (0 = Ollama's default).");
  process.exit(1);
}

console.log(`
╔═══════════════════════════════════════════════╗
║  ARIA OLLAMA HOOK  v1.0                       ║
║  Server : ${SERVER_URL.slice(0, 36).padEnd(36)}║
║  Ollama : ${OLLAMA.slice(0, 36).padEnd(36)}║
║  Context: ${(CTX ? `${CTX} tokens` : "Ollama's default").padEnd(36)}║
╚═══════════════════════════════════════════════╝

  Press Ctrl+C to stop.
`);

let running = true;
let models = [];
let ollamaUp = null; // null until the first check, so the first result logs

// ── Ollama ────────────────────────────────────────────────────
async function listModels() {
  try {
    const r = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    if (ollamaUp !== true) console.log(`[OLLAMA] Ollama is up ✓ (${(d.models || []).length} model(s))`);
    ollamaUp = true;
    return (d.models || []).map((m) => ({
      name: m.name,
      size: m.size,
      parameterSize: m.details?.parameter_size || "",
    }));
  } catch (e) {
    if (ollamaUp !== false)
      console.warn(`[OLLAMA] Ollama isn't answering at ${OLLAMA} (${e.message}) — start it; I'll keep checking.`);
    ollamaUp = false;
    return [];
  }
}

// Only what Ollama needs is passed on — the server can't set options, pull
// models or reach any other Ollama endpoint through this.
function cleanMessages(messages) {
  return (Array.isArray(messages) ? messages : [])
    .filter((m) => ["system", "user", "assistant", "tool"].includes(m?.role))
    .map((m) => ({
      role: m.role,
      content: String(m.content ?? ""),
      ...(Array.isArray(m.images) ? { images: m.images.filter((i) => typeof i === "string") } : {}),
    }));
}

async function runJob(job) {
  const started = Date.now();
  let out;
  try {
    if (!models.some((m) => m.name === job.model))
      throw new Error(`model "${job.model}" isn't installed here (ollama pull ${job.model})`);
    const r = await fetch(`${OLLAMA}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: job.model,
        messages: cleanMessages(job.messages),
        stream: false,
        ...(CTX ? { options: { num_ctx: CTX } } : {}),
      }),
      signal: AbortSignal.timeout(JOB_TIMEOUT_MS),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `Ollama HTTP ${r.status}`);
    out = { content: d.message?.content || "", thinking: d.message?.thinking || "" };
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    const rate = d.eval_duration ? ` @ ${Math.round(d.eval_count / (d.eval_duration / 1e9))} tok/s` : "";
    console.log(
      `[OLLAMA] ${job.model}: prompt ${d.prompt_eval_count ?? "?"} tok, reply ${d.eval_count ?? "?"} tok${rate}, ${secs}s`,
    );
    // Ollama silently drops the start of a prompt that doesn't fit.
    if (CTX && d.prompt_eval_count >= CTX * 0.95)
      console.warn(`[OLLAMA] That prompt filled the ${CTX}-token context — older messages were cut. Try --ctx=${CTX * 2}.`);
  } catch (e) {
    const msg = e.name === "TimeoutError" ? "timed out" : e.message;
    console.warn(`[OLLAMA] ${job.model}: failed — ${msg}`);
    out = { error: msg };
  }
  await api("POST", "/api/ollama/relay/result", { deviceId: DEVICE_ID, id: job.id, ...out }).catch((e) =>
    console.warn(`[OLLAMA] Couldn't return the result: ${e.message}`),
  );
}

// ── ARIA ──────────────────────────────────────────────────────
async function api(method, pathname, body, timeoutMs = 15000) {
  const r = await fetch(new URL(pathname, SERVER_URL), {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(RELAY_KEY ? { "x-aria-relay-key": RELAY_KEY } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 || r.status === 403) {
    // Retrying can't fix a wrong key or a server that refuses relays.
    console.error(`[OLLAMA] Server refused: ${d.message || d.error || r.status}`);
    process.exit(1);
  }
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return d;
}

async function register() {
  await api("POST", "/api/ollama/relay/register", { deviceId: DEVICE_ID, hostname: os.hostname(), models });
}

async function poll() {
  let failures = 0;
  while (running) {
    try {
      // The server holds this for up to 25s and answers as soon as work arrives.
      const d = await api("GET", `/api/ollama/relay/jobs?deviceId=${encodeURIComponent(DEVICE_ID)}`, null, 40000);
      if (failures) console.log("[OLLAMA] Reconnected to ARIA ✓");
      failures = 0;
      if (d.needsRegister) {
        await register();
        continue;
      }
      for (const job of d.jobs || []) runJob(job); // concurrently; Ollama queues them
    } catch (e) {
      if (!running) break;
      if (failures++ === 0) console.warn(`[OLLAMA] Lost ARIA (${e.message}) — retrying…`);
      await sleep(Math.min(1000 * 2 ** failures, 15000));
    }
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function shutdown(signal) {
  if (!running) return;
  running = false;
  console.log(`\n[OLLAMA] Received ${signal}, shutting down.`);
  setTimeout(() => process.exit(0), 2000).unref();
  await api("POST", "/api/ollama/relay/unregister", { deviceId: DEVICE_ID }, 1500).catch(() => {});
  process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// ── Start ─────────────────────────────────────────────────────
models = await listModels();
try {
  await register();
  console.log(`[OLLAMA] Connected to ARIA ✓ — ${models.length} model(s) offered`);
} catch (e) {
  console.warn(`[OLLAMA] Can't reach ARIA yet (${e.message}) — retrying…`);
}
setInterval(async () => {
  const next = await listModels();
  if (JSON.stringify(next) === JSON.stringify(models)) return;
  models = next;
  console.log(`[OLLAMA] Model list changed — now ${models.map((m) => m.name).join(", ") || "none"}`);
  await register().catch(() => {});
}, MODELS_EVERY_MS).unref();
poll();
