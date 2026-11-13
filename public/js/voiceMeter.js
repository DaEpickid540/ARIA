// voiceMeter.js — how loud ARIA's voice is right now, for the call hologram
//
// tts.js hands each clip it plays to meterAudio(). The clip is listened to
// through captureStream(), which taps the sound without rerouting it, so
// playback is exactly as before whether or not this works. Where it can't
// (the browser's built-in speech has no audio to tap; Firefox's capture
// mutes the element, so it isn't used), voiceLevel() returns null and the
// hologram falls back to a made-up speech rhythm.

let ctx = null;
let analyser = null;
let buf = null;
let source = null;
let liveUntil = 0;

/** Listen to one <audio> clip while it plays. Never throws. */
export function meterAudio(audio) {
  if (typeof audio?.captureStream !== "function") return;
  const attach = () => {
    try {
      ctx ||= new AudioContext();
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      if (!analyser) {
        analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        buf = new Float32Array(analyser.fftSize);
      }
      source?.disconnect();
      source = ctx.createMediaStreamSource(audio.captureStream());
      source.connect(analyser); // not to the speakers: the element already plays
      liveUntil = Infinity;
    } catch {
      liveUntil = 0;
    }
  };
  const detach = () => {
    liveUntil = Date.now() + 150; // let the tail of the clip register
  };
  audio.addEventListener("playing", attach, { once: true });
  audio.addEventListener("ended", detach);
  audio.addEventListener("pause", detach);
  audio.addEventListener("error", detach);
}

/** 0–1 loudness of the clip playing now, or null when nothing is metered. */
export function voiceLevel() {
  if (!analyser || Date.now() > liveUntil) return null;
  analyser.getFloatTimeDomainData(buf);
  let sum = 0;
  for (const v of buf) sum += v * v;
  // Speech sits around 0.05–0.2 RMS; ×6 fills the range (as Holo Core does).
  return Math.min(1, Math.sqrt(sum / buf.length) * 6);
}

window.ARIA_voiceLevel = voiceLevel;
