// voiceControls.js — fixed active state CSS + PTT visual feedback

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

  /* ── TTS TOGGLE ── */
  ttsBtn?.addEventListener("click", () => {
    const nowEnabled = !ttsBtn.classList.contains("active");
    setTTSEnabled(nowEnabled);
    // Force visual update immediately
    ttsBtn.classList.toggle("active", nowEnabled);
  });

  /* ── VTT TOGGLE ── */
  vttBtn?.addEventListener("click", () => {
    const nowEnabled = !vttBtn.classList.contains("active");
    setVTTEnabled(nowEnabled);
    vttBtn.classList.toggle("active", nowEnabled);
    if (nowEnabled) startContinuousVTT();
    else stopContinuousVTT();
  });

  /* ── PTT — hold to talk, visual feedback while held ── */
  function pttDown(e) {
    e?.preventDefault?.();
    pttBtn?.classList.add("active", "ptt-active");
    startPushToTalk();
  }
  function pttUp(e) {
    e?.preventDefault?.();
    pttBtn?.classList.remove("active", "ptt-active");
    stopPushToTalk();
  }

  pttBtn?.addEventListener("mousedown", pttDown);
  pttBtn?.addEventListener("mouseup", pttUp);
  pttBtn?.addEventListener("mouseleave", pttUp);
  pttBtn?.addEventListener("touchstart", pttDown, { passive: false });
  pttBtn?.addEventListener("touchend", pttUp, { passive: false });

  /* ── CALL MODE ── */
  callBtn?.addEventListener("click", () => {
    if (callBtn.classList.contains("active")) {
      window.ARIA_closeCallOverlay?.();
      callBtn.classList.remove("active");
    } else {
      window.ARIA_openCallOverlay?.();
      callBtn.classList.add("active");
    }
  });

  const overlay = document.getElementById("callModeOverlay");
  overlay?.addEventListener("click", (e) => {
    if (e.target === overlay) callBtn?.classList.remove("active");
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") callBtn?.classList.remove("active");
  });
}
