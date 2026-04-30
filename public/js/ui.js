// ui.js — sidebar collapse, swipe gestures, keyboard fix, textarea resize

/* ── VOICE WAVE ── */
const voiceWave = document.getElementById("voiceWave");
if (voiceWave && !voiceWave.children.length)
  for (let i = 0; i < 6; i++)
    voiceWave.appendChild(document.createElement("span"));

/* ── KEYBOARD FIX (mobile) ── */
function fixVH() {
  const vh = window.visualViewport?.height ?? window.innerHeight;
  const lay = document.getElementById("layout");
  if (lay && window.innerWidth <= 768) lay.style.height = vh + "px";
}
window.visualViewport?.addEventListener("resize", fixVH);
window.visualViewport?.addEventListener("scroll", fixVH);
window.addEventListener("resize", fixVH);
fixVH();

/* ── DESKTOP SIDEBAR COLLAPSE ── */
const sidebar = document.getElementById("sidebar");
const collapseBtn = document.getElementById("sidebarCollapseBtn");
const collapseIcon = document.getElementById("sidebarCollapseIcon");
function isMobile() {
  return window.innerWidth <= 768;
}

function collapseSidebar() {
  if (isMobile()) return;
  sidebar?.classList.add("collapsed");
  if (collapseIcon) collapseIcon.textContent = "»»";
  localStorage.setItem("aria_sidebar_collapsed", "1");
}
function expandSidebar() {
  if (isMobile()) return;
  sidebar?.classList.remove("collapsed");
  if (collapseIcon) collapseIcon.textContent = "‹‹";
  localStorage.setItem("aria_sidebar_collapsed", "0");
}
collapseBtn?.addEventListener("click", () =>
  sidebar?.classList.contains("collapsed")
    ? expandSidebar()
    : collapseSidebar(),
);
if (!isMobile() && localStorage.getItem("aria_sidebar_collapsed") === "1") {
  sidebar?.classList.add("collapsed");
  if (collapseIcon) collapseIcon.textContent = "»»";
}
window.ARIA_collapseSidebar = collapseSidebar;
window.ARIA_expandSidebar = expandSidebar;

/* ── MOBILE SIDEBAR ── */
const overlay = document.getElementById("sidebarOverlay");
const mobileToggle = document.getElementById("sidebarToggleBtn");

function openMobileSidebar() {
  sidebar?.classList.add("open");
  overlay?.classList.add("active");
  if (mobileToggle) mobileToggle.textContent = "✕";
  document.body.style.overflow = "hidden";
}
function closeMobileSidebar() {
  sidebar?.classList.remove("open");
  overlay?.classList.remove("active");
  if (mobileToggle) mobileToggle.textContent = "Menu";
  document.body.style.overflow = "";
}
mobileToggle?.addEventListener("click", () =>
  sidebar?.classList.contains("open")
    ? closeMobileSidebar()
    : openMobileSidebar(),
);
overlay?.addEventListener("click", closeMobileSidebar);
window.addEventListener("resize", () => {
  if (!isMobile()) closeMobileSidebar();
});
window.ARIA_closeSidebar = () => {
  if (isMobile()) closeMobileSidebar();
};
window.ARIA_openSidebar = () => {
  if (isMobile()) openMobileSidebar();
  else expandSidebar();
};

/* ── SETTINGS BUTTONS — all wired here for reliability ── */
function _openSettingsOverlay() {
  if (typeof window.ARIA_openSettings === "function") {
    window.ARIA_openSettings();
  } else {
    document.getElementById("settingsOverlay")?.classList.add("active");
  }
}
function _closeSettingsOverlay() {
  if (typeof window.ARIA_closeSettings === "function") {
    window.ARIA_closeSettings();
  } else {
    document.getElementById("settingsOverlay")?.classList.remove("active");
  }
}

// Wire all three settings open buttons
document
  .getElementById("settingsBtn")
  ?.addEventListener("click", _openSettingsOverlay);
document
  .getElementById("ariaSettingsBtn")
  ?.addEventListener("click", _openSettingsOverlay);
document
  .getElementById("mobilSettingsBtn")
  ?.addEventListener("click", _openSettingsOverlay);

// Wire close button + backdrop
document
  .getElementById("settingsCloseBtn")
  ?.addEventListener("click", _closeSettingsOverlay);
document.getElementById("settingsOverlay")?.addEventListener("click", (e) => {
  if (e.target === e.currentTarget) _closeSettingsOverlay();
});

// Expose globally so other modules can call them
window.ARIA_showSettings = _openSettingsOverlay;
window.ARIA_hideSettings = _closeSettingsOverlay;

/* ── ESC KEY ── */
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeMobileSidebar();
    window.ARIA_closeCodePanel?.();
  }
});

/* ─────────────────────────────────────────────────────────────
   SWIPE GESTURES (mobile)
   • Swipe right from left edge  → open sidebar
   • Swipe left on open sidebar  → close sidebar
   • Swipe left from right edge  → open settings
   • Swipe up on messages area   → scroll up (native, no override needed)
───────────────────────────────────────────────────────────── */
let touchStartX = 0,
  touchStartY = 0,
  touchStartT = 0;
const SWIPE_THRESHOLD = 60; // px
const SWIPE_MAX_VERTICAL = 80; // reject if too much vertical drift
const EDGE_ZONE = 30; // px from screen edge to count as edge swipe

document.addEventListener(
  "touchstart",
  (e) => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    touchStartT = Date.now();
  },
  { passive: true },
);

document.addEventListener(
  "touchend",
  (e) => {
    if (!isMobile()) return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = Math.abs(e.changedTouches[0].clientY - touchStartY);
    const dt = Date.now() - touchStartT;
    if (dy > SWIPE_MAX_VERTICAL || dt > 500) return; // too slow or too vertical

    // Swipe right from left edge → open sidebar
    if (dx > SWIPE_THRESHOLD && touchStartX < EDGE_ZONE) {
      openMobileSidebar();
      return;
    }
    // Swipe left → close sidebar if open
    if (dx < -SWIPE_THRESHOLD && sidebar?.classList.contains("open")) {
      closeMobileSidebar();
      return;
    }
    // Swipe left from right edge → open settings panel
    if (dx < -SWIPE_THRESHOLD && touchStartX > window.innerWidth - EDGE_ZONE) {
      if (typeof window.ARIA_openSettings === "function")
        window.ARIA_openSettings();
      return;
    }
    // Swipe right from ~center when sidebar closed → open sidebar
    if (
      dx > SWIPE_THRESHOLD * 1.5 &&
      touchStartX < 80 &&
      !sidebar?.classList.contains("open")
    ) {
      openMobileSidebar();
      return;
    }
  },
  { passive: true },
);

/* Settings panel swipe-to-close (swipe right anywhere on settings panel) */
function wireSettingsPanelSwipe() {
  const panel = document.getElementById("settingsPanel");
  if (!panel || panel._swipeWired) return;
  panel._swipeWired = true;
  let spStartX = 0;
  panel.addEventListener(
    "touchstart",
    (e) => {
      spStartX = e.touches[0].clientX;
    },
    { passive: true },
  );
  panel.addEventListener(
    "touchend",
    (e) => {
      const dx = e.changedTouches[0].clientX - spStartX;
      if (dx > SWIPE_THRESHOLD) {
        document.getElementById("settingsCloseBtn")?.click();
      }
    },
    { passive: true },
  );
}
// Wire on load + re-wire if settings opens later
document.addEventListener("DOMContentLoaded", wireSettingsPanelSwipe);
const _settingsObs = new MutationObserver(wireSettingsPanelSwipe);
const _settingsOverlay = document.getElementById("settingsOverlay");
if (_settingsOverlay)
  _settingsObs.observe(_settingsOverlay, {
    attributes: true,
    attributeFilter: ["style", "class"],
  });

/* ── TEXTAREA AUTO-RESIZE ── */
const userInput = document.getElementById("userInput");
userInput?.addEventListener("input", () => {
  userInput.style.height = "auto";
  userInput.style.height = Math.min(userInput.scrollHeight, 120) + "px";
});

/* ── SETTLE MSG ANIMATIONS ── */
const msgsEl = document.getElementById("messages");
if (msgsEl) {
  new MutationObserver((ms) =>
    ms.forEach((m) =>
      m.addedNodes.forEach((n) => {
        if (n.classList?.contains("msg"))
          n.addEventListener("animationend", () => n.classList.add("settled"), {
            once: true,
          });
      }),
    ),
  ).observe(msgsEl, { childList: true });
}
