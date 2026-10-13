// lib/routines.js — Claw routines: PC steps ARIA was taught, with blanks
// ═══════════════════════════════════════════════════════════════════
//
// A routine is a named list of Claw steps written exactly like ACTION: claw
// input ("open: https://…", "shell: copy {{file}} D:\\Backup") with
// {{placeholders}} for what changes between runs. ARIA learns one by
//   • generalising what she just did on the PC in this chat, or a macro the
//     owner recorded (teach with `steps`), or
//   • writing the steps herself from a description (teach without).
// Then "do that for every file in this folder" is one routine run per item.
//
// Safety is the server's: this file only fills blanks and checks shape.
//   • A value going into a shell step may not carry shell syntax (& | ; < >
//     ` $ " newlines), so a file name can't smuggle in a second command.
//   • server.js runs every filled step through the same approval rules as
//     chat (destructive shell, or a run that read web pages), and asks once
//     for the whole batch before anything runs.
// ═══════════════════════════════════════════════════════════════════

import fs from "fs";
import path from "path";
import { DATA_DIR } from "./paths.js";

const FILE = path.join(DATA_DIR, "routines.json");
export const MAX_ROUTINES = 50;
export const MAX_STEPS = 25;
export const MAX_RUNS = 20; // items in one "for each"
const PLACEHOLDER = /\{\{\s*([a-z][a-z0-9_]{0,30})\s*\}\}/gi;
// Characters a value may not carry into a step that becomes a command on
// the relay. Not just shell: — switch:, open: and new_tab: are also put in
// quotes inside PowerShell/cmd there. Only type: (keystrokes) and the code
// half of write_code take any text.
const VALUE_UNSAFE = /[&|;<>`$"'\r\n^%]/;
const FREE_TEXT_STEP = /^\s*(type:|write_code:)/i;

let _routines = [];
let _parse = null; // server.js's claw parser: string → { type, … } ("unknown" if not a command)

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, "utf8"));
    _routines = Array.isArray(raw.routines) ? raw.routines : [];
  } catch {
    _routines = [];
  }
}
function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE + ".tmp", JSON.stringify({ routines: _routines }, null, 1));
    fs.renameSync(FILE + ".tmp", FILE);
  } catch (e) {
    console.warn("[routines] save failed:", e.message);
  }
}

/** "Back up my notes!" → "back-up-my-notes" */
export const slug = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

export const placeholders = (step) => [...String(step).matchAll(PLACEHOLDER)].map((m) => m[1].toLowerCase());

/**
 * Checks a routine and tidies it. Throws a sentence the model or the owner
 * can act on. Every step must be a Claw command the server understands, and
 * every blank must be a declared parameter (and the other way round).
 */
export function validate(r) {
  const name = slug(r?.name);
  if (!name) throw new Error("A routine needs a name.");
  const steps = (Array.isArray(r.steps) ? r.steps : []).map((s) => String(s).trim()).filter(Boolean);
  if (!steps.length) throw new Error("A routine needs at least one step.");
  if (steps.length > MAX_STEPS) throw new Error(`At most ${MAX_STEPS} steps.`);
  const declared = (Array.isArray(r.params) ? r.params : [])
    .map((p) => (typeof p === "string" ? { name: p } : p))
    .map((p) => ({ name: String(p?.name || "").toLowerCase().trim(), desc: String(p?.desc || "").slice(0, 120) }))
    .filter((p) => /^[a-z][a-z0-9_]{0,30}$/.test(p.name));
  const used = new Set(steps.flatMap(placeholders));
  for (const u of used) if (!declared.some((p) => p.name === u)) throw new Error(`Step uses {{${u}}} but there's no parameter called "${u}".`);
  const params = declared.filter((p) => used.has(p.name));
  for (const s of steps) {
    if (!shellBlanksQuoted(s))
      throw new Error(`In "${s}", put each {{blank}} inside double quotes ("{{file}}"), so a value with spaces stays one argument.`);
    // Parsed with sample values so the shape is checked, not the blanks.
    const cmd = _parse?.(fill(s, Object.fromEntries(params.map((p) => [p.name, "x"]))));
    if (cmd && cmd.type === "unknown") throw new Error(`"${s}" isn't a Claw step. Steps look like: open: …, shell: …, type: …, hotkey: …`);
  }
  return {
    name,
    description: String(r.description || "").trim().slice(0, 300),
    params,
    steps,
    // Written by a model that had read web pages: every run asks first,
    // until the owner saves it again from the panel after seeing the steps.
    ...(r.untrusted ? { untrusted: true } : {}),
  };
}

/**
 * Fills the blanks. Values going into anything but typed text refuse
 * characters that could end a quote or start a second command.
 */
export function fill(step, values = {}) {
  const s = String(step);
  const free = FREE_TEXT_STEP.test(s);
  const codeAt = /^\s*write_code:/i.test(s) ? s.indexOf("|") : -1;
  return s.replace(PLACEHOLDER, (_, k, offset) => {
    const key = k.toLowerCase();
    if (!(key in values)) throw new Error(`No value for {{${key}}}.`);
    const v = String(values[key]);
    if (/[\r\n]/.test(v)) throw new Error(`The value for {{${key}}} has a line break.`);
    // write_code: the app name before "|" is a window name; the code after it is text.
    const isText = free && (codeAt < 0 || offset > codeAt);
    // A URL keeps its & and %: the characters that could end its quotes are
    // percent-encoded instead (the browser reads them the same).
    if (isUrlBlank(s, offset)) return encodeUrlValue(v);
    if (!isText && VALUE_UNSAFE.test(v))
      throw new Error(`The value for {{${key}}} ("${v.slice(0, 60)}") has characters (& | ; < > \` $ " ' ^ %) that could change the command, so I won't use it.`);
    return v;
  });
}

/** Is the blank at `offset` the URL of an open:/new_tab: step (open: with an http(s) value)? */
function isUrlBlank(step, offset) {
  const m = step.match(/^\s*(open|new_tab):\s*/i);
  return !!m && offset === m[0].length;
}
/** Percent-encodes what could break out of quotes on the relay; & ? = % stay. */
export const encodeUrlValue = (v) =>
  /^https?:\/\//i.test(v)
    ? v.replace(/["'`$^<>|\s]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0"))
    : (() => {
        if (VALUE_UNSAFE.test(v)) throw new Error(`The value "${v.slice(0, 60)}" has characters that could change the command, so I won't use it.`);
        return v;
      })();

/** In a shell step, is every {{blank}} inside "double quotes"? (Then spaces stay one argument.) */
export function shellBlanksQuoted(step) {
  if (!/^\s*shell:/i.test(step)) return true;
  for (const m of String(step).matchAll(PLACEHOLDER)) {
    const before = step.slice(0, m.index);
    if ((before.match(/"/g) || []).length % 2 === 0) return false;
  }
  return true;
}

/**
 * Every filled step for every run. `values` is one object, `each` a list of
 * values for the routine's only parameter (or of objects for several).
 * Returns [{ values, steps: [string] }].
 */
export function plan(routine, { values = {}, each = null } = {}) {
  const r = typeof routine === "string" ? getRoutine(routine) : routine;
  if (!r) throw new Error("No such routine.");
  let runs;
  if (Array.isArray(each) && each.length) {
    if (each.length > MAX_RUNS) throw new Error(`At most ${MAX_RUNS} items at a time (got ${each.length}).`);
    runs = each.map((item) => {
      if (item && typeof item === "object") return { ...values, ...item };
      if (r.params.length !== 1) throw new Error(`"${r.name}" has ${r.params.length} parameters; give each item as name=value pairs.`);
      return { ...values, [r.params[0].name]: item };
    });
  } else runs = [values];
  for (const v of runs)
    for (const p of r.params) if (v[p.name] == null || v[p.name] === "") throw new Error(`"${r.name}" needs ${p.name}${p.desc ? ` (${p.desc})` : ""}.`);
  return runs.map((v) => ({ values: v, steps: r.steps.map((s) => fill(s, v)) }));
}

/**
 * A parsed Claw command back as the text ARIA writes (the inverse of
 * server.js's parser), for recorded macros, which are kept as objects.
 * null for anything that isn't worth replaying (waits, unknowns).
 */
export function clawInputOf(cmd) {
  if (!cmd || typeof cmd !== "object") return null;
  switch (cmd.type) {
    case "shell": return `shell: ${cmd.cmd}`;
    case "type": return `type: ${cmd.text}`;
    case "hotkey": return `hotkey: ${[].concat(cmd.keys || []).join("+")}`;
    case "screenshot": return "screenshot";
    case "new_tab": return cmd.url ? `new_tab: ${cmd.url}` : "new_tab";
    case "close_tab": return "close_tab";
    case "switch_app": return `switch: ${cmd.app}`;
    case "write_code": return `write_code: ${cmd.app}|${cmd.code}`;
    case "mouse_move": return `move: ${cmd.x},${cmd.y}`;
    case "click": return `${cmd.button === "right" ? "right_click" : "click"}: ${cmd.x},${cmd.y}`;
    case "double_click": return `double_click: ${cmd.x},${cmd.y}`;
    case "drag": return `drag: ${cmd.x1},${cmd.y1} to ${cmd.x2},${cmd.y2}`;
    case "scroll": return `scroll: ${cmd.direction || "down"} ${cmd.amount || 3}`;
    case "browser": return `open: ${cmd.url}`;
    case "launch_app": return `open: ${cmd.app}`;
    default: return null;
  }
}

/* ── teaching ────────────────────────────────────────────────── */
const TEACH_SYSTEM = `You turn PC steps into a reusable routine for ARIA's Claw (a relay that controls the owner's Windows PC).
Steps are written exactly like Claw input, one per string:
  open: <app or https URL> · switch: <app> · new_tab: <url> · close_tab · hotkey: <keys> · type: <text>
  shell: <command> · write_code: <app>|<code> · scroll: down 3 · click: X,Y · double_click: X,Y · move: X,Y · screenshot
Replace whatever should change between runs with {{name}} placeholders (lowercase, letters/digits/_), and list each as a parameter.
Keep steps that are the same every time as they are. Prefer shell commands to mouse clicks when the job is files or folders.
In shell steps, wrap path placeholders in double quotes ("{{file}}") so paths with spaces work.
Never add steps that delete, format, shut down, or change system settings unless the owner's description explicitly asks for it.
Reply with ONE JSON object and nothing else:
{"name": "short-kebab-name", "description": "one sentence: what it does", "params": [{"name": "file", "desc": "full path of the file"}], "steps": ["…"]}`;

/**
 * Asks the model for a routine and validates it.
 * @param {object} o
 *   name, description   what the owner said it should do
 *   steps               Claw steps that were actually run (optional)
 *   ai(messages)        the model
 */
export async function teach({ name = "", description = "", steps = [], ai }) {
  if (!description && !steps.length) throw new Error("Describe what the routine should do, or record some steps first.");
  const user =
    (steps.length ? `STEPS THAT WERE RUN:\n${steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}\n\n` : "") +
    `WHAT THE ROUTINE SHOULD DO: ${description || "repeat the steps above, generalised"}` +
    (name ? `\nNAME: ${name}` : "");
  const raw = await ai([{ role: "system", content: TEACH_SYSTEM }, { role: "user", content: user }]);
  const text = String(raw || "").replace(/<think>[\s\S]*?<\/think>/gi, "");
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("The model didn't return a routine.");
  let r;
  try {
    r = JSON.parse(m[0]);
  } catch {
    throw new Error("The model's routine wasn't valid JSON.");
  }
  if (name) r.name = name;
  return validate(r);
}

/* ── the store ───────────────────────────────────────────────── */
export const listRoutines = () => _routines.map((r) => ({ ...r }));
export const getRoutine = (name) => _routines.find((r) => r.name === slug(name)) || null;

/**
 * Saves. `replace: false` (what chat uses) refuses to overwrite a routine
 * of the same name — the owner's own routines aren't the model's to redo.
 */
export function saveRoutine(r, { replace = true } = {}) {
  const v = validate(r);
  const i = _routines.findIndex((x) => x.name === v.name);
  if (i >= 0 && !replace) throw new Error(`There's already a routine called "${v.name}". Delete it first, or pick another name.`);
  if (i < 0 && _routines.length >= MAX_ROUTINES) throw new Error(`Already ${MAX_ROUTINES} routines — delete one first.`);
  const prev = i >= 0 ? _routines[i] : null;
  const out = { ...v, createdAt: prev?.createdAt || Date.now(), updatedAt: Date.now(), runs: prev?.runs || 0 };
  if (i >= 0) _routines[i] = out;
  else _routines.push(out);
  save();
  return { ...out };
}

export function removeRoutine(name) {
  const i = _routines.findIndex((r) => r.name === slug(name));
  if (i < 0) return false;
  _routines.splice(i, 1);
  save();
  return true;
}

export function noteRun(name, n = 1) {
  const r = _routines.find((x) => x.name === slug(name));
  if (!r) return;
  r.runs = (r.runs || 0) + n;
  r.lastRun = Date.now();
  save();
}

/** A routine as one line: "backup-file(file): Copies a file to D:\Backup — 2 steps". */
export const summary = (r) =>
  `${r.name}(${r.params.map((p) => p.name).join(", ")}): ${r.description || "(no description)"} — ${r.steps.length} step${r.steps.length === 1 ? "" : "s"}`;

/**
 * "file=C:\a.txt; dest=D:\" → { file: "C:\a.txt", dest: "D:\" }. A bare
 * value (no "=") goes to the only parameter. "for each: a, b, c" or a
 * JSON array gives a list.
 */
export function parseArgs(routine, text) {
  const t = String(text || "").trim();
  if (!t) return { values: {}, each: null };
  const fe = t.match(/^for\s*each\s*(?:[a-z_]+\s*)?(?:in|of)?\s*:?\s*([\s\S]+)$/i);
  if (fe) {
    const list = fe[1].trim();
    let items;
    if (list.startsWith("[")) {
      try {
        items = JSON.parse(list);
      } catch {
        throw new Error("The for-each list isn't valid JSON.");
      }
    } else items = list.split(/\s*[,\n]\s*/).filter(Boolean);
    return { values: {}, each: items };
  }
  if (!/^[a-z][a-z0-9_]*\s*=/i.test(t)) {
    if (routine.params.length !== 1) throw new Error(`"${routine.name}" takes ${routine.params.map((p) => p.name).join(", ") || "nothing"}; write name=value; name=value.`);
    return { values: { [routine.params[0].name]: t }, each: null };
  }
  const values = {};
  for (const pair of t.split(/\s*;\s*/).filter(Boolean)) {
    const m = pair.match(/^([a-z][a-z0-9_]*)\s*=\s*([\s\S]*)$/i);
    if (!m) throw new Error(`"${pair}" should be name=value.`);
    values[m[1].toLowerCase()] = m[2].trim().replace(/^"([\s\S]*)"$/, "$1");
  }
  return { values, each: null };
}

/** parse: the server's claw parser, so validate() checks steps the way they'll run. */
export function init({ parse } = {}) {
  _parse = parse || null;
  load();
}

/** Tests only. */
export function _reset() {
  _routines = [];
}
