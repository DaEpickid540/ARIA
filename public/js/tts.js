// tts.js — fixed

export let ttsEnabled = false;

export function setTTSEnabled(enabled) {
  ttsEnabled = enabled;

  const ttsBtn = document.getElementById("ttsBtn");
  if (ttsBtn) ttsBtn.classList.toggle("active", enabled);

  if (!enabled && window.speechSynthesis) {
    window.speechSynthesis.cancel();
    window.ARIA_isSpeaking = false;
  }
}

export function speak(text) {
  if (!ttsEnabled) return;
  if (!("speechSynthesis" in window)) return;

  // Strip markdown symbols so TTS doesn't say "hash hash" or "asterisk"
  const cleanText = text
    .replace(/#{1,3} /g, "") // headings
    .replace(/\*\*(.+?)\*\*/g, "$1") // bold
    .replace(/\*(.+?)\*/g, "$1") // italic
    .replace(/`{1,3}[^`]*`{1,3}/g, "") // code
    .replace(/---/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // markdown links
    .trim();

  if (!cleanText) return;

  window.speechSynthesis.cancel();

  const utter = new SpeechSynthesisUtterance(cleanText);

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
    // Mark ARIA as speaking — this prevents VTT from starting while TTS plays
    window.ARIA_isSpeaking = true;

    // Stop mic if call mode is active so ARIA doesn't hear itself
    window.ARIA_stopCallListening?.();

    // Visual: overlay pulse
    const overlay = document.getElementById("callModeOverlay");
    overlay?.classList.add("aria-speaking");
    overlay?.classList.remove("user-speaking");

    const status = document.getElementById("callModeStatus");
    if (status) status.textContent = "ARIA SPEAKING";
  };

  utter.onend = () => {
    window.ARIA_isSpeaking = false;

    // Resume mic if still in call mode
    const overlay = document.getElementById("callModeOverlay");
    overlay?.classList.remove("aria-speaking");
    overlay?.classList.add("user-speaking");

    const status = document.getElementById("callModeStatus");
    if (status) status.textContent = "LISTENING...";

    // Short pause then re-open mic
    setTimeout(() => {
      window.ARIA_startCallListening?.();
    }, 350);
  };

  utter.onerror = () => {
    window.ARIA_isSpeaking = false;
    window.ARIA_startCallListening?.();
  };

  window.speechSynthesis.speak(utter);
}

/* -------------------------------------------------------
   POPULATE VOICE SELECT ON LOAD
------------------------------------------------------- */
function populateVoices() {
  const select = document.getElementById("voiceSelect");
  if (!select) return;

  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return;

  select.innerHTML = "";
  voices.forEach((v) => {
    const opt = document.createElement("option");
    opt.value = v.name;
    opt.textContent = `${v.name} (${v.lang})`;
    select.appendChild(opt);
  });

  // Auto-select a saved voice, or fall back to a female English voice
  const saved = localStorage.getItem("aria_settings");
  let savedVoice = "";
  try {
    savedVoice = JSON.parse(saved)?.voice || "";
  } catch {}

  if (savedVoice) {
    select.value = savedVoice;
  } else if (!select.value) {
    const femaleVoice = voices.find(
      (v) =>
        v.lang.startsWith("en") &&
        /female|woman|zira|susan|emma|samantha|google uk english female/i.test(
          v.name,
        ),
    );
    if (femaleVoice) select.value = femaleVoice.name;
  }
}

window.speechSynthesis.onvoiceschanged = populateVoices;
// Also try immediately (some browsers have voices ready on load)
populateVoices();
