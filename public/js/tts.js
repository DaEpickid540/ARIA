// tts.js — FINAL CYBERPUNK ARIA OS VERSION

export let ttsEnabled = true;
let currentUtterance = null;

/* ============================================================
   ENABLE / DISABLE TTS
   ============================================================ */
export function setTTSEnabled(enabled) {
  ttsEnabled = enabled;

  const callModeBtn = document.getElementById("callModeBtn");
  const voiceOffBtn = document.getElementById("voiceOffBtn");

  if (callModeBtn) callModeBtn.classList.toggle("active", enabled);
  if (voiceOffBtn) voiceOffBtn.classList.toggle("active", !enabled);

  // Stop any active speech
  if (!enabled && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
}

/* ============================================================
   SPEAK FUNCTION
   ============================================================ */
export function speak(text) {
  if (!ttsEnabled) return;
  if (!("speechSynthesis" in window)) return;

  // Cancel any previous speech
  window.speechSynthesis.cancel();

  const utter = new SpeechSynthesisUtterance(text);
  currentUtterance = utter;

  /* ------------------------------------------------------------
     VOICE SETTINGS
     ------------------------------------------------------------ */
  const rateSlider = document.getElementById("voiceRate");
  const pitchSlider = document.getElementById("voicePitch");
  const voiceSelect = document.getElementById("voiceSelect");

  utter.rate = rateSlider ? parseFloat(rateSlider.value) || 1 : 1;
  utter.pitch = pitchSlider ? parseFloat(pitchSlider.value) || 1 : 1;

  const voices = window.speechSynthesis.getVoices();

  if (voices.length && voiceSelect && voiceSelect.value) {
    const match = voices.find((v) => v.name === voiceSelect.value);
    if (match) utter.voice = match;
  } else if (voices.length) {
    // Auto-pick a female voice if available
    const female = voices.find((v) =>
      /female|woman|girl/i.test(v.name + " " + v.lang),
    );
    utter.voice = female || voices[0];
  }

  /* ============================================================
     SPEAKING EVENTS → CALL MODE + FX
     ============================================================ */
  utter.onstart = () => {
    // ARIA SPEAKING GRADIENT
    if (window.ARIA_setAriaSpeaking) {
      window.ARIA_setAriaSpeaking(true);
    }

    // Chromatic flash
    if (window.ARIA_triggerChromaticFlash) {
      window.ARIA_triggerChromaticFlash();
    }

    // Notify UI
    document.dispatchEvent(new CustomEvent("aria-speaking-start"));
  };

  utter.onend = () => {
    if (window.ARIA_setAriaSpeaking) {
      window.ARIA_setAriaSpeaking(false);
    }

    document.dispatchEvent(new CustomEvent("aria-speaking-stop"));
  };

  /* ============================================================
     SPEAK
     ============================================================ */
  window.speechSynthesis.speak(utter);
}

/* ============================================================
   POPULATE VOICE SELECT WHEN VOICES LOAD
   ============================================================ */
window.speechSynthesis.onvoiceschanged = () => {
  const voiceSelect = document.getElementById("voiceSelect");
  if (!voiceSelect) return;

  const voices = window.speechSynthesis.getVoices();
  voiceSelect.innerHTML = "";

  voices.forEach((v) => {
    const opt = document.createElement("option");
    opt.value = v.name;
    opt.textContent = `${v.name} (${v.lang})`;
    voiceSelect.appendChild(opt);
  });
};
