// settings.js — FINAL WORKING VERSION

import { loadSettings, saveSettings } from "./personality.js";
import { setTTSEnabled } from "./tts.js";
import { setVTTEnabled } from "./vtt.js";

const settingsOverlay = document.getElementById("settingsOverlay");
const settingsBtn = document.getElementById("settingsBtn");
const settingsCloseBtn = document.getElementById("settingsCloseBtn");
const settingsSaveBtn = document.getElementById("settingsSaveBtn");

const personalityButtons = document.querySelectorAll(".personalityBtn");
const providerSelect = document.getElementById("providerSelect");

// SETTINGS PANEL TOGGLES
const ttsToggle = document.getElementById("ttsToggle");
const vttMasterToggle = document.getElementById("vttMasterToggle");

// INPUT BAR BUTTONS (REAL CONTROLS)
const ttsBtn = document.getElementById("ttsBtn");
const vttBtn = document.getElementById("vttBtn");

const voiceSelect = document.getElementById("voiceSelect");
const voiceRate = document.getElementById("voiceRate");
const voicePitch = document.getElementById("voicePitch");

let currentSettings = loadSettings();

/* -----------------------------
   APPLY SETTINGS TO UI
----------------------------- */
function applySettingsToUI() {
  personalityButtons.forEach((btn) => {
    btn.classList.toggle(
      "active",
      btn.dataset.preset === currentSettings.personality,
    );
  });

  if (providerSelect)
    providerSelect.value = currentSettings.provider || "openrouter";

  // Sync settings panel toggles
  if (ttsToggle) {
    ttsToggle.classList.toggle("active", currentSettings.ttsEnabled);
    ttsToggle.textContent = currentSettings.ttsEnabled ? "ON" : "OFF";
  }

  if (vttMasterToggle) {
    vttMasterToggle.classList.toggle("active", currentSettings.vttEnabled);
    vttMasterToggle.textContent = currentSettings.vttEnabled ? "ON" : "OFF";
  }

  // Sync input bar buttons
  if (ttsBtn) ttsBtn.classList.toggle("active", currentSettings.ttsEnabled);
  if (vttBtn) vttBtn.classList.toggle("active", currentSettings.vttEnabled);

  if (voiceSelect) voiceSelect.value = currentSettings.voice || "";
  if (voiceRate) voiceRate.value = currentSettings.rate || 1;
  if (voicePitch) voicePitch.value = currentSettings.pitch || 1;
}

/* -----------------------------
   OPEN / CLOSE SETTINGS
----------------------------- */
function openSettings() {
  applySettingsToUI();
  settingsOverlay?.classList.add("active");
}

function closeSettings() {
  settingsOverlay?.classList.remove("active");
}

settingsBtn?.addEventListener("click", openSettings);
settingsCloseBtn?.addEventListener("click", closeSettings);

/* -----------------------------
   PERSONALITY
----------------------------- */
personalityButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    currentSettings.personality = btn.dataset.preset;
    applySettingsToUI();
  });
});

/* -----------------------------
   PROVIDER
----------------------------- */
providerSelect?.addEventListener("change", () => {
  currentSettings.provider = providerSelect.value;
});

/* -----------------------------
   TTS TOGGLE (SETTINGS PANEL)
----------------------------- */
ttsToggle?.addEventListener("click", () => {
  currentSettings.ttsEnabled = !currentSettings.ttsEnabled;

  // Update both UI + engine
  setTTSEnabled(currentSettings.ttsEnabled);
  applySettingsToUI();
});

/* -----------------------------
   VTT TOGGLE (SETTINGS PANEL)
----------------------------- */
vttMasterToggle?.addEventListener("click", () => {
  currentSettings.vttEnabled = !currentSettings.vttEnabled;

  // Update both UI + engine
  setVTTEnabled(currentSettings.vttEnabled);
  applySettingsToUI();
});

/* -----------------------------
   VOICE SETTINGS
----------------------------- */
voiceSelect?.addEventListener("change", () => {
  currentSettings.voice = voiceSelect.value;
});

voiceRate?.addEventListener("input", () => {
  currentSettings.rate = parseFloat(voiceRate.value);
});

voicePitch?.addEventListener("input", () => {
  currentSettings.pitch = parseFloat(voicePitch.value);
});

/* -----------------------------
   SAVE BUTTON
----------------------------- */
settingsSaveBtn?.addEventListener("click", () => {
  saveSettings(currentSettings);
  closeSettings();
});

/* -----------------------------
   INITIAL SYNC (AFTER DOM READY)
----------------------------- */
window.addEventListener("DOMContentLoaded", () => {
  setTTSEnabled(currentSettings.ttsEnabled);
  setVTTEnabled(currentSettings.vttEnabled);
  applySettingsToUI();
});
