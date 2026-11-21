// lib/cli-relay.js — hand jobs to the Claude Code and Gemini CLIs on YOUR PC
// ═══════════════════════════════════════════════════════════════════
//
// WHY THIS EXISTS
//   ARIA runs on Render, but `claude` and `gemini` are installed and signed
//   in on your PC. aria-cli-hook.js runs there and connects OUT to ARIA (the
//   same pattern as aria-ollama-hook.js), collects jobs from here, runs the
//   CLI headless and posts the answer back. Nothing to port-forward.
//
// JOBS
//   { id, agent: "claude"|"gemini", mode: "read"|"edit", task }
//   read — the CLI may read files in the hook's folder and search the web.
//          Nothing on the PC changes.
//   edit — it may also edit files in that folder. Never shell commands.
//          The server only sends one after you approve it in the chat.
//   The hook decides the actual flags; the server can't pass any.
//
// PROTOCOL (all under /api/cli/relay/ — relay-key auth, see lib/auth.js)
//   POST register   {deviceId, hostname, agents, dir}   agents: {claude, gemini}
//                                                       each {version} or null
//   GET  jobs       ?deviceId=…  long-poll, held up to 25s
//   POST result     {deviceId, id, text, meta} or {deviceId, id, error}
//   POST unregister {deviceId}
//   A hook that hasn't polled for 60s is dropped and its jobs fail.
// ═══════════════════════════════════════════════════════════════════

import crypto from "crypto";

const POLL_HOLD_MS = 25 * 1000;
const STALE_MS = 60 * 1000;
// Agent runs read files and search the web; they take minutes, not seconds.
// The hook gives up at 9 min so its error arrives before this fires.
export const JOB_TIMEOUT_MS = 10 * 60 * 1000;
export const AGENTS = ["claude", "gemini"];
export const MAX_TASK = 8000;

const hooks = new Map(); // deviceId → { hostname, agents, dir, lastSeen, parked, queue }
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
    j.reject(new Error(`CLI hook on ${h.hostname} ${why}`));
  }
}

setInterval(() => {
  for (const [id, h] of hooks) if (Date.now() - h.lastSeen >= STALE_MS) drop(id, "went offline");
}, 15 * 1000).unref();

/** Which agents a connected hook offers, for status pages and the prompt. */
export function status() {
  const all = live();
  const agents = {};
  for (const a of AGENTS) {
    const hit = all.find(([, h]) => h.agents[a]);
    agents[a] = hit ? { hostname: hit[1].hostname, version: hit[1].agents[a].version, dir: hit[1].dir } : null;
  }
  return { connected: all.length > 0, agents };
}

export const available = (agent) => !!status().agents[agent];

/** Why `agent` can't run right now, or null. Said to ARIA as the tool result. */
export function unavailableReason(agent, serverUrl) {
  const all = live();
  if (!all.length)
    return (
      `The CLI hook isn't running on the PC. Start it there with \`node aria-cli-hook.js ${serverUrl} --key=<ARIA_RELAY_KEY>\`.`
    );
  if (!all.some(([, h]) => h.agents[agent]))
    return agent === "gemini"
      ? "Gemini CLI isn't installed on the PC (npm install -g @google/gemini-cli, then run `gemini` once to sign in), then restart the hook."
      : "Claude Code isn't installed on the PC (or isn't on PATH), so the hook can't offer it.";
  return null;
}

/**
 * Run one job on the freshest hook that has `agent`.
 * @returns {Promise<{text: string, meta: object}>}
 */
export function run(agent, task, mode = "read") {
  if (!AGENTS.includes(agent)) return Promise.reject(new Error(`unknown agent "${agent}"`));
  if (mode !== "read" && mode !== "edit") return Promise.reject(new Error(`unknown mode "${mode}"`));
  const hit = live().find(([, h]) => h.agents[agent]);
  if (!hit) return Promise.reject(new Error(unavailableReason(agent, "<ARIA URL>") || "no hook"));
  const [deviceId, h] = hit;
  const id = "cj_" + crypto.randomBytes(6).toString("hex");
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${agent} on ${h.hostname} took longer than ${JOB_TIMEOUT_MS / 60000} min`));
    }, JOB_TIMEOUT_MS);
    pending.set(id, { deviceId, resolve, reject, timer });
    const job = { id, agent, mode, task: String(task).slice(0, MAX_TASK) };
    if (h.parked) {
      const res = h.parked;
      h.parked = null;
      res.json({ jobs: [job] });
    } else {
      h.queue.push(job);
    }
  });
}

function cleanAgents(agents) {
  const out = {};
  for (const a of AGENTS) {
    const v = agents?.[a];
    out[a] = v ? { version: String(v.version || "").slice(0, 60) } : null;
  }
  return out;
}

/** Mounts /api/cli/relay/{register,jobs,result,unregister}. */
export function mountCliRelayRoutes(app) {
  // A user route (login, not relay key): what the PC offers right now.
  app.get("/api/cli/status", (_req, res) => res.json(status()));

  app.post("/api/cli/relay/register", (req, res) => {
    const { deviceId, hostname, agents, dir } = req.body || {};
    if (!deviceId || typeof agents !== "object") return res.status(400).json({ error: "bad_register" });
    const clean = cleanAgents(agents);
    const name = String(hostname || deviceId).slice(0, 80);
    const folder = String(dir || "").slice(0, 300);
    const h = hooks.get(deviceId);
    if (h) Object.assign(h, { hostname: name, agents: clean, dir: folder, lastSeen: Date.now() });
    else {
      hooks.set(deviceId, { hostname: name, agents: clean, dir: folder, lastSeen: Date.now(), parked: null, queue: [] });
      const has = AGENTS.filter((a) => clean[a]).join(" + ") || "no CLIs";
      console.log(`[CLI] Hook connected: ${name} (${has}) in ${folder}`);
    }
    res.json({ ok: true });
  });

  app.get("/api/cli/relay/jobs", (req, res) => {
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

  app.post("/api/cli/relay/result", (req, res) => {
    const { deviceId, id, text, meta, error } = req.body || {};
    const j = pending.get(id);
    // Only the hook the job went to may answer it.
    if (!j || j.deviceId !== deviceId) return res.json({ ok: false, error: "unknown_job" });
    pending.delete(id);
    clearTimeout(j.timer);
    const out = String(text || "").trim();
    if (error) j.reject(new Error(String(error).slice(0, 500)));
    else if (!out) j.reject(new Error("The CLI gave an empty answer"));
    else
      j.resolve({
        text: out.slice(0, 60000),
        meta: {
          costUsd: Number(meta?.costUsd) || 0,
          seconds: Number(meta?.seconds) || 0,
          model: String(meta?.model || "").slice(0, 80),
        },
      });
    res.json({ ok: true });
  });

  app.post("/api/cli/relay/unregister", (req, res) => {
    const id = req.body?.deviceId;
    const name = hooks.get(id)?.hostname;
    drop(id, "disconnected");
    if (name) console.log(`[CLI] Hook disconnected: ${name}`);
    res.json({ ok: true });
  });
}
