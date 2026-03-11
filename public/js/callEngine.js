// callEngine.js — with reactive orb + dual waveforms

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
  const ariaWaveEl = document.getElementById("callWaveformAria");
  const userWaveEl = document.getElementById("callWaveformUser");
  const orbCore = document.getElementById("callOrbCore");

  function open() {
    overlay.classList.add("active");
    overlay.classList.remove("aria-speaking");
    overlay.classList.add("user-speaking");
    if (status) status.textContent = "LISTENING...";
    setTTSEnabled(true);
    window.ARIA_startCallListening = startCallListening;
    window.ARIA_stopCallListening = stopCallListening;
    setCallModeActive(true);
    animateWaveform(true);
  }

  function close() {
    overlay.classList.remove("active", "user-speaking", "aria-speaking");
    setCallModeActive(false);
    window.ARIA_isSpeaking = false;
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    animateWaveform(false);
    if (status) status.textContent = "CALL MODE ACTIVE";
  }

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlay.classList.contains("active")) close();
  });

  let waveInterval = null;

  function animateWaveform(active) {
    if (!active) {
      clearInterval(waveInterval);
      waveInterval = null;
      ariaWaveEl?.querySelectorAll(".waveBar").forEach((b) => {
        b.style.height = "5px";
      });
      userWaveEl?.querySelectorAll(".waveBar").forEach((b) => {
        b.style.height = "3px";
      });
      if (orbCore) {
        orbCore.style.width = "80px";
        orbCore.style.height = "80px";
      }
      return;
    }

    clearInterval(waveInterval);
    waveInterval = setInterval(() => {
      const ariaSpeaking = !!window.ARIA_isSpeaking;
      const userSpeaking =
        !ariaSpeaking && overlay.classList.contains("user-speaking");

      ariaWaveEl?.querySelectorAll(".waveBar").forEach((bar) => {
        const max = ariaSpeaking ? 46 : 9;
        const min = ariaSpeaking ? 12 : 2;
        bar.style.height = Math.floor(Math.random() * (max - min) + min) + "px";
      });

      userWaveEl?.querySelectorAll(".waveBar").forEach((bar) => {
        const max = userSpeaking ? 38 : 7;
        const min = userSpeaking ? 8 : 2;
        bar.style.height = Math.floor(Math.random() * (max - min) + min) + "px";
      });

      if (orbCore) {
        let size;
        if (ariaSpeaking) size = 140 + Math.random() * 50;
        else if (userSpeaking) size = 100 + Math.random() * 35;
        else size = 70 + Math.random() * 20;
        orbCore.style.width = size + "px";
        orbCore.style.height = size + "px";
      }
    }, 95);
  }

  window.ARIA_openCallOverlay = open;
  window.ARIA_closeCallOverlay = close;
}
