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
      document.getElementById("settingsBtn")?.click();
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

/* Also make the settings panel swipeable (swipe right to close) */
const settingsPanel = document.getElementById("settingsPanel");
if (settingsPanel) {
  let spStartX = 0;
  settingsPanel.addEventListener(
    "touchstart",
    (e) => {
      spStartX = e.touches[0].clientX;
    },
    { passive: true },
  );
  settingsPanel.addEventListener(
    "touchend",
    (e) => {
      const dx = e.changedTouches[0].clientX - spStartX;
      if (dx > SWIPE_THRESHOLD) {
        // Close settings — find and click close btn
        document.getElementById("settingsCloseBtn")?.click();
      }
    },
    { passive: true },
  );
}

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
