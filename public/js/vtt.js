// vtt.js — Shared Recognition Engine (PTT + VTT)

import { speak, ttsEnabled } from "./tts.js";

let recognition = null;
let vttEnabled = false;
let isListening = false;

const SpeechRecognition =
  window.SpeechRecognition || window.webkitSpeechRecognition;

if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = "en-US";
}

export function setVTTEnabled(enabled) {
  vttEnabled = enabled;

  const vttBtn = document.getElementById("vttBtn");
  if (vttBtn) vttBtn.classList.toggle("active", enabled);

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
  isListening = false;
  window.ARIA_setUserSpeaking?.(false);
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
  if (!recognition) return;

  recognition.stop();
  isListening = false;
  window.ARIA_setUserSpeaking?.(false);
}

window.addEventListener("DOMContentLoaded", () => {
  if (!recognition) return;

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

  recognition.onend = async () => {
    if (!isListening) return;

    isListening = false;
    window.ARIA_setUserSpeaking?.(false);

    // Auto-send (Option C)
    if (userInput?.value.trim()) {
      sendBtn?.click();
    }
  };
});
