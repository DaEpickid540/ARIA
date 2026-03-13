// tts.js — Full rebuild: browser voices + ElevenLabs AI voices

/* ============================================================
   STATE
   ============================================================ */
export let ttsEnabled = false;
let currentVoiceMode = "browser"; // "browser" | "elevenlabs" | "custom"
let elevenLabsApiKey = "";
let elevenLabsVoiceId = ""; // active ElevenLabs voice ID
let currentAudioPlayer = null; // for ElevenLabs / custom audio

/* ============================================================
   ENABLE / DISABLE
   ============================================================ */
export function setTTSEnabled(enabled) {
  ttsEnabled = enabled;
  const ttsBtn = document.getElementById("ttsBtn");
  if (ttsBtn) ttsBtn.classList.toggle("active", enabled);
  if (!enabled) stopSpeaking();
}

export function setVoiceMode(mode) {
  currentVoiceMode = mode; // "browser" | "elevenlabs" | "custom"
}

export function setElevenLabsConfig(apiKey, voiceId) {
  elevenLabsApiKey = apiKey || "";
  elevenLabsVoiceId = voiceId || "";
}

function stopSpeaking() {
  if (window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
  if (currentAudioPlayer) {
    currentAudioPlayer.pause();
    currentAudioPlayer = null;
  }
  window.ARIA_isSpeaking = false;
}

/* ============================================================
   STRIP MARKDOWN FROM TEXT BEFORE SPEAKING
   ============================================================ */
function stripMarkdown(text) {
  return text
    .replace(/#{1,6}\s/g, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`{1,3}[^`]*`{1,3}/gs, "")
    .replace(/---+/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/>\s?.+/g, "")
    .replace(/\n{2,}/g, ". ")
    .replace(/\n/g, " ")
    .trim();
}

/* ============================================================
   MAIN SPEAK ENTRY POINT
   Routes to correct engine based on currentVoiceMode
   ============================================================ */
export function speak(rawText) {
  if (!ttsEnabled) return;
  const text = stripMarkdown(rawText);
  if (!text) return;

  stopSpeaking();

  if (
    currentVoiceMode === "elevenlabs" &&
    elevenLabsApiKey &&
    elevenLabsVoiceId
  ) {
    speakElevenLabs(text);
  } else if (currentVoiceMode === "custom") {
    speakCustomVoice(text);
  } else {
    speakBrowser(text);
  }
}

/* ============================================================
   ENGINE 1: BROWSER WEB SPEECH API
   Uses voices installed in the OS / browser
   ============================================================ */
function speakBrowser(text) {
  if (!("speechSynthesis" in window)) {
    console.warn("[TTS] Web Speech API not supported");
    return;
  }

  const utter = new SpeechSynthesisUtterance(text);

  // Pull settings from DOM
  const rateEl = document.getElementById("voiceRate");
  const pitchEl = document.getElementById("voicePitch");
  const volumeEl = document.getElementById("voiceVolume");
  const sel = document.getElementById("voiceSelect");

  utter.rate = rateEl ? parseFloat(rateEl.value) || 1 : 1;
  utter.pitch = pitchEl ? parseFloat(pitchEl.value) || 1 : 1;
  utter.volume = volumeEl ? parseFloat(volumeEl.value) || 1 : 1;

  // Match voice by name
  const voices = window.speechSynthesis.getVoices();
  if (
    voices.length &&
    sel?.value &&
    !sel.value.startsWith("custom:") &&
    !sel.value.startsWith("el:")
  ) {
    const match = voices.find((v) => v.name === sel.value);
    if (match) utter.voice = match;
  }

  utter.onstart = () => onSpeakStart();
  utter.onend = () => onSpeakEnd();
  utter.onerror = (e) => {
    console.warn("[TTS Browser] error:", e.error);
    onSpeakEnd();
  };

  window.speechSynthesis.speak(utter);
}

/* ============================================================
   ENGINE 2: ELEVENLABS AI VOICE (real HTTP call)
   Requires: ElevenLabs API key + voice ID saved in settings
   ============================================================ */
async function speakElevenLabs(text) {
  onSpeakStart();

  try {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${elevenLabsVoiceId}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": elevenLabsApiKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_monolingual_v1",
          voice_settings: {
            stability: getSettingValue("elStability", 0.5),
            similarity_boost: getSettingValue("elSimilarity", 0.75),
            style: getSettingValue("elStyle", 0.0),
            use_speaker_boost: true,
          },
        }),
      },
    );

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      console.error("[TTS ElevenLabs] API error:", response.status, err);
      onSpeakEnd();
      showTTSError(
        `ElevenLabs error: ${response.status} — ${err?.detail?.message || "Check your API key and Voice ID"}`,
      );
      return;
    }

    const blob = await response.blob();
    const audioUrl = URL.createObjectURL(blob);
    const audio = new Audio(audioUrl);
    currentAudioPlayer = audio;

    // Apply volume
    const volEl = document.getElementById("voiceVolume");
    audio.volume = volEl ? parseFloat(volEl.value) || 1 : 1;

    audio.onended = () => {
      URL.revokeObjectURL(audioUrl);
      currentAudioPlayer = null;
      onSpeakEnd();
    };
    audio.onerror = () => {
      currentAudioPlayer = null;
      onSpeakEnd();
    };
    audio.play();
  } catch (err) {
    console.error("[TTS ElevenLabs] fetch error:", err);
    onSpeakEnd();
    showTTSError("ElevenLabs: Network error. Is your API key correct?");
  }
}

/* ============================================================
   ENGINE 3: CUSTOM VOICE (pre-recorded audio files)
   Plays a stored audio file instead of generating speech.
   Note: custom voices play the clip — they don't do TTS.
   The clip is used as ARIA's "voice sound" while text displays.
   ============================================================ */
function speakCustomVoice(text) {
  // Get the selected custom voice data URL from voiceSelect
  const sel = document.getElementById("voiceSelect");
  if (!sel) {
    speakBrowser(text);
    return;
  }

  const selectedOpt = sel.options[sel.selectedIndex];
  const dataUrl = selectedOpt?.dataset?.url;

  if (!dataUrl) {
    // Fall back to browser TTS if no audio file
    speakBrowser(text);
    return;
  }

  onSpeakStart();

  const audio = new Audio(dataUrl);
  currentAudioPlayer = audio;

  const volEl = document.getElementById("voiceVolume");
  audio.volume = volEl ? parseFloat(volEl.value) || 1 : 1;

  audio.onended = () => {
    currentAudioPlayer = null;
    onSpeakEnd();
  };
  audio.onerror = () => {
    currentAudioPlayer = null;
    onSpeakEnd();
  };
  audio.play().catch((err) => {
    console.warn("[TTS Custom] Audio play failed:", err);
    currentAudioPlayer = null;
    speakBrowser(text); // fallback
  });
}

/* ============================================================
   SHARED: speak start / end callbacks
   ============================================================ */
function onSpeakStart() {
  window.ARIA_isSpeaking = true;
  window.ARIA_stopCallListening?.();

  const overlay = document.getElementById("callModeOverlay");
  overlay?.classList.add("aria-speaking");
  overlay?.classList.remove("user-speaking");

  const status = document.getElementById("callModeStatus");
  if (status) status.textContent = "ARIA SPEAKING";

  // Update status dot in chat header
  const label = document.getElementById("ariaStatusLabel");
  if (label) label.textContent = "SPEAKING";
}

function onSpeakEnd() {
  window.ARIA_isSpeaking = false;

  const overlay = document.getElementById("callModeOverlay");
  overlay?.classList.remove("aria-speaking");
  overlay?.classList.add("user-speaking");

  const status = document.getElementById("callModeStatus");
  if (status) status.textContent = "LISTENING...";

  const label = document.getElementById("ariaStatusLabel");
  if (label) label.textContent = "ONLINE";

  setTimeout(() => window.ARIA_startCallListening?.(), 350);
}

/* ============================================================
   HELPERS
   ============================================================ */
function getSettingValue(id, fallback) {
  const el = document.getElementById(id);
  if (!el) return fallback;
  return parseFloat(el.value) ?? fallback;
}

function showTTSError(msg) {
  const toast = document.getElementById("settingsToast");
  if (!toast) return;
  toast.textContent = "⚠ " + msg;
  toast.classList.add("show", "error");
  setTimeout(() => {
    toast.classList.remove("show", "error");
    toast.textContent = "✓ Settings saved";
  }, 4000);
}

/* ============================================================
   VOICE SELECT POPULATION
   Populates #voiceSelect with:
     1. Browser/OS voices (grouped by language)
     2. ElevenLabs voices (if API key is set)
     3. Custom uploaded voices (from settings)
   ============================================================ */
export function populateVoiceSelect() {
  const sel = document.getElementById("voiceSelect");
  if (!sel) return;

  // Save custom options before clearing
  const customOptions = Array.from(sel.querySelectorAll("[data-custom]")).map(
    (o) => ({
      value: o.value,
      text: o.textContent,
      dataUrl: o.dataset.url,
      name: o.dataset.custom,
    }),
  );
  const elOptions = Array.from(sel.querySelectorAll("[data-elevenlabs]")).map(
    (o) => ({
      value: o.value,
      text: o.textContent,
      voiceId: o.dataset.voiceid,
    }),
  );

  sel.innerHTML = "";

  // ── Group 1: Browser voices by language ──
  const voices = window.speechSynthesis?.getVoices() || [];
  if (voices.length) {
    // Group by language
    const byLang = {};
    voices.forEach((v) => {
      const lang = v.lang || "Other";
      if (!byLang[lang]) byLang[lang] = [];
      byLang[lang].push(v);
    });

    // English first, then alphabetical
    const sortedLangs = Object.keys(byLang).sort((a, b) => {
      if (a.startsWith("en") && !b.startsWith("en")) return -1;
      if (!a.startsWith("en") && b.startsWith("en")) return 1;
      return a.localeCompare(b);
    });

    sortedLangs.forEach((lang) => {
      const group = document.createElement("optgroup");
      group.label = `🌐 ${lang}`;
      byLang[lang].forEach((v) => {
        const opt = document.createElement("option");
        opt.value = v.name;
        const isFemale =
          /female|woman|zira|susan|emma|samantha|karen|moira|fiona|victoria|allison|ava|kate|serena|tessa/i.test(
            v.name,
          );
        opt.textContent = `${isFemale ? "♀" : "♂"} ${v.name}`;
        group.appendChild(opt);
      });
      sel.appendChild(group);
    });
  }

  // ── Group 2: ElevenLabs voices (from saved config) ──
  const elGroup = document.createElement("optgroup");
  elGroup.label = "⚡ ElevenLabs AI";
  elGroup.id = "elVoiceGroup";
  // Re-add previously fetched EL voices
  elOptions.forEach((o) => {
    const opt = document.createElement("option");
    opt.value = o.value;
    opt.textContent = o.text;
    opt.dataset.elevenlabs = "1";
    opt.dataset.voiceid = o.voiceId;
    elGroup.appendChild(opt);
  });
  if (elGroup.children.length === 0) {
    const placeholder = document.createElement("option");
    placeholder.disabled = true;
    placeholder.textContent = "   Enter API key to load voices";
    elGroup.appendChild(placeholder);
  }
  sel.appendChild(elGroup);

  // ── Group 3: Custom uploaded voices ──
  if (customOptions.length) {
    const customGroup = document.createElement("optgroup");
    customGroup.label = "🎙 Custom Voices";
    customOptions.forEach((o) => {
      const opt = document.createElement("option");
      opt.value = o.value;
      opt.textContent = o.text;
      opt.dataset.custom = o.name;
      opt.dataset.url = o.dataUrl;
      customGroup.appendChild(opt);
    });
    sel.appendChild(customGroup);
  }

  // Restore saved selection or auto-pick female English voice
  restoreSavedVoiceSelection(sel, voices);
}

function restoreSavedVoiceSelection(sel, voices) {
  const savedVoice = (() => {
    try {
      return JSON.parse(localStorage.getItem("aria_settings"))?.voice || "";
    } catch {
      return "";
    }
  })();

  if (
    savedVoice &&
    Array.from(sel.options).some((o) => o.value === savedVoice)
  ) {
    sel.value = savedVoice;
    return;
  }

  // Auto-select best female English voice
  const best =
    voices.find(
      (v) =>
        v.lang.startsWith("en") &&
        /female|woman|zira|susan|emma|samantha|karen|moira|fiona|victoria|allison|ava|kate|serena|tessa|google uk english female/i.test(
          v.name,
        ),
    ) || voices.find((v) => v.lang.startsWith("en"));

  if (best) sel.value = best.name;
}

/* ============================================================
   FETCH ELEVENLABS VOICE LIST
   Called when user saves a valid API key
   ============================================================ */
export async function fetchElevenLabsVoices(apiKey) {
  if (!apiKey) return [];
  try {
    const res = await fetch("https://api.elevenlabs.io/v1/voices", {
      headers: { "xi-api-key": apiKey },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.voices || []).map((v) => ({
      id: v.voice_id,
      name: v.name,
      category: v.category,
    }));
  } catch {
    return [];
  }
}

/* Inject ElevenLabs voices into the select after fetching */
export function injectElevenLabsVoices(voices) {
  const sel = document.getElementById("voiceSelect");
  const group = document.getElementById("elVoiceGroup");
  if (!sel || !group) return;

  group.innerHTML = "";
  voices.forEach((v) => {
    const opt = document.createElement("option");
    opt.value = "el:" + v.id;
    opt.textContent = `${v.name}${v.category ? " — " + v.category : ""}`;
    opt.dataset.elevenlabs = "1";
    opt.dataset.voiceid = v.id;
    group.appendChild(opt);
  });
}

/* ============================================================
   INIT
   Auto-loads CUSTOM_VOICE env var from Render as EL API key
   via the /api/config endpoint (server exposes it safely).
   ============================================================ */
if (window.speechSynthesis) {
  window.speechSynthesis.onvoiceschanged = populateVoiceSelect;
  if (window.speechSynthesis.getVoices().length > 0) populateVoiceSelect();
}

/* Try to load CUSTOM_VOICE key from server (Render env var) */
export async function loadEnvVoiceKey() {
  try {
    const res = await fetch("/api/config");
    if (!res.ok) return null;
    const data = await res.json();
    if (data.customVoiceKey) {
      elevenLabsApiKey = data.customVoiceKey;
      console.log("[TTS] CUSTOM_VOICE key loaded from server.");
      return data.customVoiceKey;
    }
  } catch {
    // Server may not have this endpoint — that is fine
  }
  return null;
}
