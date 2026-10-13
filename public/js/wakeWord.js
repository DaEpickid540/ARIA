// wakeWord.js — "Hey ARIA": listens for the wake phrase, then for what you
// want. Off until you turn it on (Tools → Hey ARIA, or the tray menu in the
// desktop app).
//
// How it listens: the mic's loudness is cut into short utterances
// (wakeCore.js); each one is transcribed ON THIS DEVICE by the same Whisper
// model voice input falls back to (vtt.js), and only if it starts with
// "Hey ARIA" does anything happen. Nothing the mic hears leaves the device
// until you've said the wake phrase; what you say after it goes the usual
// voice-input way.
//
//   "Hey ARIA"                       → a chime, then ARIA listens for one request
//   "Hey ARIA, what's the weather?"  → sent straight away
//
// Push-to-talk stays as the fallback: the mic button, or Ctrl+Shift+Space
// anywhere in Windows when the desktop app is running (desktop/main.js).

import { matchWake, isCommand, Segmenter } from "./wakeCore.js";
import { transcribePcmLocally, listenOnce, isVoiceBusy } from "./vtt.js";

const RATE = 16000; // what Whisper wants, so no resampling
const CHUNK = 1024; // 64 ms frames
const PREROLL = 5; // chunks kept from before speech started (~320 ms)
const KEY = "aria_wake";
const toast = (msg) => window.ARIA_showNotification?.(msg);
const desk = () => window.ariaDesktop;

let run = null; // { stream, ctx, proc, seg, pre, utter, checking }
let _transcribe = transcribePcmLocally; // tests swap this

const store = {
  get: () => {
    try {
      return localStorage.getItem(KEY) === "1";
    } catch {
      return false;
    }
  },
  set: (on) => {
    try {
      localStorage.setItem(KEY, on ? "1" : "0");
    } catch {}
  },
};

const concat = (chunks) => {
  const out = new Float32Array(chunks.reduce((a, c) => a + c.length, 0));
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
};

function chime() {
  try {
    const ctx = run?.ctx || new AudioContext();
    const t = ctx.currentTime;
    for (const [i, hz] of [660, 990].entries()) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = hz;
      g.gain.setValueAtTime(0.0001, t + i * 0.09);
      g.gain.exponentialRampToValueAtTime(0.25, t + i * 0.09 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.09 + 0.12);
      o.connect(g).connect(ctx.destination);
      o.start(t + i * 0.09);
      o.stop(t + i * 0.09 + 0.14);
    }
  } catch {}
}

async function check(pcm) {
  if (!run || run.checking) return; // one at a time; a burst while busy is skipped
  run.checking = true;
  try {
    const text = await _transcribe(pcm);
    const m = matchWake(text);
    if (m.woke && run) await woke(m.rest);
  } catch (e) {
    console.warn("[WAKE] check failed:", e);
  } finally {
    if (run) run.checking = false;
  }
}

async function woke(rest) {
  chime();
  await desk()?.showWindow?.().catch?.(() => {});
  const input = document.getElementById("userInput");
  const send = document.getElementById("sendBtn");
  if (isCommand(rest) && input && send) {
    input.value = rest;
    send.click();
    return;
  }
  // Just the name: listen for the request (after the chime has played).
  setTimeout(() => {
    if (!listenOnce()) toast("Heard you, but voice input is busy.");
  }, 250);
}

function onAudio(e) {
  if (!run) return;
  const chunk = new Float32Array(e.inputBuffer.getChannelData(0));
  let sum = 0;
  for (let i = 0; i < chunk.length; i++) sum += chunk[i] * chunk[i];
  const ev = run.seg.push(Math.sqrt(sum / chunk.length));
  // ARIA talking, or voice input already listening: not a wake phrase.
  const busy = window.ARIA_isSpeaking || isVoiceBusy();
  if (ev === "start") run.utter = { chunks: [...run.pre, chunk], busy };
  else if (run.utter) {
    run.utter.chunks.push(chunk);
    run.utter.busy ||= busy;
  }
  if (ev === "drop") run.utter = null;
  else if (ev?.end) {
    const u = run.utter;
    run.utter = null;
    if (u && !u.busy) check(concat(u.chunks));
  }
  run.pre = [...run.pre.slice(-(PREROLL - 1)), chunk];
}

export async function startWake() {
  if (run) return true;
  if (!navigator.mediaDevices?.getUserMedia) {
    toast("This browser can't listen for a wake word.");
    return false;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch {
    toast("Microphone blocked, so ARIA can't listen for 'Hey ARIA'.");
    return false;
  }
  const ctx = new AudioContext({ sampleRate: RATE });
  const source = ctx.createMediaStreamSource(stream);
  const proc = ctx.createScriptProcessor(CHUNK, 1, 1);
  proc.onaudioprocess = onAudio;
  source.connect(proc);
  proc.connect(ctx.destination); // silent, but some browsers only run it when connected
  run = { stream, ctx, proc, seg: new Segmenter({ frameMs: (CHUNK / RATE) * 1000 }), pre: [], utter: null, checking: false };
  updateUi();
  return true;
}

export function stopWake() {
  if (!run) return;
  run.proc.disconnect();
  run.stream.getTracks().forEach((t) => t.stop());
  run.ctx.close().catch(() => {});
  run = null;
  updateUi();
}

export const wakeOn = () => !!run;

/** Turns it on or off, remembers it, and tells the desktop app (tray). */
export async function setWake(on, { quiet = false } = {}) {
  let now = false;
  if (on) {
    // The mic first: no point downloading the model if it's blocked.
    now = await startWake();
    if (now) {
      if (!quiet) toast("Getting the on-device speech model ready (first time ~80 MB)…");
      try {
        await _transcribe(new Float32Array(RATE / 2)); // loads it now, not on the first "Hey ARIA"
      } catch (e) {
        toast(`Can't listen for 'Hey ARIA': the speech model didn't load (${e.message || e}).`);
        stopWake();
        now = false;
      }
    }
  } else stopWake();
  store.set(now);
  desk()?.setWake?.(now);
  if (!quiet || (on && !now)) toast(now ? "Listening for 'Hey ARIA'. What the mic hears is checked on this device only." : on ? "Couldn't start listening for 'Hey ARIA'." : "Stopped listening for 'Hey ARIA'.");
  return now;
}

function updateUi() {
  const b = document.getElementById("tool_wake");
  if (b) b.innerHTML = `<i class="bi bi-ear" aria-hidden="true"></i> Hey ARIA: <b>${run ? "on" : "off"}</b>`;
  document.body.classList.toggle("ariaWakeOn", !!run);
}

/** Tests only: a fake transcriber. */
export function _setTranscriber(fn) {
  _transcribe = fn;
}

export function initWakeWord() {
  window.ARIA_setWake = setWake;
  document.getElementById("tool_wake")?.addEventListener("click", () => {
    document.getElementById("toolsDropdown")?.style.setProperty("display", "none");
    setWake(!run);
  });
  // The desktop app's tray toggle and its global push-to-talk shortcut.
  desk()?.onWakeToggle?.((on) => setWake(on));
  desk()?.onPushToTalk?.(() => {
    chime();
    if (!listenOnce()) toast("Voice input is already listening.");
  });
  updateUi();
  if (store.get()) setWake(true, { quiet: true });
}
