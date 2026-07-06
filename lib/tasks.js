// lib/tasks.js — ARIA Background Task Engine (Mark 1.4)
// ═══════════════════════════════════════════════════════════════════
//
// Cowork/Copilot Tasks-style background runner. Differences from the
// old single-shot bg-task endpoint:
//
//   • Multi-step plans — AI breaks the task into steps and executes
//     them sequentially with full context from previous steps
//   • Persistent — tasks survive server restarts (data/tasks.json)
//   • Live progress — SSE broadcasts step status changes to clients
//   • Cancellation + pause/resume — first-class signals
//   • Scheduling — one-shot or recurring (cron-style minute precision)
//   • Per-task isolation — failure in one step doesn't kill others
//
// The execution function is injected at startup so this module
// doesn't depend on the rest of the server.
//
// ═══════════════════════════════════════════════════════════════════

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
const TASKS_FILE = path.join(DATA_DIR, "tasks.json");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ── State ─────────────────────────────────────────────────────
let _tasks = new Map();        // id → task
let _subscribers = new Set();   // SSE response objects
let _stepRunner = null;         // injected: (task, step, prevOutputs) → Promise<output>
let _planner = null;            // injected: (description) → Promise<steps[]>
let _writeTimer = null;
let _taskCounter = 1;

const SCHEDULE_CHECK_INTERVAL_MS = 30_000; // every 30s

// ── Persistence ───────────────────────────────────────────────
function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(TASKS_FILE, "utf8"));
    if (Array.isArray(raw.tasks)) {
      for (const t of raw.tasks) {
        if (t.status === "running" || t.status === "planning") {
          t.status = "paused";
          t.note = "Recovered from server restart — paused.";
        }
        _tasks.set(t.id, t);
      }
    }
    _taskCounter = raw.counter || _tasks.size + 1;
  } catch {
    /* empty file is fine */
  }
}

function scheduleSave() {
  if (_writeTimer) clearTimeout(_writeTimer);
  _writeTimer = setTimeout(() => {
    try {
      const tmp = TASKS_FILE + ".tmp";
      fs.writeFileSync(
        tmp,
        JSON.stringify(
          { counter: _taskCounter, tasks: [..._tasks.values()], savedAt: Date.now() },
          null, 2,
        ),
      );
      fs.renameSync(tmp, TASKS_FILE);
    } catch (e) {
      console.warn("[TASKS] Save failed:", e.message);
    }
    _writeTimer = null;
  }, 800);
}

export function flushSync() {
  if (_writeTimer) { clearTimeout(_writeTimer); _writeTimer = null; }
  try {
    fs.writeFileSync(
      TASKS_FILE,
      JSON.stringify({ counter: _taskCounter, tasks: [..._tasks.values()] }, null, 2),
    );
  } catch {}
}

// ── SSE broadcast ─────────────────────────────────────────────
function broadcast(event) {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const sub of _subscribers) {
    try {
      sub.write(payload);
    } catch {}
  }
}

export function addSubscriber(res) {
  _subscribers.add(res);
  // Send initial state — current snapshot of all tasks
  try {
    res.write(
      `data: ${JSON.stringify({ type: "snapshot", tasks: [..._tasks.values()] })}\n\n`,
    );
  } catch {}
}
export function removeSubscriber(res) {
  _subscribers.delete(res);
}

// ── Injection points ──────────────────────────────────────────
export function configure({ planner, stepRunner }) {
  _planner = planner;
  _stepRunner = stepRunner;
}

// ── Task lifecycle ────────────────────────────────────────────
function nextId() {
  return `task_${_taskCounter++}_${Date.now().toString(36)}`;
}

/**
 * Create a new task. Returns the task object.
 * Planning happens asynchronously — caller doesn't wait.
 *
 *   description: free-form text describing what should be done
 *   options: {
 *     title?,                  // short label (auto-generated if omitted)
 *     personality?,            // hacker | study | math | programming
 *     provider?,               // openrouter | groq | etc.
 *     schedule?,               // { runAt: ts } or { cron: "0 9 * * 1-5", nextRun: ts }
 *     contextChatId?,          // pull chat context from
 *     autoExecute?,            // if false, planning only; user approves before running
 *   }
 */
export async function createTask(description, options = {}) {
  if (!description?.trim()) throw new Error("Task description required");
  const task = {
    id: nextId(),
    title: options.title || _autoTitle(description),
    description,
    status: "planning",
    steps: [],
    currentStep: -1,
    result: null,
    personality: options.personality || "hacker",
    provider: options.provider || "openrouter",
    schedule: options.schedule || null,
    autoExecute: options.autoExecute !== false,
    contextChatId: options.contextChatId,
    cancelled: false,
    paused: false,
    created: Date.now(),
    updated: Date.now(),
    log: [],
  };
  _tasks.set(task.id, task);
  broadcast({ type: "created", task });
  scheduleSave();

  // Scheduled tasks wait — execute now only if no schedule or schedule is past
  const now = Date.now();
  const ready =
    !task.schedule ||
    (task.schedule.runAt && task.schedule.runAt <= now) ||
    (task.schedule.nextRun && task.schedule.nextRun <= now);

  if (ready) {
    // Fire and forget
    _runTask(task).catch((e) => _markError(task, e.message));
  } else {
    // Future schedule — mark as scheduled so the scheduler tick picks it up
    task.status = "scheduled";
    broadcast({ type: "updated", task });
    scheduleSave();
  }
  return task;
}

function _autoTitle(desc) {
  const firstLine = desc.split(/[\n.]/)[0].trim();
  return firstLine.length > 60 ? firstLine.slice(0, 57) + "…" : firstLine;
}

function _logTask(task, msg) {
  task.log.push({ ts: Date.now(), msg });
  if (task.log.length > 100) task.log.shift();
  task.updated = Date.now();
}

function _markError(task, msg) {
  task.status = "error";
  task.error = msg;
  _logTask(task, `❌ ${msg}`);
  broadcast({ type: "updated", task });
  scheduleSave();
}

async function _runTask(task) {
  if (!_planner || !_stepRunner) {
    _markError(task, "Task engine not configured");
    return;
  }

  // ── 1. PLAN ──
  task.status = "planning";
  _logTask(task, "Planning steps…");
  broadcast({ type: "updated", task });
  scheduleSave();

  let steps;
  try {
    steps = await _planner(task.description, {
      personality: task.personality,
      provider: task.provider,
    });
  } catch (e) {
    _markError(task, "Planning failed: " + e.message);
    return;
  }

  if (!Array.isArray(steps) || steps.length === 0) {
    _markError(task, "Planner returned no steps");
    return;
  }

  task.steps = steps.map((s, i) => ({
    id: `step_${i + 1}`,
    title: s.title || s.description || `Step ${i + 1}`,
    description: s.description || s.title || "",
    status: "pending",
    output: null,
    startedAt: null,
    completedAt: null,
  }));
  _logTask(task, `Plan ready: ${task.steps.length} steps`);
  broadcast({ type: "updated", task });
  scheduleSave();

  // If autoExecute=false, wait for user approval (via approveTask)
  if (!task.autoExecute) {
    task.status = "awaiting_approval";
    broadcast({ type: "updated", task });
    scheduleSave();
    return;
  }

  await _executeSteps(task);
}

async function _executeSteps(task) {
  task.status = "running";
  task.updated = Date.now();
  broadcast({ type: "updated", task });

  const prevOutputs = [];
  for (let i = 0; i < task.steps.length; i++) {
    // Skip steps that already completed (e.g. resuming a paused task)
    if (task.steps[i].status === "done") {
      prevOutputs.push({ title: task.steps[i].title, output: task.steps[i].output });
      continue;
    }
    if (task.cancelled) {
      task.status = "cancelled";
      _logTask(task, "Cancelled by user");
      broadcast({ type: "updated", task });
      scheduleSave();
      return;
    }
    if (task.paused) {
      task.status = "paused";
      _logTask(task, "Paused");
      broadcast({ type: "updated", task });
      scheduleSave();
      return;
    }

    const step = task.steps[i];
    task.currentStep = i;
    step.status = "running";
    step.startedAt = Date.now();
    _logTask(task, `▶ ${step.title}`);
    broadcast({ type: "updated", task });

    try {
      const output = await _stepRunner(task, step, prevOutputs);
      step.output = output;
      step.status = "done";
      step.completedAt = Date.now();
      prevOutputs.push({ title: step.title, output });
      _logTask(task, `✓ ${step.title}`);
    } catch (e) {
      step.status = "error";
      step.output = e.message;
      step.completedAt = Date.now();
      _logTask(task, `❌ ${step.title}: ${e.message}`);
      // Continue or abort? For now, continue — partial results often useful
    }

    broadcast({ type: "updated", task });
    scheduleSave();
  }

  task.status = "done";
  task.currentStep = -1;
  task.result = _summarizeOutputs(task);
  _logTask(task, "✓ Task complete");
  broadcast({ type: "updated", task });
  scheduleSave();

  // If recurring, schedule next run
  if (task.schedule?.cron) {
    task.schedule.nextRun = _nextCronRun(task.schedule.cron);
    _logTask(
      task,
      `Next run: ${new Date(task.schedule.nextRun).toLocaleString()}`,
    );
    task.status = "scheduled";
    broadcast({ type: "updated", task });
    scheduleSave();
  }
}

function _summarizeOutputs(task) {
  // Last step's output is usually the deliverable; if errored, return last good
  const done = task.steps.filter((s) => s.status === "done");
  if (done.length === 0) return "No steps completed successfully.";
  return done[done.length - 1].output;
}

// ── Control endpoints ─────────────────────────────────────────
export function getTask(id) {
  return _tasks.get(id);
}
export function listTasks(filter = {}) {
  let list = [..._tasks.values()];
  if (filter.status) list = list.filter((t) => t.status === filter.status);
  return list.sort((a, b) => b.updated - a.updated);
}
export function cancelTask(id) {
  const t = _tasks.get(id);
  if (!t) return false;
  t.cancelled = true;
  if (t.status !== "running") {
    t.status = "cancelled";
    broadcast({ type: "updated", task: t });
    scheduleSave();
  }
  return true;
}
export function pauseTask(id) {
  const t = _tasks.get(id);
  if (!t || t.status !== "running") return false;
  t.paused = true;
  return true;
}
export function resumeTask(id) {
  const t = _tasks.get(id);
  if (!t || t.status !== "paused") return false;
  t.paused = false;
  _executeSteps(t).catch((e) => _markError(t, e.message));
  return true;
}
export function approveTask(id) {
  const t = _tasks.get(id);
  if (!t || t.status !== "awaiting_approval") return false;
  _executeSteps(t).catch((e) => _markError(t, e.message));
  return true;
}
export function deleteTask(id) {
  const t = _tasks.get(id);
  if (!t) return false;
  if (t.status === "running") t.cancelled = true;
  _tasks.delete(id);
  broadcast({ type: "deleted", id });
  scheduleSave();
  return true;
}
export function editSteps(id, newSteps) {
  const t = _tasks.get(id);
  if (!t || t.status !== "awaiting_approval") return false;
  t.steps = newSteps.map((s, i) => ({
    id: `step_${i + 1}`,
    title: s.title,
    description: s.description || s.title,
    status: "pending",
    output: null,
    startedAt: null,
    completedAt: null,
  }));
  broadcast({ type: "updated", task: t });
  scheduleSave();
  return true;
}

// ── Cron scheduling (minute-level precision) ──────────────────
// Standard cron format: "minute hour day-of-month month day-of-week"
// Supports * and comma lists and ranges (no step values for simplicity)
function _matchCronField(value, field) {
  if (field === "*") return true;
  for (const part of field.split(",")) {
    if (part.includes("-")) {
      const [lo, hi] = part.split("-").map(Number);
      if (value >= lo && value <= hi) return true;
    } else if (parseInt(part) === value) return true;
  }
  return false;
}
function _cronMatches(cron, date) {
  const [mn, hr, dom, mo, dow] = cron.split(/\s+/);
  return (
    _matchCronField(date.getMinutes(), mn) &&
    _matchCronField(date.getHours(), hr) &&
    _matchCronField(date.getDate(), dom) &&
    _matchCronField(date.getMonth() + 1, mo) &&
    _matchCronField(date.getDay(), dow)
  );
}
function _nextCronRun(cron) {
  // Brute-force scan minute-by-minute for next 7 days
  const now = new Date();
  now.setSeconds(0, 0);
  for (let i = 1; i < 60 * 24 * 7; i++) {
    const d = new Date(now.getTime() + i * 60_000);
    if (_cronMatches(cron, d)) return d.getTime();
  }
  return null;
}

// ── Scheduler tick ────────────────────────────────────────────
setInterval(() => {
  const now = Date.now();
  for (const task of _tasks.values()) {
    if (task.status !== "scheduled" || !task.schedule) continue;
    const ready =
      (task.schedule.runAt && task.schedule.runAt <= now) ||
      (task.schedule.nextRun && task.schedule.nextRun <= now);
    if (ready) {
      task.schedule.lastRun = now;
      _logTask(task, "Scheduled trigger fired");
      _runTask(task).catch((e) => _markError(task, e.message));
    }
  }
}, SCHEDULE_CHECK_INTERVAL_MS);

// ── Stats ─────────────────────────────────────────────────────
export function getStats() {
  const tasks = [..._tasks.values()];
  return {
    total: tasks.length,
    byStatus: tasks.reduce((acc, t) => {
      acc[t.status] = (acc[t.status] || 0) + 1;
      return acc;
    }, {}),
    runningNow: tasks.filter((t) => t.status === "running").length,
    scheduled: tasks.filter((t) => t.status === "scheduled").length,
    subscribers: _subscribers.size,
  };
}

// ── Public init ───────────────────────────────────────────────
load();

