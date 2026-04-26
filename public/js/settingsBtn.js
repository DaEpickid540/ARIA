/**
 * settingsBtn.js — standalone settings button wiring
 * Completely independent of the old wireAllControls() / initSettings() flow.
 * Just finds #ariaSettingsBtn and wires it directly to ARIA_openSettings.
 * Called from lock.js after all modules load.
 */
export function initSettingsBtn() {
  const btn = document.getElementById("ariaSettingsBtn");
  if (!btn) {
    console.warn("[ARIA] #ariaSettingsBtn not found");
    return;
  }

  btn.addEventListener("click", () => {
    // Try the global exposed by settings.js first
    if (typeof window.ARIA_openSettings === "function") {
      window.ARIA_openSettings();
      return;
    }
    // Fallback: manually flip the overlay active class
    const overlay = document.getElementById("settingsOverlay");
    if (overlay) {
      overlay.classList.add("active");
    }
  });

  // Keyboard shortcut — Ctrl+, (standard settings shortcut)
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === ",") {
      e.preventDefault();
      btn.click();
    }
  });

  console.log("[ARIA] Settings button wired ✓");
}
