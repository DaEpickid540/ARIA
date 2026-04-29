/**
 * settingsBtn.js — settings modal open/close.
 * Uses display:flex / display:none directly — same as commandsModal.
 * No class toggling, no dependency on ARIA_openSettings timing.
 */
export function initSettingsBtn() {
  function openSettings() {
    const overlay = document.getElementById("settingsOverlay");
    if (!overlay) return;
    // Call settings.js hook if available (applies UI, populates voice select)
    window.ARIA_openSettings?.();
    // Force display regardless of whether hook worked
    overlay.style.display = "flex";
  }

  function closeSettings() {
    const overlay = document.getElementById("settingsOverlay");
    if (!overlay) return;
    window.ARIA_closeSettings?.();
    overlay.style.display = "none";
  }

  // Wire open buttons
  document
    .getElementById("settingsBtn")
    ?.addEventListener("click", openSettings);
  document
    .getElementById("ariaSettingsBtn")
    ?.addEventListener("click", openSettings);

  // Wire close
  document
    .getElementById("settingsCloseBtn")
    ?.addEventListener("click", closeSettings);

  // Backdrop
  document.getElementById("settingsOverlay")?.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeSettings();
  });

  // Escape
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      const o = document.getElementById("settingsOverlay");
      if (o && o.style.display !== "none" && o.style.display !== "")
        closeSettings();
    }
  });

  // Ctrl+,
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === ",") {
      e.preventDefault();
      const o = document.getElementById("settingsOverlay");
      o?.style.display === "flex" ? closeSettings() : openSettings();
    }
  });

  console.log("[ARIA] Settings buttons wired ✓");
}
