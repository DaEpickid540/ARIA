// voiceControls.js — final baseline

import {
  initVTT,
  setVTTEnabled,
  startContinuousVTT,
  stopContinuousVTT,
  startPushToTalk,
  stopPushToTalk,
} from "./vtt.js";

import { setTTSEnabled } from "./tts.js";

export function initVoiceControls() {
  initVTT();

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

  // Push-to-talk
  pttBtn?.addEventListener("mousedown", startPushToTalk);
  pttBtn?.addEventListener("mouseup", stopPushToTalk);
  pttBtn?.addEventListener("mouseleave", stopPushToTalk);

  // Call mode
  callBtn?.addEventListener("click", () => {
    window.ARIA_openCallOverlay?.();
    setTTSEnabled(true);
  });
}
