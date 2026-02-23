// voiceControls.js — Button Wiring + Waveform

import { setTTSEnabled } from "./tts.js";
import {
  setVTTEnabled,
  startContinuousVTT,
  stopContinuousVTT,
  startPushToTalk,
  stopPushToTalk,
} from "./vtt.js";

export function initVoiceControls() {
  const callBtn = document.getElementById("callModeBtn");
  const pttBtn = document.getElementById("pushToTalkBtn");
  const vttBtn = document.getElementById("vttBtn");
  const ttsBtn = document.getElementById("ttsBtn");

  // TTS toggle
  ttsBtn?.addEventListener("click", () => {
    const enabled = !ttsBtn.classList.contains("active");
    setTTSEnabled(enabled);
  });

  // VTT toggle
  vttBtn?.addEventListener("click", () => {
    const enabled = !vttBtn.classList.contains("active");
    setVTTEnabled(enabled);
    if (enabled) startContinuousVTT();
    else stopContinuousVTT();
  });

  // Push-to-Talk (Option C)
  pttBtn?.addEventListener("mousedown", startPushToTalk);
  pttBtn?.addEventListener("mouseup", stopPushToTalk);
  pttBtn?.addEventListener("mouseleave", stopPushToTalk);

  // Call Mode
  callBtn?.addEventListener("click", () => {
    window.ARIA_openCallOverlay?.();
    setTTSEnabled(true);
  });

  // Waveform analyzer
  initAudioAnalyzer();
}

function initAudioAnalyzer() {
  const waveformBars = document.querySelectorAll("#callWaveform .waveBar");
  const spectrogramBars = document.querySelectorAll(
    "#callSpectrogram .specBar",
  );

  let ctx = null;
  let analyser = null;
  let data = null;

  navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = ctx.createAnalyser();
    analyser.fftSize = 64;
    data = new Uint8Array(analyser.frequencyBinCount);

    const src = ctx.createMediaStreamSource(stream);
    src.connect(analyser);

    function loop() {
      requestAnimationFrame(loop);
      analyser.getByteFrequencyData(data);

      waveformBars.forEach((bar, i) => {
        const v = data[i] || 0;
        bar.style.height = `${Math.max(10, v / 4)}px`;
      });

      spectrogramBars.forEach((bar, i) => {
        const v = data[i] || 0;
        bar.style.height = `${Math.max(6, v / 5)}px`;
      });
    }

    loop();
  });
}
