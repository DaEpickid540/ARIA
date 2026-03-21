// ui.js — runs immediately after dynamic import (no DOMContentLoaded needed)

/* ── VOICE WAVE BARS ── */
const voiceWave = document.getElementById("voiceWave");
if (voiceWave && !voiceWave.children.length) {
  for (let i = 0; i < 6; i++) voiceWave.appendChild(document.createElement("span"));
}

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
