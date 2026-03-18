// ui.js — UI helpers including mobile sidebar

window.addEventListener("DOMContentLoaded", () => {

  /* ── VOICE WAVE BARS ── */
  const voiceWave = document.getElementById("voiceWave");
  if (voiceWave && voiceWave.children.length === 0) {
    for (let i = 0; i < 6; i++) {
      const bar = document.createElement("span");
      voiceWave.appendChild(bar);
    }
  }

  /* ── MOBILE SIDEBAR ── */
  const sidebar         = document.getElementById("sidebar");
  const hamburgerBtn    = document.getElementById("hamburgerBtn");
  const sidebarOverlay  = document.getElementById("sidebarOverlay");

  function openSidebar() {
    sidebar?.classList.add("open");
    hamburgerBtn?.classList.add("open");
    sidebarOverlay?.classList.add("active");
    document.body.style.overflow = "hidden"; // prevent scroll behind
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

  // Close sidebar when any chat item or action button inside it is clicked
  sidebar?.addEventListener("click", (e) => {
    const isActionable =
      e.target.closest("#chatList") ||
      e.target.closest("#newChatBtn") ||
      e.target.closest("#goHomeBtn") ||
      e.target.closest("#goLockBtn");
    if (isActionable && window.innerWidth <= 768) closeSidebar();
  });

  // Close on ESC key
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeSidebar();
  });

  // Close sidebar on window resize to desktop width
  window.addEventListener("resize", () => {
    if (window.innerWidth > 768) closeSidebar();
  });

  // Expose globally so other modules can close it (e.g. after starting a new chat)
  window.ARIA_closeSidebar = closeSidebar;
  window.ARIA_openSidebar  = openSidebar;
});
