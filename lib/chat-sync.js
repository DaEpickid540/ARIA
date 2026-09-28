// lib/chat-sync.js — one chat history across every ARIA server
// ═══════════════════════════════════════════════════════════════════
//
// WHY
//   Chats live on whichever server a page talks to: the desktop app on your
//   PC or Render. (The Firebase site and the SMS hook are only windows onto
//   one of those.) Each kept its own chats.json, so a conversation started
//   on the PC never showed up on Render and vice versa. The old Firestore
//   backup (cloud-sync.js) stored all of chats.json as ONE document,
//   last-writer-wins, so two servers syncing it would wipe each other out.
//
// HOW
//   One Firestore document per chat in `aria_chats`: { userId, chatId,
//   updatedAt, deleted, json, origin }. Every chat carries an updatedAt
//   (stamped by the page that changed it, public/js/chat.js), and the newer
//   copy of a chat wins wherever the two meet: in /api/saveChats, and when a
//   change arrives from the other server. Deleting a chat leaves a tombstone,
//   so a device that still has it can't bring it back.
//
//   Each server pushes the chats it changes and listens to the collection
//   (onSnapshot). A change from elsewhere is merged into its chats.json and
//   its open pages are told to re-pull (broadcastChatSync). The `origin`
//   field lets a server skip its own echoes.
//
//   Needs FIREBASE_SERVICE_ACCOUNT, like cloud-sync.js. Without it chats stay
//   local to each server, exactly as before.
// ═══════════════════════════════════════════════════════════════════

import crypto from "crypto";
import { initCloud, getDb } from "./cloud-sync.js";

const COLLECTION = "aria_chats";
const MAX_DOC_BYTES = 900_000; // Firestore's limit is 1 MiB
const ORIGIN = crypto.randomBytes(6).toString("hex"); // this server process

const docId = (userId, chatId) =>
  `${String(userId).replace(/[^\w.-]/g, "_")}__${String(chatId).replace(/[^\w.-]/g, "_")}`;

let db = null;
let unsubscribe = null;

/**
 * The newer copy wins. A chat with no updatedAt (from a page older than
 * this sync) counts as 0, so it never overwrites a stamped one, but between
 * two unstamped copies the incoming one wins, as the old overwrite did.
 */
export function newer(incoming, existing) {
  if (!existing) return true;
  const a = Number(incoming?.updatedAt) || 0;
  const b = Number(existing?.updatedAt) || 0;
  if (a !== b) return a > b;
  return !a && JSON.stringify(incoming) !== JSON.stringify(existing);
}

/**
 * Merges chats (and deletions) into one user's list, in place.
 * @param {{ chats: object[], deleted: Record<string, number> }} store
 * @param {object[]} incoming
 * @param {Array<string|{id:string,at:number}>} deleted
 * @returns {Array<object>} what changed: chats, or {id, deleted:true, updatedAt}
 */
export function mergeInto(store, incoming = [], deleted = []) {
  const byId = new Map(store.chats.map((c) => [c.id, c]));
  const changed = [];
  for (const d of deleted) {
    const id = typeof d === "string" ? d : d?.id;
    const at = (typeof d === "object" && Number(d.at)) || Date.now();
    if (!id || (store.deleted[id] && store.deleted[id] >= at)) continue;
    const cur = byId.get(id);
    // A delete older than the last edit of that chat loses to the edit.
    if (cur && (Number(cur.updatedAt) || 0) > at) continue;
    byId.delete(id);
    store.deleted[id] = at;
    changed.push({ id, deleted: true, updatedAt: at });
  }
  for (const c of incoming) {
    if (!c?.id) continue;
    const tomb = store.deleted[c.id];
    if (tomb && (Number(c.updatedAt) || 0) <= tomb) continue;
    if (tomb) delete store.deleted[c.id]; // edited after the delete: back it comes
    if (newer(c, byId.get(c.id))) {
      byId.set(c.id, c);
      changed.push(c);
    }
  }
  store.chats = [...byId.values()].sort((a, b) => String(b.id).localeCompare(String(a.id)));
  return changed;
}

/* ── Firestore ─────────────────────────────────────────────────── */

// Big attachments (images as base64) would blow the 1 MiB document limit;
// the synced copy drops them, the local one keeps them.
function serialise(chat) {
  let json = JSON.stringify(chat);
  if (json.length <= MAX_DOC_BYTES) return json;
  const slim = {
    ...chat,
    messages: (chat.messages || []).map((m) =>
      m.attachments
        ? { ...m, attachments: m.attachments.map(({ base64, dataUrl, ...a }) => ({ ...a, omitted: true })) }
        : m,
    ),
  };
  json = JSON.stringify(slim);
  return json.length <= MAX_DOC_BYTES ? json : null;
}

/** Push changed chats / tombstones for one user. Fire and forget. */
export function push(userId, changes) {
  if (!db || !changes?.length) return;
  const batch = db.batch();
  let n = 0;
  for (const c of changes) {
    const ref = db.collection(COLLECTION).doc(docId(userId, c.id));
    if (c.deleted) {
      batch.set(ref, { userId, chatId: c.id, deleted: true, updatedAt: c.updatedAt, json: "", origin: ORIGIN });
    } else {
      const json = serialise(c);
      if (!json) {
        console.warn(`[chat-sync] chat ${c.id} is too big to sync`);
        continue;
      }
      batch.set(ref, { userId, chatId: c.id, deleted: false, updatedAt: Number(c.updatedAt) || Date.now(), json, origin: ORIGIN });
    }
    if (++n >= 450) break; // a batch holds 500 writes
  }
  if (n) batch.commit().catch((e) => console.warn("[chat-sync] push failed:", e.message));
}

/**
 * Start syncing. Resolves once the first snapshot has been merged in.
 * @param {object} opts
 * @param {() => Record<string, {chats, deleted}>} opts.stores  all users' stores
 * @param {(userId: string, changes: object[]) => void} opts.onRemote  called
 *        after a change from another server was merged: persist and notify.
 * @param {(userId: string) => string} [opts.userFor]  which local list a
 *        remote chat belongs in (server.js folds every name into the owner's).
 */
export async function startChatSync({ stores, onRemote, userFor = (u) => u }) {
  if (!initCloud()) return false;
  db = getDb();
  const col = db.collection(COLLECTION);

  // One-time move from the old whole-file backup (aria_state/chats), so a
  // fresh Render disk doesn't start empty once chats leave that backup.
  let first = true;
  const ready = new Promise((resolve) => {
    unsubscribe = col.onSnapshot(
      async (snap) => {
        const byUser = new Map();
        for (const ch of snap.docChanges()) {
          if (ch.type === "removed") continue;
          const d = ch.doc.data();
          if (!first && d.origin === ORIGIN) continue; // our own write coming back
          const key = userFor(d.userId);
          if (!byUser.has(key)) byUser.set(key, { chats: [], deleted: [] });
          const u = byUser.get(key);
          if (d.deleted) u.deleted.push({ id: d.chatId, at: d.updatedAt });
          else {
            try {
              u.chats.push(JSON.parse(d.json));
            } catch {}
          }
        }
        const all = stores();
        for (const [userId, u] of byUser) {
          all[userId] ||= { chats: [], deleted: {} };
          const changed = mergeInto(all[userId], u.chats, u.deleted);
          if (changed.length) onRemote(userId, changed);
        }
        if (first) {
          first = false;
          await seed(col, snap.empty, stores, onRemote, userFor);
          resolve(true);
        }
      },
      (e) => {
        console.warn("[chat-sync] listener stopped:", e.message);
        resolve(false);
      },
    );
  });
  const ok = await ready;
  if (ok) console.log(`[chat-sync] chats sync across servers (Firestore ${COLLECTION})`);
  return ok;
}

// First run on this project: bring in the old single-document backup, then
// upload whatever this server has that the collection doesn't.
async function seed(col, empty, stores, onRemote, userFor) {
  const all = stores();
  if (empty) {
    try {
      const legacy = await db.collection("aria_state").doc("chats").get();
      const json = legacy.exists ? legacy.data()?.json : null;
      if (typeof json === "string") {
        for (const [name, chats] of Object.entries(JSON.parse(json))) {
          if (!Array.isArray(chats)) continue;
          const userId = userFor(name);
          all[userId] ||= { chats: [], deleted: {} };
          const changed = mergeInto(all[userId], chats, []);
          if (changed.length) onRemote(userId, changed);
        }
        console.log("[chat-sync] imported chats from the old aria_state backup");
      }
    } catch (e) {
      console.warn("[chat-sync] legacy import failed:", e.message);
    }
  }
  // Anything local the collection hasn't seen goes up once.
  const have = new Set((await col.select("userId", "chatId").get()).docs.map((d) => d.id));
  for (const [userId, store] of Object.entries(all)) {
    push(userId, store.chats.filter((c) => !have.has(docId(userId, c.id))));
  }
}

export function stopChatSync() {
  unsubscribe?.();
  unsubscribe = null;
}
