// callEngine.js — final baseline

export function initCallEngine() {
  const overlay = document.getElementById("callModeOverlay");
  if (!overlay) {
    console.warn("callModeOverlay missing");
    return;
  }

  function open() {
    overlay.classList.add("active");
  }

  function close() {
    overlay.classList.remove("active");
  }

  overlay.addEventListener("click", close);
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });

  window.ARIA_openCallOverlay = open;
  window.ARIA_closeCallOverlay = close;
}
