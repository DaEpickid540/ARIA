// practiceAudio.js — the sums behind the Practice panel's tuner and tempo
// check. Pure functions on sample arrays: no DOM, no AudioContext, so the
// tests run them on made-up signals (tests/practice.test.mjs).

const NOTES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];

/**
 * The pitch of one buffer, in Hz, or null when it's too quiet or not a
 * steady note. McLeod's normalised square difference: the first strong peak
 * after the lag-0 lobe is the period, which skips the octave errors plain
 * autocorrelation makes on bowed strings and piano.
 * @param {Float32Array} buf
 * @param {number} sampleRate
 * @param {{ minHz?: number, maxHz?: number, minRms?: number }} [o]
 */
export function detectPitch(buf, sampleRate, { minHz = 50, maxHz = 2000, minRms = 0.01 } = {}) {
  const n = buf.length;
  let rms = 0;
  for (let i = 0; i < n; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / n);
  if (rms < minRms) return null;

  const minLag = Math.max(2, Math.floor(sampleRate / maxHz));
  const maxLag = Math.min(n - 1, Math.ceil(sampleRate / minHz));
  const nsdf = new Float32Array(maxLag + 2);
  for (let tau = 0; tau <= maxLag + 1; tau++) {
    let acf = 0;
    let m = 0;
    for (let i = 0; i < n - tau; i++) {
      acf += buf[i] * buf[i + tau];
      m += buf[i] * buf[i] + buf[i + tau] * buf[i + tau];
    }
    nsdf[tau] = m > 0 ? (2 * acf) / m : 0;
  }
  // Peaks between zero crossings, after the first one going down.
  const peaks = [];
  let tau = 1;
  while (tau <= maxLag && nsdf[tau] > 0) tau++;
  while (tau <= maxLag) {
    while (tau <= maxLag && nsdf[tau] <= 0) tau++;
    let best = -1;
    while (tau <= maxLag && nsdf[tau] > 0) {
      if (tau >= minLag && (best < 0 || nsdf[tau] > nsdf[best])) best = tau;
      tau++;
    }
    if (best > 0) peaks.push(best);
  }
  if (!peaks.length) return null;
  const top = Math.max(...peaks.map((p) => nsdf[p]));
  if (top < 0.5) return null; // noise, or a chord
  const pick = peaks.find((p) => nsdf[p] >= 0.9 * top);
  // Parabolic interpolation for a fraction of a sample (cents matter here).
  const a = nsdf[pick - 1];
  const b = nsdf[pick];
  const c = nsdf[pick + 1];
  const d = a - 2 * b + c;
  const shift = d !== 0 ? (0.5 * (a - c)) / d : 0;
  return sampleRate / (pick + shift);
}

/** The nearest note to `hz` and how far off it is: { name: "A", octave: 4, cents: -3, midi: 69, target: 440 }. */
export function noteOf(hz, a4 = 440) {
  if (!(hz > 0)) return null;
  const exact = 69 + 12 * Math.log2(hz / a4);
  const midi = Math.round(exact);
  return {
    name: NOTES[((midi % 12) + 12) % 12],
    octave: Math.floor(midi / 12) - 1,
    cents: Math.round((exact - midi) * 100),
    midi,
    target: a4 * 2 ** ((midi - 69) / 12),
  };
}

/**
 * Note starts in a recording, in seconds: frames whose energy jumps well
 * above the recent level. Bowed and plucked notes, claps and piano all show
 * up; a held note doesn't count twice.
 * @param {Float32Array} samples  mono
 * @param {number} sampleRate
 * @param {{ hop?: number, minGap?: number, ratio?: number, floor?: number }} [o]
 */
export function detectOnsets(samples, sampleRate, { hop = 512, minGap = 0.09, ratio = 1.8, floor = 0.005 } = {}) {
  const frames = Math.floor(samples.length / hop);
  const energy = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let e = 0;
    for (let i = f * hop; i < (f + 1) * hop; i++) e += samples[i] * samples[i];
    energy[f] = Math.sqrt(e / hop);
  }
  const out = [];
  let avg = energy[0] || 0;
  let lastT = -Infinity;
  for (let f = 1; f < frames; f++) {
    const t = (f * hop) / sampleRate;
    if (energy[f] > floor && energy[f] > avg * ratio && energy[f] > energy[f - 1] && t - lastT >= minGap) {
      out.push(t);
      lastT = t;
    }
    avg = 0.85 * avg + 0.15 * energy[f]; // the "recent level"
  }
  return out;
}

/**
 * Tempo and steadiness from note starts. With a target BPM, intervals are
 * read as the nearest beat subdivision (eighths at 60 count as 60, not 120).
 * @returns {{ bpm: number, steadiness: number, notes: number, drift: number } | null}
 *   steadiness: 100 = metronomic; drift: BPM change from the first half to the second.
 */
export function tempoFrom(onsets, targetBpm = null) {
  if (onsets.length < 4) return null;
  let iois = [];
  for (let i = 1; i < onsets.length; i++) iois.push(onsets[i] - onsets[i - 1]);
  const median = (a) => {
    const s = [...a].sort((x, y) => x - y);
    return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  };
  // Long gaps (a rest, a breath) aren't the beat.
  const m0 = median(iois);
  iois = iois.filter((x) => x < m0 * 1.8);
  if (iois.length < 3) return null;
  // Each interval as a count of beats, then per-beat length. Straight
  // subdivisions and triplets only: allowing dotted values too would let
  // sloppy timing pass as a "rhythm".
  const STEPS = [0.25, 1 / 3, 0.5, 1, 2, 3, 4];
  const snap = (x, beat) => STEPS.reduce((best, k) => (Math.abs(Math.log(x / beat / k)) < Math.abs(Math.log(x / beat / best)) ? k : best), 1);
  const guess = targetBpm ? 60 / targetBpm : median(iois);
  const perBeat = iois.map((x) => x / snap(x, guess));
  // A trimmed mean: a median lands on one side of long-short-long-short
  // playing; the mean of the middle 80% doesn't, and a stray note can't pull it.
  const trimmed = (a) => {
    const s = [...a].sort((x, y) => x - y);
    const cut = Math.floor(s.length * 0.1);
    const mid = s.slice(cut, s.length - cut);
    return mid.reduce((x, y) => x + y, 0) / mid.length;
  };
  const b = trimmed(perBeat);
  // How far each note lands from where the beat says it should, as a share
  // of a beat: 0 → 100, a tenth of a beat on average → 50.
  const err = iois.reduce((a, x) => a + Math.abs(x - snap(x, b) * b) / b, 0) / iois.length;
  const half = Math.floor(perBeat.length / 2);
  const first = trimmed(perBeat.slice(0, half));
  const second = trimmed(perBeat.slice(half));
  return {
    bpm: Math.round(60 / b),
    steadiness: Math.max(0, Math.round(100 - err * 500)),
    notes: onsets.length,
    drift: Math.round(60 / second - 60 / first),
  };
}

/** BPM from tap times (ms), using the last few taps. */
export function tapTempo(taps) {
  const recent = taps.slice(-6);
  if (recent.length < 2) return null;
  const gaps = [];
  for (let i = 1; i < recent.length; i++) gaps.push(recent[i] - recent[i - 1]);
  const avg = gaps.reduce((a, x) => a + x, 0) / gaps.length;
  const bpm = Math.round(60000 / avg);
  return bpm >= 20 && bpm <= 400 ? bpm : null;
}
