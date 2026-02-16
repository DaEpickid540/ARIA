import {
  personalityPresets,
  loadSettings,
  saveSettings,
} from "./personality.js";
import { setTTSEnabled } from "./tts.js";
import { setVTTEnabled } from "./vtt.js";

window.addEventListener("DOMContentLoaded", () => {
  const settingsOverlay = document.getElementById("settingsOverlay");
  const settingsBtn = document.getElementById("settingsBtn");
  const settingsCloseBtn = document.getElementById("settingsCloseBtn");
  const settingsSaveBtn = document.getElementById("settingsSaveBtn");

  const personalityButtons = document.querySelectorAll(".personalityBtn");
  const providerSelect = document.getElementById("providerSelect");
  const ttsToggle = document.getElementById("ttsToggle");
  const vttMasterToggle = document.getElementById("vttMasterToggle");

  const voiceSelect = document.getElementById("voiceSelect");
  const voiceRate = document.getElementById("voiceRate");
  const voicePitch = document.getElementById("voicePitch");

  let currentSettings = loadSettings();

  /* -----------------------------
     APPLY SETTINGS TO UI
  ----------------------------- */
  function applySettingsToUI() {
    // Personality
    personalityButtons.forEach((btn) => {
      const key = btn.dataset.preset;
      btn.classList.toggle("active", key === currentSettings.personality);
    });

    // Provider
    providerSelect.value = currentSettings.provider || "openrouter";

    // TTS
    ttsToggle.classList.toggle("active", currentSettings.ttsEnabled);
    ttsToggle.textContent = currentSettings.ttsEnabled ? "ON" : "OFF";

    // VTT
    vttMasterToggle.classList.toggle("active", currentSettings.vttEnabled);
    vttMasterToggle.textContent = currentSettings.vttEnabled ? "ON" : "OFF";
  }

  /* -----------------------------
     OPEN / CLOSE SETTINGS
  ----------------------------- */
  function openSettings() {
    applySettingsToUI();
    settingsOverlay.classList.add("active");
  }

  function closeSettings() {
    settingsOverlay.classList.remove("active");
  }

  settingsBtn.addEventListener("click", openSettings);
  settingsCloseBtn.addEventListener("click", closeSettings);

  /* -----------------------------
     PERSONALITY SELECT
  ----------------------------- */
  personalityButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      currentSettings.personality = btn.dataset.preset;
      applySettingsToUI();
    });
  });

  /* -----------------------------
     PROVIDER SELECT
  ----------------------------- */
  providerSelect.addEventListener("change", () => {
    currentSettings.provider = providerSelect.value;
  });

  /* -----------------------------
     TTS TOGGLE
  ----------------------------- */
  ttsToggle.addEventListener("click", () => {
    currentSettings.ttsEnabled = !currentSettings.ttsEnabled;
    applySettingsToUI();
    setTTSEnabled(currentSettings.ttsEnabled);
  });

  /* -----------------------------
     VTT TOGGLE
  ----------------------------- */
  vttMasterToggle.addEventListener("click", () => {
    currentSettings.vttEnabled = !currentSettings.vttEnabled;
    applySettingsToUI();
    setVTTEnabled(currentSettings.vttEnabled);
  });

  /* -----------------------------
     SAVE BUTTON
  ----------------------------- */
  settingsSaveBtn.addEventListener("click", () => {
    saveSettings(currentSettings);
    closeSettings();
  });

  // Apply initial settings to TTS/VTT
  setTTSEnabled(currentSettings.ttsEnabled);
  setVTTEnabled(currentSettings.vttEnabled);
});
