// settings.js — Complete rebuild, all features functional

import { loadSettings, saveSettings } from "./personality.js";
import {
  setTTSEnabled,
  setVoiceMode,
  setElevenLabsConfig,
  populateVoiceSelect,
  fetchElevenLabsVoices,
  injectElevenLabsVoices,
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
  gold: {
    label: "Gilded",
    vars: {
      "--red-core": "#ffd700",
      "--red-hot": "#ffbb00",
      "--red-neon": "#ffe033",
      "--red-deep": "#aa8800",
      "--red-dim": "#554400",
      "--red-ember": "#ffee88",
    },
  },
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

  document
    .querySelectorAll(".themeSwatch")
    .forEach((s) => s.classList.toggle("active", s.dataset.theme === themeKey));
}

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
  // Refresh emotion when switching to that tab
  if (tabName === "emotion") renderEmotionSummary();
  if (tabName === "memory") renderMemoryPanel();
  if (tabName === "voice") populateVoiceSelect();
}
window.ARIA_switchSettingsTab = switchSettingsTab;

/* ============================================================
   FONT SIZE
   ============================================================ */
function applyFontSize(size) {
  const map = { small: "11px", medium: "13px", large: "15px" };
  document.documentElement.style.setProperty(
    "--chat-font-size",
    map[size] || "13px",
  );
}

/* ============================================================
   CUSTOM VOICES MANAGER
   Stores { name, type, dataUrl?, description? }
   ============================================================ */
function renderCustomVoiceList() {
  const list = document.getElementById("customVoiceList");
  if (!list) return;
  const voices = currentSettings.customVoices || [];

  if (!voices.length) {
    list.innerHTML = `<div class="memEmpty">No custom voices added yet. Upload an MP3/WAV or add an ElevenLabs Voice ID below.</div>`;
    return;
  }

  list.innerHTML = voices
    .map(
      (v, i) => `
    <div class="customVoiceItem ${currentSettings.voice === (v.elVoiceId ? "el:" + v.elVoiceId : "custom:" + v.name) ? "active" : ""}">
      <div class="cviLeft">
        <span class="cviType">${v.elVoiceId ? "⚡ EL" : "🎙 FILE"}</span>
        <div>
          <div class="cviName">${v.name}</div>
          <div class="cviDesc">${v.elVoiceId ? "ElevenLabs Voice ID: " + v.elVoiceId : v.fileName || "Audio file"}</div>
        </div>
      </div>
      <div class="cviActions">
        <button class="cviSelectBtn ${currentSettings.voice === (v.elVoiceId ? "el:" + v.elVoiceId : "custom:" + v.name) ? "active" : ""}"
          onclick="window.ARIA_selectCustomVoice(${i})">
          ${currentSettings.voice === (v.elVoiceId ? "el:" + v.elVoiceId : "custom:" + v.name) ? "✓ ACTIVE" : "USE"}
        </button>
        <button class="cviDeleteBtn" onclick="window.ARIA_removeCustomVoice(${i})">✕</button>
      </div>
    </div>
  `,
    )
    .join("");
}

window.ARIA_removeCustomVoice = (idx) => {
  currentSettings.customVoices.splice(idx, 1);
  saveSettings(currentSettings);
  renderCustomVoiceList();
  populateVoiceSelect();
};

window.ARIA_selectCustomVoice = (idx) => {
  const v = currentSettings.customVoices[idx];
  if (!v) return;
  const voiceValue = v.elVoiceId ? "el:" + v.elVoiceId : "custom:" + v.name;
  currentSettings.voice = voiceValue;
  const sel = document.getElementById("voiceSelect");
  if (sel) sel.value = voiceValue;
  // Set active engine
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
   ELEVENLABS SECTION — LIVE KEY VALIDATION
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

  // Save key
  currentSettings.elApiKey = apiKey;
  setElevenLabsConfig(apiKey, elevenLabsVoiceId);

  if (statusEl) {
    statusEl.textContent = `✓ Connected — ${voices.length} voice${voices.length !== 1 ? "s" : ""} found.`;
    statusEl.className = "elStatus ok";
  }

  // Populate EL voice dropdown
  const elSelEl = document.getElementById("elVoiceSelect");
  if (elSelEl) {
    elSelEl.innerHTML = voices
      .map(
        (v) =>
          `<option value="${v.id}">${v.name}${v.category ? " — " + v.category : ""}</option>`,
      )
      .join("");
  }

  // Inject into main voiceSelect
  injectElevenLabsVoices(voices);

  // Save voices list for offline display
  currentSettings.elVoices = voices;
  saveSettings(currentSettings);
}

let elevenLabsVoiceId = "";

function wireElevenLabsSection() {
  // Load existing key
  const keyEl = document.getElementById("elApiKey");
  if (keyEl && currentSettings.elApiKey) keyEl.value = currentSettings.elApiKey;

  document
    .getElementById("elValidateBtn")
    ?.addEventListener("click", validateAndLoadElevenLabs);

  // EL voice picker — add to custom voices list
  document.getElementById("elAddVoiceBtn")?.addEventListener("click", () => {
    const selEl = document.getElementById("elVoiceSelect");
    const nameEl = document.getElementById("elVoiceName");
    const voiceId = selEl?.value;
    const name =
      nameEl?.value.trim() ||
      selEl?.options[selEl?.selectedIndex]?.text ||
      "EL Voice";

    if (!voiceId) {
      showToast("Select an ElevenLabs voice first.", true);
      return;
    }

    if (!currentSettings.customVoices) currentSettings.customVoices = [];

    // Avoid duplicates
    if (currentSettings.customVoices.some((v) => v.elVoiceId === voiceId)) {
      showToast("That voice is already in your list.", true);
      return;
    }

    currentSettings.customVoices.push({ name, elVoiceId: voiceId });
    if (nameEl) nameEl.value = "";
    renderCustomVoiceList();
    saveSettings(currentSettings);
  });

  // Restore EL voices if we have them
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
}

/* ============================================================
   FILE VOICE UPLOAD
   ============================================================ */
function wireFileVoiceUpload() {
  document
    .getElementById("addCustomVoiceBtn")
    ?.addEventListener("click", () => {
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
      // Validate file type
      if (!file.type.startsWith("audio/")) {
        showToast("File must be an audio file (MP3, WAV, OGG).", true);
        return;
      }
      // Warn if too large (>5MB)
      if (file.size > 5 * 1024 * 1024) {
        showToast("File is large — may cause slow loading.", false);
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
          fileType: file.type,
        });
        if (nameEl) nameEl.value = "";
        fileEl.value = "";
        document.getElementById("customVoiceFileName").textContent =
          "No file selected";
        renderCustomVoiceList();
        populateVoiceSelect();
        saveSettings(currentSettings);
        showToast(`Voice "${name}" added.`);
      };
      reader.readAsDataURL(file);
    });

  // File input label update
  document
    .getElementById("customVoiceFile")
    ?.addEventListener("change", (e) => {
      const label = document.getElementById("customVoiceFileName");
      if (label)
        label.textContent = e.target.files[0]?.name || "No file selected";
    });
}

/* ============================================================
   MAIN SETTINGS STATE
   ============================================================ */
let currentSettings = loadSettings();

/* ============================================================
   APPLY EVERYTHING TO UI
   ============================================================ */
function applySettingsToUI() {
  // ── Personality ──
  document
    .querySelectorAll(".personalityBtn")
    .forEach((btn) =>
      btn.classList.toggle(
        "active",
        btn.dataset.preset === currentSettings.personality,
      ),
    );

  // ── Provider ──
  const provSel = document.getElementById("providerSelect");
  if (provSel) provSel.value = currentSettings.provider || "openrouter";

  // ── TTS / VTT toggles ──
  syncToggle("ttsToggle", currentSettings.ttsEnabled);
  syncToggle("vttMasterToggle", currentSettings.vttEnabled);
  const ttsBtn = document.getElementById("ttsBtn");
  const vttBtn = document.getElementById("vttBtn");
  if (ttsBtn) ttsBtn.classList.toggle("active", currentSettings.ttsEnabled);
  if (vttBtn) vttBtn.classList.toggle("active", currentSettings.vttEnabled);

  // ── Voice sliders ──
  const rateEl = document.getElementById("voiceRate");
  const pitchEl = document.getElementById("voicePitch");
  const volEl = document.getElementById("voiceVolume");
  if (rateEl) {
    rateEl.value = currentSettings.rate ?? 1;
    document.getElementById("rateDisplay") &&
      (document.getElementById("rateDisplay").textContent = parseFloat(
        rateEl.value,
      ).toFixed(1));
  }
  if (pitchEl) {
    pitchEl.value = currentSettings.pitch ?? 1;
    document.getElementById("pitchDisplay") &&
      (document.getElementById("pitchDisplay").textContent = parseFloat(
        pitchEl.value,
      ).toFixed(1));
  }
  if (volEl) {
    volEl.value = currentSettings.volume ?? 1;
    document.getElementById("volDisplay") &&
      (document.getElementById("volDisplay").textContent = parseFloat(
        volEl.value,
      ).toFixed(1));
  }

  // ── Language filter ──
  const langEl = document.getElementById("voiceLangFilter");
  if (langEl && currentSettings.voiceLang)
    langEl.value = currentSettings.voiceLang;

  // ── VTT language ──
  const vttLangEl = document.getElementById("vttLangSelect");
  if (vttLangEl && currentSettings.vttLang)
    vttLangEl.value = currentSettings.vttLang;

  // ── Theme ──
  applyTheme(
    currentSettings.theme || "red",
    currentSettings.darkMode !== false,
  );
  syncToggle("darkModeToggle", currentSettings.darkMode !== false);

  // ── Feature toggles ──
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

  // ── Font size ──
  const fsEl = document.getElementById("fontSizeSelect");
  if (fsEl) fsEl.value = currentSettings.fontSize || "medium";
  applyFontSize(currentSettings.fontSize || "medium");

  // ── EL key ──
  const elKeyEl = document.getElementById("elApiKey");
  if (elKeyEl && currentSettings.elApiKey)
    elKeyEl.value = currentSettings.elApiKey;

  // ── Custom voices ──
  renderCustomVoiceList();

  // ── Memory ──
  renderMemoryPanel();

  // ── Emotion ──
  renderEmotionSummary();
}

function syncToggle(id, isOn) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.toggle("active", !!isOn);
  el.textContent = isOn ? "ON" : "OFF";
}

/* ============================================================
   OPEN / CLOSE
   ============================================================ */
const settingsOverlay = document.getElementById("settingsOverlay");
const settingsBtn = document.getElementById("settingsBtn");
const settingsCloseBtn = document.getElementById("settingsCloseBtn");
const settingsSaveBtn = document.getElementById("settingsSaveBtn");

function openSettings() {
  applySettingsToUI();
  populateVoiceSelect();
  settingsOverlay?.classList.add("active");
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
   WIRE ALL CONTROLS
   ============================================================ */
function wireAllControls() {
  // ── Tabs ──
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
    applySettingsToUI();
  });

  // ── VTT toggle ──
  document.getElementById("vttMasterToggle")?.addEventListener("click", () => {
    currentSettings.vttEnabled = !currentSettings.vttEnabled;
    setVTTEnabled(currentSettings.vttEnabled);
    applySettingsToUI();
  });

  // ── Voice select — detect mode change ──
  document.getElementById("voiceSelect")?.addEventListener("change", (e) => {
    const val = e.target.value;
    currentSettings.voice = val;
    if (val.startsWith("el:")) {
      const vid = val.slice(3);
      setVoiceMode("elevenlabs");
      setElevenLabsConfig(currentSettings.elApiKey, vid);
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
    if (d) d.textContent = currentSettings.volume.toFixed(1);
  });

  // ── Language filter for voice list ──
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
    applySettingsToUI();
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
          currentSettings[key] = currentSettings[key] === false;
          applySettingsToUI();
        });
    },
  );

  // ── Font size ──
  document.getElementById("fontSizeSelect")?.addEventListener("change", (e) => {
    currentSettings.fontSize = e.target.value;
    applyFontSize(e.target.value);
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
  settingsSaveBtn?.addEventListener("click", () => {
    // Capture voice select value
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
          const imp = JSON.parse(ev.target.result);
          currentSettings = { ...currentSettings, ...imp };
          applySettingsToUI();
          showToast("Settings imported.");
        } catch {
          showToast("Invalid settings file.", true);
        }
      };
      r.readAsText(f);
    });

  // ── ElevenLabs ──
  wireElevenLabsSection();

  // ── Custom file voice ──
  wireFileVoiceUpload();
}

/* ============================================================
   LANGUAGE FILTER FOR VOICE SELECT
   ============================================================ */
function filterVoicesByLanguage(lang) {
  const sel = document.getElementById("voiceSelect");
  if (!sel) return;
  Array.from(sel.querySelectorAll("optgroup")).forEach((grp) => {
    if (grp.id === "elVoiceGroup") return; // never hide EL group
    if (!lang || lang === "all") {
      grp.style.display = "";
    } else {
      // optgroup label = "🌐 en-US" etc.
      grp.style.display = grp.label.includes(lang) ? "" : "none";
    }
  });
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
      ARIA's internal emotional state. Shifts naturally through conversation.
    </div>
  `;
  const btns = document.getElementById("emotionOverrideBtns");
  if (btns) {
    btns.innerHTML = Object.entries(EMOTIONS)
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
   TOAST
   ============================================================ */
function showToast(msg, isError = false) {
  const toast = document.getElementById("settingsToast");
  if (!toast) return;
  toast.textContent = msg;
  toast.className = "show" + (isError ? " error" : "");
  setTimeout(() => {
    toast.classList.remove("show", "error");
  }, 3000);
}
window.ARIA_showToast = showToast;

/* ============================================================
   INIT
   ============================================================ */
window.addEventListener("DOMContentLoaded", () => {
  setTTSEnabled(currentSettings.ttsEnabled);
  setVTTEnabled(currentSettings.vttEnabled);

  // Set initial voice mode
  const v = currentSettings.voice || "";
  if (v.startsWith("el:")) {
    setVoiceMode("elevenlabs");
    setElevenLabsConfig(currentSettings.elApiKey, v.slice(3));
  } else if (v.startsWith("custom:")) {
    setVoiceMode("custom");
  } else {
    setVoiceMode("browser");
  }

  // Wire VTT language into recognition if available
  if (currentSettings.vttLang)
    window.ARIA_setVTTLanguage?.(currentSettings.vttLang);

  applySettingsToUI();
  loadEmotionState();
  wireAllControls();
  populateVoiceSelect();
});
