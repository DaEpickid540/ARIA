// lib/hud.js — what the home screen's HUD shows, in one call
// ═══════════════════════════════════════════════════════════════════
//
// The old home page made about fifteen requests to fill its cards, and had
// no memory: every number was "now". This keeps a short history of CPU and
// memory load (a sample every 5 s, ten minutes of them) for the HUD's
// traces, and turns the state of everything else — relay, model, tasks,
// reminders, focus, grades, flashcards — into two things:
//
//   priorities(s)   what deserves attention, most pressing first
//   statusReport(s) the same as a few spoken sentences ("status report")
//
// Both are plain functions of a snapshot the server assembles (see
// lib/upgrade-routes.js), so they're tested without a server.
// ═══════════════════════════════════════════════════════════════════

import { TZ, zoned } from "./clock.js";
import { fmtWhen } from "./reminders.js";

export const SAMPLE_MS = 5000;
export const MAX_SAMPLES = 120;

let _samples = [];
let _timer = null;

export function sample({ cpu = null, mem = null, at = Date.now() } = {}) {
  _samples.push({ at, cpu: cpu == null ? null : Math.round(cpu), mem: mem == null ? null : Math.round(mem) });
  if (_samples.length > MAX_SAMPLES) _samples = _samples.slice(-MAX_SAMPLES);
}
export const history = () => _samples.map((s) => ({ ...s }));

/** Highest and average of a metric over the history (null when unmeasured). */
export function trend(key) {
  const v = _samples.map((s) => s[key]).filter((n) => n != null);
  if (!v.length) return { avg: null, peak: null };
  return { avg: Math.round(v.reduce((a, b) => a + b, 0) / v.length), peak: Math.max(...v) };
}

export function greeting(now = Date.now(), tz = TZ) {
  const h = zoned(now, tz).h;
  return h < 5 ? "Working late" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

/**
 * What needs attention, most pressing first.
 * @param s  the snapshot (every field optional):
 *   confirms, tasks: { running, awaiting }, focus: { active, held },
 *   reminders: [{ text, at }], grades: { line, margin }, cards: { due },
 *   practice: { line }, relay: { connected, name }, cpu, mem, usage: { failRate, calls }
 * @returns {{ level: "alert"|"warn"|"info"|"ok", icon, text, action? }[]}
 */
export function priorities(s = {}, now = Date.now()) {
  const out = [];
  const add = (level, icon, text, action) => out.push({ level, icon, text, ...(action ? { action } : {}) });

  if (s.confirms > 0) add("alert", "shield-exclamation", `${plural(s.confirms, "action")} waiting for your OK`, "claw");
  if (s.tasks?.awaiting > 0) add("alert", "hand-index", `${plural(s.tasks.awaiting, "task")} waiting for approval`, "tasks");
  if (s.cpu != null && s.cpu >= 90) add("warn", "cpu", `CPU at ${s.cpu}%`, "system");
  if (s.mem != null && s.mem >= 90) add("warn", "memory", `Memory at ${s.mem}%`, "system");
  if (s.usage?.calls >= 5 && s.usage.failRate >= 30) add("warn", "exclamation-triangle", `${s.usage.failRate}% of model calls failed today`, "usage");

  if (s.focus?.active) {
    const left = Math.max(1, Math.ceil(s.focus.active.leftMs / 60_000));
    add("info", "bullseye", `Focus: ${left} min left${s.focus.active.goal ? ` on ${s.focus.active.goal}` : ""}`, "focus");
  }
  for (const r of (s.reminders || []).filter((r) => r.at - now < 24 * 3600_000).slice(0, 3))
    add(r.at - now <= 10 * 60_000 ? "warn" : "info", "alarm", `${r.text} — ${fmtWhen(r.at, now)}`, "reminders");
  if (s.grades?.line) add(s.grades.margin != null && s.grades.margin < 0 ? "warn" : "info", "mortarboard", s.grades.line, "grades");
  if (s.cards?.due > 0) add("info", "card-text", `${plural(s.cards.due, "flashcard")} due`, "flashcards");
  if (s.practice?.line) add("info", "music-note-list", s.practice.line, "practice");
  if (s.tasks?.running > 0) add("info", "gear-wide-connected", `${plural(s.tasks.running, "background task")} running`, "tasks");
  if (s.focus?.held > 0) add("info", "inbox", `${plural(s.focus.held, "alert")} held for later`, "focus");
  if (s.watchers > 0) add("info", "eye", `${plural(s.watchers, "watcher")} on duty`, "watchers");

  if (!out.length) add("ok", "check2-circle", "Nothing needs you right now.");
  return out;
}

/** The overall word for the HUD's centre: NOMINAL / ATTENTION / ALERT. */
export function overall(list) {
  if (list.some((p) => p.level === "alert")) return "ALERT";
  if (list.some((p) => p.level === "warn")) return "ATTENTION";
  return "NOMINAL";
}

/**
 * A spoken status report: a few short sentences, no markdown, facts only.
 * Anything unmeasured is left out rather than guessed.
 */
export function statusReport(s = {}, now = Date.now(), tz = TZ) {
  const list = priorities(s, now);
  const state = overall(list);
  const out = [`${greeting(now, tz)}.`];
  out.push(state === "NOMINAL" ? "All systems nominal." : state === "ALERT" ? "Something needs your approval." : "A few things need attention.");

  const sys = [];
  if (s.cpu != null) sys.push(`processor at ${s.cpu} percent`);
  if (s.mem != null) sys.push(`memory at ${s.mem} percent`);
  if (sys.length) out.push(sys.join(", ").replace(/^./, (c) => c.toUpperCase()) + ".");

  out.push(s.relay?.connected ? `PC control is online${s.relay.name ? ` on ${s.relay.name}` : ""}.` : "PC control is offline.");
  if (s.model?.label) out.push(`Thinking with ${s.model.label}.`);
  if (s.usage?.calls) out.push(`${plural(s.usage.calls, "model call")} today${s.usage.avgMs != null ? `, averaging ${(s.usage.avgMs / 1000).toFixed(1)} seconds` : ""}.`);

  const attention = list.filter((p) => p.level !== "ok" && !/^(CPU|Memory) at/.test(p.text));
  if (attention.length) out.push(attention.slice(0, 4).map((p) => p.text.replace(/\s+—\s+/g, ", ")).join(". ") + ".");
  return out.join(" ").replace(/\.\./g, ".");
}

/** Starts sampling. `read` returns { cpu, mem } in percent. */
export function init({ read, start = true } = {}) {
  clearInterval(_timer);
  if (!start || !read) return;
  const take = () => {
    try {
      sample(read());
    } catch {}
  };
  take();
  _timer = setInterval(take, SAMPLE_MS);
  _timer.unref?.();
}

export function _reset(samples = []) {
  _samples = samples;
}
