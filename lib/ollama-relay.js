// lib/ollama-relay.js — reach the Ollama on YOUR PC from wherever ARIA runs
// ═══════════════════════════════════════════════════════════════════
//
// WHY THIS EXISTS
//   The "ollama" provider fetched OLLAMA_URL, which defaults to
//   localhost:11434. On Render, localhost is Render's own container: the
//   Ollama on your PC sits behind your router and could never be reached, so
//   picking it quietly fell back to a cloud model. aria-ollama-hook.js runs
//   next to Ollama and connects OUT to ARIA (like claw-relay.js), so there is
//   nothing to port-forward. It collects jobs here, runs them locally and
//   posts the answers back.
//
// PROTOCOL (all under /api/ollama/relay/ — relay-key auth, see lib/auth.js)
//   POST register   {deviceId, hostname, models}  hello; repeated when the
//                                                  model list changes
//   GET  jobs       ?deviceId=…  long-poll: held up to 25s, answered the
//                                moment a job arrives → {jobs: [...]}
//   POST result     {deviceId, id, content, thinking} or {deviceId, id, error}
//   POST unregister {deviceId}
//   A hook that hasn't polled for 60s is dropped and its jobs fail, so
//   callAI can fall back instead of waiting out the full timeout.
// ═══════════════════════════════════════════════════════════════════

import crypto from "crypto";

const POLL_HOLD_MS = 25 * 1000;
const STALE_MS = 60 * 1000;
// Loading a model cold and answering on a consumer GPU (or CPU) is slow.
const JOB_TIMEOUT_MS = 5 * 60 * 1000;

const hooks = new Map(); // deviceId → { hostname, models, lastSeen, parked, queue }
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
    j.reject(new Error(`Ollama hook on ${h.hostname} ${why}`));
  }
}

setInterval(() => {
  for (const [id, h] of hooks) if (Date.now() - h.lastSeen >= STALE_MS) drop(id, "went offline");
}, 15 * 1000).unref();

/** Connected hooks and their models, for the model pickers. */
export function status() {
  const all = live();
  const models = [...new Set(all.flatMap(([, h]) => h.models.map((m) => m.name)))];
  return {
    connected: all.length > 0,
    hostname: all[0]?.[1].hostname || null,
    models,
    details: all.flatMap(([, h]) => h.models),
  };
}

export const connected = () => live().length > 0;

/** The model to use when none was picked: first one on the freshest hook. */
export const defaultModel = () => live()[0]?.[1].models[0]?.name || null;

/**
 * OpenAI-style messages (what callAI is handed) → Ollama's shape: content is
 * a plain string and images ride alongside as bare base64. Ollama rejects
 * the content-array form the vision path builds.
 */
export function toOllamaMessages(messages) {
  return messages.map((m) => {
    if (!Array.isArray(m.content)) return { role: m.role, content: String(m.content ?? "") };
    const text = m.content
      .filter((p) => p?.type === "text")
      .map((p) => p.text)
      .join("\n");
    const images = m.content
      .filter((p) => p?.type === "image_url" && /^data:/.test(p.image_url?.url || ""))
      .map((p) => p.image_url.url.replace(/^data:[^,]*,/, ""));
    return { role: m.role, content: text, ...(images.length ? { images } : {}) };
  });
}

/**
 * Run one chat completion on a connected hook.
 * @returns {Promise<string>} the reply; a thinking model's reasoning comes
 *   back wrapped in <think> so the rest of ARIA treats it like any other.
 */
export function chat(model, messages) {
  const hosts = live();
  if (!hosts.length) return Promise.reject(new Error("No Ollama hook connected"));
  const hit = hosts.find(([, h]) => h.models.some((m) => m.name === model));
  if (!hit) {
    return Promise.reject(
      new Error(`Model "${model}" isn't installed on ${hosts.map(([, h]) => h.hostname).join(", ")}`),
    );
  }
  const [deviceId, h] = hit;
  const id = "oj_" + crypto.randomBytes(6).toString("hex");
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Ollama on ${h.hostname} took longer than ${JOB_TIMEOUT_MS / 60000} min`));
    }, JOB_TIMEOUT_MS);
    pending.set(id, { deviceId, resolve, reject, timer });
    const job = { id, model, messages: toOllamaMessages(messages) };
    if (h.parked) {
      const res = h.parked;
      h.parked = null;
      res.json({ jobs: [job] });
    } else {
      h.queue.push(job);
    }
  });
}

/** Mounts /api/ollama/relay/{register,jobs,result,unregister}. */
export function mountOllamaRelayRoutes(app) {
  app.post("/api/ollama/relay/register", (req, res) => {
    const { deviceId, hostname, models } = req.body || {};
    if (!deviceId || !Array.isArray(models)) return res.status(400).json({ error: "bad_register" });
    const clean = models
      .filter((m) => m && typeof m.name === "string")
      .slice(0, 200)
      .map((m) => ({
        name: m.name.slice(0, 200),
        size: Number(m.size) || 0,
        parameterSize: String(m.parameterSize || "").slice(0, 20),
      }));
    const h = hooks.get(deviceId);
    const name = String(hostname || deviceId).slice(0, 80);
    if (h) Object.assign(h, { hostname: name, models: clean, lastSeen: Date.now() });
    else {
      hooks.set(deviceId, { hostname: name, models: clean, lastSeen: Date.now(), parked: null, queue: [] });
      console.log(`[OLLAMA] Hook connected: ${name} (${clean.length} model(s))`);
    }
    res.json({ ok: true });
  });

  app.get("/api/ollama/relay/jobs", (req, res) => {
    const h = hooks.get(String(req.query.deviceId || ""));
    if (!h) return res.json({ needsRegister: true, jobs: [] });
    h.lastSeen = Date.now();
    if (h.queue.length) return res.json({ jobs: h.queue.splice(0) });
    // Park the request; chat() answers it the moment a job arrives.
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

  app.post("/api/ollama/relay/result", (req, res) => {
    const { deviceId, id, content, thinking, error } = req.body || {};
    const j = pending.get(id);
    // Only the hook the job went to may answer it.
    if (!j || j.deviceId !== deviceId) return res.json({ ok: false, error: "unknown_job" });
    pending.delete(id);
    clearTimeout(j.timer);
    const text = String(content || "").trim();
    if (error) j.reject(new Error(String(error).slice(0, 300)));
    else if (!text && !thinking) j.reject(new Error("Empty Ollama response"));
    else j.resolve(thinking ? `<think>${thinking}</think>\n${text}` : text);
    res.json({ ok: true });
  });

  app.post("/api/ollama/relay/unregister", (req, res) => {
    const id = req.body?.deviceId;
    const name = hooks.get(id)?.hostname;
    drop(id, "disconnected");
    if (name) console.log(`[OLLAMA] Hook disconnected: ${name}`);
    res.json({ ok: true });
  });
}
