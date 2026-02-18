// settings.js

import { saveSettings, loadSettings } from "./personality.js";
import { enableTTS, disableTTS, ttsEnabled } from "./tts.js";
import { enableVTT, disableVTT, vttEnabled } from "./vtt.js";

console.log("SETTINGS.JS LOADED");

const settingsBtn = document.getElementById("settingsBtn");
const settingsOverlay = document.getElementById("settingsOverlay");
const closeSettingsBtn = document.getElementById("closeSettingsBtn");

const providerSelect = document.getElementById("providerSelect");
const personalitySelect = document.getElementById("personalitySelect");

const ttsToggle = document.getElementById("ttsToggle");
const vttToggle = document.getElementById("vttToggle");

// Load saved settings
let current = loadSettings();
applySettingsToUI(current);

/* -----------------------------
   OPEN / CLOSE SETTINGS
----------------------------- */
settingsBtn?.addEventListener("click", () => {
  settingsOverlay.style.display = "flex";
});

closeSettingsBtn?.addEventListener("click", () => {
  settingsOverlay.style.display = "none";
});

/* -----------------------------
   PROVIDER + PERSONALITY
----------------------------- */
providerSelect?.addEventListener("change", () => {
  current.provider = providerSelect.value;
  saveSettings(current);
});

personalitySelect?.addEventListener("change", () => {
  current.personality = personalitySelect.value;
  saveSettings(current);
});

/* -----------------------------
   TTS TOGGLE
----------------------------- */
ttsToggle?.addEventListener("change", () => {
  if (ttsToggle.checked) {
    enableTTS();
  } else {
    disableTTS();
  }
});

/* -----------------------------
   VTT TOGGLE
----------------------------- */
vttToggle?.addEventListener("change", () => {
  if (vttToggle.checked) {
    enableVTT();
  } else {
    disableVTT();
  }
});

/* -----------------------------
   APPLY SETTINGS TO UI
----------------------------- */
function applySettingsToUI(settings) {
  if (!settings) return;

  providerSelect.value = settings.provider || "openrouter";
  personalitySelect.value = settings.personality || "hacker";

  ttsToggle.checked = ttsEnabled;
  vttToggle.checked = vttEnabled;
}
