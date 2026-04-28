/**
 * settingsBtn.js — all settings open/close wiring in one place.
 * Wires: #settingsBtn (sidebar), #ariaSettingsBtn (chat header),
 *        #settingsCloseBtn (X button), backdrop click, Escape, Ctrl+,
 */
export function initSettingsBtn() {
  function openSettings() {
    // settings.js exposes ARIA_openSettings which calls applySettingsToUI too
    if (typeof window.ARIA_openSettings === "function") {
      window.ARIA_openSettings();
    } else {
      // Direct fallback
      const overlay = document.getElementById("settingsOverlay");
      if (overlay) overlay.classList.add("active");
    }
  }

  function closeSettings() {
    if (typeof window.ARIA_closeSettings === "function") {
      window.ARIA_closeSettings();
    } else {
      const overlay = document.getElementById("settingsOverlay");
      if (overlay) overlay.classList.remove("active");
    }
  }

  // ── Open triggers ──
  document
    .getElementById("settingsBtn")
    ?.addEventListener("click", openSettings);

  document
    .getElementById("ariaSettingsBtn")
    ?.addEventListener("click", openSettings);

  // ── Close triggers ──
  document
    .getElementById("settingsCloseBtn")
    ?.addEventListener("click", closeSettings);

  // Backdrop click
  document.getElementById("settingsOverlay")?.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeSettings();
  });

  // Escape key
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      const overlay = document.getElementById("settingsOverlay");
      if (overlay?.classList.contains("active")) closeSettings();
    }
  });

  // Ctrl+, shortcut
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === ",") {
      e.preventDefault();
      const overlay = document.getElementById("settingsOverlay");
      overlay?.classList.contains("active") ? closeSettings() : openSettings();
    }
  });

  console.log("[ARIA] Settings button wired ✓");
}
