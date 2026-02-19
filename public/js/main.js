// main.js
console.log("MAIN JS LOADED");

// Load ONLY the lock screen immediately
import "./lock.js";

window.addEventListener("DOMContentLoaded", () => {
  const homepage = document.getElementById("homepageScreen");
  const layout = document.getElementById("layout");

  const enterBtn = document.getElementById("enterConsoleBtn");
  const goHomeBtn = document.getElementById("goHomeBtn");
  const goLockBtn = document.getElementById("goLockBtn");

  /* ---------------- ENTER ARIA (LOAD CHAT MODULES) ---------------- */
  enterBtn?.addEventListener("click", async () => {
    console.log("ENTER ARIA CLICKED");

    homepage.style.display = "none";
    layout.style.display = "flex";

    try {
      // Load chat system dynamically
      const chatModule = await import("./chat.js");
      console.log("CHAT.JS LOADED", chatModule);

      await import("./ui.js");
      await import("./tools.js");
      await import("./tts.js");
      await import("./vtt.js");
      await import("./settings.js");
      await import("./personality.js");
      await import("./pages.js"); // NEW: load pages system

      console.log("ALL CHAT + PAGE MODULES LOADED");
    } catch (err) {
      console.error("CHAT/PAGE MODULE FAILED:", err);
    }
  });

  /* ---------------- GO HOME ---------------- */
  goHomeBtn?.addEventListener("click", () => {
    layout.style.display = "none";
    homepage.style.display = "flex";
  });

  /* ---------------- GO LOCK ---------------- */
  goLockBtn?.addEventListener("click", () => {
    layout.style.display = "none";
    homepage.style.display = "none";
    document.getElementById("lockScreen").style.display = "flex";
  });
});
