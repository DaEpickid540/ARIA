export let ttsEnabled = true;

const voiceOffBtn = document.getElementById("voiceOffBtn");
const voiceSelect = document.getElementById("voiceSelect");
const voiceRate = document.getElementById("voiceRate");
const voicePitch = document.getElementById("voicePitch");
const callIndicator = document.getElementById("callIndicator");
const voiceActivityBar = document.getElementById("voiceActivityBar");
const voiceWave = document.getElementById("voiceWave");

let voices = [];
let speakingInterval = null;

function populateVoices() {
  voices = window.speechSynthesis.getVoices();
}

if (typeof speechSynthesis !== "undefined") {
  populateVoices();
  speechSynthesis.onvoiceschanged = populateVoices;
}

export function speak(text) {
  if (!ttsEnabled) return;
  if (!window.speechSynthesis) return;
  if (!text) return;

  window.speechSynthesis.cancel();

  const utter = new SpeechSynthesisUtterance(text);

  const selectedName = voiceSelect?.value;
  if (selectedName && voices.length) {
    const match = voices.find((v) => v.name === selectedName);
    if (match) utter.voice = match;
  }

  if (voiceRate) utter.rate = parseFloat(voiceRate.value) || 1;
  if (voicePitch) utter.pitch = parseFloat(voicePitch.value) || 1;

  utter.onstart = () => {
    setSpeakingState(true);
  };

  utter.onend = () => {
    setSpeakingState(false);
  };

  window.speechSynthesis.speak(utter);
}

function setSpeakingState(isSpeaking) {
  if (!callIndicator || !voiceActivityBar || !voiceWave) return;

  callIndicator.classList.remove("recording");
  voiceActivityBar.classList.remove("recording");

  if (isSpeaking) {
    callIndicator.classList.add("speaking");
    voiceActivityBar.classList.add("speaking");
    voiceWave.classList.add("active");

    if (speakingInterval) clearInterval(speakingInterval);
    speakingInterval = setInterval(() => {
      Array.from(voiceWave.children).forEach((bar) => {
        bar.style.height = `${4 + Math.random() * 16}px`;
      });
    }, 100);
  } else {
    callIndicator.classList.remove("speaking");
    voiceActivityBar.classList.remove("speaking");
    voiceWave.classList.remove("active");
    if (speakingInterval) clearInterval(speakingInterval);
    Array.from(voiceWave.children).forEach((bar) => {
      bar.style.height = "4px";
    });
  }
}

if (voiceOffBtn) {
  voiceOffBtn.addEventListener("click", () => {
    ttsEnabled = !ttsEnabled;
    voiceOffBtn.classList.toggle("active", ttsEnabled);

    if (!ttsEnabled && window.speechSynthesis) {
      window.speechSynthesis.cancel();
      setSpeakingState(false);
    }
  });

  // default ON
  voiceOffBtn.classList.add("active");
}
