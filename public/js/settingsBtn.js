/**
 * settingsBtn.js — settings modal open/close.
 * Uses classList.add/remove("active") — consistent with settings.js,
 * shortcuts.js, ui.js, and the CSS which uses #settingsOverlay.active { display:flex }
 * DO NOT set style.display directly — it overrides the class and breaks close.
 */
export function initSettingsBtn() {
  function openSettings() {
    // ARIA_openSettings (from settings.js) calls applySettingsToUI,
    // populateVoiceSelect, classList.add("active"), switchSettingsTab — use it.
    if (typeof window.ARIA_openSettings === "function") {
      window.ARIA_openSettings();
    } else {
      // Fallback: just add active class (CSS handles display:flex)
      document.getElementById("settingsOverlay")?.classList.add("active");
    }
  }

  function closeSettings() {
    if (typeof window.ARIA_closeSettings === "function") {
      window.ARIA_closeSettings();
    } else {
      document.getElementById("settingsOverlay")?.classList.remove("active");
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
      const o = document.getElementById("settingsOverlay");
      if (o?.classList.contains("active")) closeSettings();
    }
  });

  // Ctrl+/ (matches shortcuts.js Ctrl+/ → ARIA_openSettings)
  // Ctrl+, as alternate shortcut
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === ",") {
      e.preventDefault();
      const o = document.getElementById("settingsOverlay");
      o?.classList.contains("active") ? closeSettings() : openSettings();
    }
  });

  console.log("[ARIA] Settings buttons wired ✓");
}
