// settings.js — fixed: all DOM access deferred to DOMContentLoaded

import { loadSettings, saveSettings } from "./personality.js";
import {
  setTTSEnabled,
  setVoiceMode,
  setElevenLabsConfig,
  populateVoiceSelect,
  fetchElevenLabsVoices,
  injectElevenLabsVoices,
  loadEnvVoiceKey,
} from "./tts.js";
import { setVTTEnabled } from "./vtt.js";
import {
  renderMemoryPanel,
  addManualMemory,
  clearAllMemory,
} from "./memory.js";
import {
  loadEmotionState,
  EMOTIONS,
  getEmotion,
  setEmotion,
} from "./personality.js";

/* ============================================================
   THEMES
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
    },
  },
  gold:   { label:"Gilded",   vars:{"--red-core":"#ffd700","--red-hot":"#ffbb00","--red-neon":"#ffe033","--red-deep":"#aa8800","--red-dim":"#554400","--red-ember":"#ffee88"} },
  pink:   { label:"Hot Pink",  vars:{"--red-core":"#ff0099","--red-hot":"#ff33aa","--red-neon":"#ff55bb","--red-deep":"#aa0066","--red-dim":"#550033","--red-ember":"#ff66cc"} },
  ice:    { label:"Ice Blue",  vars:{"--red-core":"#00aaff","--red-hot":"#00ccff","--red-neon":"#33bbff","--red-deep":"#006699","--red-dim":"#002244","--red-ember":"#00ddff"} },
  toxic:  { label:"Toxic",     vars:{"--red-core":"#aaff00","--red-hot":"#bbff33","--red-neon":"#ccff44","--red-deep":"#558800","--red-dim":"#224400","--red-ember":"#ddff88"} },
  mono:   { label:"Ghost",     vars:{"--red-core":"#cccccc","--red-hot":"#dddddd","--red-neon":"#eeeeee","--red-deep":"#888888","--red-dim":"#333333","--red-ember":"#aaaaaa"} },
  blood:  { label:"Blood",     vars:{"--red-core":"#880000","--red-hot":"#aa0000","--red-neon":"#aa1111","--red-deep":"#550000","--red-dim":"#220000","--red-ember":"#cc2222"} },
  teal:   { label:"Teal",      vars:{"--red-core":"#00ffcc","--red-hot":"#00ddaa","--red-neon":"#33ffdd","--red-deep":"#008866","--red-dim":"#003322","--red-ember":"#00ffaa"} },
  solar:  { label:"Solar",     vars:{"--red-core":"#ffaa00","--red-hot":"#ff8800","--red-neon":"#ffbb33","--red-deep":"#cc6600","--red-dim":"#553300","--red-ember":"#ffdd88"} },
  violet: { label:"Violet",    vars:{"--red-core":"#8844ff","--red-hot":"#aa66ff","--red-neon":"#bb88ff","--red-deep":"#441188","--red-dim":"#220044","--red-ember":"#cc99ff"} },
  rose:   { label:"Rose",      vars:{"--red-core":"#ff4466","--red-hot":"#ff6688","--red-neon":"#ff88aa","--red-deep":"#aa1133","--red-dim":"#550011","--red-ember":"#ffaacc"} },
  cobalt: { label:"Cobalt",    vars:{"--red-core":"#0066ff","--red-hot":"#3388ff","--red-neon":"#55aaff","--red-deep":"#003388","--red-dim":"#001144","--red-ember":"#88ccff"} },
};

export function applyTheme(themeKey, darkMode = true) {
  const theme = THEMES[themeKey] || THEMES.red;
  const root = document.documentElement;
  const core = theme.vars["--red-core"];

  Object.entries(theme.vars).forEach(([k, v]) => root.style.setProperty(k, v));
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

  document.querySelectorAll(".themeSwatch")
    .forEach(s => s.classList.toggle("active", s.dataset.theme === themeKey));

  // Apply scanline color to match theme
  const rgb = hexToRgb(core);
  if (rgb) document.documentElement.style.setProperty("--scanline-rgb", `${rgb.r},${rgb.g},${rgb.b}`);
}

function hexToRgb(hex) {
  const m = hex.replace("#","").match(/([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
  return m ? { r:parseInt(m[1],16), g:parseInt(m[2],16), b:parseInt(m[3],16) } : null;
}

export function applyAccentColor(hex) {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return;
  const root = document.documentElement;
  root.style.setProperty("--red-core",  hex);
  root.style.setProperty("--red-hot",   hex + "cc");
  root.style.setProperty("--red-neon",  hex + "ee");
  root.style.setProperty("--red-deep",  hex + "88");
  root.style.setProperty("--red-dim",   hex + "44");
  root.style.setProperty("--glow-sm",   `0 0 8px ${hex}99`);
  root.style.setProperty("--glow-md",   `0 0 16px ${hex}bb, 0 0 32px ${hex}55`);
  root.style.setProperty("--glow-lg",   `0 0 24px ${hex}ee, 0 0 48px ${hex}88, 0 0 80px ${hex}33`);
  const rgb = hexToRgb(hex);
  if (rgb) root.style.setProperty("--scanline-rgb", `${rgb.r},${rgb.g},${rgb.b}`);
}

export function applyFont(fontKey) {
  const fonts = {
    mono:    '"Share Tech Mono", "Courier New", monospace',
    orbitron:'"Orbitron", "Share Tech Mono", monospace',
    inter:   '"Inter", "Segoe UI", Arial, sans-serif',
    jetbrains:'"JetBrains Mono", "Share Tech Mono", monospace',
    fira:    '"Fira Code", "Share Tech Mono", monospace',
  };
  document.documentElement.style.setProperty("--ui-font", fonts[fontKey] || fonts.mono);
  document.body.style.fontFamily = fonts[fontKey] || fonts.mono;
}

const BG_ANIMATIONS = {
  none:    "",
  grid:    "aria-bg-grid",
  rain:    "aria-bg-rain",
  stars:   "aria-bg-stars",
  circuit: "aria-bg-circuit",
  pulse:   "aria-bg-pulse",
};

export function applyBgAnimation(key) {
  const body = document.body;
  Object.values(BG_ANIMATIONS).forEach(c => { if (c) body.classList.remove(c); });
  if (BG_ANIMATIONS[key]) body.classList.add(BG_ANIMATIONS[key]);
}

export function applyAmoled(on) {
  const root = document.documentElement;
  if (on) {
    root.style.setProperty("--bg-void",    "#000000");
    root.style.setProperty("--bg-abyss",   "#000000");
    root.style.setProperty("--bg-panel",   "#050505");
    root.style.setProperty("--bg-raised",  "#0a0a0a");
  }
}

export function applyBrightness(val) {
  // val = 0.3 (dim) to 1.5 (bright). 1.0 = normal
  document.documentElement.style.setProperty("--brightness", String(val));
  document.body.style.filter = val === 1 ? "" : `brightness(${val})`;
}

/* ============================================================
   TAB SWITCHING — pure function, no DOM cached at top level
   ============================================================ */
export function switchSettingsTab(tabName) {
  document
    .querySelectorAll(".settingsTab")
    .forEach((t) => t.classList.toggle("active", t.dataset.tab === tabName));
  document
    .querySelectorAll(".settingsTabPane")
    .forEach((p) => p.classList.toggle("active", p.dataset.pane === tabName));
  if (tabName === "emotion") renderEmotionSummary();
  if (tabName === "memory") renderMemoryPanel();
  if (tabName === "voice") populateVoiceSelect();
}
window.ARIA_switchSettingsTab = switchSettingsTab;

/* ============================================================
   SETTINGS STATE — loaded once at module level (no DOM needed)
   ============================================================ */
let currentSettings = loadSettings();

/* ============================================================
   HELPERS
   ============================================================ */
function syncToggle(id, isOn) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.toggle("active", !!isOn);
  el.textContent = isOn ? "ON" : "OFF";
}

function applyFontSize(size) {
  const map = { small: "11px", medium: "13px", large: "15px" };
  document.documentElement.style.setProperty(
    "--chat-font-size",
    map[size] || "13px",
  );
}

function showToast(msg, isError = false) {
  const toast = document.getElementById("settingsToast");
  if (!toast) return;
  toast.textContent = msg;
  toast.className = "show" + (isError ? " error" : "");
  setTimeout(() => {
    toast.classList.remove("show", "error");
    toast.textContent = "✓ Settings saved";
  }, 3000);
}
window.ARIA_showToast = showToast;

/* ============================================================
   APPLY ALL SETTINGS TO UI
   (called every time settings panel opens or a value changes)
   ============================================================ */
function applySettingsToUI() {
  // Personality
  document
    .querySelectorAll(".personalityBtn")
    .forEach((btn) =>
      btn.classList.toggle(
        "active",
        btn.dataset.preset === currentSettings.personality,
      ),
    );

  // Provider
  const provSel = document.getElementById("providerSelect");
  if (provSel) provSel.value = currentSettings.provider || "openrouter";

  // TTS / VTT toggles
  syncToggle("ttsToggle", currentSettings.ttsEnabled);
  syncToggle("vttMasterToggle", currentSettings.vttEnabled);
  const ttsBtn = document.getElementById("ttsBtn");
  const vttBtn = document.getElementById("vttBtn");
  if (ttsBtn) ttsBtn.classList.toggle("active", !!currentSettings.ttsEnabled);
  if (vttBtn) vttBtn.classList.toggle("active", !!currentSettings.vttEnabled);

  // Voice sliders
  const rateEl = document.getElementById("voiceRate");
  const pitchEl = document.getElementById("voicePitch");
  const volEl = document.getElementById("voiceVolume");
  if (rateEl) {
    rateEl.value = currentSettings.rate ?? 1;
    document.getElementById("rateDisplay") &&
      (rateDisplay.textContent = parseFloat(rateEl.value).toFixed(1));
  }
  if (pitchEl) {
    pitchEl.value = currentSettings.pitch ?? 1;
    document.getElementById("pitchDisplay") &&
      (pitchDisplay.textContent = parseFloat(pitchEl.value).toFixed(1));
  }
  if (volEl) {
    volEl.value = currentSettings.volume ?? 1;
    document.getElementById("volDisplay") &&
      (volDisplay.textContent = parseFloat(volEl.value).toFixed(2));
  }

  // Language filters
  const langEl = document.getElementById("voiceLangFilter");
  if (langEl && currentSettings.voiceLang)
    langEl.value = currentSettings.voiceLang;
  const vttLangEl = document.getElementById("vttLangSelect");
  if (vttLangEl && currentSettings.vttLang)
    vttLangEl.value = currentSettings.vttLang;

  // Theme & dark mode
  applyTheme(
    currentSettings.theme || "red",
    currentSettings.darkMode !== false,
  );
  syncToggle("darkModeToggle", currentSettings.darkMode !== false);

  // Brightness
  const brightEl = document.getElementById("brightnessSlider");
  if (brightEl) {
    brightEl.value = currentSettings.brightness ?? 1;
    const bd = document.getElementById("brightnessDisplay");
    if (bd) bd.textContent = parseFloat(brightEl.value).toFixed(2);
  }
  applyBrightness(currentSettings.brightness ?? 1);

  // Feature toggles
  ["glitchEffects", "scanlines", "sendOnEnter", "showTimestamps"].forEach((k) =>
    syncToggle("toggle_" + k, currentSettings[k] !== false),
  );
  document.body.classList.toggle(
    "no-scanlines",
    currentSettings.scanlines === false,
  );
  document.body.classList.toggle(
    "no-glitch",
    currentSettings.glitchEffects === false,
  );

  // Font size
  const fsEl = document.getElementById("fontSizeSelect");
  if (fsEl) fsEl.value = currentSettings.fontSize || "medium";
  applyFontSize(currentSettings.fontSize || "medium");

  // EL key
  const elKeyEl = document.getElementById("elApiKey");
  if (elKeyEl && currentSettings.elApiKey)
    elKeyEl.value = currentSettings.elApiKey;

  // Custom voices list
  renderCustomVoiceList();

  // Memory & emotion
  renderMemoryPanel();
  renderEmotionSummary();
}

/* ============================================================
   CUSTOM VOICES
   ============================================================ */
function renderCustomVoiceList() {
  const list = document.getElementById("customVoiceList");
  if (!list) return;
  const voices = currentSettings.customVoices || [];
  if (!voices.length) {
    list.innerHTML = `<div class="memEmpty">No custom voices yet. Add an ElevenLabs voice or upload an audio file below.</div>`;
    return;
  }
  list.innerHTML = voices
    .map((v, i) => {
      const val = v.elVoiceId ? "el:" + v.elVoiceId : "custom:" + v.name;
      const active = currentSettings.voice === val;
      return `
      <div class="customVoiceItem ${active ? "active" : ""}">
        <div class="cviLeft">
          <span class="cviType">${v.elVoiceId ? "⚡ EL" : "🎙 FILE"}</span>
          <div>
            <div class="cviName">${v.name}</div>
            <div class="cviDesc">${v.elVoiceId ? "ElevenLabs: " + v.elVoiceId : v.fileName || "audio file"}</div>
          </div>
        </div>
        <div class="cviActions">
          <button class="cviSelectBtn ${active ? "active" : ""}" onclick="window.ARIA_selectCustomVoice(${i})">
            ${active ? "✓ ACTIVE" : "USE"}
          </button>
          <button class="cviDeleteBtn" onclick="window.ARIA_removeCustomVoice(${i})">✕</button>
        </div>
      </div>`;
    })
    .join("");
}

window.ARIA_removeCustomVoice = (idx) => {
  currentSettings.customVoices.splice(idx, 1);
  saveSettings(currentSettings);
  renderCustomVoiceList();
  populateVoiceSelect();
};

window.ARIA_selectCustomVoice = (idx) => {
  const v = currentSettings.customVoices?.[idx];
  if (!v) return;
  const val = v.elVoiceId ? "el:" + v.elVoiceId : "custom:" + v.name;
  currentSettings.voice = val;
  const sel = document.getElementById("voiceSelect");
  if (sel) sel.value = val;
  if (v.elVoiceId) {
    setVoiceMode("elevenlabs");
    setElevenLabsConfig(currentSettings.elApiKey, v.elVoiceId);
  } else {
    setVoiceMode("custom");
  }
  saveSettings(currentSettings);
  renderCustomVoiceList();
};

/* ============================================================
   ELEVENLABS
   ============================================================ */
async function validateAndLoadElevenLabs() {
  const keyEl = document.getElementById("elApiKey");
  const statusEl = document.getElementById("elKeyStatus");
  const apiKey = keyEl?.value.trim();
  if (!apiKey) {
    if (statusEl) statusEl.textContent = "Enter your API key first.";
    return;
  }
  if (statusEl) {
    statusEl.textContent = "⏳ Validating...";
    statusEl.className = "elStatus";
  }

  const voices = await fetchElevenLabsVoices(apiKey);
  if (!voices.length) {
    if (statusEl) {
      statusEl.textContent = "✗ Invalid key or no voices found.";
      statusEl.className = "elStatus error";
    }
    return;
  }

  currentSettings.elApiKey = apiKey;
  setElevenLabsConfig(
    apiKey,
    currentSettings.voice?.startsWith("el:")
      ? currentSettings.voice.slice(3)
      : "",
  );
  if (statusEl) {
    statusEl.textContent = `✓ Connected — ${voices.length} voice${voices.length !== 1 ? "s" : ""} found.`;
    statusEl.className = "elStatus ok";
  }

  const elSelEl = document.getElementById("elVoiceSelect");
  if (elSelEl) {
    elSelEl.innerHTML = voices
      .map(
        (v) =>
          `<option value="${v.id}">${v.name}${v.category ? " — " + v.category : ""}</option>`,
      )
      .join("");
  }
  injectElevenLabsVoices(voices);
  currentSettings.elVoices = voices;
  saveSettings(currentSettings);
}

/* ============================================================
   FILE VOICE UPLOAD
   ============================================================ */
function handleFileVoiceAdd() {
  const nameEl = document.getElementById("customVoiceName");
  const fileEl = document.getElementById("customVoiceFile");
  const name = nameEl?.value.trim();
  if (!name) {
    showToast("Enter a name for this voice.", true);
    return;
  }
  if (!fileEl?.files[0]) {
    showToast("Select an audio file.", true);
    return;
  }
  const file = fileEl.files[0];
  if (!file.type.startsWith("audio/")) {
    showToast("Must be an audio file (MP3, WAV, OGG).", true);
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    if (!currentSettings.customVoices) currentSettings.customVoices = [];
    if (currentSettings.customVoices.some((v) => v.name === name)) {
      showToast("A voice with that name already exists.", true);
      return;
    }
    currentSettings.customVoices.push({
      name,
      dataUrl: e.target.result,
      fileName: file.name,
    });
    if (nameEl) nameEl.value = "";
    if (fileEl) fileEl.value = "";
    const fnEl = document.getElementById("customVoiceFileName");
    if (fnEl) fnEl.textContent = "No file selected";
    renderCustomVoiceList();
    populateVoiceSelect();
    saveSettings(currentSettings);
    showToast(`Voice "${name}" added.`);
  };
  reader.readAsDataURL(file);
}

/* ============================================================
   EMOTION
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
    <div class="settingsHint" style="margin-top:6px">
      Shifts naturally through conversation. Override below.
    </div>`;
  const btns = document.getElementById("emotionOverrideBtns");
  if (btns) {
    btns.innerHTML = Object.entries(EMOTIONS)
      .map(
        ([key, val]) => `
      <button class="emotionOverrideBtn ${current === key ? "active" : ""}"
        style="--em-color:${val.color}"
        onclick="window.ARIA_setEmotion('${key}')"
      >${val.icon} ${val.label}</button>`,
      )
      .join("");
  }
}
window.ARIA_setEmotion = (key) => {
  setEmotion(key);
  renderEmotionSummary();
};

/* ============================================================
   OPEN / CLOSE  — defined inside init so DOM is guaranteed ready
   ============================================================ */
function openSettings() {
  applySettingsToUI();
  populateVoiceSelect();
  document.getElementById("settingsOverlay")?.classList.add("active");
  switchSettingsTab("appearance");
}
function closeSettings() {
  document.getElementById("settingsOverlay")?.classList.remove("active");
}
window.ARIA_openSettings = openSettings;
window.ARIA_closeSettings = closeSettings;

/* ============================================================
   WIRE ALL EVENT LISTENERS — called once inside DOMContentLoaded
   ============================================================ */
function wireAllControls() {
  // ── Settings open / close ──
  document
    .getElementById("settingsBtn")
    ?.addEventListener("click", openSettings);
  document
    .getElementById("settingsCloseBtn")
    ?.addEventListener("click", closeSettings);
  document.getElementById("settingsOverlay")?.addEventListener("click", (e) => {
    if (e.target === document.getElementById("settingsOverlay"))
      closeSettings();
  });

  // ── Tab buttons ──
  document
    .querySelectorAll(".settingsTab")
    .forEach((t) =>
      t.addEventListener("click", () => switchSettingsTab(t.dataset.tab)),
    );

  // ── Personality ──
  document.querySelectorAll(".personalityBtn").forEach((btn) =>
    btn.addEventListener("click", () => {
      currentSettings.personality = btn.dataset.preset;
      applySettingsToUI();
    }),
  );

  // ── Provider ──
  document.getElementById("providerSelect")?.addEventListener("change", (e) => {
    currentSettings.provider = e.target.value;
  });

  // ── TTS toggle ──
  document.getElementById("ttsToggle")?.addEventListener("click", () => {
    currentSettings.ttsEnabled = !currentSettings.ttsEnabled;
    setTTSEnabled(currentSettings.ttsEnabled);
    syncToggle("ttsToggle", currentSettings.ttsEnabled);
    const ttsBtn = document.getElementById("ttsBtn");
    if (ttsBtn) ttsBtn.classList.toggle("active", currentSettings.ttsEnabled);
  });

  // ── VTT toggle ──
  document.getElementById("vttMasterToggle")?.addEventListener("click", () => {
    currentSettings.vttEnabled = !currentSettings.vttEnabled;
    setVTTEnabled(currentSettings.vttEnabled);
    syncToggle("vttMasterToggle", currentSettings.vttEnabled);
    const vttBtn = document.getElementById("vttBtn");
    if (vttBtn) vttBtn.classList.toggle("active", currentSettings.vttEnabled);
  });

  // ── Voice select ──
  document.getElementById("voiceSelect")?.addEventListener("change", (e) => {
    const val = e.target.value;
    currentSettings.voice = val;
    if (val.startsWith("el:")) {
      setVoiceMode("elevenlabs");
      setElevenLabsConfig(currentSettings.elApiKey, val.slice(3));
    } else if (val.startsWith("custom:")) {
      setVoiceMode("custom");
    } else {
      setVoiceMode("browser");
    }
  });

  // ── Voice sliders ──
  document.getElementById("voiceRate")?.addEventListener("input", (e) => {
    currentSettings.rate = parseFloat(e.target.value);
    const d = document.getElementById("rateDisplay");
    if (d) d.textContent = currentSettings.rate.toFixed(1);
  });
  document.getElementById("voicePitch")?.addEventListener("input", (e) => {
    currentSettings.pitch = parseFloat(e.target.value);
    const d = document.getElementById("pitchDisplay");
    if (d) d.textContent = currentSettings.pitch.toFixed(1);
  });
  document.getElementById("voiceVolume")?.addEventListener("input", (e) => {
    currentSettings.volume = parseFloat(e.target.value);
    const d = document.getElementById("volDisplay");
    if (d) d.textContent = currentSettings.volume.toFixed(2);
  });

  // ── Language filter ──
  document
    .getElementById("voiceLangFilter")
    ?.addEventListener("change", (e) => {
      currentSettings.voiceLang = e.target.value;
      filterVoicesByLanguage(e.target.value);
    });

  // ── VTT language ──
  document.getElementById("vttLangSelect")?.addEventListener("change", (e) => {
    currentSettings.vttLang = e.target.value;
    window.ARIA_setVTTLanguage?.(e.target.value);
  });

  // ── Dark mode ──
  document.getElementById("darkModeToggle")?.addEventListener("click", () => {
    currentSettings.darkMode = !currentSettings.darkMode;
    applyTheme(currentSettings.theme || "red", currentSettings.darkMode);
    syncToggle("darkModeToggle", currentSettings.darkMode);
  });

  // ── Brightness slider ──
  document
    .getElementById("brightnessSlider")
    ?.addEventListener("input", (e) => {
      currentSettings.brightness = parseFloat(e.target.value);
      const d = document.getElementById("brightnessDisplay");
      if (d) d.textContent = currentSettings.brightness.toFixed(2);
      applyBrightness(currentSettings.brightness);
    });

  // ── Theme swatches ──
  document.querySelectorAll(".themeSwatch").forEach((s) =>
    s.addEventListener("click", () => {
      currentSettings.theme = s.dataset.theme;
      applyTheme(currentSettings.theme, currentSettings.darkMode !== false);
    }),
  );

  // ── Feature toggles ──
  ["glitchEffects", "scanlines", "sendOnEnter", "showTimestamps"].forEach(
    (key) => {
      document
        .getElementById("toggle_" + key)
        ?.addEventListener("click", () => {
          currentSettings[key] = currentSettings[key] === false ? true : false;
          syncToggle("toggle_" + key, currentSettings[key]);
          if (key === "scanlines")
            document.body.classList.toggle(
              "no-scanlines",
              !currentSettings[key],
            );
          if (key === "glitchEffects")
            document.body.classList.toggle("no-glitch", !currentSettings[key]);
        });
    },
  );

  // ── Font size ──
  document.getElementById("fontSizeSelect")?.addEventListener("change", (e) => {
    currentSettings.fontSize = e.target.value;
    applyFontSize(e.target.value);
  });

  // ── ElevenLabs ──
  document
    .getElementById("elValidateBtn")
    ?.addEventListener("click", validateAndLoadElevenLabs);
  document.getElementById("elAddVoiceBtn")?.addEventListener("click", () => {
    const selEl = document.getElementById("elVoiceSelect");
    const nameEl = document.getElementById("elVoiceName");
    const vid = selEl?.value;
    const name =
      nameEl?.value.trim() ||
      selEl?.options[selEl?.selectedIndex]?.text ||
      "EL Voice";
    if (!vid || vid === "none") {
      showToast("Select a voice first.", true);
      return;
    }
    if (!currentSettings.customVoices) currentSettings.customVoices = [];
    if (currentSettings.customVoices.some((v) => v.elVoiceId === vid)) {
      showToast("Already in your list.", true);
      return;
    }
    currentSettings.customVoices.push({ name, elVoiceId: vid });
    if (nameEl) nameEl.value = "";
    renderCustomVoiceList();
    saveSettings(currentSettings);
    showToast(`EL voice "${name}" added.`);
  });

  // Restore saved EL voices into select
  if (currentSettings.elVoices?.length) {
    const elSelEl = document.getElementById("elVoiceSelect");
    if (elSelEl) {
      elSelEl.innerHTML = currentSettings.elVoices
        .map(
          (v) =>
            `<option value="${v.id}">${v.name}${v.category ? " — " + v.category : ""}</option>`,
        )
        .join("");
    }
    injectElevenLabsVoices(currentSettings.elVoices);
  }

  // ── Custom file voice ──
  document
    .getElementById("addCustomVoiceBtn")
    ?.addEventListener("click", handleFileVoiceAdd);
  document
    .getElementById("customVoiceFile")
    ?.addEventListener("change", (e) => {
      const label = document.getElementById("customVoiceFileName");
      if (label)
        label.textContent = e.target.files[0]?.name || "No file selected";
    });
  document
    .getElementById("customVoiceFileBtn")
    ?.addEventListener("click", () => {
      document.getElementById("customVoiceFile")?.click();
    });

  // ── Memory ──
  document.getElementById("addMemoryBtn")?.addEventListener("click", () => {
    const inp = document.getElementById("memoryAddInput");
    const cat =
      document.getElementById("memoryCategorySelect")?.value || "note";
    if (!inp?.value.trim()) return;
    addManualMemory(inp.value.trim(), cat);
    inp.value = "";
  });
  document.getElementById("clearMemoryBtn")?.addEventListener("click", () => {
    if (confirm("Clear ALL of ARIA's memories? This cannot be undone."))
      clearAllMemory();
  });

  // ── Save ──
  // Accent color picker
  document.getElementById("accentColorPicker")?.addEventListener("input", e => {
    applyAccentColor(e.target.value);
    currentSettings.accentColor = e.target.value;
  });

  // Font selector
  document.getElementById("uiFontSelect")?.addEventListener("change", e => {
    applyFont(e.target.value);
    currentSettings.uiFont = e.target.value;
  });

  // BG animation
  document.getElementById("bgAnimSelect")?.addEventListener("change", e => {
    applyBgAnimation(e.target.value);
    currentSettings.bgAnim = e.target.value;
  });

  // AMOLED toggle
  document.getElementById("toggle_amoled")?.addEventListener("click", e => {
    const btn = e.currentTarget;
    const on  = btn.textContent.trim() === "OFF";
    btn.textContent = on ? "ON" : "OFF";
    btn.classList.toggle("active", on);
    currentSettings.amoled = on;
    applyAmoled(on);
  });

  // Memory search/filter
  document.getElementById("memSearchInput")?.addEventListener("input", () => {
    import("./memory.js").then(m => m.renderMemoryPanel?.());
  });
  document.getElementById("memFilterCat")?.addEventListener("change", () => {
    import("./memory.js").then(m => m.renderMemoryPanel?.());
  });

  document.getElementById("settingsSaveBtn")?.addEventListener("click", () => {
    const sel = document.getElementById("voiceSelect");
    if (sel) currentSettings.voice = sel.value;
    saveSettings(currentSettings);
    closeSettings();
    showToast("✓ Settings saved");
  });

  // ── Export / Import ──
  document
    .getElementById("exportSettingsBtn")
    ?.addEventListener("click", () => {
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
  document
    .getElementById("importSettingsBtn")
    ?.addEventListener("click", () =>
      document.getElementById("importSettingsFile")?.click(),
    );
  document
    .getElementById("importSettingsFile")
    ?.addEventListener("change", (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = (ev) => {
        try {
          currentSettings = {
            ...currentSettings,
            ...JSON.parse(ev.target.result),
          };
          applySettingsToUI();
          showToast("Settings imported.");
        } catch {
          showToast("Invalid settings file.", true);
        }
      };
      r.readAsText(f);
    });
}

/* ============================================================
   VOICE LANGUAGE FILTER
   ============================================================ */
function filterVoicesByLanguage(lang) {
  const sel = document.getElementById("voiceSelect");
  if (!sel) return;
  Array.from(sel.querySelectorAll("optgroup")).forEach((grp) => {
    if (grp.id === "elVoiceGroup" || grp.label.includes("Custom")) return;
    grp.style.display =
      !lang || lang === "all" || grp.label.includes(lang) ? "" : "none";
  });
}

/* ============================================================
   INIT — everything DOM-related goes here
   ============================================================ */
export function initSettings() {
  // Apply saved settings to engines immediately
  setTTSEnabled(currentSettings.ttsEnabled);
  setVTTEnabled(currentSettings.vttEnabled);
  applyBrightness(currentSettings.brightness ?? 1);

  // Set voice mode from saved value
  const savedVoice = currentSettings.voice || "";
  if (savedVoice.startsWith("el:")) {
    setVoiceMode("elevenlabs");
    setElevenLabsConfig(currentSettings.elApiKey, savedVoice.slice(3));
  } else if (savedVoice.startsWith("custom:")) {
    setVoiceMode("custom");
  } else {
    setVoiceMode("browser");
  }

  // Apply VTT language
  if (currentSettings.vttLang)
    window.ARIA_setVTTLanguage?.(currentSettings.vttLang);

  // Apply visual settings
  applyTheme(
    currentSettings.theme || "red",
    currentSettings.darkMode !== false,
  );
  applyFontSize(currentSettings.fontSize || "medium");
  document.body.classList.toggle(
    "no-scanlines",
    currentSettings.scanlines === false,
  );
  document.body.classList.toggle(
    "no-glitch",
    currentSettings.glitchEffects === false,
  );

  // Wire all controls (all DOM queries happen inside here)
  wireAllControls();

  // Load emotion state
  loadEmotionState();

  // Auto-load CUSTOM_VOICE env var from Render server
  loadEnvVoiceKey().then((key) => {
    if (!key) return;
    // Pre-fill the EL API key input if it's empty
    const keyEl = document.getElementById("elApiKey");
    if (keyEl && !keyEl.value) keyEl.value = key;
    // Store it in settings so it's used for API calls
    if (!currentSettings.elApiKey) {
      currentSettings.elApiKey = key;
      setElevenLabsConfig(
        key,
        currentSettings.voice?.startsWith("el:")
          ? currentSettings.voice.slice(3)
          : "",
      );
    }
  });
}
