// callEngine.js — orb + halo only (waveforms removed)

import {
  setCallModeActive,
  startCallListening,
  stopCallListening,
} from "./vtt.js";
import { setTTSEnabled } from "./tts.js";

export function initCallEngine() {
  const overlay = document.getElementById("callModeOverlay");
  if (!overlay) {
    console.warn("callModeOverlay missing");
    return;
  }

  const status = document.getElementById("callModeStatus");
  const orbCore = document.getElementById("callOrbCore");
  const hint = document.getElementById("callModeHint");

  function open() {
    overlay.classList.add("active");
    overlay.classList.remove("aria-speaking");
    overlay.classList.add("user-speaking"); // white halo — user talking
    if (status) status.textContent = "LISTENING...";
    setTTSEnabled(true);
    window.ARIA_startCallListening = startCallListening;
    window.ARIA_stopCallListening = stopCallListening;
    setCallModeActive(true);
    startOrbAnimation();
    startHolo();
  }

  // ── Hologram (js/holo/) ──
  // Takes the orb's place when the browser can draw it. Loaded on the first
  // call, so three.js costs nothing before then; if it can't load or there's
  // no WebGL, the CSS orb stays, and it isn't tried again.
  let holo = null;
  let holoFailed = false;

  async function startHolo() {
    if (holoFailed) return;
    try {
      if (!holo) {
        const { createHolo } = await import("./holo/index.js");
        const canvas = document.createElement("canvas");
        canvas.id = "callHolo";
        canvas.setAttribute("aria-hidden", "true");
        overlay.prepend(canvas);
        holo = createHolo(canvas, {
          // The same signals the orb reads: ARIA's voice, else the mic.
          state: () =>
            window.ARIA_isSpeaking || overlay.classList.contains("aria-speaking")
              ? "aria"
              : overlay.classList.contains("user-speaking")
              ? "user"
              : "idle",
          voice: () => window.ARIA_voiceLevel?.() ?? null,
          mic: () => (overlay.classList.contains("user-speaking") ? window.ARIA_micLevel ?? null : null),
          // The canvas covers the overlay, so it passes taps on: tap to hang up.
          onTap: close,
        });
      }
      if (!overlay.classList.contains("active")) return; // closed while it loaded
      overlay.classList.add("holo-on");
      if (hint) hint.textContent = "Drag to turn · tap or ESC to exit";
      holo.start();
    } catch (e) {
      holoFailed = true;
      console.warn("[CALL] Hologram unavailable, keeping the orb:", e.message);
      overlay.classList.remove("holo-on");
      document.getElementById("callHolo")?.remove();
    }
  }

  function close() {
    holo?.stop();
    overlay.classList.remove("active", "user-speaking", "aria-speaking");
    setCallModeActive(false);
    window.ARIA_isSpeaking = false;
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    stopOrbAnimation();
    if (status) status.textContent = "CALL MODE ACTIVE";
  }

  // ── Halo state: white = user talking, red = ARIA talking ──
  // Called externally by TTS when ARIA starts/stops speaking
  window.ARIA_setCallSpeaker = (speaker) => {
    // speaker: "aria" | "user"
    overlay.classList.remove("user-speaking", "aria-speaking");
    if (speaker === "aria") {
      overlay.classList.add("aria-speaking"); // red halo
      if (status) status.textContent = "ARIA SPEAKING";
    } else {
      overlay.classList.add("user-speaking"); // white halo
      if (status) status.textContent = "LISTENING...";
    }
  };

  // ── Orb animation — pulses based on who is speaking ──
  let orbInterval = null;

  function startOrbAnimation() {
    stopOrbAnimation();
    orbInterval = setInterval(() => {
      if (!orbCore) return;
      const ariaSpeaking = !!window.ARIA_isSpeaking;
      const userSpeaking = overlay.classList.contains("user-speaking");
      let size;
      if (ariaSpeaking) size = 140 + Math.random() * 50;
      else if (userSpeaking) size = 100 + Math.random() * 35;
      else size = 70 + Math.random() * 20;
      orbCore.style.width = size + "px";
      orbCore.style.height = size + "px";
    }, 95);
  }

  function stopOrbAnimation() {
    clearInterval(orbInterval);
    orbInterval = null;
    if (orbCore) {
      orbCore.style.width = "80px";
      orbCore.style.height = "80px";
    }
  }

  // ── Close triggers ──
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlay.classList.contains("active")) close();
  });

  window.ARIA_openCallOverlay = open;
  window.ARIA_closeCallOverlay = close;
}
