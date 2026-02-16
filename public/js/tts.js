export let ttsEnabled = true;

const voiceOffBtn = document.getElementById("voiceOffBtn");
const voiceSelect = document.getElementById("voiceSelect");
const voiceRate = document.getElementById("voiceRate");
const voicePitch = document.getElementById("voicePitch");
const voiceActivityBar = document.getElementById("voiceActivityBar");
const voiceWave = document.getElementById("voiceWave");

let voices = [];
let speakingInterval = null;

function populateVoices() {
  voices = window.speechSynthesis.getVoices();
  if (voiceSelect && voiceSelect.children.length <= 1) {
    // Fill with actual voices
    voiceSelect.innerHTML = "";
    voices.forEach((v) => {
      const opt = document.createElement("option");
      opt.value = v.name;
      opt.textContent = v.name;
      voiceSelect.appendChild(opt);
    });
  }
}

if (typeof speechSynthesis !== "undefined") {
  populateVoices();
  speechSynthesis.onvoiceschanged = populateVoices;
}

export function setTTSEnabled(enabled) {
  ttsEnabled = enabled;
  if (voiceOffBtn) {
    voiceOffBtn.classList.toggle("active", ttsEnabled);
  }
  if (!enabled && window.speechSynthesis) {
    window.speechSynthesis.cancel();
    setSpeakingState(false);
  }
}

export function speak(text) {
  if (!ttsEnabled) return;
  if (!window.speechSynthesis) return;
  if (!text) return;

  window.speechSynthesis.cancel();

  const utter = new SpeechSynthesisUtterance(text);

  let selectedName = voiceSelect?.value;

  // Auto-pick a female voice if none selected
  if (!selectedName && voices.length) {
    const female = voices.find(
      (v) =>
        v.name.toLowerCase().includes("female") ||
        v.name.toLowerCase().includes("woman") ||
        v.name.toLowerCase().includes("girl") ||
        v.name.toLowerCase().includes("samantha") ||
        v.name.toLowerCase().includes("victoria") ||
        v.name.toLowerCase().includes("zira"),
    );
    if (female) selectedName = female.name;
  }

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
  if (!voiceActivityBar || !voiceWave) return;

  voiceActivityBar.classList.remove("recording");
  voiceActivityBar.classList.remove("speaking");

  if (isSpeaking) {
    voiceActivityBar.classList.add("speaking");
    voiceWave.classList.add("active");

    if (speakingInterval) clearInterval(speakingInterval);
    speakingInterval = setInterval(() => {
      Array.from(voiceWave.children).forEach((bar) => {
        bar.style.height = `${4 + Math.random() * 16}px`;
      });
    }, 100);
  } else {
    voiceWave.classList.remove("active");
    if (speakingInterval) clearInterval(speakingInterval);
    Array.from(voiceWave.children).forEach((bar) => {
      bar.style.height = "4px";
    });
    voiceActivityBar.classList.remove("speaking");
  }
}

if (voiceOffBtn) {
  voiceOffBtn.addEventListener("click", () => {
    setTTSEnabled(!ttsEnabled);
  });
}
