// ui.js — runs after dynamic import, DOM is already ready

/* ── VOICE WAVE BARS ── */
const voiceWave = document.getElementById("voiceWave");
if (voiceWave && voiceWave.children.length === 0) {
  for (let i = 0; i < 6; i++) {
    voiceWave.appendChild(document.createElement("span"));
  }
}

/* ── MOBILE SIDEBAR ── */
const sidebar = document.getElementById("sidebar");
const hamburgerBtn = document.getElementById("hamburgerBtn");
const sidebarOverlay = document.getElementById("sidebarOverlay");

function openSidebar() {
  sidebar?.classList.add("open");
  hamburgerBtn?.classList.add("open");
  sidebarOverlay?.classList.add("active");
  document.body.style.overflow = "hidden";
}

function closeSidebar() {
  sidebar?.classList.remove("open");
  hamburgerBtn?.classList.remove("open");
  sidebarOverlay?.classList.remove("active");
  document.body.style.overflow = "";
}

function toggleSidebar() {
  sidebar?.classList.contains("open") ? closeSidebar() : openSidebar();
}

hamburgerBtn?.addEventListener("click", toggleSidebar);
sidebarOverlay?.addEventListener("click", closeSidebar);

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeSidebar();
});
window.addEventListener("resize", () => {
  if (window.innerWidth > 768) closeSidebar();
});

// Expose globally
window.ARIA_closeSidebar = closeSidebar;
window.ARIA_openSidebar = openSidebar;
