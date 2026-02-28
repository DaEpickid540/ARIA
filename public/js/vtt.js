// vtt.js — final baseline

let recognition;
let isListening = false;
let vttEnabled = false;

export function initVTT() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    console.warn("SpeechRecognition not supported");
    return;
  }

  recognition = new SR();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = "en-US";

  const input = document.getElementById("userInput");
  const sendBtn = document.getElementById("sendBtn");

  recognition.onresult = (event) => {
    let final = "";
    for (let i = 0; i < event.results.length; i++) {
      if (event.results[i].isFinal) {
        final += event.results[i][0].transcript;
      }
    }
    if (final && input) input.value = final.trim();
  };

  recognition.onend = () => {
    const wasListening = isListening;
    isListening = false;

    if (wasListening && input && input.value.trim()) {
      sendBtn?.click();
    }
  };
}

export function setVTTEnabled(enabled) {
  vttEnabled = enabled;

  const vttBtn = document.getElementById("vttBtn");
  if (vttBtn) vttBtn.classList.toggle("active", enabled);

  const settingsVTT = document.getElementById("settingsVTT");
  if (settingsVTT) settingsVTT.checked = enabled;

  if (!enabled && recognition) {
    recognition.stop();
  }
}

export function startContinuousVTT() {
  if (!recognition || !vttEnabled || isListening) return;
  recognition.start();
  isListening = true;
}

export function stopContinuousVTT() {
  if (!recognition || !isListening) return;
  recognition.stop();
}

export function startPushToTalk() {
  if (!recognition) return;
  recognition.start();
  isListening = true;
}

export function stopPushToTalk() {
  if (!recognition || !isListening) return;
  recognition.stop();
}
