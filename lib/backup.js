// lib/backup.js — one file that holds everything ARIA knows, and a way back
// ═══════════════════════════════════════════════════════════════════
//
// ARIA's state is a folder of JSON files (chats, memory, grades, routines,
// reminders…). Until now the only copy was that folder. A backup is every
// one of those files in a single JSON document:
//
//   { app: "aria", kind: "backup", version: 1, at, files: { "chats.json": …, … } }
//
// One is written every day to data/backups/ (the last 7 are kept), and you
// can download one or restore from one in Settings ▸ Backup. Restoring
// first writes a "pre-restore" snapshot of what's there now, so a restore
// can itself be undone.
//
// Left out on purpose: who may sign in (owners.json) and anything that
// looks like a key, token or session — a backup gets emailed and dropped in
// cloud folders, and those don't belong there — plus what can be rebuilt
// (the RAG vectors) or is only noise (the error log).
// ═══════════════════════════════════════════════════════════════════

import fs from "fs";
import path from "path";
import { DATA_DIR } from "./paths.js";
import { dateKey } from "./clock.js";

export const KEEP_DAILY = 7;
export const KEEP_SAFETY = 3;
const MAX_FILE_BYTES = 40 * 1024 * 1024;
const NAME_OK = /^[a-z0-9][a-z0-9._-]{0,60}\.json$/i;
const EXCLUDE = /(^|[._-])(owners?|keys?|tokens?|secrets?|sessions?|auth|credentials?|gvoice[a-z-]*)([._-]|$)/i;
const SKIP = new Set(["vectors.json", "error-log.json", "ingested.json"]);

let _dir = DATA_DIR;
let _timer = null;
const backupDir = () => path.join(_dir, "backups");

/** May this file name be in a backup (and be written by a restore)? */
export function allowed(name) {
  const n = String(name || "");
  return NAME_OK.test(n) && !n.includes("..") && !EXCLUDE.test(n.replace(/\.json$/i, "")) && !SKIP.has(n.toLowerCase());
}

/** Every backup-able file in the data folder, parsed. */
export function collect() {
  const files = {};
  const skipped = [];
  let names = [];
  try {
    names = fs.readdirSync(_dir, { withFileTypes: true }).filter((d) => d.isFile() && d.name.toLowerCase().endsWith(".json")).map((d) => d.name);
  } catch {}
  for (const name of names.sort()) {
    if (!allowed(name)) {
      skipped.push(name);
      continue;
    }
    try {
      const full = path.join(_dir, name);
      if (fs.statSync(full).size > MAX_FILE_BYTES) {
        skipped.push(name);
        continue;
      }
      files[name] = JSON.parse(fs.readFileSync(full, "utf8"));
    } catch {
      skipped.push(name); // unreadable or mid-write: left out rather than failing the backup
    }
  }
  return { files, skipped };
}

export function bundle(now = Date.now()) {
  const { files, skipped } = collect();
  return { app: "aria", kind: "backup", version: 1, at: now, files, skipped };
}

function rotate(prefix, keep) {
  try {
    const all = fs.readdirSync(backupDir()).filter((n) => n.startsWith(prefix) && n.endsWith(".json")).sort();
    for (const n of all.slice(0, Math.max(0, all.length - keep))) fs.unlinkSync(path.join(backupDir(), n));
  } catch {}
}

function write(name, doc) {
  fs.mkdirSync(backupDir(), { recursive: true });
  const full = path.join(backupDir(), name);
  fs.writeFileSync(full + ".tmp", JSON.stringify(doc));
  fs.renameSync(full + ".tmp", full);
  return full;
}

/** Today's snapshot (written again if today's already exists). */
export function writeSnapshot(now = Date.now()) {
  const doc = bundle(now);
  const name = `aria-backup-${dateKey(now)}.json`;
  write(name, doc);
  rotate("aria-backup-", KEEP_DAILY);
  return { name, at: now, files: Object.keys(doc.files).length, skipped: doc.skipped };
}

export function listSnapshots() {
  try {
    return fs
      .readdirSync(backupDir())
      .filter((n) => /^aria-(backup|pre-restore)-[\w-]+\.json$/.test(n))
      .map((name) => {
        const st = fs.statSync(path.join(backupDir(), name));
        return { name, at: st.mtimeMs, bytes: st.size, safety: name.startsWith("aria-pre-restore-") };
      })
      .sort((a, b) => b.at - a.at);
  } catch {
    return [];
  }
}

export function readSnapshot(name) {
  if (!/^aria-(backup|pre-restore)-[\w-]+\.json$/.test(String(name))) throw new Error("No such backup.");
  try {
    return JSON.parse(fs.readFileSync(path.join(backupDir(), name), "utf8"));
  } catch {
    throw new Error("No such backup.");
  }
}

/**
 * Checks a document is a backup and returns only what a restore may write.
 * Throws a sentence the owner can act on.
 */
export function validate(doc) {
  if (!doc || typeof doc !== "object" || doc.app !== "aria" || doc.kind !== "backup") throw new Error("That file isn't an ARIA backup.");
  if (doc.version !== 1) throw new Error(`That backup is version ${doc.version}; this ARIA reads version 1.`);
  if (!doc.files || typeof doc.files !== "object" || Array.isArray(doc.files)) throw new Error("That backup has no files in it.");
  const files = {};
  const refused = [];
  for (const [name, content] of Object.entries(doc.files)) {
    // The name came from a file someone picked: only plain names from the
    // backup-able set are written, never a path.
    if (!allowed(name) || path.basename(name) !== name || content === undefined || typeof content === "function") refused.push(name);
    else files[name] = content;
  }
  if (!Object.keys(files).length) throw new Error("Nothing in that backup can be restored.");
  return { files, refused, at: Number(doc.at) || null };
}

/**
 * Writes a backup's files over the current ones. What's there now is saved
 * first as aria-pre-restore-<time>.json.
 * @param only  file names to restore (default: all of them)
 */
export function restore(doc, { only = null, now = Date.now() } = {}) {
  const { files, refused } = validate(doc);
  const names = Object.keys(files).filter((n) => !only || only.includes(n));
  if (!names.length) throw new Error("None of the chosen files are in that backup.");
  const safety = `aria-pre-restore-${new Date(now).toISOString().replace(/[:.]/g, "-")}.json`;
  write(safety, bundle(now));
  rotate("aria-pre-restore-", KEEP_SAFETY);
  fs.mkdirSync(_dir, { recursive: true });
  for (const name of names) {
    const full = path.join(_dir, name);
    fs.writeFileSync(full + ".tmp", JSON.stringify(files[name], null, 1));
    fs.renameSync(full + ".tmp", full);
  }
  return { restored: names, refused, safety };
}

/** Writes today's snapshot if there isn't one yet. */
export function tick(now = Date.now()) {
  const name = `aria-backup-${dateKey(now)}.json`;
  if (fs.existsSync(path.join(backupDir(), name))) return null;
  try {
    return writeSnapshot(now);
  } catch (e) {
    console.warn("[backup] snapshot failed:", e.message);
    return null;
  }
}

export function init({ dir = DATA_DIR, start = true, everyMs = 30 * 60_000 } = {}) {
  _dir = dir;
  clearInterval(_timer);
  if (start) {
    // Not at boot: the modules are still loading their files. A minute in.
    const first = setTimeout(() => tick(), 60_000);
    first.unref?.();
    _timer = setInterval(() => tick(), everyMs);
    _timer.unref?.();
  }
}
