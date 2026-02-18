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

  enterBtn.addEventListener("click", async () => {
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

      console.log("ALL CHAT MODULES LOADED");
    } catch (err) {
      console.error("CHAT MODULE FAILED:", err);
    }
  });

  goHomeBtn.addEventListener("click", () => {
    layout.style.display = "none";
    homepage.style.display = "flex";
  });

  goLockBtn.addEventListener("click", () => {
    layout.style.display = "none";
    homepage.style.display = "none";
    document.getElementById("lockScreen").style.display = "flex";
  });
});
