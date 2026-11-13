// claw-core.js — Claw's shared state and rules
//
// Everything that decides what may run on the PC lives here, in one place:
// the queues the relays poll, the kill switch, the command parser, which
// relay gets a command, which commands need the owner's OK, and the
// approvals waiting on an answer. server.js and lib/claw-routes.js both
// import from this file, so there is one copy of each rule.
//
// Moved out of server.js unchanged, apart from the kill switch: it was a
// `let` there, and a module can't export a variable others reassign, so it
// is read with isKilled() and set with setKilled().

import crypto from "crypto";
import * as auth from "./auth.js";
import * as clawGrid from "./claw-grid.js";
import * as clawHistory from "./claw-history.js";

/* ── Claw state ── */
export const clawQueue = new Map(); // deviceId → [commands]
export const clawRelays = new Map(); // deviceId → {platform, hostname, lastSeen}
let killed = false; // the kill switch: nothing is queued or run while it is set
export const isKilled = () => killed;
export function setKilled(on) {
  killed = !!on;
}
let clawCmdSeq = 0;
export function nextClawId() {
  return "claw_" + Date.now() + "_" + clawCmdSeq++;
}

/* ── The grid Claw sees over the screen(s) (lib/claw-grid.js) ──
   Set each time a model is shown a screenshot, so "click: F7" means the cell
   it just looked at. Per device, plus the latest (a screen watcher posts the
   ESP32's screenshots under its own id). */
export const clawGrids = new Map(); // deviceId → { spec, monitors, at }
let lastClawGrid = null;
/** Remember the grid a model was just shown, for this device and as the latest. */
export function setGrid(deviceId, grid) {
  if (deviceId) clawGrids.set(deviceId, grid);
  lastClawGrid = grid;
}
export function gridFor(deviceId) {
  return (deviceId && clawGrids.get(deviceId)) || lastClawGrid;
}

/**
 * "X,Y", "X Y", a grid cell ("F7", "F7.3"), or nothing.
 * @returns {{x:number,y:number} | {none:true} | {error:string}}
 */
export function clawPoint(arg, deviceId) {
  const t = String(arg ?? "").trim();
  if (!t) return { none: true };
  if (clawGrid.parseCell(t)) {
    const g = gridFor(deviceId);
    if (!g) return { error: `"${t}" is a grid cell, but there's no grid yet — take a screenshot first` };
    const p = clawGrid.cellPoint(g.spec, t);
    return p || { error: `"${t}" is off the grid (columns A–${clawGrid.colName(g.spec.cols - 1)}, rows 1–${g.spec.rows})` };
  }
  const m = /^(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)$/.exec(t);
  if (m) return { x: Math.round(+m[1]), y: Math.round(+m[2]) };
  return { error: `"${t}" isn't a spot — use X,Y or a grid cell like F7` };
}

export function _parseChatClawInput(s, deviceId) {
  const id = nextClawId();
  s = String(s ?? "").trim();
  const bad = (hint) => ({ id, type: "unknown", raw: s, hint });
  if (s.startsWith("shell:"))
    return { id, type: "shell", cmd: s.slice(6).trim() };
  if (s.startsWith("type:"))
    return { id, type: "type", text: s.slice(5).trim() };
  if (s.startsWith("hotkey:"))
    return { id, type: "hotkey", keys: s.slice(7).trim().split("+") };
  if (s.startsWith("screenshot")) return { id, type: "screenshot" };
  if (s.startsWith("new_tab:"))
    return { id, type: "new_tab", url: s.slice(8).trim() };
  if (s === "new_tab" || s === "new tab") return { id, type: "new_tab" };
  if (s.startsWith("close_tab")) return { id, type: "close_tab" };
  if (/^(close|quit):/.test(s)) {
    const app = s.slice(s.indexOf(":") + 1).trim();
    return app ? { id, type: "close_app", app } : bad("close: needs an app name");
  }
  // What's open (one line per app with a window): for "what's running?" and
  // before a close: when the name is a guess.
  if (/^(apps|running|list_apps):?\s*$/i.test(s)) return { id, type: "list_apps" };
  if (s.startsWith("switch:"))
    return { id, type: "switch_app", app: s.slice(7).trim() };
  if (s.startsWith("write_code:")) {
    const p = s.slice(11).split("|");
    return { id, type: "write_code", app: p[0]?.trim(), code: p[1]?.trim() };
  }
  if (/^wait\b/.test(s)) {
    const ms = Math.round(Number(s.replace(/^wait:?/, "").trim()) || 1000);
    return { id, type: "wait", ms: Math.max(0, Math.min(10000, ms)) };
  }
  // ── Mouse actions: X,Y or a grid cell (F7 / F7.3) ──────────
  if (/^(mouse_pos|mouse position|where|pos|position):?\s*$/i.test(s)) return { id, type: "mouse_pos" };
  const mouse = /^(move|click|right_click|double_click):\s*(.*)$/i.exec(s);
  if (mouse) {
    const verb = mouse[1].toLowerCase();
    const p = clawPoint(mouse[2], deviceId);
    if (p.error) return bad(p.error);
    if (verb === "move") return p.none ? bad("move: needs X,Y or a grid cell") : { id, type: "mouse_move", x: p.x, y: p.y };
    // No spot = click where the pointer already is (it used to click 0,0).
    const at = p.none ? {} : { x: p.x, y: p.y };
    if (verb === "double_click") return { id, type: "double_click", ...at };
    return { id, type: "click", ...at, button: verb === "right_click" ? "right" : "left" };
  }
  if (s.startsWith("drag:")) {
    // drag: X1,Y1 to X2,Y2  (either end may be a grid cell)
    const m = /^drag:\s*(.+?)\s+to\s+(.+)$/i.exec(s);
    if (!m) return bad("drag: <from> to <to>");
    const a = clawPoint(m[1], deviceId);
    const b = clawPoint(m[2], deviceId);
    if (a.error || b.error) return bad(a.error || b.error);
    if (a.none || b.none) return bad("drag: needs both ends");
    return { id, type: "drag", x1: a.x, y1: a.y, x2: b.x, y2: b.y };
  }
  if (s.startsWith("scroll:")) {
    const p = s.slice(7).trim().split(/\s+/);
    return {
      id,
      type: "scroll",
      direction: /^up$/i.test(p[0]) ? "up" : "down",
      amount: Math.max(1, Math.min(50, Math.round(+p[1] || 3))),
    };
  }
  if (s.startsWith("open:")) {
    const t = s.slice(5).trim();
    return t.startsWith("http")
      ? { id, type: "browser", url: t }
      : { id, type: "launch_app", app: t };
  }
  // Unknown — used to be queued as a shell echo, which told the model it had
  // succeeded at something it had not done.
  return bad();
}

export const CLAW_HELP =
  "open:, close:, apps, switch:, new_tab:, close_tab, hotkey:, type:, shell:, screenshot, write_code:, wait:, " +
  "scroll:, move:, click:, right_click:, double_click:, drag: (spots are X,Y or a grid cell like F7), mouse_pos";

/* ── Claw: which relay, waiting for results, approvals ──────────
   The screen watcher registers as a relay so it shows up in the panel, but
   it executes nothing — it used to be picked as the target whenever it
   happened to be first in the map, and every command vanished. */
export function liveClawRelays() {
  return [...clawRelays.entries()].filter(
    ([, v]) => Date.now() - v.lastSeen < 20000 && v.relayType !== "screenwatcher",
  );
}
export function pickRelay({ preferEsp32 = false } = {}) {
  const live = liveClawRelays();
  if (preferEsp32) {
    const esp = live.find(([, v]) => v.relayType === "esp32");
    if (esp) return esp[0];
  }
  const node = live.find(([, v]) => v.relayType !== "esp32");
  return (node || live[0])?.[0] || null;
}
export function queueClaw(deviceId, ...cmds) {
  if (!clawQueue.has(deviceId)) clawQueue.set(deviceId, []);
  clawQueue.get(deviceId).push(...cmds);
  // The flight recorder: whoever asked (chat, panel, AUTO, a routine, a text).
  for (const c of cmds) clawHistory.record(c, { deviceId });
}

/**
 * One Claw line, run now, and what the relay answered. For features that
 * act on the PC themselves (focus closing apps, the panel's APPS row).
 * Throws when there's no relay or PC control is off; a command that needs
 * the owner's OK is refused rather than run.
 */
export async function clawRunLine(line) {
  if (killed) throw new Error("Claw is killed. Click RESUME in the Claw panel.");
  if (!auth.dangerousAllowed()) throw new Error(auth.DANGEROUS_DISABLED_MSG);
  const tid = pickRelay();
  if (!tid || clawRelays.get(tid)?.relayType === "esp32") throw new Error("No PC relay connected.");
  const cmd = _parseChatClawInput(line, tid);
  if (cmd.type === "unknown") throw new Error(cmd.hint || `"${line}" isn't a Claw command.`);
  if (clawConfirmReason(cmd)) throw new Error("That needs your OK; run it from the Claw panel.");
  queueClaw(tid, cmd);
  const out = await awaitClawResult(cmd.id, clawWaitMs(cmd) || 10000);
  if (out == null) throw new Error("The relay didn't answer in time.");
  return out;
}

// cmdId → { resolve, timer }. Filled by /api/claw/relay/result so the model
// sees what a command actually did instead of "✓ Queued".
export const pendingClawResults = new Map();
export function awaitClawResult(cmdId, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingClawResults.delete(cmdId);
      resolve(null);
    }, ms);
    pendingClawResults.set(cmdId, { resolve, timer });
  });
}
export function clawWaitMs(cmd) {
  if (cmd.type === "shell" || cmd.type === "close_app" || cmd.type === "list_apps") return 20000;
  if (cmd.type === "wait") return (cmd.ms || 1000) + 4000;
  if (cmd.type === "continuous_screen") return 0;
  return 10000;
}

// Commands that only look. Everything else acts on the machine.
export const CLAW_READONLY = new Set(["screenshot", "wait", "scroll", "mouse_move", "move", "mouse_pos", "list_apps"]);
export const DANGEROUS_SHELL = [
  /\brm\s+-\w*[rf]/i, /\brmdir\b/i, /\b(del|erase)\b[^|&]*\/[sq]/i,
  /Remove-Item\b/i, /\bformat(\.com)?\s+[a-z]:/i, /\bmkfs/i, /\bdd\s+if=/i,
  /\bdiskpart\b/i, /\b(shutdown|reboot|halt|poweroff)\b/i,
  /(Restart|Stop)-Computer/i, /\breg(\.exe)?\s+(delete|add|import)\b/i,
  /(Remove|Set|New)-ItemProperty/i, /\bbcdedit\b/i, /\bcipher\s+\/w/i,
  /\btakeown\b/i, /\bicacls\b/i, /\bch(mod|own)\s+-R\b/i,
  /\bnet\s+(user|localgroup)\b/i, /Set-ExecutionPolicy/i,
  /\b(iex|Invoke-Expression)\b/i, /-e(nc(odedcommand)?)?\s+[A-Za-z0-9+/=]{16,}/i,
  /(curl|wget|iwr|irm|Invoke-WebRequest|Invoke-RestMethod)\b.*\|\s*(sh|bash|zsh|iex|powershell|pwsh|python|node)\b/i,
  /\bsudo\b/i, /\bschtasks\b.*\/create/i, /\bcrontab\b/i,
  /\bsc(\.exe)?\s+(delete|config|create)\b/i, /Stop-Process|taskkill|pkill|killall/i,
  /\bvssadmin\b/i, /\bwmic\b.*\bdelete\b/i,
  /git\s+(push\b.*(--force|-f\b)|reset\s+--hard|clean\s+-\w*f)/i,
  />\s*\/dev\/sd/, /:\(\)\s*\{/, /\bmv\s+.*\s+\/dev\/null/i,
];

/**
 * Why this command needs the owner's OK, or null if it can run.
 * `tainted` = this run has already pulled in text a stranger wrote (web
 * pages). After that, anything that acts on the PC asks first, so a page
 * saying "ARIA, run …" cannot drive the machine.
 */
export function clawConfirmReason(cmd, { tainted = false } = {}) {
  if (cmd.type === "shell" && DANGEROUS_SHELL.some((re) => re.test(cmd.cmd || "")))
    return "that shell command looks destructive";
  if (tainted && !CLAW_READONLY.has(cmd.type))
    return "this conversation includes text from web pages, so PC actions need your OK";
  return null;
}

export function describeClaw(cmd) {
  const d =
    cmd.cmd ?? cmd.text ?? cmd.app ?? cmd.url ?? cmd.path ?? "";
  return `${cmd.type}${d !== "" ? ": " + String(d).slice(0, 200) : ""}`;
}

// id → { id, kind: "claw", payload, summary, reason, created }
// Held server-side so an approval runs exactly what was proposed, and
// expires so a stale dialog cannot fire later.
export const pendingConfirms = new Map();
export const CONFIRM_TTL_MS = 10 * 60 * 1000;
export function createConfirm(kind, payload, summary, reason) {
  const id = "cf_" + crypto.randomBytes(6).toString("hex");
  const c = { id, kind, payload, summary, reason, created: Date.now() };
  pendingConfirms.set(id, c);
  for (const [k, v] of pendingConfirms)
    if (Date.now() - v.created > CONFIRM_TTL_MS) pendingConfirms.delete(k);
  return c;
}
export const publicConfirm = (c) => ({ id: c.id, kind: c.kind, action: c.summary, reason: c.reason });

export function truncateOut(s, n = 4000) {
  s = String(s ?? "");
  return s.length > n ? s.slice(0, n) + `\n…[${s.length - n} more chars]` : s;
}

/** "mouse at 812,433" → "mouse at 812,433 (cell H5)" when there's a grid. */
export function withCell(cmd, out) {
  if (cmd.type !== "mouse_pos" || !out) return out;
  const m = /(-?\d+),(-?\d+)/.exec(out);
  const g = gridFor(null);
  const cell = m && g && clawGrid.pointCell(g.spec, +m[1], +m[2]);
  return cell ? `${out} (cell ${cell})` : out;
}

// cmdId → { deviceId, resolve, timer }: screenshots someone is waiting on.
export const pendingScreenshotResolvers = new Map();

/* ── Macros: record the PC steps ARIA takes in one chat, replay them later ──
   A recording belongs to the chat it was started in; steps taken in any
   other chat stay out of it. */
let macroOn = false;
let macroSteps = [];
let macroChat = null;

export function startMacro(chatId) {
  macroOn = true;
  macroSteps = [];
  macroChat = chatId;
}

/** Ends the recording and returns its steps. */
export function stopMacro() {
  macroOn = false;
  const steps = macroSteps;
  macroSteps = [];
  return steps;
}

/** Called for each command the chat pipeline runs: kept if it's being recorded. */
export function recordMacroStep(cmd, chatId) {
  if (macroOn && cmd.type !== "wait" && macroChat && macroChat === chatId) macroSteps.push({ ...cmd });
}
