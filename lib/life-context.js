// lib/life-context.js — read-only cross-app context for ARIA
// ═══════════════════════════════════════════════════════════════════
//
// WHY THIS EXISTS
//   ARIA, GRIND, and hardware-tracker share one Firestore project
//   (personal-suite) but were three independent apps. This module lets ARIA
//   read GRIND's fitness/habit state and hardware-tracker's inventory so it
//   can answer "what's my streak", "have I checked in today", or "what do I
//   need to wire an 18650 to an ESP32" using real data instead of asking the
//   user to repeat themselves. See ../../personal-suite-schema.md §5 for the
//   full dependency map this implements.
//
// READ-ONLY, ADMIN SDK ONLY
//   Uses the same Firestore connection as lib/cloud-sync.js (reused via
//   getDb(), not a second Admin app). This bypasses Firestore rules the way
//   any Admin SDK call does — that's expected and safe here because nothing
//   this module reads is ever written back, and no browser client can reach
//   this code path.
//
// SINGLE-USER MODEL
//   ARIA has no Firebase Auth of its own — set ARIA_OWNER_UID to the
//   canonical personal-suite UID (per MIGRATION.md §3, the GRIND UID) once
//   it's known. Without it, this module no-ops exactly like cloud-sync does
//   without FIREBASE_SERVICE_ACCOUNT — safe to deploy before it's set.
// ═══════════════════════════════════════════════════════════════════

import { cloudEnabled, getDb } from "./cloud-sync.js";

let cached = "";

function ownerUid() {
  return process.env.ARIA_OWNER_UID || null;
}

export function lifeContextEnabled() {
  return cloudEnabled() && !!ownerUid();
}

function fmtInventory(items, categories, subcategories) {
  if (!items.length) return "The user's hardware inventory is empty.";
  const catName = new Map(categories.map((c) => [c.id, c.name]));
  const subName = new Map(subcategories.map((c) => [c.id, c.name]));
  const byCategory = new Map();
  for (const item of items) {
    const label = catName.get(item.categoryId) || "Uncategorized";
    if (!byCategory.has(label)) byCategory.set(label, []);
    const sub = subName.get(item.subcategoryId);
    byCategory.get(label).push(sub ? `${item.name} (${sub})` : item.name);
  }
  return [...byCategory.entries()]
    .map(([cat, names]) => `- ${cat}: ${names.join(", ")}`)
    .join("\n");
}

function fmtGrind(profile, checkins, skills) {
  if (!profile) return "";
  const lines = [];
  lines.push(`Level ${profile.level ?? 1}, ${profile.xp ?? 0} XP, ${profile.streak ?? 0}-day streak` +
    (profile.longestStreak ? ` (longest: ${profile.longestStreak})` : ""));
  lines.push(profile.lastCheckIn === new Date().toISOString().split("T")[0]
    ? "Checked in today." : `Last check-in: ${profile.lastCheckIn || "never"}.`);
  if (checkins.length) {
    lines.push(`Recent check-ins: ${checkins.map((c) => c.date).join(", ")}.`);
  }
  if (skills.length) {
    lines.push("Skills: " + skills.map((s) => `${s.name} (Lv.${s.level ?? 1})`).join(", "));
  }
  return lines.join("\n");
}

// Pull a bounded snapshot of GRIND + hardware-tracker state and cache it as
// a formatted string, ready to splice into a system prompt. Call this once
// at boot and again on an interval — never inline in the hot request path,
// so a slow Firestore read never adds latency to a chat reply.
export async function refreshLifeContext() {
  if (!lifeContextEnabled()) return;
  const db = getDb();
  const uid = ownerUid();

  try {
    const [profileSnap, checkinsSnap, skillsSnap, itemsSnap, categoriesSnap, subcategoriesSnap] =
      await Promise.all([
        db.collection("grind_users").doc(uid).get(),
        db.collection("grind_users").doc(uid).collection("checkins")
          .orderBy("timestamp", "desc").limit(7).get(),
        db.collection("grind_users").doc(uid).collection("skills").get(),
        db.collection("hw_items").where("uid", "==", uid).get(),
        db.collection("hw_categories").where("uid", "==", uid).get(),
        db.collection("hw_subcategories").where("uid", "==", uid).get(),
      ]);

    const profile = profileSnap.exists ? profileSnap.data() : null;
    const checkins = checkinsSnap.docs.map((d) => ({ date: d.id, ...d.data() }));
    const skills = skillsSnap.docs.map((d) => d.data());
    const items = itemsSnap.docs.map((d) => d.data());
    const categories = categoriesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const subcategories = subcategoriesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    const grindBlock = fmtGrind(profile, checkins, skills);
    const invBlock = fmtInventory(items, categories, subcategories);

    cached = [
      "\n\n[LIFE CONTEXT — read from GRIND (fitness) and hardware-tracker (inventory), current as of last sync:",
      grindBlock ? `GRIND:\n${grindBlock}` : "GRIND: no profile yet.",
      `Hardware inventory:\n${invBlock}`,
      "Use this naturally when relevant; don't recite it unprompted.]",
    ].join("\n\n");
  } catch (e) {
    console.warn("[life-context] refresh failed:", e.message);
    // Keep serving the last good snapshot rather than blanking it on a
    // transient read failure.
  }
}

export function buildLifeContext() {
  return cached;
}
