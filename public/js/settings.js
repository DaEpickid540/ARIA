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

  function applySettingsToUI() {
    // Personality
    personalityButtons.forEach((btn) => {
      const key = btn.dataset.preset;
      btn.classList.toggle("active", key === currentSettings.personality);
    });

    // Provider
    if (providerSelect) {
      providerSelect.value = currentSettings.provider || "openrouter";
    }

    // TTS
    if (ttsToggle) {
      ttsToggle.classList.toggle("active", currentSettings.ttsEnabled);
      ttsToggle.textContent = currentSettings.ttsEnabled ? "ON" : "OFF";
    }

    // VTT
    if (vttMasterToggle) {
      vttMasterToggle.classList.toggle("active", currentSettings.vttEnabled);
      vttMasterToggle.textContent = currentSettings.vttEnabled ? "ON" : "OFF";
    }

    // Voice sliders (keep whatever is stored in DOM; no persistence yet)
  }

  function openSettings() {
    applySettingsToUI();
    settingsOverlay?.classList.add("active");
  }

  function closeSettings() {
    settingsOverlay?.classList.remove("active");
  }

  settingsBtn?.addEventListener("click", openSettings);
  settingsCloseBtn?.addEventListener("click", closeSettings);

  personalityButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.preset;
      currentSettings.personality = key;
      applySettingsToUI();
    });
  });

  providerSelect?.addEventListener("change", () => {
    currentSettings.provider = providerSelect.value;
  });

  ttsToggle?.addEventListener("click", () => {
    currentSettings.ttsEnabled = !currentSettings.ttsEnabled;
    applySettingsToUI();
    setTTSEnabled(currentSettings.ttsEnabled);
  });

  vttMasterToggle?.addEventListener("click", () => {
    currentSettings.vttEnabled = !currentSettings.vttEnabled;
    applySettingsToUI();
    setVTTEnabled(currentSettings.vttEnabled);
  });

  settingsSaveBtn?.addEventListener("click", () => {
    saveSettings(currentSettings);
    closeSettings();
  });

  // Apply initial settings to TTS/VTT
  setTTSEnabled(currentSettings.ttsEnabled);
  setVTTEnabled(currentSettings.vttEnabled);
});
