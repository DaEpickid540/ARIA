// error-log.js — append-only record of what actually goes wrong.
//
// Ported from the AGI harness (agi/error_log.py). The idea worth taking is
// that failures are *structured data*, not console noise: a failure type, the
// context it happened in, a severity, a timestamp. Console logs answer "what
// just happened"; this answers "what keeps happening", which is the question
// you have when deciding what to fix.
//
// Clustering by failure_type is the whole point. Twelve scattered "tool error"
// lines in a terminal look like twelve unrelated events; grouped, they are one
// broken tool that has failed twelve times.
//
// Deliberately NOT ported: the self-improvement loop these errors fed in AGI,
// where a council voted on persona edits and promoted them automatically.
// Nothing here writes back into ARIA's behaviour — it only records.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
const LOG_PATH = path.join(DATA_DIR, "error-log.json");

export const SEVERITIES = new Set(["low", "medium", "high"]);

// Bounded so a failing loop can't fill the disk. Oldest entries drop first.
const MAX_ENTRIES = 500;

// Read through to disk rather than caching in memory. A cache populated once
// at startup goes stale the moment anything else writes the file — a second
// process, a manual edit, the relay — and a log that quietly under-reports is
// worse than no log. The file is bounded to MAX_ENTRIES, and reads only happen
// when something asks, so there is nothing to optimise here.
function load() {
  try {
    const parsed = JSON.parse(fs.readFileSync(LOG_PATH, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persist(entries) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(LOG_PATH, JSON.stringify(entries, null, 2));
  } catch (e) {
    // A logger that throws is worse than one that misses an entry.
    console.warn("[ERRLOG] could not persist:", e.message);
  }
}

/**
 * Record one failure.
 * @param {string} failureType  stable identifier — the clustering key
 * @param {string} context      what was being attempted when it failed
 * @param {"low"|"medium"|"high"} severity
 * @param {object} [meta]       anything else worth keeping
 */
export function logError(failureType, context, severity = "medium", meta = {}) {
  if (!SEVERITIES.has(severity)) severity = "medium";
  const entry = {
    id:
      globalThis.crypto?.randomUUID?.() ||
      `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    failureType: String(failureType || "unknown").slice(0, 80),
    context: String(context ?? "").slice(0, 1000),
    severity,
    meta,
    timestamp: new Date().toISOString(),
  };
  const entries = load();
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
  persist(entries);
  return entry;
}

export function loadEntries() {
  return [...load()];
}

/** Group by failure type, most frequent first — the "what keeps breaking" view. */
export function clusterByType(entries = null) {
  const list = entries || load();
  const clusters = new Map();
  for (const e of list) {
    if (!clusters.has(e.failureType)) clusters.set(e.failureType, []);
    clusters.get(e.failureType).push(e);
  }
  return [...clusters.entries()]
    .map(([failureType, items]) => ({
      failureType,
      count: items.length,
      severity: items.some((i) => i.severity === "high")
        ? "high"
        : items.some((i) => i.severity === "medium")
          ? "medium"
          : "low",
      lastSeen: items[items.length - 1].timestamp,
      lastContext: items[items.length - 1].context,
      samples: items.slice(-3).reverse(),
    }))
    .sort((a, b) => b.count - a.count);
}

export function stats() {
  const list = load();
  const since = Date.now() - 24 * 60 * 60 * 1000;
  return {
    total: list.length,
    last24h: list.filter((e) => Date.parse(e.timestamp) >= since).length,
    high: list.filter((e) => e.severity === "high").length,
    distinctTypes: new Set(list.map((e) => e.failureType)).size,
  };
}

export function clearLog() {
  persist([]);
  return { ok: true };
}
