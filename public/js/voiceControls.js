// voiceControls.js

import { loadSettings, saveSettings } from "./personality.js";
import { setTTSEnabled } from "./tts.js";
import { setVTTEnabled } from "./vtt.js";

export function initVoiceControls() {
  const callModeBtn = document.getElementById("callModeBtn");
  const voiceOffBtn = document.getElementById("voiceOffBtn");
  const vttToggleBtn = document.getElementById("vttToggleBtn"); // adjust id if needed

  const callOverlay = document.getElementById("callModeOverlay");

  let settings = loadSettings();

  function applyToButtons() {
    if (callModeBtn && voiceOffBtn) {
      callModeBtn.classList.toggle("active", settings.ttsEnabled);
      voiceOffBtn.classList.toggle("active", !settings.ttsEnabled);
    }

    if (vttToggleBtn) {
      vttToggleBtn.classList.toggle("active", settings.vttEnabled);
    }
  }

  function applyToEngines() {
    setTTSEnabled(settings.ttsEnabled);
    setVTTEnabled(settings.vttEnabled);
  }

  function openCallOverlay() {
    if (!callOverlay) return;
    callOverlay.classList.add("active");
    callOverlay.classList.remove("user-speaking", "aria-speaking");
  }

  function closeCallOverlay() {
    if (!callOverlay) return;
    callOverlay.classList.remove("active", "user-speaking", "aria-speaking");
  }

  // Expose hooks for TTS/VTT to drive gradients
  window.ARIA_setUserSpeaking = (isSpeaking) => {
    if (!callOverlay) return;
    callOverlay.classList.toggle("user-speaking", !!isSpeaking);
    if (isSpeaking) callOverlay.classList.remove("aria-speaking");
  };

  window.ARIA_setAriaSpeaking = (isSpeaking) => {
    if (!callOverlay) return;
    callOverlay.classList.toggle("aria-speaking", !!isSpeaking);
    if (isSpeaking) callOverlay.classList.remove("user-speaking");
  };

  // Initial sync
  applyToButtons();
  applyToEngines();

  // TTS ON (and open call mode)
  callModeBtn?.addEventListener("click", () => {
    settings.ttsEnabled = true;
    saveSettings(settings);
    applyToButtons();
    applyToEngines();
    openCallOverlay();
    if (window.ARIA_triggerChromaticFlash) window.ARIA_triggerChromaticFlash();
  });

  // TTS OFF (and close call mode)
  voiceOffBtn?.addEventListener("click", () => {
    settings.ttsEnabled = false;
    saveSettings(settings);
    applyToButtons();
    applyToEngines();
    closeCallOverlay();
  });

  // VTT TOGGLE
  vttToggleBtn?.addEventListener("click", () => {
    settings.vttEnabled = !settings.vttEnabled;
    saveSettings(settings);
    applyToButtons();
    applyToEngines();
  });

  // Exit call mode via ESC or click
  if (callOverlay) {
    callOverlay.addEventListener("click", closeCallOverlay);
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeCallOverlay();
    });
  }
}
