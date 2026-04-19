// lock.js  — ARIA unlock flow: lock → homepage → chat
// Flow: unlock() shows homepageScreen, wires all nav buttons, lazy-loads chat on demand.

const USERS = [{ id: "sarvin", password: "727846" }];

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

    const user = USERS.find((u) => u.id.toLowerCase() === enteredId);
    if (!user) {
      failedAttempts++;
      if (lockError)
        lockError.textContent = `UNKNOWN USER: "${enteredId.toUpperCase()}"`;
      checkLockout();
      return;
    }
    if (user.password !== enteredPass) {
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
    // ── Init settings (wires settingsBtn, TTS, VTT, all controls) ──
    const { initSettings } = await import("./settings.js");
    initSettings();

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
