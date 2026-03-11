// vtt.js — fixed

let recognition;
let isListening = false;
let vttEnabled = false;
let callModeActive = false;

export function initVTT() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    console.warn("SpeechRecognition not supported");
    return;
  }

  recognition = new SR();
  recognition.continuous = false; // single-shot per turn; we restart manually
  recognition.interimResults = true;
  recognition.lang = "en-US";

  const input = document.getElementById("userInput");
  const sendBtn = document.getElementById("sendBtn");

  recognition.onresult = (event) => {
    let interim = "";
    let final = "";

    for (let i = 0; i < event.results.length; i++) {
      if (event.results[i].isFinal) {
        final += event.results[i][0].transcript;
      } else {
        interim += event.results[i][0].transcript;
      }
    }

    // Show live interim text in input while speaking
    if (input) {
      input.value = (final || interim).trim();
    }
  };

  recognition.onend = () => {
    const wasListening = isListening;
    isListening = false;

    const text = input?.value?.trim();

    if (callModeActive) {
      // CALL MODE: send whatever was transcribed then restart mic
      if (wasListening && text) {
        sendBtn?.click();
        // Restart mic after a short pause (waits for TTS to begin)
        setTimeout(() => {
          if (callModeActive) startCallListening();
        }, 400);
      } else {
        // Nothing transcribed — restart mic immediately
        if (callModeActive) {
          setTimeout(() => startCallListening(), 300);
        }
      }
    } else {
      // NORMAL VTT MODE: only send on final result
      if (wasListening && text) {
        sendBtn?.click();
      }
    }
  };

  recognition.onerror = (e) => {
    // "no-speech" is normal; restart silently in call mode
    isListening = false;
    if (callModeActive && e.error === "no-speech") {
      setTimeout(() => {
        if (callModeActive) startCallListening();
      }, 500);
    }
  };
}

/* -------------------------------------------------------
   CALL MODE — separate start/stop so TTS can pause the mic
   while ARIA is speaking (prevents hearing itself)
------------------------------------------------------- */
export function startCallListening() {
  if (!recognition || isListening) return;
  // Don't listen while ARIA is speaking
  if (window.ARIA_isSpeaking) return;
  try {
    recognition.start();
    isListening = true;
    setWaveActive(true);
  } catch {
    // already started — ignore
  }
}

export function stopCallListening() {
  if (!recognition || !isListening) return;
  try {
    recognition.stop();
  } catch {}
  isListening = false;
  setWaveActive(false);
}

export function setCallModeActive(active) {
  callModeActive = active;
  if (active) {
    startCallListening();
  } else {
    stopCallListening();
  }
}

/* -------------------------------------------------------
   NORMAL VTT (continuous toggle)
------------------------------------------------------- */
export function setVTTEnabled(enabled) {
  vttEnabled = enabled;

  const vttBtn = document.getElementById("vttBtn");
  if (vttBtn) vttBtn.classList.toggle("active", enabled);

  if (!enabled && recognition) {
    try {
      recognition.stop();
    } catch {}
    isListening = false;
  }
}

export function startContinuousVTT() {
  if (!recognition || !vttEnabled || isListening) return;
  try {
    recognition.start();
    isListening = true;
  } catch {}
}

export function stopContinuousVTT() {
  if (!recognition || !isListening) return;
  try {
    recognition.stop();
  } catch {}
  isListening = false;
}

/* -------------------------------------------------------
   PUSH TO TALK
------------------------------------------------------- */
export function startPushToTalk() {
  if (!recognition || isListening) return;
  try {
    recognition.start();
    isListening = true;
    setWaveActive(true);
  } catch {}
}

export function stopPushToTalk() {
  if (!recognition || !isListening) return;
  try {
    recognition.stop();
  } catch {}
  isListening = false;
  setWaveActive(false);
}

/* -------------------------------------------------------
   VOICE WAVE HELPER
------------------------------------------------------- */
function setWaveActive(active) {
  const wave = document.getElementById("voiceWave");
  if (wave) wave.classList.toggle("active", active);
}
