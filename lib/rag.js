// lib/rag.js — ARIA Memory V4 + RAG system
// ═══════════════════════════════════════════════════════════════════
//
// What this provides:
//   • A persistent vector store (JSON file, no DB dependency)
//   • Embedding-based semantic search across:
//       - User-injected training documents (RAG corpus)
//       - Past chat messages (cross-chat recall)
//       - Memory facts (Memory V4)
//   • Three "namespaces" so we can search them independently or together
//
// Storage layout:
//   data/rag/
//     vectors.json    — { id, namespace, text, embedding[], meta{}, addedAt }[]
//     ingested.json   — list of source files ingested (so we don't re-ingest)
//
// Each vector entry is small: ~3 KB for a 384-dim float embedding.
// At 10,000 entries this is ~30 MB JSON. Fine for personal use.
//
// ═══════════════════════════════════════════════════════════════════

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data", "rag");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const VECTORS_FILE = path.join(DATA_DIR, "vectors.json");
const INGESTED_FILE = path.join(DATA_DIR, "ingested.json");

// ── In-memory state ───────────────────────────────────────────
// Loaded once on first access; persisted via debounced writes.
let _vectors = null;
let _ingested = null;
let _writeTimer = null;

function loadVectors() {
  if (_vectors) return _vectors;
  try {
    _vectors = JSON.parse(fs.readFileSync(VECTORS_FILE, "utf8"));
  } catch {
    _vectors = [];
  }
  return _vectors;
}

function loadIngested() {
  if (_ingested) return _ingested;
  try {
    _ingested = JSON.parse(fs.readFileSync(INGESTED_FILE, "utf8"));
  } catch {
    _ingested = { sources: [] };
  }
  return _ingested;
}

function scheduleWrite() {
  if (_writeTimer) clearTimeout(_writeTimer);
  _writeTimer = setTimeout(() => {
    try {
      const tmp = VECTORS_FILE + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(_vectors, null, 0));
      fs.renameSync(tmp, VECTORS_FILE);
      fs.writeFileSync(INGESTED_FILE, JSON.stringify(_ingested, null, 2));
    } catch (e) {
      console.warn("[RAG] Write failed:", e.message);
    }
    _writeTimer = null;
  }, 1000);
}

// ── Math: cosine similarity ──────────────────────────────────
function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

// ── Chunking for documents ────────────────────────────────────
// Split long text into semantically meaningful chunks for embedding.
// Aim for ~500 tokens (≈2000 chars) with 100 char overlap.
function chunkText(text, chunkSize = 2000, overlap = 200) {
  if (text.length <= chunkSize) return [text];

  const chunks = [];
  let start = 0;

  // Try to split on paragraph or sentence boundaries when possible
  while (start < text.length) {
    let end = Math.min(start + chunkSize, text.length);

    // If we're not at the end, find a sentence/paragraph boundary
    if (end < text.length) {
      const candidates = [
        text.lastIndexOf("\n\n", end),
        text.lastIndexOf(". ", end),
        text.lastIndexOf("! ", end),
        text.lastIndexOf("? ", end),
      ].filter((i) => i > start + chunkSize * 0.5);
      if (candidates.length) end = Math.max(...candidates) + 1;
    }

    chunks.push(text.slice(start, end).trim());
    start = end - overlap;
    if (start < 0) start = 0;
  }
  return chunks.filter((c) => c.length > 20);
}

// ── Public API ────────────────────────────────────────────────

/**
 * Add a single entry to the vector store.
 *   namespace: "chat" | "training" | "memory"
 *   text:      the actual text to embed
 *   meta:      arbitrary JSON (chatId, role, timestamp, source, etc.)
 *   embedFn:   async function that returns an embedding vector for a given text
 */
export async function addEntry(namespace, text, meta, embedFn) {
  if (!text || text.length < 5) return null;
  const vectors = loadVectors();
  const embedding = await embedFn(text);
  if (!embedding) return null;
  const entry = {
    id: `${namespace}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    namespace,
    text: text.slice(0, 4000), // keep stored text bounded
    embedding,
    meta: meta || {},
    addedAt: Date.now(),
  };
  vectors.push(entry);
  scheduleWrite();
  return entry.id;
}

/**
 * Add a long document — split it into chunks first, embed each, store all.
 * Returns the number of chunks added.
 */
export async function addDocument(namespace, fullText, meta, embedFn) {
  const chunks = chunkText(fullText);
  let added = 0;
  for (let i = 0; i < chunks.length; i++) {
    const id = await addEntry(
      namespace,
      chunks[i],
      { ...meta, chunkIndex: i, totalChunks: chunks.length },
      embedFn,
    );
    if (id) added++;
  }
  // Record source so we don't re-ingest
  if (meta?.source) {
    const ing = loadIngested();
    ing.sources.push({
      source: meta.source,
      namespace,
      chunks: added,
      addedAt: Date.now(),
    });
    scheduleWrite();
  }
  return added;
}

/**
 * Semantic search.
 *   query:      free-form query string
 *   namespaces: array of namespaces to search (default: all)
 *   topK:       max results
 *   minScore:   filter floor (cosine similarity); 0 = no filter
 */
export async function search(query, embedFn, { namespaces = null, topK = 5, minScore = 0.3 } = {}) {
  if (!query || query.length < 3) return [];
  const vectors = loadVectors();
  if (vectors.length === 0) return [];

  const queryEmb = await embedFn(query);
  if (!queryEmb) return [];

  const scored = [];
  for (const v of vectors) {
    if (namespaces && !namespaces.includes(v.namespace)) continue;
    const score = cosine(queryEmb, v.embedding);
    if (score >= minScore) {
      scored.push({ score, ...v, embedding: undefined }); // strip embedding from result
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

/**
 * Delete entries by filter. Returns number deleted.
 */
export function deleteEntries({ namespace, source, olderThanMs } = {}) {
  const vectors = loadVectors();
  const before = vectors.length;
  _vectors = vectors.filter((v) => {
    if (namespace && v.namespace !== namespace) return true;
    if (source && v.meta?.source !== source) return true;
    if (olderThanMs && Date.now() - v.addedAt < olderThanMs) return true;
    return false;
  });
  if (source) {
    const ing = loadIngested();
    ing.sources = ing.sources.filter((s) => s.source !== source);
  }
  scheduleWrite();
  return before - _vectors.length;
}

/**
 * Get statistics about the vector store.
 */
export function getStats() {
  const vectors = loadVectors();
  const ingested = loadIngested();
  const byNamespace = {};
  let totalChars = 0;
  for (const v of vectors) {
    byNamespace[v.namespace] = (byNamespace[v.namespace] || 0) + 1;
    totalChars += v.text.length;
  }
  return {
    totalEntries: vectors.length,
    byNamespace,
    totalChars,
    ingestedSources: ingested.sources?.length || 0,
    sources: ingested.sources?.slice(-20) || [],
    estimatedSizeMB: Math.round((JSON.stringify(vectors).length / 1024 / 1024) * 10) / 10,
  };
}

/**
 * Check whether a source has already been ingested (so we don't re-process).
 */
export function isSourceIngested(source) {
  const ing = loadIngested();
  return ing.sources.some((s) => s.source === source);
}

/**
 * Flush pending writes synchronously. Call this on process shutdown.
 */
export function flushSync() {
  if (_writeTimer) {
    clearTimeout(_writeTimer);
    _writeTimer = null;
  }
  try {
    if (_vectors)
      fs.writeFileSync(VECTORS_FILE, JSON.stringify(_vectors, null, 0));
    if (_ingested)
      fs.writeFileSync(INGESTED_FILE, JSON.stringify(_ingested, null, 2));
  } catch {}
}

/**
 * Build context block from search results — formatted for injection into AI prompt.
 */
export function formatContextBlock(results, maxChars = 4000) {
  if (!results || !results.length) return "";
  let out = "";
  for (const r of results) {
    const tag = r.namespace.toUpperCase();
    const ref =
      r.meta?.source ||
      (r.meta?.chatId ? `chat:${r.meta.chatId}` : r.namespace);
    const snippet = r.text.replace(/\s+/g, " ").trim();
    const line = `[${tag} | ${ref} | score:${r.score.toFixed(2)}] ${snippet}\n\n`;
    if (out.length + line.length > maxChars) break;
    out += line;
  }
  return out.trim();
}
