// main.js

console.log("MAIN JS LOADED");

// Only lock loads immediately
import "./lock.js";

window.addEventListener("DOMContentLoaded", () => {
  const homepage = document.getElementById("homepageScreen");
  const layout = document.getElementById("layout");

  const enterBtn = document.getElementById("enterConsoleBtn");
  const goHomeBtn = document.getElementById("goHomeBtn");
  const goLockBtn = document.getElementById("goLockBtn");

  enterBtn?.addEventListener("click", async () => {
    console.log("ENTER ARIA CLICKED");

    homepage.style.display = "none";
    layout.style.display = "flex";

    try {
      const chatModule = await import("./chat.js");
      console.log("CHAT.JS LOADED", chatModule);

      await import("./ui.js");
      await import("./tools.js");
      await import("./tts.js");
      await import("./vtt.js");
      await import("./settings.js");
      await import("./personality.js");
      await import("./pages.js"); // pages system

      console.log("ALL CHAT MODULES LOADED");
    } catch (err) {
      console.error("CHAT MODULE FAILED:", err);
    }
  });

  goHomeBtn?.addEventListener("click", () => {
    layout.style.display = "none";
    homepage.style.display = "flex";
    homepage.style.opacity = 1;
  });

  goLockBtn?.addEventListener("click", () => {
    layout.style.display = "none";
    homepage.style.display = "none";
    const lock = document.getElementById("lockScreen");
    if (lock) lock.style.display = "flex";
  });
});
