// lib/owners.js — which Google accounts own this ARIA, and how one gets added
// ═══════════════════════════════════════════════════════════════════
//
// PAIRING (same idea as proxvocx)
//   Something already trusted (the desktop app on your PC, or you, signed in
//   on any ARIA) asks for a code: `K7F2-9QXB`, good for 10 minutes. Any Google
//   account that signs in anywhere and enters it becomes an owner, for good.
//   No user IDs to copy, no keys to edit, no restart.
//
// SHARED
//   Owners live in Firestore (aria_owners/{uid}), so an account paired on the
//   PC also gets into Render and the other way round — signing in on any
//   machine reaches the same ARIA. Codes live there too (aria_pairing/{code}),
//   so a code shown on the PC can be redeemed through Render when the device
//   you're on can't reach the PC directly.
//   Needs FIREBASE_SERVICE_ACCOUNT, like chat sync. Without it everything
//   still works on that one server, from data/owners.json.
//
// MACHINES
//   The desktop app gives each PC a random secret and connects its Claw relay
//   to Render with it. The PC registers only the secret's hash
//   (aria_machines/{id}); Render accepts a relay whose key hashes to one. So
//   Render can drive your PC with no ARIA_RELAY_KEY to set on either side.
//
// ARIA_OWNER_UID / ARIA_OWNER_EMAILS still work alongside all of this.
// ═══════════════════════════════════════════════════════════════════

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { initCloud, getDb } from "./cloud-sync.js";
import { DATA_DIR } from "./paths.js";

const FILE = path.join(DATA_DIR, "owners.json");
const OWNERS = "aria_owners";
const PAIRING = "aria_pairing";
const MACHINES = "aria_machines";
export const PAIRING_TTL_MS = 10 * 60 * 1000;

// No I, L, O, U, 0 or 1: a code read off one screen and typed on a phone
// can't be misread. 30^8 ≈ 6.6e11 codes.
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_LENGTH = 8;

export function newPairingCode() {
  const limit = Math.floor(256 / ALPHABET.length) * ALPHABET.length; // no modulo bias
  let out = "";
  while (out.length < CODE_LENGTH) {
    for (const b of crypto.randomBytes(16)) {
      if (b >= limit) continue;
      out += ALPHABET[b % ALPHABET.length];
      if (out.length === CODE_LENGTH) break;
    }
  }
  return out;
}

/** Uppercases, drops the dash and spaces, folds look-alikes people type. */
export function normaliseCode(input) {
  return String(input || "")
    .toUpperCase()
    .replace(/[IL1]/g, "J")
    .replace(/[O0]/g, "Q")
    .replace(/U/g, "V")
    .split("")
    .filter((c) => ALPHABET.includes(c))
    .join("")
    .slice(0, CODE_LENGTH);
}

export const formatCode = (c) => (c ? `${c.slice(0, 4)}-${c.slice(4)}` : "");

const sha256 = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");

// ── State ─────────────────────────────────────────────────────────
// owners:   uid → { email, name, addedAt, via }
// machines: id  → { name, secretHash, updatedAt }
// codes:    code → { createdAt, expiresAt, createdBy, claimedBy? } (this server's)
let state = { owners: {}, machines: {}, cloudSeen: false };
const codes = new Map();
let db = null;

function load() {
  try {
    const d = JSON.parse(fs.readFileSync(FILE, "utf8"));
    state = { owners: d.owners || {}, machines: d.machines || {}, cloudSeen: !!d.cloudSeen };
  } catch {}
}
function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(state, null, 2));
  } catch (e) {
    console.warn("[owners] couldn't save:", e.message);
  }
}

/** Load the local copy and, with Firestore, follow the shared lists. */
export function startOwners() {
  load();
  if (!initCloud()) {
    console.log(`[owners] ${Object.keys(state.owners).length} paired account(s), this server only (no FIREBASE_SERVICE_ACCOUNT)`);
    return;
  }
  db = getDb();

  db.collection(OWNERS).onSnapshot(
    (snap) => {
      const owners = {};
      for (const d of snap.docs) owners[d.id] = d.data();
      // The first time this server meets Firestore, anything paired locally
      // goes up rather than being dropped. After that Firestore decides, so
      // an account removed on one server is gone from all of them.
      if (!state.cloudSeen) {
        for (const [uid, o] of Object.entries(state.owners)) {
          if (owners[uid]) continue;
          owners[uid] = o;
          db.collection(OWNERS).doc(uid).set(o).catch(() => {});
        }
        state.cloudSeen = true;
      }
      state.owners = owners;
      save();
    },
    (e) => console.warn("[owners] listen failed, using the local copy:", e.message),
  );

  db.collection(MACHINES).onSnapshot(
    (snap) => {
      const machines = {};
      for (const d of snap.docs) machines[d.id] = d.data();
      state.machines = machines;
      save();
    },
    (e) => console.warn("[owners] machine list unavailable:", e.message),
  );
}

// ── Owners ────────────────────────────────────────────────────────
export const pairedUids = () => Object.keys(state.owners);
export const cloudShared = () => !!db;

export function listOwners() {
  return Object.entries(state.owners)
    .map(([uid, o]) => ({ uid, ...o }))
    .sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0));
}

async function addOwner(uid, info) {
  const entry = { email: info.email || "", name: info.name || "", addedAt: Date.now(), via: "pairing" };
  state.owners[uid] = entry;
  save();
  if (db) await db.collection(OWNERS).doc(uid).set(entry);
}

export async function removeOwner(uid) {
  delete state.owners[uid];
  save();
  if (db) await db.collection(OWNERS).doc(uid).delete();
}

// ── Pairing codes ─────────────────────────────────────────────────
export async function createCode({ createdBy = "", machine = "" } = {}) {
  const now = Date.now();
  for (const [c, v] of codes) if (v.expiresAt < now - PAIRING_TTL_MS) codes.delete(c);
  const code = newPairingCode();
  const entry = { createdAt: now, expiresAt: now + PAIRING_TTL_MS, createdBy, machine };
  codes.set(code, entry);
  if (db) {
    await db.collection(PAIRING).doc(code).set(entry);
    // Tidy codes nobody used (best effort).
    db.collection(PAIRING)
      .where("expiresAt", "<", now - PAIRING_TTL_MS)
      .limit(20)
      .get()
      .then((s) => s.docs.forEach((d) => d.ref.delete().catch(() => {})))
      .catch(() => {});
  }
  return { code, formatted: formatCode(code), expiresAt: entry.expiresAt };
}

/** "waiting" | "claimed" | "expired" | "unknown", plus who claimed it. */
export async function codeStatus(raw) {
  const code = normaliseCode(raw);
  let e = codes.get(code);
  if (db) {
    try {
      const s = await db.collection(PAIRING).doc(code).get();
      if (s.exists) e = s.data();
    } catch {}
  }
  if (!e) return { status: "unknown" };
  if (e.claimedBy) return { status: "claimed", email: e.claimedBy.email || "" };
  if (e.expiresAt < Date.now()) return { status: "expired" };
  return { status: "waiting", expiresAt: e.expiresAt };
}

/**
 * Redeems a code for a (verified) Google account.
 * Resolves { ok: true } or { ok: false, error: "malformed|unknown|used|expired" }.
 */
export async function claimCode(raw, who) {
  const code = normaliseCode(raw);
  if (code.length !== CODE_LENGTH) return { ok: false, error: "malformed" };
  const claim = { uid: who.uid, email: who.email || "", at: Date.now() };

  const check = (e) => {
    if (!e) return "unknown";
    if (e.claimedBy && e.claimedBy.uid !== who.uid) return "used";
    if (e.expiresAt < Date.now()) return "expired";
    return null;
  };

  if (db) {
    // A transaction, so two people can't both redeem one code.
    try {
      const ref = db.collection(PAIRING).doc(code);
      const err = await db.runTransaction(async (tx) => {
        const s = await tx.get(ref);
        const bad = check(s.exists ? s.data() : null);
        if (bad) return bad;
        tx.update(ref, { claimedBy: claim });
        return null;
      });
      if (err && err !== "unknown") return { ok: false, error: err };
      if (!err) {
        codes.delete(code);
        await addOwner(who.uid, who);
        return { ok: true };
      }
    } catch (e) {
      console.warn("[owners] pairing via Firestore failed, trying this server's codes:", e.message);
    }
  }

  const local = codes.get(code);
  const bad = check(local);
  if (bad) return { ok: false, error: bad };
  local.claimedBy = claim;
  await addOwner(who.uid, who);
  return { ok: true };
}

// ── Machines ──────────────────────────────────────────────────────
/** The desktop app's PC announces the hash of its relay secret. */
export async function registerMachine({ id, name, secret }) {
  if (!id || !secret) return;
  const entry = { name: name || id, secretHash: sha256(secret), updatedAt: Date.now() };
  state.machines[id] = entry;
  save();
  if (db) {
    try {
      await db.collection(MACHINES).doc(id).set(entry);
      console.log(`[owners] this PC (${entry.name}) can be reached through ARIA's other servers`);
    } catch (e) {
      console.warn("[owners] couldn't register this PC:", e.message);
    }
  }
}

/** A relay key that belongs to a registered PC. */
export function validMachineKey(key) {
  if (!key) return false;
  const h = Buffer.from(sha256(key));
  return Object.values(state.machines).some((m) => {
    const mh = Buffer.from(String(m.secretHash || ""));
    return mh.length === h.length && crypto.timingSafeEqual(mh, h);
  });
}
