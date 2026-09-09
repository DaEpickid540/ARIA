// installApp.js — install ARIA as a desktop app from inside ARIA.
//
// Chromium fires `beforeinstallprompt` when a page qualifies for installation
// and lets you defer that prompt to a moment of your choosing. Without this,
// the only way in is a menu item in the browser's own chrome that most people
// never look for — the app was installable and nobody could tell.
//
// The event does not fire when the app is already installed, when the manifest
// or the service worker fail their checks, or on Safari and Firefox, so the
// button is hidden by default and only ever appears if the browser offers.

let deferredPrompt = null;

const btn = () => document.getElementById("installAppBtn");

function show() {
  const el = btn();
  if (el) el.hidden = false;
}

function hide() {
  const el = btn();
  if (el) el.hidden = true;
}

/** Already running as the installed app? Then there is nothing to install. */
function isStandalone() {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    window.matchMedia?.("(display-mode: minimal-ui)").matches ||
    window.navigator.standalone === true
  );
}

export function initInstallApp() {
  if (isStandalone()) return;

  window.addEventListener("beforeinstallprompt", (e) => {
    // Chromium shows its own mini-infobar unless this is cancelled; the point
    // is to move the offer into the app's own header instead.
    e.preventDefault();
    deferredPrompt = e;
    show();
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    hide();
    window.ARIA_showNotification?.("ARIA installed — it now opens in its own window.");
  });

  btn()?.addEventListener("click", async () => {
    if (!deferredPrompt) return;
    const el = btn();
    if (el) el.disabled = true;
    try {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      // The captured event is single-use whatever the answer; declining means
      // the browser will offer again on a later visit.
      deferredPrompt = null;
      if (outcome === "accepted") hide();
    } catch {
      /* prompt already consumed or dismissed by the browser */
    } finally {
      if (el) el.disabled = false;
    }
  });
}
