// main.js

import { initHomepage } from "./homepage.js";
import { initPages } from "./pages.js";
import { initSettings } from "./settings.js";
import { initChat } from "./chat.js";

window.addEventListener("DOMContentLoaded", () => {
  const lockScreen = document.getElementById("lockScreen");
  const lockInput = document.getElementById("lockInput");
  const lockBtn = document.getElementById("lockBtn");
  const lockError = document.getElementById("lockError");

  const PASS = "727846"; // your lock code

  // Lock screen logic
  lockBtn.addEventListener("click", tryUnlock);
  lockInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") tryUnlock();
  });

  function tryUnlock() {
    if (lockInput.value === PASS) {
      lockError.textContent = "";
      lockScreen.style.opacity = 0;

      setTimeout(() => {
        lockScreen.style.display = "none";

        // Load homepage
        initHomepage();

        // Load pages
        initPages();

        // Load chat system
        initChat();

        // Load settings panel
        initSettings();
      }, 300);
    } else {
      lockError.textContent = "Incorrect code.";
    }
  }
});
