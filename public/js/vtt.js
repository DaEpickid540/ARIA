let recognition = null;
let vttEnabled = true;
let isRecording = false;

export function setVTTEnabled(enabled) {
  vttEnabled = enabled;
  if (!enabled && recognition && isRecording) {
    recognition.stop();
  }
}

window.addEventListener("DOMContentLoaded", () => {
  const callModeBtn = document.getElementById("callModeBtn");
  const userInput = document.getElementById("userInput");
  const voiceActivityBar = document.getElementById("voiceActivityBar");
  const voiceWave = document.getElementById("voiceWave");

  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    if (callModeBtn) {
      callModeBtn.disabled = true;
      callModeBtn.textContent = "🎙 N/A";
    }
    return;
  }

  recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.lang = "en-US";

  function setRecordingUI(active) {
    isRecording = active;
    if (callModeBtn) callModeBtn.classList.toggle("active", active);
    if (voiceActivityBar) {
      voiceActivityBar.classList.toggle("recording", active);
    }
    if (voiceWave) {
      voiceWave.classList.toggle("active", active);
    }
  }

  callModeBtn?.addEventListener("mousedown", () => {
    if (!vttEnabled || !recognition) return;
    try {
      recognition.start();
      setRecordingUI(true);
    } catch {
      // ignore double start
    }
  });

  callModeBtn?.addEventListener("mouseup", () => {
    if (!recognition) return;
    recognition.stop();
    setRecordingUI(false);
  });

  recognition.onresult = (event) => {
    let finalTranscript = "";
    for (let i = 0; i < event.results.length; i++) {
      const res = event.results[i];
      if (res.isFinal) {
        finalTranscript += res[0].transcript;
      }
    }
    if (finalTranscript && userInput) {
      userInput.value = finalTranscript.trim();
    }
  };

  recognition.onend = () => {
    setRecordingUI(false);
  };
});
