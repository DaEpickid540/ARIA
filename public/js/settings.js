// settings.js — full rebuild

import { loadSettings, saveSettings } from "./personality.js";
import { setTTSEnabled } from "./tts.js";
import { setVTTEnabled } from "./vtt.js";
import {
  renderMemoryPanel,
  addManualMemory,
  clearAllMemory,
  getAllFacts,
} from "./memory.js";
import {
  loadEmotionState,
  EMOTIONS,
  getEmotion,
  setEmotion,
} from "./personality.js";

/* ============================================================
   THEME DEFINITIONS
   ============================================================ */
export const THEMES = {
  red: {
    label: "Crimson",
    vars: {
      "--red-core": "#ff0000",
      "--red-hot": "#ff2200",
      "--red-neon": "#ff3333",
      "--red-deep": "#cc0000",
      "--red-dim": "#660000",
      "--red-ember": "#ff6633",
      "--accent-a": "#ff0000",
      "--accent-b": "#ff3333",
    },
  },
  cyan: {
    label: "Neon Cyan",
    vars: {
      "--red-core": "#00ffff",
      "--red-hot": "#00dddd",
      "--red-neon": "#33ffff",
      "--red-deep": "#008888",
      "--red-dim": "#004444",
      "--red-ember": "#00ffcc",
      "--accent-a": "#00ffff",
      "--accent-b": "#33ffff",
    },
  },
  green: {
    label: "Matrix",
    vars: {
      "--red-core": "#00ff41",
      "--red-hot": "#00cc33",
      "--red-neon": "#33ff66",
      "--red-deep": "#007722",
      "--red-dim": "#003311",
      "--red-ember": "#88ff00",
      "--accent-a": "#00ff41",
      "--accent-b": "#33ff66",
    },
  },
  purple: {
    label: "Synthwave",
    vars: {
      "--red-core": "#cc00ff",
      "--red-hot": "#aa00dd",
      "--red-neon": "#dd33ff",
      "--red-deep": "#660088",
      "--red-dim": "#330044",
      "--red-ember": "#ff44cc",
      "--accent-a": "#cc00ff",
      "--accent-b": "#ff44cc",
    },
  },
  orange: {
    label: "Ember",
    vars: {
      "--red-core": "#ff6600",
      "--red-hot": "#ff4400",
      "--red-neon": "#ff8833",
      "--red-deep": "#cc3300",
      "--red-dim": "#661100",
      "--red-ember": "#ffaa00",
      "--accent-a": "#ff6600",
      "--accent-b": "#ffaa00",
    },
  },
  gold: {
    label: "Gilded",
    vars: {
      "--red-core": "#ffd700",
      "--red-hot": "#ffbb00",
      "--red-neon": "#ffe033",
      "--red-deep": "#aa8800",
      "--red-dim": "#554400",
      "--red-ember": "#ffee88",
      "--accent-a": "#ffd700",
      "--accent-b": "#ffe033",
    },
  },
};

/* ============================================================
   APPLY THEME
   ============================================================ */
export function applyTheme(themeKey, darkMode = true) {
  const theme = THEMES[themeKey] || THEMES.red;
  const root = document.documentElement;

  // Apply accent color vars
  Object.entries(theme.vars).forEach(([k, v]) => root.style.setProperty(k, v));

  // Also update glow vars to match
  const core = theme.vars["--red-core"];
  root.style.setProperty("--glow-sm", `0 0 8px ${core}99`);
  root.style.setProperty("--glow-md", `0 0 16px ${core}bb, 0 0 32px ${core}55`);
  root.style.setProperty(
    "--glow-lg",
    `0 0 24px ${core}ee, 0 0 48px ${core}88, 0 0 80px ${core}33`,
  );
  root.style.setProperty(
    "--glow-ultra",
    `0 0 4px #fff, 0 0 14px ${core}, 0 0 40px ${core}, 0 0 80px ${core}88`,
  );
  root.style.setProperty("--border-cut", theme.vars["--red-dim"]);
  root.style.setProperty("--border-glow", theme.vars["--red-deep"]);

  // Dark / light mode
  if (darkMode) {
    root.style.setProperty("--bg-void", "#000000");
    root.style.setProperty("--bg-abyss", "#030303");
    root.style.setProperty("--bg-panel", "#080808");
    root.style.setProperty("--bg-elevated", "#0d0d0d");
    root.style.setProperty("--bg-raised", "#111111");
    root.style.setProperty("--text-blaze", "#ffffff");
    root.style.setProperty("--text-hot", core + "cc");
    root.style.setProperty("--text-muted", "#444444");
    root.classList.remove("light-mode");
  } else {
    root.style.setProperty("--bg-void", "#f0f0f0");
    root.style.setProperty("--bg-abyss", "#e8e8e8");
    root.style.setProperty("--bg-panel", "#d8d8d8");
    root.style.setProperty("--bg-elevated", "#cccccc");
    root.style.setProperty("--bg-raised", "#c0c0c0");
    root.style.setProperty("--text-blaze", "#111111");
    root.style.setProperty("--text-hot", "#333333");
    root.style.setProperty("--text-muted", "#888888");
    root.classList.add("light-mode");
  }

  // Update theme swatches active state
  document.querySelectorAll(".themeSwatch").forEach((s) => {
    s.classList.toggle("active", s.dataset.theme === themeKey);
  });
}

/* ============================================================
   DOM REFS
   ============================================================ */
const settingsOverlay = document.getElementById("settingsOverlay");
const settingsBtn = document.getElementById("settingsBtn");
const settingsCloseBtn = document.getElementById("settingsCloseBtn");
const settingsSaveBtn = document.getElementById("settingsSaveBtn");
const personalityButtons = document.querySelectorAll(".personalityBtn");
const providerSelect = document.getElementById("providerSelect");
const ttsToggle = document.getElementById("ttsToggle");
const vttMasterToggle = document.getElementById("vttMasterToggle");
const ttsBtn = document.getElementById("ttsBtn");
const vttBtn = document.getElementById("vttBtn");
const voiceSelect = document.getElementById("voiceSelect");
const voiceRate = document.getElementById("voiceRate");
const voicePitch = document.getElementById("voicePitch");

let currentSettings = loadSettings();

/* ============================================================
   APPLY ALL SETTINGS TO UI
   ============================================================ */
function applySettingsToUI() {
  // Personality
  personalityButtons.forEach((btn) =>
    btn.classList.toggle(
      "active",
      btn.dataset.preset === currentSettings.personality,
    ),
  );

  // Provider
  if (providerSelect)
    providerSelect.value = currentSettings.provider || "openrouter";

  // TTS toggle
  if (ttsToggle) {
    ttsToggle.classList.toggle("active", currentSettings.ttsEnabled);
    ttsToggle.textContent = currentSettings.ttsEnabled ? "ON" : "OFF";
  }
  if (vttMasterToggle) {
    vttMasterToggle.classList.toggle("active", currentSettings.vttEnabled);
    vttMasterToggle.textContent = currentSettings.vttEnabled ? "ON" : "OFF";
  }
  if (ttsBtn) ttsBtn.classList.toggle("active", currentSettings.ttsEnabled);
  if (vttBtn) vttBtn.classList.toggle("active", currentSettings.vttEnabled);

  // Voice
  if (voiceSelect && currentSettings.voice)
    voiceSelect.value = currentSettings.voice;
  if (voiceRate) voiceRate.value = currentSettings.rate ?? 1;
  if (voicePitch) voicePitch.value = currentSettings.pitch ?? 1;

  // Theme
  applyTheme(
    currentSettings.theme || "red",
    currentSettings.darkMode !== false,
  );

  // Dark mode toggle
  const darkToggle = document.getElementById("darkModeToggle");
  if (darkToggle) {
    darkToggle.classList.toggle("active", currentSettings.darkMode !== false);
    darkToggle.textContent = currentSettings.darkMode !== false ? "ON" : "OFF";
  }

  // Feature toggles
  ["glitchEffects", "scanlines", "sendOnEnter", "showTimestamps"].forEach(
    (key) => {
      const el = document.getElementById(`toggle_${key}`);
      if (el) {
        el.classList.toggle("active", currentSettings[key] !== false);
        el.textContent = currentSettings[key] !== false ? "ON" : "OFF";
      }
    },
  );

  // Font size
  const fsEl = document.getElementById("fontSizeSelect");
  if (fsEl) fsEl.value = currentSettings.fontSize || "medium";
  applyFontSize(currentSettings.fontSize || "medium");

  // Custom voices list
  renderCustomVoiceList();

  // Memory panel
  renderMemoryPanel();
}

function applyFontSize(size) {
  const map = { small: "11px", medium: "13px", large: "15px" };
  document.documentElement.style.setProperty(
    "--chat-font-size",
    map[size] || "13px",
  );
}

/* ============================================================
   OPEN / CLOSE
   ============================================================ */
function openSettings() {
  applySettingsToUI();
  settingsOverlay?.classList.add("active");
  // Default to first tab
  switchSettingsTab("appearance");
}
function closeSettings() {
  settingsOverlay?.classList.remove("active");
}

settingsBtn?.addEventListener("click", openSettings);
settingsCloseBtn?.addEventListener("click", closeSettings);
settingsOverlay?.addEventListener("click", (e) => {
  if (e.target === settingsOverlay) closeSettings();
});

/* ============================================================
   SETTINGS TABS
   ============================================================ */
export function switchSettingsTab(tabName) {
  document
    .querySelectorAll(".settingsTab")
    .forEach((t) => t.classList.toggle("active", t.dataset.tab === tabName));
  document
    .querySelectorAll(".settingsTabPane")
    .forEach((p) => p.classList.toggle("active", p.dataset.pane === tabName));
}

window.ARIA_switchSettingsTab = switchSettingsTab;

/* ============================================================
   PERSONALITY BUTTONS
   ============================================================ */
personalityButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    currentSettings.personality = btn.dataset.preset;
    applySettingsToUI();
  });
});

/* ============================================================
   PROVIDER
   ============================================================ */
providerSelect?.addEventListener("change", () => {
  currentSettings.provider = providerSelect.value;
});

/* ============================================================
   TTS / VTT TOGGLES
   ============================================================ */
ttsToggle?.addEventListener("click", () => {
  currentSettings.ttsEnabled = !currentSettings.ttsEnabled;
  setTTSEnabled(currentSettings.ttsEnabled);
  applySettingsToUI();
});

vttMasterToggle?.addEventListener("click", () => {
  currentSettings.vttEnabled = !currentSettings.vttEnabled;
  setVTTEnabled(currentSettings.vttEnabled);
  applySettingsToUI();
});

/* ============================================================
   VOICE
   ============================================================ */
voiceSelect?.addEventListener("change", () => {
  currentSettings.voice = voiceSelect.value;
});
voiceRate?.addEventListener("input", () => {
  currentSettings.rate = parseFloat(voiceRate.value);
});
voicePitch?.addEventListener("input", () => {
  currentSettings.pitch = parseFloat(voicePitch.value);
});

/* ============================================================
   DARK MODE TOGGLE
   ============================================================ */
document.getElementById("darkModeToggle")?.addEventListener("click", () => {
  currentSettings.darkMode = !currentSettings.darkMode;
  applySettingsToUI();
});

/* ============================================================
   THEME SWATCHES
   ============================================================ */
document.querySelectorAll(".themeSwatch").forEach((swatch) => {
  swatch.addEventListener("click", () => {
    currentSettings.theme = swatch.dataset.theme;
    applyTheme(currentSettings.theme, currentSettings.darkMode !== false);
    document
      .querySelectorAll(".themeSwatch")
      .forEach((s) => s.classList.toggle("active", s === swatch));
  });
});

/* ============================================================
   FEATURE TOGGLES
   ============================================================ */
["glitchEffects", "scanlines", "sendOnEnter", "showTimestamps"].forEach(
  (key) => {
    document.getElementById(`toggle_${key}`)?.addEventListener("click", () => {
      currentSettings[key] = currentSettings[key] === false ? true : false;
      applySettingsToUI();
      // Apply scanlines immediately
      if (key === "scanlines")
        document.body.classList.toggle("no-scanlines", !currentSettings[key]);
      if (key === "glitchEffects")
        document.body.classList.toggle("no-glitch", !currentSettings[key]);
    });
  },
);

/* ============================================================
   FONT SIZE
   ============================================================ */
document.getElementById("fontSizeSelect")?.addEventListener("change", (e) => {
  currentSettings.fontSize = e.target.value;
  applyFontSize(e.target.value);
});

/* ============================================================
   CUSTOM VOICE UPLOAD
   ============================================================ */
function renderCustomVoiceList() {
  const list = document.getElementById("customVoiceList");
  if (!list) return;
  const voices = currentSettings.customVoices || [];
  if (!voices.length) {
    list.innerHTML = `<div class="memEmpty">No custom voices added yet.</div>`;
    return;
  }
  list.innerHTML = voices
    .map(
      (v, i) => `
    <div class="customVoiceItem">
      <span class="memCategory">custom</span>
      <span class="memText">${v.name}</span>
      <button class="memDelete" onclick="window.ARIA_removeCustomVoice(${i})">✕</button>
    </div>
  `,
    )
    .join("");
}

window.ARIA_removeCustomVoice = (idx) => {
  currentSettings.customVoices.splice(idx, 1);
  renderCustomVoiceList();
};

document.getElementById("addCustomVoiceBtn")?.addEventListener("click", () => {
  const nameEl = document.getElementById("customVoiceName");
  const fileEl = document.getElementById("customVoiceFile");
  const name = nameEl?.value.trim();
  if (!name || !fileEl?.files[0]) {
    alert("Please enter a name and select an audio file.");
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    if (!currentSettings.customVoices) currentSettings.customVoices = [];
    currentSettings.customVoices.push({ name, dataUrl: e.target.result });
    if (nameEl) nameEl.value = "";
    renderCustomVoiceList();
    // Add to voice select
    addCustomVoiceToSelect(name, e.target.result);
  };
  reader.readAsDataURL(fileEl.files[0]);
});

function addCustomVoiceToSelect(name, dataUrl) {
  const sel = document.getElementById("voiceSelect");
  if (!sel) return;
  const existing = sel.querySelector(`[data-custom="${name}"]`);
  if (existing) return;
  const opt = document.createElement("option");
  opt.value = "custom:" + name;
  opt.textContent = `⚡ ${name} (Custom)`;
  opt.dataset.custom = name;
  opt.dataset.url = dataUrl;
  sel.appendChild(opt);
}

/* Load custom voices into select on init */
function loadCustomVoicesIntoSelect() {
  (currentSettings.customVoices || []).forEach((v) =>
    addCustomVoiceToSelect(v.name, v.dataUrl),
  );
}

/* ============================================================
   MEMORY PANEL — ADD / CLEAR
   ============================================================ */
document.getElementById("addMemoryBtn")?.addEventListener("click", () => {
  const input = document.getElementById("memoryAddInput");
  const catEl = document.getElementById("memoryCategorySelect");
  if (!input?.value.trim()) return;
  addManualMemory(input.value, catEl?.value || "note");
  input.value = "";
});

document.getElementById("clearMemoryBtn")?.addEventListener("click", () => {
  if (confirm("Clear ALL of ARIA's memories? This cannot be undone."))
    clearAllMemory();
});

/* ============================================================
   EMOTION DISPLAY
   ============================================================ */
function renderEmotionSummary() {
  const el = document.getElementById("emotionSummaryDisplay");
  if (!el) return;
  const current = getEmotion();
  const e = EMOTIONS[current] || EMOTIONS.neutral;
  el.innerHTML = `
    <div class="emotionCurrent" style="color:${e.color}; text-shadow: 0 0 8px ${e.color}">
      ${e.icon} ${e.label.toUpperCase()}
    </div>
    <div style="font-size:10px; color: var(--text-muted); margin-top:4px;">
      ARIA's current emotional state — shifts naturally with conversation
    </div>
  `;

  // Manual override buttons
  const btnsEl = document.getElementById("emotionOverrideBtns");
  if (btnsEl) {
    btnsEl.innerHTML = Object.entries(EMOTIONS)
      .map(
        ([key, val]) => `
      <button class="emotionOverrideBtn ${current === key ? "active" : ""}"
        style="--em-color: ${val.color}"
        onclick="window.ARIA_setEmotion('${key}')"
      >${val.icon} ${val.label}</button>
    `,
      )
      .join("");
  }
}

window.ARIA_setEmotion = (key) => {
  setEmotion(key);
  renderEmotionSummary();
};

/* ============================================================
   SAVE
   ============================================================ */
settingsSaveBtn?.addEventListener("click", () => {
  saveSettings(currentSettings);
  closeSettings();

  // Toast notification
  const toast = document.getElementById("settingsToast");
  if (toast) {
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 2200);
  }
});

/* ============================================================
   EXPORT / IMPORT SETTINGS
   ============================================================ */
document.getElementById("exportSettingsBtn")?.addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(currentSettings, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "aria-settings.json";
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById("importSettingsBtn")?.addEventListener("click", () => {
  document.getElementById("importSettingsFile")?.click();
});

document
  .getElementById("importSettingsFile")
  ?.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const imported = JSON.parse(ev.target.result);
        currentSettings = { ...currentSettings, ...imported };
        applySettingsToUI();
      } catch {
        alert("Invalid settings file.");
      }
    };
    reader.readAsText(file);
  });

/* ============================================================
   INIT ON DOM READY
   ============================================================ */
window.addEventListener("DOMContentLoaded", () => {
  setTTSEnabled(currentSettings.ttsEnabled);
  setVTTEnabled(currentSettings.vttEnabled);
  applySettingsToUI();
  loadEmotionState();
  loadCustomVoicesIntoSelect();
  renderEmotionSummary();

  // Open settings tabs on click
  document.querySelectorAll(".settingsTab").forEach((t) => {
    t.addEventListener("click", () => switchSettingsTab(t.dataset.tab));
  });
});
