const SpeechRecognition =
  window.SpeechRecognition || window.webkitSpeechRecognition || null;

const callModeBtn = document.getElementById("callModeBtn");
const vttToggleBtn = document.getElementById("vttToggleBtn");
const userInput = document.getElementById("userInput");
const voiceActivityBar = document.getElementById("voiceActivityBar");
const voiceWave = document.getElementById("voiceWave");

let recognition = null;
let vttEnabled = true;
let isRecording = false;
let waveInterval = null;

if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.lang = "en-US";

  recognition.onresult = (event) => {
    let transcript = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      transcript += event.results[i][0].transcript;
    }
    if (userInput) userInput.value = transcript;
  };

  recognition.onend = () => {
    setRecordingState(false);
  };
}

export function setVTTEnabled(enabled) {
  vttEnabled = enabled;
  if (vttToggleBtn) {
    vttToggleBtn.classList.toggle("active", vttEnabled);
  }
  if (!enabled) {
    stopRecognition();
  }
}

function setRecordingState(active) {
  if (!voiceActivityBar || !voiceWave) return;

  isRecording = active;

  voiceActivityBar.classList.remove("speaking");
  voiceActivityBar.classList.remove("recording");

  if (active) {
    voiceActivityBar.classList.add("recording");
    voiceWave.classList.add("active");

    if (waveInterval) clearInterval(waveInterval);
    waveInterval = setInterval(() => {
      Array.from(voiceWave.children).forEach((bar) => {
        bar.style.height = `${4 + Math.random() * 16}px`;
      });
    }, 100);
  } else {
    voiceWave.classList.remove("active");
    if (waveInterval) clearInterval(waveInterval);
    Array.from(voiceWave.children).forEach((bar) => {
      bar.style.height = "4px";
    });
    voiceActivityBar.classList.remove("recording");
  }
}

function startRecognition() {
  if (!recognition || !vttEnabled) return;
  try {
    recognition.start();
    setRecordingState(true);
  } catch {
    // ignore double start
  }
}

function stopRecognition() {
  if (!recognition) return;
  recognition.stop();
  setRecordingState(false);
}

if (vttToggleBtn) {
  vttToggleBtn.addEventListener("click", () => {
    setVTTEnabled(!vttEnabled);
  });
}

if (callModeBtn && recognition) {
  const start = () => {
    if (!vttEnabled) return;
    callModeBtn.classList.add("active");
    startRecognition();
  };

  const stop = () => {
    callModeBtn.classList.remove("active");
    stopRecognition();
  };

  callModeBtn.addEventListener("mousedown", start);
  callModeBtn.addEventListener("mouseup", stop);
  callModeBtn.addEventListener("mouseleave", stop);

  callModeBtn.addEventListener("touchstart", (e) => {
    e.preventDefault();
    start();
  });
  callModeBtn.addEventListener("touchend", (e) => {
    e.preventDefault();
    stop();
  });
}
