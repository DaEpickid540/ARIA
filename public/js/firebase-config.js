// firebase-config.js — the personal-suite Firebase project ARIA signs in with
//
// Same project as GRIND, hardware-tracker and proxvocx, so one Google account
// is one user ID (ARIA_OWNER_UID) across all of them.
//
// Nothing here is secret: the web API key only names the project. The server
// imports this file too (lib/auth.js), so the project it checks sign-in
// tokens against can never drift from the one the page signs in to.

export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyAtRLYEN30W1eL4EwiRGN4x_oOzI-HlJZQ",
  authDomain: "personal-suite-ca587.firebaseapp.com",
  databaseURL: "https://personal-suite-ca587-default-rtdb.firebaseio.com",
  projectId: "personal-suite-ca587",
  appId: "1:894530323591:web:7eaa581c5d2b4474fc6422",
};
