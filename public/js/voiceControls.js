// voiceControls.js — FINAL CYBERPUNK ARIA OS VERSION

import { loadSettings, saveSettings } from "./personality.js";
import { setTTSEnabled } from "./tts.js";
import { setVTTEnabled } from "./vtt.js";

export function initVoiceControls() {
  /* ============================================================
     ELEMENTS
     ============================================================ */
  const callModeBtn = document.getElementById("callModeBtn");
  const voiceOffBtn = document.getElementById("voiceOffBtn");
  const vttToggleBtn = document.getElementById("vttToggleBtn");

  const callOverlay = document.getElementById("callModeOverlay");
  const waveformBars = document.querySelectorAll("#callWaveform .waveBar");
  const spectrogramBars = document.querySelectorAll(
    "#callSpectrogram .specBar",
  );

  let settings = loadSettings();

  /* ============================================================
     APPLY SETTINGS TO UI
     ============================================================ */
  function applyToButtons() {
    if (callModeBtn)
      callModeBtn.classList.toggle("active", settings.ttsEnabled);
    if (voiceOffBtn)
      voiceOffBtn.classList.toggle("active", !settings.ttsEnabled);
    if (vttToggleBtn)
      vttToggleBtn.classList.toggle("active", settings.vttEnabled);
  }

  function applyToEngines() {
    setTTSEnabled(settings.ttsEnabled);
    setVTTEnabled(settings.vttEnabled);
  }

  applyToButtons();
  applyToEngines();

  /* ============================================================
     CALL MODE OVERLAY CONTROL
     ============================================================ */
  function openCallOverlay() {
    if (!callOverlay) return;
    callOverlay.classList.add("active");
    callOverlay.classList.remove("user-speaking", "aria-speaking");

    // FX
    window.ARIA_triggerChromaticFlash?.();
    window.ARIA_triggerGlitch?.();
  }

  function closeCallOverlay() {
    if (!callOverlay) return;
    callOverlay.classList.remove("active", "user-speaking", "aria-speaking");
  }

  // Exit via ESC or click
  if (callOverlay) {
    callOverlay.addEventListener("click", closeCallOverlay);
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeCallOverlay();
    });
  }

  /* ============================================================
     GLOBAL HOOKS FOR TTS/VTT
     ============================================================ */
  window.ARIA_setUserSpeaking = (isSpeaking) => {
    if (!callOverlay) return;
    callOverlay.classList.toggle("user-speaking", !!isSpeaking);
    if (isSpeaking) callOverlay.classList.remove("aria-speaking");
  };

  window.ARIA_setAriaSpeaking = (isSpeaking) => {
    if (!callOverlay) return;
    callOverlay.classList.toggle("aria-speaking", !!isSpeaking);
    if (isSpeaking) callOverlay.classList.remove("user-speaking");
  };

  /* ============================================================
     WAVEFORM + SPECTROGRAM ANIMATION ENGINE
     ============================================================ */
  let audioContext = null;
  let analyser = null;
  let dataArray = null;

  function initAudioAnalyzer() {
    if (audioContext) return;

    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 64;

    dataArray = new Uint8Array(analyser.frequencyBinCount);

    navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);
      animateAudio();
    });
  }

  function animateAudio() {
    requestAnimationFrame(animateAudio);
    if (!analyser || !dataArray) return;

    analyser.getByteFrequencyData(dataArray);

    // Waveform bars (10 bars)
    waveformBars.forEach((bar, i) => {
      const v = dataArray[i] || 0;
      const height = Math.max(10, v / 4);
      bar.style.height = `${height}px`;
      bar.style.opacity = 0.4 + (v / 255) * 0.6;
    });

    // Spectrogram bars (15 bars)
    spectrogramBars.forEach((bar, i) => {
      const v = dataArray[i] || 0;
      const height = Math.max(6, v / 5);
      bar.style.height = `${height}px`;
      bar.style.opacity = 0.3 + (v / 255) * 0.7;
    });
  }

  /* ============================================================
     BUTTON LOGIC
     ============================================================ */

  // TTS ON (Call Mode)
  callModeBtn?.addEventListener("click", () => {
    settings.ttsEnabled = true;
    saveSettings(settings);

    applyToButtons();
    applyToEngines();

    openCallOverlay();
    initAudioAnalyzer();
  });

  // TTS OFF
  voiceOffBtn?.addEventListener("click", () => {
    settings.ttsEnabled = false;
    saveSettings(settings);

    applyToButtons();
    applyToEngines();

    closeCallOverlay();
  });

  // VTT Toggle
  vttToggleBtn?.addEventListener("click", () => {
    settings.vttEnabled = !settings.vttEnabled;
    saveSettings(settings);

    applyToButtons();
    applyToEngines();
  });
}
