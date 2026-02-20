// vtt.js — FINAL CYBERPUNK ARIA OS VERSION

let recognition = null;
let vttEnabled = true;
let isRecording = false;

/* ============================================================
   ENABLE / DISABLE VTT
   ============================================================ */
export function setVTTEnabled(enabled) {
  vttEnabled = enabled;

  // Stop recognition if disabled
  if (!enabled && recognition && isRecording) {
    recognition.stop();
  }

  // Update UI button state
  const vttToggleBtn = document.getElementById("vttToggleBtn");
  if (vttToggleBtn) {
    vttToggleBtn.classList.toggle("active", enabled);
  }
}

/* ============================================================
   INITIALIZE VTT ON DOM LOAD
   ============================================================ */
window.addEventListener("DOMContentLoaded", () => {
  const callModeBtn = document.getElementById("callModeBtn");
  const userInput = document.getElementById("userInput");
  const voiceActivityBar = document.getElementById("voiceActivityBar");
  const voiceWave = document.getElementById("voiceWave");

  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;

  /* ------------------------------------------------------------
     NO SPEECH RECOGNITION AVAILABLE
     ------------------------------------------------------------ */
  if (!SpeechRecognition) {
    if (callModeBtn) {
      callModeBtn.disabled = true;
      callModeBtn.textContent = "🎙 N/A";
    }
    return;
  }

  /* ------------------------------------------------------------
     CREATE RECOGNITION INSTANCE
     ------------------------------------------------------------ */
  recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.lang = "en-US";

  /* ============================================================
     RECORDING UI + CALL MODE GRADIENT HOOKS
     ============================================================ */
  function setRecordingUI(active) {
    isRecording = active;

    // Button glow
    callModeBtn?.classList.toggle("active", active);

    // Old UI elements (if still present)
    voiceActivityBar?.classList.toggle("recording", active);
    voiceWave?.classList.toggle("active", active);

    // CALL MODE GRADIENT HOOK
    if (window.ARIA_setUserSpeaking) {
      window.ARIA_setUserSpeaking(active);
    }

    // Chromatic flash on start
    if (active && window.ARIA_triggerChromaticFlash) {
      window.ARIA_triggerChromaticFlash();
    }
  }

  /* ============================================================
     PUSH-TO-TALK START
     ============================================================ */
  callModeBtn?.addEventListener("mousedown", () => {
    if (!vttEnabled || !recognition) return;

    try {
      recognition.start();
      setRecordingUI(true);
    } catch {
      // Ignore double-start errors
    }
  });

  /* ============================================================
     PUSH-TO-TALK STOP
     ============================================================ */
  callModeBtn?.addEventListener("mouseup", () => {
    if (!recognition) return;
    recognition.stop();
    setRecordingUI(false);
  });

  /* ============================================================
     SPEECH RESULT HANDLER
     ============================================================ */
  recognition.onresult = (event) => {
    let finalTranscript = "";

    for (let i = 0; i < event.results.length; i++) {
      const res = event.results[i];
      if (res.isFinal) {
        finalTranscript += res[0].transcript;
      }
    }

    if (finalTranscript && userInput) {
      userInput.value = finalTranscript.trim();
    }
  };

  /* ============================================================
     RECOGNITION END
     ============================================================ */
  recognition.onend = () => {
    setRecordingUI(false);
  };
});
