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
  return _fb;
}

/** The Google account Firebase already remembers here, or null. */
export async function currentGoogleUser() {
  const { auth } = await firebase();
  return auth.currentUser;
}

async function exchange(user) {
  const idToken = await user.getIdToken();
  const r = await fetch("/api/auth/google", {
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
    // The wrong account stays signed in otherwise, and the next click would
    // try it again without offering the account chooser.
    if (e.code === "not_owner" || e.code === "not_google") await sdk.signOut(auth);
    throw e;
  }
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
  if (d.error === "not_owner")
    return `${d.email || "That account"} isn't ARIA's owner.`;
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
