// vtt.js — speech to text for VTT, push-to-talk and call mode
//
// Two engines behind one set of exports:
//   "browser" — the Web Speech API. Works in Chrome and Edge.
//   "record"  — records the mic and transcribes it: on the server
//               (/api/transcribe, Groq or OpenAI Whisper), or, with neither
//               key, in this page with a local Whisper model (transformers.js,
//               ~80 MB, downloaded once and then cached by the browser).
// The desktop app always records: Electron has the Web Speech API, but it
// fails with "network" every time (Chrome's speech service needs keys only
// Chrome ships with). The old code swallowed that error, so the mic just
// did nothing. If the browser engine fails that way anywhere else, this
// switches to recording for the rest of the session.

let recognition = null;
let engine = "browser"; // "browser" | "record"
let isListening = false;
let vttEnabled = false;
let callModeActive = false;

const isElectron = /Electron/i.test(navigator.userAgent);

const $input = () => document.getElementById("userInput");
const $send = () => document.getElementById("sendBtn");
const toast = (msg) => window.ARIA_showNotification?.(msg);

export function initVTT() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR || isElectron) {
    engine = "record";
    return;
  }

  recognition = new SR();
  recognition.continuous = false; // single-shot per turn; we restart manually
  recognition.interimResults = true;
  recognition.lang = "en-US";

  recognition.onresult = (event) => {
    let interim = "";
    let final = "";
    for (let i = 0; i < event.results.length; i++) {
      if (event.results[i].isFinal) final += event.results[i][0].transcript;
      else interim += event.results[i][0].transcript;
    }
    // Show live interim text in input while speaking
    const input = $input();
    if (input) input.value = (final || interim).trim();
  };

  recognition.onend = () => {
    const wasListening = isListening;
    isListening = false;
    setWaveActive(false);
    finishTurn(wasListening, $input()?.value?.trim());
  };

  recognition.onerror = (e) => {
    isListening = false;
    setWaveActive(false);
    if (["network", "service-not-allowed", "language-not-supported"].includes(e.error)) {
      // The recognizer can't work here at all; recording can.
      engine = "record";
      recognition = null;
      toast("Voice input switched to recording mode — try again.");
      return;
    }
    if (e.error === "not-allowed") {
      toast("Microphone access is blocked for ARIA.");
      return;
    }
    // "no-speech" is normal; restart silently in call mode
    if (callModeActive && e.error === "no-speech") {
      setTimeout(() => {
        if (callModeActive) startCallListening();
      }, 500);
    }
  };
}

/** What happens when one utterance is over, whichever engine heard it. */
function finishTurn(wasListening, text) {
  if (callModeActive) {
    // CALL MODE: send whatever was transcribed then restart mic
    if (wasListening && text) {
      $send()?.click();
      // Restart mic after a short pause (waits for TTS to begin)
      setTimeout(() => {
        if (callModeActive) startCallListening();
      }, 400);
    } else if (callModeActive) {
      // Nothing transcribed — restart mic
      setTimeout(() => startCallListening(), 300);
    }
  } else if (wasListening && text) {
    // NORMAL VTT / PTT: send once the utterance is final
    $send()?.click();
  }
}

/* -------------------------------------------------------
   RECORD ENGINE
------------------------------------------------------- */
let rec = null; // the recording in progress

const SPEECH_RMS = 0.02; // above this counts as talking
const SILENCE_MS = 1300; // this long quiet after talking ends the utterance
const NO_SPEECH_MS = 8000; // nothing said at all: give up
const MAX_MS = 60_000;

/**
 * @param {{ endOnSilence: boolean }} opts  push-to-talk ends on release;
 *   VTT and call mode end when you stop talking.
 */
async function recordStart({ endOnSilence }) {
  if (rec || isListening) return;
  isListening = true;
  setWaveActive(true);
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
  } catch {
    isListening = false;
    setWaveActive(false);
    toast("Microphone access is blocked for ARIA.");
    return;
  }
  // Released before getUserMedia resolved (a quick PTT tap).
  if (!isListening) {
    stream.getTracks().forEach((t) => t.stop());
    return;
  }

  const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find(
    (t) => window.MediaRecorder?.isTypeSupported?.(t),
  );
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const r = { stream, recorder, chunks: [], heard: false, started: Date.now(), ctx: null, timer: null };
  rec = r;
  recorder.ondataavailable = (e) => e.data.size && r.chunks.push(e.data);
  recorder.onstop = () => onRecorded(r);
  recorder.start(250);

  // Level meter: notices speech, and (when asked) the silence after it.
  try {
    r.ctx = new AudioContext();
    const analyser = r.ctx.createAnalyser();
    analyser.fftSize = 1024;
    r.ctx.createMediaStreamSource(stream).connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    let lastLoud = Date.now();
    r.timer = setInterval(() => {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      const now = Date.now();
      if (Math.sqrt(sum / buf.length) > SPEECH_RMS) {
        r.heard = true;
        lastLoud = now;
      }
      const tooLong = now - r.started > MAX_MS;
      const doneTalking = endOnSilence && r.heard && now - lastLoud > SILENCE_MS;
      const neverTalked = endOnSilence && !r.heard && now - r.started > NO_SPEECH_MS;
      if (tooLong || doneTalking || neverTalked) recordStop();
    }, 100);
  } catch {
    r.heard = true; // no meter: assume there's something to transcribe
  }
}

function recordStop() {
  const r = rec;
  if (!r) {
    isListening = false;
    setWaveActive(false);
    return;
  }
  rec = null;
  clearInterval(r.timer);
  try {
    r.recorder.state !== "inactive" && r.recorder.stop();
  } catch {}
  r.stream.getTracks().forEach((t) => t.stop());
  r.ctx?.close().catch(() => {});
}

async function onRecorded(r) {
  isListening = false;
  setWaveActive(false);
  const blob = new Blob(r.chunks, { type: r.recorder.mimeType || "audio/webm" });
  let text = "";
  if (r.heard && blob.size > 1500) {
    const input = $input();
    const placeholder = input?.placeholder;
    if (input) input.placeholder = "Transcribing…";
    try {
      text = await transcribe(blob);
    } catch (e) {
      console.warn("[VTT] transcription failed:", e);
      toast(`Voice input failed: ${e.message || e}`);
    } finally {
      if (input) input.placeholder = placeholder;
    }
    const input2 = $input();
    if (input2 && text) input2.value = text;
  }
  finishTurn(true, text);
}

async function transcribe(blob) {
  const form = new FormData();
  form.append("audio", blob, blob.type.includes("mp4") ? "speech.mp4" : "speech.webm");
  const r = await fetch("/api/transcribe", { method: "POST", body: form });
  if (r.ok) return (await r.json()).text || "";
  if (r.status === 501) return transcribeLocally(blob); // no Groq/OpenAI key
  const d = await r.json().catch(() => ({}));
  throw new Error(d.message || d.error || `HTTP ${r.status}`);
}

/* Local Whisper, for when the server has no speech key. */
let _asr = null;
async function transcribeLocally(blob) {
  if (!_asr) {
    toast("Downloading the speech model (first time only, ~80 MB)…");
    _asr = import("https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1")
      .then(({ pipeline }) =>
        pipeline("automatic-speech-recognition", "onnx-community/whisper-base.en", {
          dtype: "q8",
          device: "wasm",
        }),
      )
      .catch((e) => {
        _asr = null; // let the next try download again
        throw e;
      });
  }
  const asr = await _asr;
  // Whisper wants 16 kHz mono PCM.
  const ctx = new AudioContext({ sampleRate: 16000 });
  try {
    const audio = await ctx.decodeAudioData(await blob.arrayBuffer());
    const out = await asr(audio.getChannelData(0));
    return String(out?.text || "").trim();
  } finally {
    ctx.close().catch(() => {});
  }
}

/* -------------------------------------------------------
   CALL MODE — separate start/stop so TTS can pause the mic
   while ARIA is speaking (prevents hearing itself)
------------------------------------------------------- */
export function startCallListening() {
  if (isListening) return;
  // Don't listen while ARIA is speaking
  if (window.ARIA_isSpeaking) return;
  if (engine === "record") return void recordStart({ endOnSilence: true });
  if (!recognition) return;
  try {
    recognition.start();
    isListening = true;
    setWaveActive(true);
  } catch {
    // already started — ignore
  }
}

export function stopCallListening() {
  if (!isListening) return;
  if (engine === "record") return recordStop();
  try {
    recognition?.stop();
  } catch {}
  isListening = false;
  setWaveActive(false);
}

export function setCallModeActive(active) {
  callModeActive = active;
  if (active) startCallListening();
  else stopCallListening();
}

/* -------------------------------------------------------
   NORMAL VTT (continuous toggle)
------------------------------------------------------- */
export function setVTTEnabled(enabled) {
  vttEnabled = enabled;

  const vttBtn = document.getElementById("vttBtn");
  if (vttBtn) vttBtn.classList.toggle("active", enabled);

  if (!enabled) stopContinuousVTT();
}

export function startContinuousVTT() {
  if (!vttEnabled || isListening) return;
  if (engine === "record") return void recordStart({ endOnSilence: true });
  if (!recognition) return;
  try {
    recognition.start();
    isListening = true;
  } catch {}
}

export function stopContinuousVTT() {
  if (!isListening) return;
  if (engine === "record") return recordStop();
  try {
    recognition?.stop();
  } catch {}
  isListening = false;
}

/* -------------------------------------------------------
   PUSH TO TALK
------------------------------------------------------- */
export function startPushToTalk() {
  if (isListening) return;
  if (engine === "record") return void recordStart({ endOnSilence: false });
  if (!recognition) return;
  try {
    recognition.start();
    isListening = true;
    setWaveActive(true);
  } catch {}
}

export function stopPushToTalk() {
  if (!isListening) return;
  if (engine === "record") return recordStop();
  try {
    recognition?.stop();
  } catch {}
  isListening = false;
  setWaveActive(false);
}

/* -------------------------------------------------------
   VOICE WAVE HELPER
------------------------------------------------------- */
function setWaveActive(active) {
  const wave = document.getElementById("voiceWave");
  if (wave) wave.classList.toggle("active", active);
}
