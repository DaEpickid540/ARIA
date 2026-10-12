// googleAuth.js — Google sign-in for the lock screen (Firebase Auth)
//
// Firebase keeps the Google session in this browser; the server only ever
// sees a short-lived ID token, which /api/auth/google swaps for ARIA's usual
// session cookie (see lib/auth.js). So:
//   - first time: a Google popup, then in;
//   - after that: one click, no popup (Firebase restores the session);
//   - cookie lost (server restarted): renewSession() swaps a fresh token
//     for a fresh cookie behind the scenes.
//
// The SDK is loaded on first use, from the same gstatic build proxvocx uses,
// so a locked-down server with no Google login never downloads it.

import { FIREBASE_CONFIG } from "./firebase-config.js";

const SDK = "https://www.gstatic.com/firebasejs/10.12.5";
// On the Firebase site (apiBase.js) the server is another origin: no cookie,
// the ID token rides on every request instead.
const SITE = !!window.ARIA_SITE;

let _fb = null; // { auth, sdk }

async function firebase() {
  if (_fb) return _fb;
  const [appSdk, authSdk] = await Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-auth.js`),
  ]);
  const app = appSdk.initializeApp(FIREBASE_CONFIG, "aria");
  const auth = authSdk.getAuth(app);
  try {
    await authSdk.setPersistence(auth, authSdk.browserLocalPersistence);
  } catch {
    /* private windows refuse; sign-in still works for this tab */
  }
  await auth.authStateReady();
  _fb = { auth, sdk: authSdk };
  // For apiBase.js. getIdToken() refreshes the token itself when it's due.
  window.ARIA_getIdToken = () => auth.currentUser?.getIdToken() ?? null;
  return _fb;
}

/** Loads Firebase and restores a remembered sign-in (site mode needs it early). */
export const initGoogle = () => firebase();

/** The Google account Firebase already remembers here, or null. */
export async function currentGoogleUser() {
  const { auth } = await firebase();
  return auth.currentUser;
}

async function exchange(user) {
  const idToken = await user.getIdToken();
  const r = SITE
    ? // apiBase.js adds the token; this only asks whether it's accepted.
      await fetch("/api/auth/me")
    : await fetch("/api/auth/google", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      });
  const d = await r.json().catch(() => ({}));
  if (r.ok && d.ok) return d;
  const err = new Error(describeServerError(r.status, d));
  err.code = d.error || `http_${r.status}`;
  err.detail = d;
  throw err;
}

/**
 * Signs in (popup only if Firebase has no Google session yet) and gets the
 * server session cookie. Resolves { email }.
 */
export async function signInWithGoogle() {
  const { auth, sdk } = await firebase();
  let user = auth.currentUser;
  if (!user) {
    const provider = new sdk.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    try {
      user = (await sdk.signInWithPopup(auth, provider)).user;
    } catch (e) {
      const err = new Error(describeFirebaseError(e));
      err.code = e?.code;
      throw err;
    }
  }
  try {
    return await exchange(user);
  } catch (e) {
    // A non-Google login can never get in, so offer the chooser next time.
    // An account that isn't an owner stays signed in: the lock screen asks
    // it for a pairing code (pairAccount below).
    if (e.code === "not_google") await sdk.signOut(auth);
    throw e;
  }
}

/**
 * Makes the signed-in Google account an owner with a pairing code from
 * Settings ▸ Accounts (lib/owners.js), then signs in as usual.
 */
export async function pairAccount(code) {
  const { auth } = await firebase();
  const user = auth.currentUser;
  if (!user) throw new Error("Sign in with Google first.");
  const r = await fetch("/api/auth/pair", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, idToken: await user.getIdToken() }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.ok) {
    const err = new Error(describePairError(r.status, d));
    err.code = d.error || `http_${r.status}`;
    throw err;
  }
  return exchange(user);
}

function describePairError(status, d) {
  const map = {
    malformed: "A pairing code is 8 characters.",
    unknown: "That code doesn't exist. Check it, or make a new one.",
    used: "That code has already been used. Make a new one.",
    expired: "That code has expired. Make a new one.",
    locked: "Too many wrong codes. Try again in 15 minutes.",
    invalid_token: "Your Google sign-in expired. Use a different account, then sign in again.",
    not_google: "Sign in with a Google account.",
  };
  if (map[d.error]) return map[d.error];
  if (SITE && status === 404) return "That ARIA server is older than this website. Update it (or pick the other brain).";
  return "Pairing failed.";
}

/**
 * Quietly gets a new session cookie from the remembered Google session.
 * Resolves true on success, false if there is nothing to renew from.
 */
export async function renewSession() {
  try {
    const user = await currentGoogleUser();
    if (!user) return false;
    await exchange(user);
    return true;
  } catch {
    return false;
  }
}

export async function signOutGoogle() {
  const { auth, sdk } = await firebase();
  await sdk.signOut(auth);
}

function describeServerError(status, d) {
  // The lock screen answers these two with the pairing step.
  if (d.error === "owner_unset" || d.error === "not_owner")
    return `${d.email || "That account"} isn't paired with ARIA yet.`;
  if (SITE && status === 404)
    return "That ARIA server is older than this website. Update it (or pick the other brain).";
  if (d.error === "not_google") return "Sign in with a Google account.";
  if (d.error === "invalid_token") return "Google sign-in expired — try again.";
  if (d.error === "google_disabled") return "Google sign-in isn't set up on this server.";
  if (status === 429) return "Too many attempts — locked for 15 minutes.";
  return "Sign-in failed.";
}

function describeFirebaseError(e) {
  const map = {
    "auth/popup-closed-by-user": "The Google window was closed.",
    "auth/popup-blocked": "The browser blocked the Google popup — allow popups for this site.",
    "auth/cancelled-popup-request": "Another sign-in is already open.",
    "auth/unauthorized-domain":
      "This site isn't an authorised domain in Firebase (Authentication ▸ Settings).",
    "auth/network-request-failed": "Couldn't reach Google. Check the connection.",
  };
  return map[e?.code] || e?.message || "Google sign-in failed.";
}
