// lib/claw-history.js — the flight recorder: every command Claw ran
// ═══════════════════════════════════════════════════════════════════
//
// The Claw panel's log lived in the page: close the tab and what ARIA did
// to the PC was gone, and a command sent from a chat or a text never
// appeared in it at all. This records every command as it's queued for a
// relay, and what the relay answered, whoever asked (chat, panel, AUTO,
// a routine, a text). Kept to the last 300 in data/claw-history.json.
//
// It also turns a run of them back into Claw steps (lib/routines.js
// clawInputOf), so "that worked — save it as a routine" is one click.
// ═══════════════════════════════════════════════════════════════════

import fs from "fs";
import path from "path";
import { DATA_DIR } from "./paths.js";

const FILE = path.join(DATA_DIR, "claw-history.json");
export const MAX_ENTRIES = 300;
// Never recorded: the screen watch asks for a frame every few seconds.
const SKIP = new Set(["continuous_screen"]);

let _entries = [];
let _saveTimer = null;
let _persist = true;

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, "utf8"));
    _entries = Array.isArray(raw.entries) ? raw.entries : [];
  } catch {
    _entries = [];
  }
}
function saveSoon() {
  if (!_persist || _saveTimer) return;
  _saveTimer = setTimeout(() => {
    _saveTimer = null;
    flush();
  }, 3000);
  _saveTimer.unref?.();
}
export function flush() {
  if (!_persist) return;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE + ".tmp", JSON.stringify({ entries: _entries }));
    fs.renameSync(FILE + ".tmp", FILE);
  } catch (e) {
    console.warn("[claw-history] save failed:", e.message);
  }
}

/** What the command was, in a line, with typed text shortened. */
export function describe(cmd) {
  const d = cmd.cmd ?? cmd.text ?? cmd.app ?? cmd.url ?? cmd.path ?? (Array.isArray(cmd.keys) ? cmd.keys.join("+") : "");
  const spot = cmd.x != null && cmd.y != null ? `${cmd.x},${cmd.y}` : "";
  const detail = String(d || spot || "").replace(/\s+/g, " ").slice(0, 160);
  return `${cmd.type}${detail ? ": " + detail : ""}`;
}

/** A command just queued for a relay. */
export function record(cmd, { deviceId = "", at = Date.now() } = {}) {
  if (!cmd?.type || SKIP.has(cmd.type)) return;
  const last = _entries[_entries.length - 1];
  // A screen watch is a screenshot every few seconds: one line, counted.
  if (cmd.type === "screenshot" && last?.type === "screenshot" && at - last.at < 60_000) {
    last.count = (last.count || 1) + 1;
    last.at = at;
    last.id = cmd.id || last.id;
    return saveSoon();
  }
  // The command itself is kept (without its id) so it can become a routine step.
  const { id, ...rest } = cmd;
  _entries.push({ id: id || `h${at}`, type: cmd.type, summary: describe(cmd), cmd: rest, deviceId, at, result: null });
  if (_entries.length > MAX_ENTRIES) _entries = _entries.slice(-MAX_ENTRIES);
  saveSoon();
}

/** What the relay answered for a command. */
export function result(cmdId, out, at = Date.now()) {
  if (!cmdId) return;
  for (let i = _entries.length - 1; i >= 0 && i >= _entries.length - 50; i--) {
    const e = _entries[i];
    if (e.id !== cmdId) continue;
    e.result = String(out ?? "ok").replace(/\s+/g, " ").slice(0, 300);
    e.ms = Math.max(0, at - e.at);
    e.failed = /^(ERROR|exit \d|unknown command)/i.test(e.result);
    return saveSoon();
  }
}

/** Newest first. */
export const list = (n = 100) => _entries.slice(-Math.max(1, Math.min(MAX_ENTRIES, n))).reverse().map((e) => ({ ...e }));

/**
 * The chosen entries, oldest first, as Claw steps a routine can hold.
 * Commands with no text form (wait, a bare screenshot between steps) are
 * left out; `toInput` is lib/routines.js clawInputOf.
 */
export function stepsOf(ids, toInput) {
  const want = new Set(ids);
  return _entries
    .filter((e) => want.has(e.id) && !e.failed)
    .map((e) => toInput({ ...e.cmd, type: e.type }))
    .filter(Boolean);
}

export function stats(now = Date.now()) {
  const day = _entries.filter((e) => now - e.at < 86400_000);
  return { today: day.length, failed: day.filter((e) => e.failed).length, last: _entries[_entries.length - 1] || null };
}

export function clear() {
  _entries = [];
  flush();
}

export function init({ persist = true } = {}) {
  _persist = persist;
  if (persist) load();
}

export function _reset(entries = []) {
  _entries = entries;
  _persist = false;
}
