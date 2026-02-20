// main.js

console.log("MAIN JS LOADED");

// Only lock loads immediately
import "./lock.js";

window.addEventListener("DOMContentLoaded", () => {
  // HIDE OLD LOADING SCREEN IF PRESENT
  const loading = document.getElementById("loadingScreen");
  if (loading) loading.style.display = "none";

  const chromaticFlash = document.getElementById("chromaticFlash");
  function triggerChromaticFlash() {
    if (!chromaticFlash) return;
    chromaticFlash.classList.remove("chromatic-active");
    void chromaticFlash.offsetWidth;
    chromaticFlash.classList.add("chromatic-active");
  }

  // EXPOSE FOR OTHER MODULES (chat, etc.)
  window.ARIA_triggerChromaticFlash = triggerChromaticFlash;

  /* ---------------- PRE-BOOT RED SCRIPTS ---------------- */
  const preBootScreen = document.getElementById("preBootScreen");
  const preBootLog = document.getElementById("preBootLog");

  function runPreBoot(callback) {
    if (!preBootScreen || !preBootLog) {
      callback();
      return;
    }

    const lines = [
      "[SYS] Mounting ARIA partitions...",
      "[SYS] Checking integrity of local modules...",
      "[OK ] js/chat.js",
      "[OK ] js/ui.js",
      "[OK ] js/tools.js",
      "[OK ] js/tts.js",
      "[OK ] js/vtt.js",
      "[OK ] js/settings.js",
      "[OK ] js/personality.js",
      "[SYS] Linking homeTools suite...",
      "[OK ] time, weather, system, tasks, recent, health, speed, quick, summary, monitor",
      "[SYS] Handing off to core bootloader...",
    ];

    let idx = 0;

    const step = () => {
      if (idx < lines.length) {
        preBootLog.textContent += lines[idx] + "\n";
        idx++;
        setTimeout(step, 120);
      } else {
        preBootScreen.classList.add("fade-out");
        setTimeout(() => {
          preBootScreen.style.display = "none";
          callback();
        }, 600);
      }
    };

    step();
  }

  /* ---------------- MAIN BOOT SEQUENCE ---------------- */
  const bootScreen = document.getElementById("bootScreen");
  const bootLog = document.getElementById("bootLog");
  const bootModal = document.getElementById("bootModal");
  const bootSound = document.getElementById("bootSound");

  function runBootSequence(callback) {
    if (!bootScreen || !bootLog || !bootModal) {
      callback();
      return;
    }

    const lines = [
      "[BOOT] ARIA core loader engaged...",
      "[CHECK] Verifying system integrity...",
      "[OK]  Memory map stable.",
      "[OK]  Neural routing tables loaded.",
      "[LINK] Establishing local IO channels...",
      "[OK]  Audio, text, and tools online.",
      "[SCAN] Loading personality profiles...",
      "[OK]  Active profile: SARVIN-LOCAL",
      "[WIRE] Binding UI surfaces...",
      "[OK]  Lock, homepage, console linked.",
      "[FINAL] Preparing ARIA shell...",
    ];

    let idx = 0;

    const step = () => {
      if (idx < lines.length) {
        bootLog.textContent += lines[idx] + "\n";
        idx++;
        triggerChromaticFlash();
        setTimeout(step, 180);
      } else {
        bootModal.classList.add("show");

        if (bootSound) {
          bootSound.currentTime = 0;
          bootSound.play().catch(() => {});
        }

        setTimeout(() => {
          bootScreen.classList.add("fade-out");
          setTimeout(() => {
            bootScreen.style.display = "none";
            callback();
          }, 600);
        }, 900);
      }
    };

    step();
  }

  /* ---------------- AFTER BOOT → ARIA MAIN ---------------- */
  runPreBoot(() => {
    runBootSequence(() => {
      const homepage = document.getElementById("homepageScreen");
      const layout = document.getElementById("layout");

      const enterBtn = document.getElementById("enterConsoleBtn");
      const goHomeBtn = document.getElementById("goHomeBtn");
      const goLockBtn = document.getElementById("goLockBtn");

      /* ENTER ARIA */
      enterBtn?.addEventListener("click", async () => {
        homepage.style.display = "none";
        layout.style.display = "flex";

        try {
          await import("./chat.js");
          await import("./ui.js");
          await import("./tools.js");
          await import("./tts.js");
          await import("./vtt.js");
          await import("./settings.js");
          await import("./personality.js");
          await import("./pages.js");

          const { initVoiceControls } = await import("./voiceControls.js");
          initVoiceControls();

          console.log("ALL CHAT MODULES LOADED");
        } catch (err) {
          console.error("CHAT MODULE FAILED:", err);
        }
      });

      /* GO HOME */
      goHomeBtn?.addEventListener("click", () => {
        layout.style.display = "none";
        homepage.style.display = "flex";
        homepage.style.opacity = 1;
      });

      /* GO LOCK */
      goLockBtn?.addEventListener("click", () => {
        layout.style.display = "none";
        homepage.style.display = "none";
        document.getElementById("lockScreen").style.display = "flex";
      });
    });
  });
});
