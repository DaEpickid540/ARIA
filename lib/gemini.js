// lib/gemini.js — Google Gemini, with as many API keys as you give it
// ═══════════════════════════════════════════════════════════════════
//
// Keys: GEMINI_API_KEYS (several, separated by commas — what Settings ▸ Keys
// writes) and/or GEMINI_API_KEY (one). Each call takes the next key in turn,
// so the free tier's per-key limits add up across keys. A key that answers
// 429 (rate limit / quota) sits out for as long as Google asks (or a
// minute); one Google says is invalid sits out for an hour. The call moves
// straight on to the next key, so a busy key never fails a message while
// another one is free.
//
// Calls go to Gemini's OpenAI-compatible endpoint, so ARIA's messages
// (system turns, image_url parts) go as they are, and streaming is the same
// SSE format OpenRouter uses.
//
// Model: the one asked for, else GEMINI_MODEL, else the newest stable Flash
// model the keys can see (asked from Google's model list, cached for hours),
// so a retired model name doesn't break ARIA.
// ═══════════════════════════════════════════════════════════════════

const BASE = "https://generativelanguage.googleapis.com/v1beta";
export const CHAT_URL = `${BASE}/openai/chat/completions`;
// Used only when the model list can't be read.
export const FALLBACK_MODEL = "gemini-2.5-flash";

/** Every configured key, de-duplicated, in order. */
export function keys(env = process.env) {
  const all = [env.GEMINI_API_KEYS, env.GEMINI_API_KEY]
    .filter(Boolean)
    .join(",")
    .split(/[\s,;]+/)
    .map((k) => k.trim())
    .filter(Boolean);
  return [...new Set(all)];
}

export const configured = (env = process.env) => keys(env).length > 0;

/* ── Rotation ────────────────────────────────────────────────── */
const resting = new Map(); // key → { until, why }
let turn = 0;

/** The keys to try for one call, starting with the next one in turn and skipping any that are resting. */
export function keyOrder(now = Date.now(), env = process.env) {
  const ks = keys(env);
  if (!ks.length) return [];
  const start = turn++ % ks.length;
  const order = [...ks.slice(start), ...ks.slice(0, start)];
  const ready = order.filter((k) => !(resting.get(k)?.until > now));
  // All resting: try the one that frees up first rather than failing outright.
  return ready.length ? ready : [...order].sort((a, b) => resting.get(a).until - resting.get(b).until).slice(0, 1);
}

export function rest(key, ms, why) {
  resting.set(key, { until: Date.now() + ms, why });
}

/** For Settings / the self-test: how each key is doing (last four characters only). */
export function keyStatus(now = Date.now(), env = process.env) {
  return keys(env).map((k) => {
    const r = resting.get(k);
    return { key: `…${k.slice(-4)}`, resting: r?.until > now ? { seconds: Math.ceil((r.until - now) / 1000), why: r.why } : null };
  });
}

export function _reset() {
  resting.clear();
  turn = 0;
  modelCache = { at: 0, models: [] };
}

/**
 * What an error means for the key that got it.
 * @returns {{ rest: number, why: string } | null} null = not the key's fault (bad request, server error)
 */
export function judge(status, body = "", retryAfter = null) {
  const text = String(body);
  if (status === 429 || /RESOURCE_EXHAUSTED|quota|rate limit/i.test(text)) {
    const secs = Number(retryAfter) || Number(/retry in ([\d.]+)s/i.exec(text)?.[1]) || Number(/"retryDelay":\s*"(\d+)s"/.exec(text)?.[1]) || 60;
    return { rest: Math.min(Math.max(secs, 5), 3600) * 1000, why: "rate limit" };
  }
  if (status === 401 || status === 403 || /API_KEY_INVALID|API key not valid|PERMISSION_DENIED/i.test(text))
    return { rest: 60 * 60_000, why: "key refused" };
  return null;
}

/* ── Models ──────────────────────────────────────────────────── */
let modelCache = { at: 0, models: [] };
const MODEL_TTL = 6 * 60 * 60_000;

/** "gemini-3.8-flash" → [3.8]; higher is newer. */
const versionOf = (id) => Number(/^gemini-(\d+(?:\.\d+)?)/.exec(id)?.[1] || 0);

/**
 * Chat models the keys can use, best first: stable Flash (newest first),
 * then Pro, then previews; never embedding / image / TTS / live models.
 */
export function rankModels(list) {
  const chat = list
    .filter((m) => (m.supportedGenerationMethods || ["generateContent"]).includes("generateContent"))
    .map((m) => String(m.name || m.id || "").replace(/^models\//, ""))
    .filter((id) => /^gemini-/.test(id) && !/embedding|image|tts|audio|live|exp|aqa|robotics|computer-use|native/i.test(id));
  const score = (id) =>
    (/-flash$/.test(id) ? 4000 : /-pro$/.test(id) ? 3000 : /-flash-lite$/.test(id) ? 2000 : /preview/.test(id) ? 1000 : 0) + versionOf(id) * 10;
  return [...new Set(chat)].sort((a, b) => score(b) - score(a) || a.localeCompare(b));
}

/** The chat models the first working key can see (cached). */
export async function listModels({ fetchImpl = fetch, force = false } = {}) {
  if (!force && modelCache.models.length && Date.now() - modelCache.at < MODEL_TTL) return modelCache.models;
  for (const key of keyOrder()) {
    try {
      const r = await fetchImpl(`${BASE}/models?pageSize=200`, { headers: { "x-goog-api-key": key }, signal: AbortSignal.timeout(8000) });
      if (!r.ok) {
        const j = judge(r.status, await r.text().catch(() => ""), r.headers?.get?.("retry-after"));
        if (j) rest(key, j.rest, j.why);
        continue;
      }
      const models = rankModels((await r.json()).models || []);
      if (models.length) {
        modelCache = { at: Date.now(), models };
        return models;
      }
    } catch {}
  }
  return modelCache.models; // stale is better than nothing
}

export async function defaultModel(opts = {}) {
  if (process.env.GEMINI_MODEL) return process.env.GEMINI_MODEL;
  return (await listModels(opts))[0] || FALLBACK_MODEL;
}

/* ── Calls ───────────────────────────────────────────────────── */
/**
 * One chat completion, rotating keys on rate limits. With `stream`, returns
 * the open Response (SSE) instead of text.
 */
export async function chat(messages, { model, stream = false, maxTokens = 4096, fetchImpl = fetch, timeoutMs = 120_000 } = {}) {
  const order = keyOrder();
  if (!order.length) throw new Error("No Gemini key set (GEMINI_API_KEYS).");
  const m = model || (await defaultModel({ fetchImpl }));
  const errors = [];
  for (const key of order) {
    let r;
    try {
      r = await fetchImpl(CHAT_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: m, messages, max_tokens: maxTokens, stream }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      errors.push(`…${key.slice(-4)}: ${e.message}`);
      continue; // network trouble: another key won't hurt
    }
    if (r.ok) {
      if (stream) return r;
      const data = await r.json();
      const reply = data?.choices?.[0]?.message?.content;
      const text = (Array.isArray(reply) ? reply.map((p) => p?.text || "").join("") : String(reply ?? "")).trim();
      if (!text) throw new Error(`Gemini (${m}) returned nothing${data?.choices?.[0]?.finish_reason ? ` (${data.choices[0].finish_reason})` : ""}`);
      return text;
    }
    const body = await r.text().catch(() => "");
    const j = judge(r.status, body, r.headers?.get?.("retry-after"));
    errors.push(`…${key.slice(-4)}: HTTP ${r.status}${j ? ` (${j.why})` : ""}`);
    if (!j) throw new Error(`Gemini HTTP ${r.status} (${m}): ${body.slice(0, 200)}`); // the request, not the key
    rest(key, j.rest, j.why);
  }
  throw new Error(`Every Gemini key is busy or refused — ${errors.join("; ")}`);
}
