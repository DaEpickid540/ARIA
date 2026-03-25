<<<<<<< HEAD
// ui.js — keyboard fix, sidebar, textarea resize, animation settle
=======
// ui.js — mobile sidebar + keyboard white-bar fix
>>>>>>> 244b24b6258139849561495221c42d6ae70cda70

/* ── VOICE WAVE BARS ── */
const voiceWave = document.getElementById("voiceWave");
if (voiceWave && !voiceWave.children.length) {
<<<<<<< HEAD
  for (let i = 0; i < 6; i++)
    voiceWave.appendChild(document.createElement("span"));
}

/* ── KEYBOARD WHITE BAR FIX ── */
function fixViewportHeight() {
  const vh = window.visualViewport?.height ?? window.innerHeight;
  const layout = document.getElementById("layout");
  if (layout && window.innerWidth <= 768) layout.style.height = vh + "px";
}
=======
  for (let i = 0; i < 6; i++) voiceWave.appendChild(document.createElement("span"));
}

/* ── KEYBOARD WHITE BAR FIX ──
   On Android Chrome, when the keyboard opens the visual viewport
   shrinks but window.innerHeight stays the same, creating a white
   gap below the app. We pin the layout height to the visual viewport.
*/
function fixViewportHeight() {
  const vh = window.visualViewport?.height ?? window.innerHeight;
  const layout = document.getElementById("layout");
  if (layout && window.innerWidth <= 768) {
    layout.style.height = vh + "px";
  }
}

>>>>>>> 244b24b6258139849561495221c42d6ae70cda70
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", fixViewportHeight);
  window.visualViewport.addEventListener("scroll", fixViewportHeight);
}
window.addEventListener("resize", fixViewportHeight);
<<<<<<< HEAD
fixViewportHeight();

/* ── MOBILE SIDEBAR ── */
const sidebar = document.getElementById("sidebar");
const overlay = document.getElementById("sidebarOverlay");
const toggle = document.getElementById("sidebarToggleBtn");

function openSidebar() {
  sidebar?.classList.add("open");
  overlay?.classList.add("active");
  if (toggle) toggle.textContent = "✕";
=======
// Run immediately
fixViewportHeight();

/* ── MOBILE SIDEBAR ── */
const sidebar        = document.getElementById("sidebar");
const sidebarOverlay = document.getElementById("sidebarOverlay");
const toggleBtn      = document.getElementById("sidebarToggleBtn");

function openSidebar() {
  sidebar?.classList.add("open");
  sidebarOverlay?.classList.add("active");
  if (toggleBtn) toggleBtn.textContent = "✕ Close";
>>>>>>> 244b24b6258139849561495221c42d6ae70cda70
  document.body.style.overflow = "hidden";
}
function closeSidebar() {
  sidebar?.classList.remove("open");
<<<<<<< HEAD
  overlay?.classList.remove("active");
  if (toggle) toggle.textContent = "Menu";
  document.body.style.overflow = "";
}
toggle?.addEventListener("click", () =>
  sidebar?.classList.contains("open") ? closeSidebar() : openSidebar(),
);
overlay?.addEventListener("click", closeSidebar);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeSidebar();
    window.ARIA_closeCodePanel?.();
  }
});
window.addEventListener("resize", () => {
  if (window.innerWidth > 768) closeSidebar();
});
window.ARIA_openSidebar = openSidebar;
=======
  sidebarOverlay?.classList.remove("active");
  if (toggleBtn) toggleBtn.textContent = "☰ Menu";
  document.body.style.overflow = "";
}

toggleBtn?.addEventListener("click", () => {
  sidebar?.classList.contains("open") ? closeSidebar() : openSidebar();
});
sidebarOverlay?.addEventListener("click", closeSidebar);
document.addEventListener("keydown", e => { if (e.key === "Escape") closeSidebar(); });
window.addEventListener("resize", () => { if (window.innerWidth > 768) closeSidebar(); });

window.ARIA_openSidebar  = openSidebar;
>>>>>>> 244b24b6258139849561495221c42d6ae70cda70
window.ARIA_closeSidebar = closeSidebar;

/* ── TEXTAREA AUTO-RESIZE ── */
const userInput = document.getElementById("userInput");
userInput?.addEventListener("input", () => {
  userInput.style.height = "auto";
  userInput.style.height = Math.min(userInput.scrollHeight, 120) + "px";
});
<<<<<<< HEAD

/* ── SETTLE MSG ANIMATIONS (free GPU will-change) ── */
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
=======
>>>>>>> 244b24b6258139849561495221c42d6ae70cda70
