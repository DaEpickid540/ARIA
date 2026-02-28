// vtt.js — Shared Recognition Engine (patched)

let recognition = null;
let vttEnabled = false;
let isListening = false;

const SpeechRecognition =
  window.SpeechRecognition || window.webkitSpeechRecognition;

window.addEventListener("DOMContentLoaded", () => {
  if (!SpeechRecognition) {
    console.warn("SpeechRecognition not supported");
    return;
  }

  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = "en-US";

  const userInput = document.getElementById("userInput");
  const sendBtn = document.getElementById("sendBtn");

  recognition.onresult = (event) => {
    let final = "";

    for (let i = 0; i < event.results.length; i++) {
      const res = event.results[i];
      if (res.isFinal) final += res[0].transcript;
    }

    if (final && userInput) {
      userInput.value = final.trim();
    }
  };

  recognition.onend = () => {
    const hadBeenListening = isListening;
    isListening = false;
    window.ARIA_setUserSpeaking?.(false);

    // Auto-send only for PTT (Option C)
    if (hadBeenListening && userInput?.value.trim()) {
      sendBtn?.click();
    }
  };
});

export function setVTTEnabled(enabled) {
  vttEnabled = enabled;

  const vttBtn = document.getElementById("vttBtn");
  if (vttBtn) vttBtn.classList.toggle("active", enabled);

  const settingsVTT = document.getElementById("settingsVTT");
  if (settingsVTT) settingsVTT.checked = enabled;

  if (!enabled) stopContinuousVTT();
}

export function startContinuousVTT() {
  if (!recognition || !vttEnabled || isListening) return;

  try {
    recognition.start();
    isListening = true;
    window.ARIA_setUserSpeaking?.(true);
  } catch {}
}

export function stopContinuousVTT() {
  if (!recognition || !isListening) return;

  recognition.stop();
  // onend will reset flags
}

export function startPushToTalk() {
  if (!recognition) return;

  try {
    recognition.start();
    isListening = true;
    window.ARIA_setUserSpeaking?.(true);
  } catch {}
}

export function stopPushToTalk() {
  if (!recognition || !isListening) return;

  recognition.stop();
  // onend will handle the rest
}
