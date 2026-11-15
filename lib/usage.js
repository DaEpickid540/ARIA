// lib/usage.js — what the models are being asked, and how they answer
// ═══════════════════════════════════════════════════════════════════
//
// Every model call the server makes (chat, briefing, watchers, Claw auto…)
// goes through metered(): how long it took, whether it failed, and roughly
// how much text went in and came out. Kept per day and per provider/model
// for 60 days (data/usage.json), so "which model is slow today", "how often
// does the free tier fail" and "how much am I using this" have answers.
//
// Tokens are estimated at 4 characters each: the providers don't all report
// counts, and an even estimate is more useful than counts from half of them.
// ═══════════════════════════════════════════════════════════════════

import fs from "fs";
import path from "path";
import { DATA_DIR } from "./paths.js";
import { dateKey } from "./clock.js";

const FILE = path.join(DATA_DIR, "usage.json");
const KEEP_DAYS = 60;
const DAY = 86400_000;

let _days = {}; // "2026-11-09" → { "provider/model": { calls, fails, ms, inTok, outTok } }
let _recent = []; // last failures, for the panel
let _saveTimer = null;
let _persist = true;

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, "utf8"));
    _days = raw.days && typeof raw.days === "object" ? raw.days : {};
    _recent = Array.isArray(raw.recent) ? raw.recent : [];
  } catch {
    _days = {};
    _recent = [];
  }
}
function saveSoon() {
  if (!_persist || _saveTimer) return;
  // A chat turn can be a dozen calls; one write covers them.
  _saveTimer = setTimeout(() => {
    _saveTimer = null;
    flush();
  }, 5000);
  _saveTimer.unref?.();
}
export function flush() {
  if (!_persist) return;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE + ".tmp", JSON.stringify({ days: _days, recent: _recent }));
    fs.renameSync(FILE + ".tmp", FILE);
  } catch (e) {
    console.warn("[usage] save failed:", e.message);
  }
}

export const estTokens = (chars) => Math.ceil(Math.max(0, Number(chars) || 0) / 4);

/** Characters of text in a messages array (images counted as nothing). */
export function messageChars(messages) {
  let n = 0;
  for (const m of Array.isArray(messages) ? messages : []) {
    if (typeof m?.content === "string") n += m.content.length;
    else if (Array.isArray(m?.content)) for (const p of m.content) if (typeof p?.text === "string") n += p.text.length;
  }
  return n;
}

export function record({ provider = "unknown", model = "", ms = 0, ok = true, inChars = 0, outChars = 0, error = "", at = Date.now() } = {}) {
  const day = dateKey(at);
  const key = `${String(provider || "unknown").toLowerCase()}/${String(model || "default").slice(0, 80)}`;
  const d = (_days[day] ||= {});
  const e = (d[key] ||= { calls: 0, fails: 0, ms: 0, inTok: 0, outTok: 0 });
  e.calls++;
  if (!ok) e.fails++;
  else e.ms += Math.max(0, Math.round(ms)); // latency is of answers; a refusal in 80ms isn't "fast"
  e.inTok += estTokens(inChars);
  e.outTok += estTokens(outChars);
  if (!ok) {
    _recent.push({ at, key, error: String(error || "failed").slice(0, 200) });
    if (_recent.length > 30) _recent = _recent.slice(-30);
  }
  prune(at);
  saveSoon();
}

function prune(now) {
  const cutoff = dateKey(now - KEEP_DAYS * DAY);
  for (const k of Object.keys(_days)) if (k < cutoff) delete _days[k];
}

/**
 * Runs `fn` (a model call returning text) and records it.
 * Throws what fn throws; the failure is recorded first.
 */
export async function metered({ provider, model, messages }, fn) {
  const t0 = Date.now();
  const inChars = messageChars(messages);
  try {
    const out = await fn();
    // Providers that aren't set up answer with a "⚠ … not set" string.
    const text = typeof out === "string" ? out : "";
    const ok = !/^⚠/.test(text);
    record({ provider, model, ms: Date.now() - t0, ok, inChars, outChars: text.length, error: ok ? "" : text });
    return out;
  } catch (e) {
    record({ provider, model, ms: Date.now() - t0, ok: false, inChars, error: e?.message });
    throw e;
  }
}

/** The same for a streamed reply: counts what comes through, records at the end. */
export function meteredStream({ provider, model, messages }, upstream) {
  if (!upstream?.deltas) return upstream;
  const t0 = Date.now();
  const inChars = messageChars(messages);
  const src = upstream.deltas;
  async function* counted() {
    let outChars = 0;
    let ok = true;
    let error = "";
    try {
      for await (const d of src) {
        if (typeof d === "string") outChars += d.length;
        yield d;
      }
    } catch (e) {
      ok = false;
      error = e?.message;
      throw e;
    } finally {
      record({ provider, model, ms: Date.now() - t0, ok: ok && outChars > 0, inChars, outChars, error: error || (outChars ? "" : "empty stream") });
    }
  }
  return { ...upstream, deltas: counted() };
}

const blank = () => ({ calls: 0, fails: 0, ms: 0, inTok: 0, outTok: 0 });
const addTo = (a, b) => {
  a.calls += b.calls;
  a.fails += b.fails;
  a.ms += b.ms;
  a.inTok += b.inTok;
  a.outTok += b.outTok;
  return a;
};
const view = (e) => ({
  ...e,
  avgMs: e.calls - e.fails > 0 ? Math.round(e.ms / (e.calls - e.fails)) : null,
  failRate: e.calls ? Math.round((e.fails / e.calls) * 100) : 0,
});

/** Totals for the last `days` days: today, the series, and a row per model. */
export function summary({ days = 7, now = Date.now() } = {}) {
  const n = Math.max(1, Math.min(KEEP_DAYS, Math.round(days)));
  const series = [];
  const models = {};
  const total = blank();
  for (let i = n - 1; i >= 0; i--) {
    const k = dateKey(now - i * DAY);
    const day = blank();
    for (const [key, e] of Object.entries(_days[k] || {})) {
      addTo(day, e);
      addTo((models[key] ||= blank()), e);
    }
    addTo(total, day);
    series.push({ day: k, ...view(day) });
  }
  return {
    days: n,
    today: series[series.length - 1],
    total: view(total),
    series,
    models: Object.entries(models)
      .map(([key, e]) => ({ key, provider: key.split("/")[0], model: key.slice(key.indexOf("/") + 1), ...view(e) }))
      .sort((a, b) => b.calls - a.calls),
    recentFailures: _recent.slice(-8).reverse(),
  };
}

const k = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

/** ACTION: usage — the same numbers, as text. */
export function runUsageTool(_name, input, now = Date.now()) {
  const days = Math.max(1, Math.min(KEEP_DAYS, parseInt(String(input || "").replace(/\D/g, ""), 10) || 7));
  const s = summary({ days, now });
  if (!s.total.calls) return `No model calls recorded in the last ${days} day${days === 1 ? "" : "s"}.`;
  const line = (label, e) =>
    `${label}: ${e.calls} call${e.calls === 1 ? "" : "s"}${e.fails ? `, ${e.fails} failed (${e.failRate}%)` : ""}${e.avgMs != null ? `, avg ${(e.avgMs / 1000).toFixed(1)}s` : ""}, ~${k(e.inTok)} tokens in / ~${k(e.outTok)} out`;
  return [
    line("Today", s.today),
    line(`Last ${days} days`, s.total),
    "By model:",
    ...s.models.slice(0, 8).map((m) => "- " + line(`${m.provider} ${m.model}`, m)),
    "(Tokens are estimates: 4 characters each.)",
  ].join("\n");
}

export function init({ persist = true } = {}) {
  _persist = persist;
  if (persist) load();
}

export function _reset(days = {}) {
  _days = days;
  _recent = [];
  _persist = false;
}
