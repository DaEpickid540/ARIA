// voiceControls.js

import { loadSettings, saveSettings } from "./personality.js";
import { setTTSEnabled } from "./tts.js";
import { setVTTEnabled } from "./vtt.js";

export function initVoiceControls() {
  const callModeBtn = document.getElementById("callModeBtn"); // TTS ON
  const voiceOffBtn = document.getElementById("voiceOffBtn"); // TTS OFF
  const vttToggleBtn = document.getElementById("vttToggleBtn"); // VTT TOGGLE (adjust id if different)

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

  // Initial sync
  applyToButtons();
  applyToEngines();

  // TTS ON
  callModeBtn?.addEventListener("click", () => {
    settings.ttsEnabled = true;
    saveSettings(settings);
    applyToButtons();
    applyToEngines();
  });

  // TTS OFF
  voiceOffBtn?.addEventListener("click", () => {
    settings.ttsEnabled = false;
    saveSettings(settings);
    applyToButtons();
    applyToEngines();
  });

  // VTT TOGGLE
  vttToggleBtn?.addEventListener("click", () => {
    settings.vttEnabled = !settings.vttEnabled;
    saveSettings(settings);
    applyToButtons();
    applyToEngines();
  });
}
