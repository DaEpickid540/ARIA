// main.js

// Only lock loads immediately
import "./lock.js";

window.addEventListener("DOMContentLoaded", () => {
  const homepage = document.getElementById("homepageScreen");
  const layout = document.getElementById("layout");
  const enterBtn = document.getElementById("enterConsoleBtn");
  const goHomeBtn = document.getElementById("goHomeBtn");
  const goLockBtn = document.getElementById("goLockBtn");

  // HOMEPAGE → CHAT
  enterBtn.addEventListener("click", async () => {
    homepage.style.display = "none";
    layout.style.display = "flex";

    // Load chat modules AFTER entering console
    await import("./chat.js");
    await import("./ui.js");
    await import("./tts.js");
    await import("./vtt.js");
    await import("./tools.js");
    await import("./settings.js");
    await import("./personality.js");
  });

  // SIDEBAR → HOME
  goHomeBtn.addEventListener("click", () => {
    layout.style.display = "none";
    homepage.style.display = "flex";
  });

  // SIDEBAR → LOCK
  goLockBtn.addEventListener("click", () => {
    layout.style.display = "none";
    homepage.style.display = "none";
    document.getElementById("lockScreen").style.display = "flex";
  });
});
