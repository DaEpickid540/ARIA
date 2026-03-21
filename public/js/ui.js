// ui.js — mobile sidebar + keyboard white-bar fix

/* ── VOICE WAVE BARS ── */
const voiceWave = document.getElementById("voiceWave");
if (voiceWave && !voiceWave.children.length) {
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

if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", fixViewportHeight);
  window.visualViewport.addEventListener("scroll", fixViewportHeight);
}
window.addEventListener("resize", fixViewportHeight);
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
  document.body.style.overflow = "hidden";
}

function closeSidebar() {
  sidebar?.classList.remove("open");
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
window.ARIA_closeSidebar = closeSidebar;

/* ── TEXTAREA AUTO-RESIZE ── */
const userInput = document.getElementById("userInput");
userInput?.addEventListener("input", () => {
  userInput.style.height = "auto";
  userInput.style.height = Math.min(userInput.scrollHeight, 120) + "px";
});
