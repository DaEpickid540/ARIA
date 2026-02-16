export let ttsEnabled = true;

let currentUtterance = null;

export function setTTSEnabled(enabled) {
  ttsEnabled = enabled;
  const btn = document.getElementById("voiceOffBtn");
  if (btn) {
    btn.classList.toggle("active", enabled);
  }
}

export function speak(text) {
  if (!ttsEnabled) return;
  if (!("speechSynthesis" in window)) return;

  window.speechSynthesis.cancel();

  const utter = new SpeechSynthesisUtterance(text);
  currentUtterance = utter;

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
    const female = voices.find((v) =>
      /female|woman|girl/i.test(v.name + " " + v.lang),
    );
    utter.voice = female || voices[0];
  }

  utter.onstart = () => {
    document.dispatchEvent(new CustomEvent("aria-speaking-start"));
  };

  utter.onend = () => {
    document.dispatchEvent(new CustomEvent("aria-speaking-stop"));
  };

  window.speechSynthesis.speak(utter);
}

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
