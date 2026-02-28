// callEngine.js — ARIA Call Mode Engine (patched)

export function initCallEngine() {
  const overlay = document.getElementById("callModeOverlay");
  if (!overlay) {
    console.warn("callModeOverlay not found");
    return;
  }

  function open() {
    overlay.classList.add("active");
    overlay.classList.remove("user-speaking", "aria-speaking");

    window.ARIA_triggerChromaticFlash?.();
    window.ARIA_triggerGlitch?.();
  }

  function close() {
    overlay.classList.remove("active", "user-speaking", "aria-speaking");
  }

  overlay.addEventListener("click", close);
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });

  window.ARIA_openCallOverlay = open;
  window.ARIA_closeCallOverlay = close;
}
