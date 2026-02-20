// settings.js

import { loadSettings, saveSettings } from "./personality.js";
import { setTTSEnabled } from "./tts.js";
import { setVTTEnabled } from "./vtt.js";

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
  personalityButtons.forEach((btn) => {
    btn.classList.toggle(
      "active",
      btn.dataset.preset === currentSettings.personality,
    );
  });

  if (providerSelect)
    providerSelect.value = currentSettings.provider || "openrouter";

  if (ttsToggle) {
    ttsToggle.classList.toggle("active", currentSettings.ttsEnabled);
    ttsToggle.textContent = currentSettings.ttsEnabled ? "ON" : "OFF";
  }

  if (vttMasterToggle) {
    vttMasterToggle.classList.toggle("active", currentSettings.vttEnabled);
    vttMasterToggle.textContent = currentSettings.vttEnabled ? "ON" : "OFF";
  }

  if (voiceSelect) voiceSelect.value = currentSettings.voice || "";
  if (voiceRate) voiceRate.value = currentSettings.rate || 1;
  if (voicePitch) voicePitch.value = currentSettings.pitch || 1;
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
    currentSettings.personality = btn.dataset.preset;
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

voiceSelect?.addEventListener("change", () => {
  currentSettings.voice = voiceSelect.value;
});

voiceRate?.addEventListener("input", () => {
  currentSettings.rate = parseFloat(voiceRate.value);
});

voicePitch?.addEventListener("input", () => {
  currentSettings.pitch = parseFloat(voicePitch.value);
});

settingsSaveBtn?.addEventListener("click", () => {
  saveSettings(currentSettings);
  closeSettings();
});

setTTSEnabled(currentSettings.ttsEnabled);
setVTTEnabled(currentSettings.vttEnabled);
