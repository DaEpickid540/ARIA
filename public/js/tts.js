// tts.js — final baseline

export let ttsEnabled = false;

export function setTTSEnabled(enabled) {
  ttsEnabled = enabled;

  const ttsBtn = document.getElementById("ttsBtn");
  if (ttsBtn) ttsBtn.classList.toggle("active", enabled);

  const settingsTTS = document.getElementById("settingsTTS");
  if (settingsTTS) settingsTTS.checked = enabled;

  if (!enabled && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
}

export function speak(text) {
  if (!ttsEnabled) return;
  if (!("speechSynthesis" in window)) return;

  window.speechSynthesis.cancel();

  const utter = new SpeechSynthesisUtterance(text);

  const rate = document.getElementById("voiceRate");
  const pitch = document.getElementById("voicePitch");
  const voiceSelect = document.getElementById("voiceSelect");

  utter.rate = rate ? parseFloat(rate.value) || 1 : 1;
  utter.pitch = pitch ? parseFloat(pitch.value) || 1 : 1;

  const voices = window.speechSynthesis.getVoices();
  if (voices.length && voiceSelect?.value) {
    const match = voices.find((v) => v.name === voiceSelect.value);
    if (match) utter.voice = match;
  }

  utter.onstart = () => {
    window.ARIA_setAriaSpeaking?.(true);
  };

  utter.onend = () => {
    window.ARIA_setAriaSpeaking?.(false);
  };

  window.speechSynthesis.speak(utter);
}

window.speechSynthesis.onvoiceschanged = () => {
  const select = document.getElementById("voiceSelect");
  if (!select) return;

  const voices = window.speechSynthesis.getVoices();
  select.innerHTML = "";

  voices.forEach((v) => {
    const opt = document.createElement("option");
    opt.value = v.name;
    opt.textContent = `${v.name} (${v.lang})`;
    select.appendChild(opt);
  });

  // AUTO‑SELECT FEMALE VOICE IF NO SAVED SETTING
  if (!select.value) {
    const femaleVoice = voices.find(
      (v) =>
        v.lang.startsWith("en") &&
        /female|woman|zira|susan|emma|samantha|google uk english female/i.test(
          v.name,
        ),
    );

    if (femaleVoice) {
      select.value = femaleVoice.name;
    }
  }
};
