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
// rotated, cookie expired, server restarted). With a Google session still in
// this browser, swap it for a new cookie and replay the request; otherwise
// put the lock screen back up instead of letting every panel fail silently.
let _googleOn = false; // set from /api/auth/status once the page loads
let _renewing = null;
function renewGoogleSession() {
  _renewing ||= import("./googleAuth.js")
    .then((m) => m.renewSession())
    .catch(() => false)
    .finally(() => setTimeout(() => (_renewing = null), 0));
  return _renewing;
}

const _origFetch = window.fetch.bind(window);
window.fetch = async (...args) => {
  const res = await _origFetch(...args);
  if (res.status === 401) {
    try {
      const url = String(args[0]?.url || args[0] || "");
      if (url.includes("/api/") && !url.includes("/api/auth/")) {
        if (_googleOn && (await renewGoogleSession())) return _origFetch(...args);
        relock();
      }
    } catch {}
  }
  return res;
};

function relock(msg = "Your session ended. Sign in again.") {
  const lockScreen = document.getElementById("lockScreen");
  if (!lockScreen || lockScreen.style.display === "flex") return;
  lockScreen.style.display = "flex";
  showLockStep("signin");
  const hp = document.getElementById("homepageScreen");
  const lay = document.getElementById("layout");
  if (hp) hp.style.display = "none";
  if (lay) lay.style.display = "none";
  const err = document.getElementById("lockError");
  if (err) err.textContent = msg;
  document.getElementById("passwordInput")?.focus();
}

// The lock card has two steps: sign in, and pair a Google account that
// isn't an owner yet (lib/owners.js).
function showLockStep(step) {
  const signIn = document.getElementById("lockStepSignIn");
  const pair = document.getElementById("lockStepPair");
  if (signIn) signIn.hidden = step !== "signin";
  if (pair) pair.hidden = step !== "pair";
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
      if (lockError) lockError.textContent = `Too many tries. Wait ${secs}s.`;
      return;
    }

    const enteredId = (
      (userIdInput?.value || "sarvin").trim() || "sarvin"
    ).toLowerCase();
    const enteredPass = (passwordInput?.value || "").trim();

    if (!enteredPass) {
      if (lockError) lockError.textContent = "Enter your access code.";
      passwordInput?.focus();
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
          lockError.textContent = "Too many tries. Sign-in is paused for 15 minutes.";
        return;
      }
      if (d.ok && !d.authDisabled) serverUser = { id: enteredId };
      else if (!d.ok) {
        failedAttempts++;
        if (lockError)
          lockError.textContent = "That access code isn't right.";
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
        lockError.textContent = `There's no user called "${enteredId}".`;
      checkLockout();
      return;
    }
    if (!serverUser && user.password !== enteredPass) {
      failedAttempts++;
      if (lockError)
        lockError.textContent = "That access code isn't right.";
      if (passwordInput) passwordInput.value = "";
      checkLockout();
      return;
    }

    failedAttempts = 0;
    await finishUnlock(user.id);
  }

  // ── SUCCESS (either door) ──
  async function finishUnlock(userId) {
    if (lockError) lockError.textContent = "";
    window.ARIA_userId = userId;

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
      if (lockError) lockError.textContent = "Too many tries. Wait 30s.";
    }
  }

  unlockBtn?.addEventListener("click", unlock);
  passwordInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") unlock();
  });
  userIdInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") passwordInput?.focus();
  });

  // ── Google door ──
  const googleBtn = document.getElementById("googleSignInBtn");
  const googleLabel = document.getElementById("googleSignInLabel");
  const switchLink = document.getElementById("googleSwitchAccount");
  const keyForm = document.getElementById("lockKeyForm");

  const lockSub = document.getElementById("lockSub");
  const pairInput = document.getElementById("lockPairInput");
  const pairBtn = document.getElementById("lockPairBtn");
  const pairEmail = document.getElementById("lockPairEmail");

  // Which doors this server has decides the line under the heading.
  function describeDoors(google, key) {
    if (!lockSub) return;
    lockSub.textContent = google && key
      ? "Sign in with Google, or use your access code."
      : google
        ? "Sign in with any Google account paired to your ARIA."
        : "Enter your access code to continue.";
  }

  async function showGoogleAccount() {
    try {
      const { currentGoogleUser } = await import("./googleAuth.js");
      const u = await currentGoogleUser();
      if (googleLabel) googleLabel.textContent = u?.email ? `Continue as ${u.email}` : "Continue with Google";
      if (switchLink) switchLink.hidden = !u;
    } catch (e) {
      console.warn("[ARIA] Google sign-in unavailable:", e);
    }
  }

  // Every owner account (sarvinsukhe@, sarvin.sukhe@…) is the same person:
  // one chat list, the one the app has always used. Filing chats under each
  // email's name split them into separate histories.
  const enterAsOwner = () => finishUnlock("sarvin");

  function askToPair(email) {
    if (pairEmail) pairEmail.textContent = email || "This account";
    if (lockError) lockError.textContent = "";
    showLockStep("pair");
    if (pairInput) {
      pairInput.value = "";
      pairInput.focus();
    }
  }

  googleBtn?.addEventListener("click", async () => {
    googleBtn.disabled = true;
    if (lockError) lockError.textContent = "";
    try {
      const { signInWithGoogle } = await import("./googleAuth.js");
      await signInWithGoogle();
      await enterAsOwner();
    } catch (e) {
      if (e.code === "not_owner" || e.code === "owner_unset") askToPair(e.detail?.email);
      else if (lockError) lockError.textContent = e.message || "Sign-in failed.";
    } finally {
      googleBtn.disabled = false;
      showGoogleAccount();
    }
  });

  // The code box: capitals, the look-alikes folded (O→Q, I/L/1→J, U→V, the
  // same as lib/owners.js), and a dash after four.
  const CODE_CHARS = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
  const cleanCode = (s) =>
    String(s || "")
      .toUpperCase()
      .replace(/[IL1]/g, "J")
      .replace(/[O0]/g, "Q")
      .replace(/U/g, "V")
      .split("")
      .filter((c) => CODE_CHARS.includes(c))
      .join("")
      .slice(0, 8);
  pairInput?.addEventListener("input", () => {
    const c = cleanCode(pairInput.value);
    pairInput.value = c.length > 4 ? `${c.slice(0, 4)}-${c.slice(4)}` : c;
    if (pairBtn) pairBtn.disabled = c.length !== 8;
  });
  pairInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") pairBtn?.click();
  });
  if (pairBtn) pairBtn.disabled = true;

  pairBtn?.addEventListener("click", async () => {
    const code = cleanCode(pairInput?.value);
    if (code.length !== 8) return;
    pairBtn.disabled = true;
    pairBtn.textContent = "Pairing…";
    if (lockError) lockError.textContent = "";
    try {
      const { pairAccount } = await import("./googleAuth.js");
      await pairAccount(code);
      showLockStep("signin");
      await enterAsOwner();
    } catch (e) {
      if (lockError) lockError.textContent = e.message || "Pairing failed.";
      pairBtn.disabled = false;
    } finally {
      pairBtn.textContent = "Pair and continue";
    }
  });

  async function useAnotherAccount(e) {
    e?.preventDefault();
    const { signOutGoogle } = await import("./googleAuth.js");
    await signOutGoogle();
    if (lockError) lockError.textContent = "";
    showLockStep("signin");
    await showGoogleAccount();
    googleBtn?.focus();
  }
  switchLink?.addEventListener("click", useAnotherAccount);
  document.getElementById("lockPairBack")?.addEventListener("click", useAnotherAccount);

  if (window.ARIA_SITE) {
    // The Firebase site: Google is the only door (no cookie can cross to the
    // server), and the brain picker says which server this page talks to.
    _googleOn = true;
    if (googleBtn) googleBtn.hidden = false;
    if (keyForm) keyForm.hidden = true;
    describeDoors(true, false);
    googleBtn?.focus();
    import("./googleAuth.js").then((m) => m.initGoogle()).then(showGoogleAccount).catch(() => {});
    wireBrainPicker();
  } else {
    // The server says which doors exist. Google only → hide the key form; key
    // only (or nothing configured) → the lock screen stays as it always was.
    fetch("/api/auth/status")
      .then((r) => r.json())
      .then((s) => {
        _googleOn = !!s.methods?.google;
        describeDoors(_googleOn, !_googleOn || !!s.methods.key);
        if (!_googleOn) return;
        if (googleBtn) googleBtn.hidden = false;
        if (keyForm && !s.methods.key) keyForm.hidden = true;
        if (!s.methods.key) googleBtn?.focus();
        showGoogleAccount();
      })
      .catch(() => {});
  }

  async function wireBrainPicker() {
    const brain = window.ARIA_brain;
    const wrap = document.getElementById("brainPick");
    const sel = document.getElementById("brainSelect");
    const state = document.getElementById("brainState");
    if (!brain || !wrap || !sel) return;
    sel.innerHTML =
      `<option value="">Automatic</option>` +
      brain.list.map((b) => `<option value="${b.url}">${b.label}</option>`).join("");
    const cur = await brain.ready;
    sel.value = brain.pinned ? cur.url : "";
    if (state) state.textContent = brain.pinned ? "" : `(${cur.label})`;
    wrap.hidden = false;
    sel.addEventListener("change", () => brain.choose(sel.value || null));
  }

  // The lock screen shows before the chat modules (which normally stamp it).
  import("./version.js").then((m) => m.applyVersion()).catch(() => {});
  // Settings opens from the home screen too, before the chat modules load.
  import("./keysPanel.js").then((m) => m.initKeysPanel()).catch(() => {});
  import("./accountsPanel.js").then((m) => m.initAccountsPanel()).catch(() => {});

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
    showLockStep("signin");
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
        if (m.includes("pages") && mod.initPages) mod.initPages();
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
    try {
      const { initModelSwitcher } = await import("./modelSwitcher.js");
      initModelSwitcher();
    } catch (e) {
      console.warn("[ARIA] model switcher init failed:", e);
    }

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
