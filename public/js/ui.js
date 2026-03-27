// ui.js — sidebar collapse, keyboard fix, textarea resize

/* ── VOICE WAVE ── */
const voiceWave = document.getElementById("voiceWave");
if (voiceWave && !voiceWave.children.length) {
  for (let i = 0; i < 6; i++)
    voiceWave.appendChild(document.createElement("span"));
}

/* ── KEYBOARD FIX ── */
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
collapseBtn?.addEventListener("click", () => {
  sidebar?.classList.contains("collapsed")
    ? expandSidebar()
    : collapseSidebar();
});
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
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeMobileSidebar();
    window.ARIA_closeCodePanel?.();
  }
});
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

/* ── TEXTAREA RESIZE ── */
const userInput = document.getElementById("userInput");
userInput?.addEventListener("input", () => {
  userInput.style.height = "auto";
  userInput.style.height = Math.min(userInput.scrollHeight, 120) + "px";
});

/* ── SETTLE ANIMATIONS ── */
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
