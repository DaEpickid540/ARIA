// lock.js  — ARIA unlock flow: lock → homepage → chat
// Flow: unlock() shows homepageScreen, wires all nav buttons, lazy-loads chat on demand.

// ── Global error capture ─────────────────────────────────────
// Catch uncaught errors and unhandled promise rejections so they show up
// in the console with context instead of disappearing silently.
window.addEventListener("error", (e) => {
  console.error(
    `[ARIA] Uncaught error in ${e.filename}:${e.lineno}:${e.colno}`,
    e.error || e.message,
  );
});
window.addEventListener("unhandledrejection", (e) => {
  console.error("[ARIA] Unhandled promise rejection:", e.reason);
});

// ── Online/offline indicator ─────────────────────────────────
window.addEventListener("offline", () => {
  console.warn("[ARIA] Network offline — ARIA will use cached assets only.");
});
window.addEventListener("online", () => {
  console.log("[ARIA] Network back online.");
});

const USERS = [{ id: "sarvin", password: "727846" }];

// ── Session expiry ───────────────────────────────────────────
// Any /api call answered 401 means the server-side session is gone (key
// rotated, cookie expired). Put the lock screen back up instead of letting
// every panel fail silently.
const _origFetch = window.fetch.bind(window);
window.fetch = async (...args) => {
  const res = await _origFetch(...args);
  if (res.status === 401) {
    try {
      const url = String(args[0]?.url || args[0] || "");
      if (url.includes("/api/") && !url.includes("/api/auth/")) relock();
    } catch {}
  }
  return res;
};

function relock(msg = "SESSION EXPIRED — ENTER ACCESS CODE") {
  const lockScreen = document.getElementById("lockScreen");
  if (!lockScreen || lockScreen.style.display === "flex") return;
  lockScreen.style.display = "flex";
  const hp = document.getElementById("homepageScreen");
  const lay = document.getElementById("layout");
  if (hp) hp.style.display = "none";
  if (lay) lay.style.display = "none";
  const err = document.getElementById("lockError");
  if (err) err.textContent = msg;
  document.getElementById("passwordInput")?.focus();
}

let _buttonsWired = false;
let _modulesLoaded = false;

/* ── expose early so main.js can call after its boot sequence ── */
window.ARIA_wireConsoleButtons = wireConsoleButtons;
window.ARIA_loadChatModules = loadChatModules;
window.ARIA_enterConsole = enterConsole; // used by homepage quick-mode buttons

window.addEventListener("DOMContentLoaded", () => {
  const lockScreen = document.getElementById("lockScreen");
  const homepageScreen = document.getElementById("homepageScreen");
  const layout = document.getElementById("layout");
  const userIdInput = document.getElementById("userIdInput");
  const passwordInput = document.getElementById("passwordInput");
  const unlockBtn = document.getElementById("unlockBtn");
  const lockError = document.getElementById("lockError");

  // Ensure correct initial visibility
  if (lockScreen) lockScreen.style.display = "flex";
  if (homepageScreen) homepageScreen.style.display = "none";
  if (layout) layout.style.display = "none";

  let failedAttempts = 0;
  let lockedUntil = 0;

  async function unlock() {
    const now = Date.now();
    if (now < lockedUntil) {
      const secs = Math.ceil((lockedUntil - now) / 1000);
      if (lockError) lockError.textContent = `LOCKED — retry in ${secs}s`;
      return;
    }

    const enteredId = (
      (userIdInput?.value || "sarvin").trim() || "sarvin"
    ).toLowerCase();
    const enteredPass = (passwordInput?.value || "").trim();

    if (!enteredPass) {
      if (lockError) lockError.textContent = "ACCESS CODE REQUIRED";
      return;
    }

    // The server decides when it has ARIA_ACCESS_KEY set (lib/auth.js) and
    // sets an HttpOnly session cookie. The in-page USERS list below is only
    // consulted when the server says auth is not configured — it was never
    // real security, since this file is public.
    let serverUser = null;
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: enteredId, key: enteredPass }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.status === 429) {
        if (lockError)
          lockError.textContent = "TOO MANY ATTEMPTS — SERVER LOCKED 15 MIN";
        return;
      }
      if (d.ok && !d.authDisabled) serverUser = { id: enteredId };
      else if (!d.ok) {
        failedAttempts++;
        if (lockError)
          lockError.textContent = "INVALID ACCESS CODE — ACCESS DENIED";
        if (passwordInput) passwordInput.value = "";
        checkLockout();
        return;
      }
    } catch {
      // Server unreachable — fall through to the offline check.
    }

    const user =
      serverUser || USERS.find((u) => u.id.toLowerCase() === enteredId);
    if (!user) {
      failedAttempts++;
      if (lockError)
        lockError.textContent = `UNKNOWN USER: "${enteredId.toUpperCase()}"`;
      checkLockout();
      return;
    }
    if (!serverUser && user.password !== enteredPass) {
      failedAttempts++;
      if (lockError)
        lockError.textContent = "INVALID ACCESS CODE — ACCESS DENIED";
      if (passwordInput) passwordInput.value = "";
      checkLockout();
      return;
    }

    // ── SUCCESS ──
    failedAttempts = 0;
    if (lockError) lockError.textContent = "";
    window.ARIA_userId = user.id;

    if (lockScreen) lockScreen.style.display = "none";
    if (passwordInput) passwordInput.value = "";
    if (userIdInput) userIdInput.value = "";

    // ── Show homepage and init it ──
    const hp = document.getElementById("homepageScreen");
    if (hp) {
      hp.style.display = "flex";
      hp.style.opacity = "1";
    }

    try {
      const { initHomepage } = await import("./homepage.js");
      initHomepage();
    } catch (err) {
      console.error("[ARIA] Homepage init failed:", err);
    }

    // Wire all nav buttons
    wireConsoleButtons();
  }

  function checkLockout() {
    if (failedAttempts >= 5) {
      lockedUntil = Date.now() + 30_000;
      failedAttempts = 0;
      if (lockError) lockError.textContent = "TOO MANY ATTEMPTS — LOCKED 30s";
    }
  }

  unlockBtn?.addEventListener("click", unlock);
  passwordInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") unlock();
  });
  userIdInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") passwordInput?.focus();
  });

  // Auto-focus
  setTimeout(() => (userIdInput || passwordInput)?.focus(), 80);
});

/* ── Wire Enter / Home / Lock buttons — idempotent ── */
function wireConsoleButtons() {
  if (_buttonsWired) return;
  _buttonsWired = true;

  const hp = () => document.getElementById("homepageScreen");
  const lay = () => document.getElementById("layout");
  const lk = () => document.getElementById("lockScreen");

  // Expose enter for homepage quick-mode buttons
  window.ARIA_enterConsole = enterConsole;

  document
    .getElementById("enterConsoleBtn")
    ?.addEventListener("click", enterConsole);

  document.getElementById("goHomeBtn")?.addEventListener("click", () => {
    const l = lay();
    if (l) l.style.display = "none";
    const h = hp();
    if (h) {
      h.style.display = "flex";
      h.style.opacity = "1";
    }
  });

  document.getElementById("goLockBtn")?.addEventListener("click", () => {
    const l = lay();
    if (l) l.style.display = "none";
    const h = hp();
    if (h) h.style.display = "none";
    const lkEl = lk();
    if (lkEl) lkEl.style.display = "flex";
    // Locking ends the server session too, so the lock screen is not just a curtain.
    fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
  });
}

async function enterConsole() {
  const hp = document.getElementById("homepageScreen");
  const lay = document.getElementById("layout");
  if (!lay) return;
  if (hp) hp.style.display = "none";
  lay.style.display = "flex";
  await loadChatModules();
}

async function loadChatModules() {
  if (_modulesLoaded) return;
  _modulesLoaded = true;
  const mods = [
    "./chat.js",
    "./ui.js",
    "./tools.js",
    "./tts.js",
    "./vtt.js",
    "./settings.js",
    "./personality.js",
  ];
  try {
    for (const m of mods) await import(m);
    // Optional modules — don't crash if missing
    const optionals = ["./pages.js", "./callEngine.js", "./voiceControls.js"];
    for (const m of optionals) {
      try {
        const mod = await import(m);
        if (m.includes("callEngine") && mod.initCallEngine)
          mod.initCallEngine();
        if (m.includes("voiceControls") && mod.initVoiceControls)
          mod.initVoiceControls();
      } catch {}
    }
    // ── Init settings (wires TTS, VTT, theme, all controls) ──
    const { initSettings } = await import("./settings.js");
    initSettings();

    // ── New standalone settings button (independent of old wireAllControls) ──
    try {
      const { initSettingsBtn } = await import("./settingsBtn.js");
      initSettingsBtn();
    } catch (e) {
      console.warn("[ARIA] settingsBtn init failed:", e);
    }

    // ── New feature modules ──
    try {
      const { initShortcuts } = await import("./shortcuts.js");
      initShortcuts();
    } catch {}
    try {
      const { initChatExport } = await import("./chatExport.js");
      initChatExport();
    } catch {}
    try {
      const { initAmbient } = await import("./ambient.js");
      initAmbient();
    } catch {}
    try {
      const { initClaw } = await import("./claw.js");
      initClaw();
    } catch {}
    try {
      const { initTaskPanel } = await import("./taskPanel.js");
      initTaskPanel();
    } catch {}
    try {
      const { initInstallApp } = await import("./installApp.js");
      initInstallApp();
    } catch {}

    // ── Apply version stamp ──
    try {
      const { applyVersion } = await import("./version.js");
      applyVersion();
    } catch {}

    console.log("[ARIA] All chat modules loaded ✓");
  } catch (err) {
    console.error("[ARIA] Module load error:", err);
  }
}
