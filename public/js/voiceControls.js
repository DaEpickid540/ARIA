// voiceControls.js — fixed

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
  // Init the recognition engine first
  initVTT();

  const callBtn = document.getElementById("callModeBtn");
  const pttBtn = document.getElementById("pushToTalkBtn");
  const vttBtn = document.getElementById("vttBtn");
  const ttsBtn = document.getElementById("ttsBtn");

  /* -------------------------------------------------------
     TTS TOGGLE
  ------------------------------------------------------- */
  ttsBtn?.addEventListener("click", () => {
    const nowEnabled = !ttsBtn.classList.contains("active");
    setTTSEnabled(nowEnabled);
  });

  /* -------------------------------------------------------
     VTT CONTINUOUS TOGGLE
  ------------------------------------------------------- */
  vttBtn?.addEventListener("click", () => {
    const nowEnabled = !vttBtn.classList.contains("active");
    setVTTEnabled(nowEnabled);
    if (nowEnabled) startContinuousVTT();
    else stopContinuousVTT();
  });

  /* -------------------------------------------------------
     PUSH TO TALK
  ------------------------------------------------------- */
  pttBtn?.addEventListener("mousedown", startPushToTalk);
  pttBtn?.addEventListener("mouseup", stopPushToTalk);
  pttBtn?.addEventListener("mouseleave", stopPushToTalk);
  // Touch support
  pttBtn?.addEventListener("touchstart", (e) => {
    e.preventDefault();
    startPushToTalk();
  });
  pttBtn?.addEventListener("touchend", (e) => {
    e.preventDefault();
    stopPushToTalk();
  });

  /* -------------------------------------------------------
     CALL MODE BUTTON
     The actual open logic lives in callEngine.js.
     voiceControls just triggers it.
  ------------------------------------------------------- */
  callBtn?.addEventListener("click", () => {
    if (callBtn.classList.contains("active")) {
      // Already in call — close it
      window.ARIA_closeCallOverlay?.();
      callBtn.classList.remove("active");
    } else {
      window.ARIA_openCallOverlay?.();
      callBtn.classList.add("active");
    }
  });

  // Sync button state when call overlay closes via ESC or background click
  const overlay = document.getElementById("callModeOverlay");
  overlay?.addEventListener("click", (e) => {
    if (e.target === overlay) callBtn?.classList.remove("active");
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") callBtn?.classList.remove("active");
  });
}
