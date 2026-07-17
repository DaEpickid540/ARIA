// lib/cloud-sync.js — Firestore persistence for ARIA's state files
// ═══════════════════════════════════════════════════════════════════
//
// WHY THIS EXISTS
//   Render's filesystem is EPHEMERAL: every redeploy/restart wipes data/.
//   ARIA's memory, tasks and behaviour were silently lost each deploy.
//   This module mirrors those small JSON state files to Firestore
//   (project: personal-suite) so they survive restarts and are visible
//   alongside GRIND + hardware-tracker.
//
// DESIGN — deliberately non-invasive
//   The rest of ARIA keeps its fast synchronous fs reads/writes. We only:
//     1. hydrateAll()   — on boot, pull cloud state down into data/*.json
//                         BEFORE server.js does its sync readJSON() calls.
//     2. startAutoSync()— poll mtimes and push changed files up (debounced
//                         by the interval). No writer code has to change.
//     3. flushAll()     — final push on SIGTERM (Render sends this on deploy).
//   Cloud is the source of truth on boot; local is the source while running.
//
// STORAGE SHAPE
//   collection aria_state / doc <name> = { json: "<file contents>", bytes, updatedAt }
//   The whole file is stored as a JSON *string* on purpose: Firestore cannot
//   store nested arrays natively, and a string sidesteps that entirely.
//
// NOT SYNCED: data/rag/vectors.json
//   Embeddings are nested arrays and grow to tens of MB — far past Firestore's
//   1 MiB/doc limit, and cosine search over a Firestore collection means a full
//   scan on every query. Keep the vector store local (or move it to a real
//   vector DB / Firestore Vector Search). RAG re-ingests; it is a cache.
//
// CONFIG: set FIREBASE_SERVICE_ACCOUNT to the service-account JSON (raw or
//   base64). Without it this module no-ops and ARIA runs local-only, exactly
//   as before — so it is safe to deploy before the env var is set.
// ═══════════════════════════════════════════════════════════════════

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
const COLLECTION = "aria_state";
const MAX_DOC_BYTES = 900_000; // Firestore hard limit is 1 MiB — leave headroom

// Small state files worth persisting. (rag/vectors.json intentionally absent.)
const SYNC_FILES = ["chats.json", "memory.json", "behavior.json", "tasks.json"];

const docId = (name) => name.replace(/\.json$/, "");

let db = null;
const lastPushedMtime = new Map();

function credentialsFromEnv() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (raw) {
    try {
      return JSON.parse(raw);
    } catch {
      try {
        return JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
      } catch {
        console.warn("[cloud] FIREBASE_SERVICE_ACCOUNT set but not valid JSON/base64");
      }
    }
  }
  const p = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (p && fs.existsSync(p)) {
    try {
      return JSON.parse(fs.readFileSync(p, "utf8"));
    } catch {}
  }
  return null;
}

export function initCloud() {
  if (db) return true;
  const sa = credentialsFromEnv();
  if (!sa) {
    console.log("[cloud] no FIREBASE_SERVICE_ACCOUNT — running local-only (data lost on redeploy)");
    return false;
  }
  try {
    const app =
      getApps().find((a) => a.name === "aria-cloud") ||
      initializeApp({ credential: cert(sa) }, "aria-cloud");
    db = getFirestore(app);
    console.log(`[cloud] Firestore persistence enabled (${sa.project_id})`);
    return true;
  } catch (e) {
    console.warn("[cloud] init failed, staying local-only:", e.message);
    return false;
  }
}

export const cloudEnabled = () => !!db;
// Exposes the same Admin SDK Firestore instance for read-only cross-app
// context lookups (grind_users, hw_items, ...) — see lib/life-context.js.
// Reuses this module's single `db` connection rather than initializing a
// second Firebase Admin app.
export const getDb = () => db;

// Pull cloud state down into data/. Must run BEFORE the sync readJSON() calls.
export async function hydrateAll() {
  if (!initCloud()) return;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  for (const name of SYNC_FILES) {
    const local = path.join(DATA_DIR, name);
    try {
      const snap = await db.collection(COLLECTION).doc(docId(name)).get();
      const data = snap.exists ? snap.data() : null;
      if (data && typeof data.json === "string") {
        fs.writeFileSync(local, data.json);
        lastPushedMtime.set(name, fs.statSync(local).mtimeMs);
        console.log(`[cloud] hydrated ${name} (${data.json.length}B)`);
      } else if (fs.existsSync(local)) {
        await pushFile(name); // first run: seed cloud from whatever is on disk
        console.log(`[cloud] seeded ${name} to cloud`);
      }
    } catch (e) {
      console.warn(`[cloud] hydrate ${name} failed:`, e.message);
    }
  }
}

export async function pushFile(name) {
  if (!db) return;
  const local = path.join(DATA_DIR, name);
  if (!fs.existsSync(local)) return;
  const json = fs.readFileSync(local, "utf8");
  if (json.length > MAX_DOC_BYTES) {
    console.warn(`[cloud] ${name} is ${json.length}B (> ${MAX_DOC_BYTES}) — not synced`);
    return;
  }
  await db.collection(COLLECTION).doc(docId(name)).set({
    json,
    bytes: json.length,
    updatedAt: new Date().toISOString(),
  });
  lastPushedMtime.set(name, fs.statSync(local).mtimeMs);
}

// Push any file whose mtime changed since we last pushed it.
export async function syncChanged() {
  if (!db) return;
  for (const name of SYNC_FILES) {
    const local = path.join(DATA_DIR, name);
    if (!fs.existsSync(local)) continue;
    try {
      const m = fs.statSync(local).mtimeMs;
      if (lastPushedMtime.get(name) === m) continue;
      await pushFile(name);
      console.log(`[cloud] synced ${name}`);
    } catch (e) {
      console.warn(`[cloud] push ${name} failed:`, e.message);
    }
  }
}

export function startAutoSync(intervalMs = 20_000) {
  if (!db) return null;
  const t = setInterval(() => {
    syncChanged().catch(() => {});
  }, intervalMs);
  t.unref?.(); // never hold the process open
  return t;
}

// Best-effort final push (Render sends SIGTERM on redeploy).
export async function flushAll() {
  if (!db) return;
  for (const name of SYNC_FILES) {
    try {
      await pushFile(name);
    } catch {}
  }
}
