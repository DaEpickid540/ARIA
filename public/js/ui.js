// ui.js — sidebar collapse, keyboard fix, textarea resize

/* ── VOICE WAVE BARS ── */
const voiceWave = document.getElementById("voiceWave");
if (voiceWave && !voiceWave.children.length) {
  for (let i = 0; i < 6; i++)
    voiceWave.appendChild(document.createElement("span"));
}

/* ── KEYBOARD WHITE BAR FIX (mobile) ── */
function fixViewportHeight() {
  const vh = window.visualViewport?.height ?? window.innerHeight;
  const layout = document.getElementById("layout");
  if (layout && window.innerWidth <= 768) layout.style.height = vh + "px";
}
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", fixViewportHeight);
  window.visualViewport.addEventListener("scroll", fixViewportHeight);
}
window.addEventListener("resize", fixViewportHeight);
fixViewportHeight();

/* ============================================================
   DESKTOP SIDEBAR — collapse/expand in-flow strip
   The sidebar stays in the DOM as a flex child.
   Collapsing it via CSS width makes #chatWindow auto-expand.
   ============================================================ */
const sidebar = document.getElementById("sidebar");
const collapseBtn = document.getElementById("sidebarCollapseBtn");
const collapseIcon = document.getElementById("sidebarCollapseIcon");

function isMobile() {
  return window.innerWidth <= 768;
}

function collapseSidebar() {
  if (isMobile()) return; // mobile uses open/close instead
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

function toggleSidebarCollapse() {
  if (sidebar?.classList.contains("collapsed")) {
    expandSidebar();
  } else {
    collapseSidebar();
  }
}

collapseBtn?.addEventListener("click", toggleSidebarCollapse);

// Restore persisted collapsed state
if (!isMobile() && localStorage.getItem("aria_sidebar_collapsed") === "1") {
  sidebar?.classList.add("collapsed");
  if (collapseIcon) collapseIcon.textContent = "»»";
}

// Expose for chat.js to use when code panel opens
window.ARIA_collapseSidebar = collapseSidebar;
window.ARIA_expandSidebar = expandSidebar;

/* ============================================================
   MOBILE SIDEBAR — overlay drawer
   On mobile, use position:fixed open/close (not collapsed class)
   ============================================================ */
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

mobileToggle?.addEventListener("click", () => {
  sidebar?.classList.contains("open")
    ? closeMobileSidebar()
    : openMobileSidebar();
});
overlay?.addEventListener("click", closeMobileSidebar);

// ESC closes everything
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeMobileSidebar();
    window.ARIA_closeCodePanel?.();
  }
});

// Close mobile drawer on resize to desktop
window.addEventListener("resize", () => {
  if (!isMobile()) closeMobileSidebar();
});

// Expose unified close (used by chat.js when switching chats on mobile)
window.ARIA_closeSidebar = () => {
  if (isMobile()) closeMobileSidebar();
  // On desktop, don't auto-collapse — let the user control it
};
window.ARIA_openSidebar = () => {
  if (isMobile()) openMobileSidebar();
  else expandSidebar();
};

/* ── TEXTAREA AUTO-RESIZE ── */
const userInput = document.getElementById("userInput");
userInput?.addEventListener("input", () => {
  userInput.style.height = "auto";
  userInput.style.height = Math.min(userInput.scrollHeight, 120) + "px";
});

/* ── SETTLE MESSAGE ANIMATIONS ── */
const msgsEl = document.getElementById("messages");
if (msgsEl) {
  new MutationObserver((mutations) => {
    mutations.forEach((m) =>
      m.addedNodes.forEach((node) => {
        if (node.classList?.contains("msg")) {
          node.addEventListener(
            "animationend",
            () => node.classList.add("settled"),
            { once: true },
          );
        }
      }),
    );
  }).observe(msgsEl, { childList: true });
}
