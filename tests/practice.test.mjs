// Run: npm test   (or node --test tests/practice.test.mjs)
// The practice log (lib/practice.js) and the tuner/tempo sums the Practice
// panel runs in the browser (public/js/practiceAudio.js), on made-up signals.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

process.env.ARIA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "aria-practice-"));
const pr = await import("../lib/practice.js");
const { detectPitch, noteOf, detectOnsets, tempoFrom, tapTempo } = await import("../public/js/practiceAudio.js");

const SR = 44100;
/** A note with a few overtones (strings and piano are rich in them). */
function tone(hz, { len = 4096, harmonics = [1, 0.6, 0.4, 0.25], noise = 0 } = {}) {
  const b = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    let v = 0;
    harmonics.forEach((amp, k) => (v += amp * Math.sin((2 * Math.PI * hz * (k + 1) * i) / SR)));
    b[i] = 0.2 * v + noise * (Math.random() * 2 - 1);
  }
  return b;
}
const cents = (a, b) => 1200 * Math.log2(a / b);

test("tuner: finds the note within a couple of cents, low cello C to high violin E", () => {
  for (const hz of [65.41, 98, 196, 293.66, 440, 659.25, 1318.5]) {
    const got = detectPitch(tone(hz), SR);
    assert.ok(got, `${hz}: nothing`);
    assert.ok(Math.abs(cents(got, hz)) < 3, `${hz} → ${got.toFixed(2)} (${cents(got, hz).toFixed(1)}¢)`);
  }
  // A weak fundamental (strong 2nd harmonic) still reads as the note, not the octave.
  const g3 = detectPitch(tone(196, { harmonics: [0.3, 1, 0.5] }), SR);
  assert.ok(Math.abs(cents(g3, 196)) < 3, `weak fundamental → ${g3}`);
  assert.ok(detectPitch(tone(440, { noise: 0.05 }), SR) > 435, "copes with some noise");
  assert.equal(detectPitch(new Float32Array(4096), SR), null, "silence");
  const noise = Float32Array.from({ length: 4096 }, () => Math.random() * 0.4 - 0.2);
  assert.equal(detectPitch(noise, SR), null, "noise isn't a note");
});

test("note names and cents", () => {
  assert.deepEqual(noteOf(440), { name: "A", octave: 4, cents: 0, midi: 69, target: 440 });
  const flatA = noteOf(437);
  assert.equal(flatA.name, "A");
  assert.equal(flatA.cents, -12);
  assert.equal(noteOf(261.63).name + noteOf(261.63).octave, "C4");
  assert.equal(noteOf(466.16).name, "B♭");
  assert.equal(noteOf(442, 442).cents, 0, "A=442 tuning");
  assert.equal(noteOf(0), null);
});

/** Plucks at given times (seconds): a sharp attack that decays. */
function plucks(times, { len = Math.ceil((times.at(-1) + 1) * SR), hz = 330 } = {}) {
  const s = new Float32Array(len);
  for (const t of times) {
    const at = Math.round(t * SR);
    for (let i = 0; i < SR * 0.4 && at + i < len; i++) s[at + i] += 0.5 * Math.exp(-i / (SR * 0.08)) * Math.sin((2 * Math.PI * hz * i) / SR);
  }
  return s;
}

test("tempo check: finds the beat, how steady it is, and drift", () => {
  const beat = 60 / 96;
  const steady = Array.from({ length: 16 }, (_, i) => 0.3 + i * beat);
  const on = detectOnsets(plucks(steady), SR);
  assert.equal(on.length, 16, `found ${on.length} onsets`);
  const t = tempoFrom(on, 96);
  assert.ok(Math.abs(t.bpm - 96) <= 1, `bpm ${t.bpm}`);
  assert.ok(t.steadiness >= 90, `steadiness ${t.steadiness}`);
  // Eighth notes at 96 read as 96 when the metronome says 96, not 192.
  const eighths = Array.from({ length: 16 }, (_, i) => 0.3 + (i * beat) / 2);
  assert.ok(Math.abs(tempoFrom(eighths, 96).bpm - 96) <= 1);
  // Rushing: each beat a little shorter.
  const rushing = [0.3];
  for (let i = 1; i < 16; i++) rushing.push(rushing[i - 1] + beat * (1 - i * 0.012));
  assert.ok(tempoFrom(rushing).drift > 5, `drift ${tempoFrom(rushing).drift}`);
  // Sloppy timing scores lower.
  const sloppy = steady.map((x, i) => x + (i % 2 ? 0.06 : -0.05));
  assert.ok(tempoFrom(sloppy, 96).steadiness < t.steadiness - 20, `sloppy ${tempoFrom(sloppy, 96).steadiness}`);
  assert.ok(Math.abs(tempoFrom(sloppy, 96).bpm - 96) <= 2, "uneven, but still 96 on average");
  assert.equal(tempoFrom([0, 1, 2]), null, "too few notes");
});

test("tap tempo", () => {
  assert.equal(tapTempo([0, 500, 1000, 1500]), 120);
  assert.equal(tapTempo([0]), null);
  assert.equal(tapTempo([0, 10]), null, "6000 BPM isn't a tempo");
});

const DAY = 86400_000;
// 10:30 PM in New York on Mon Oct 12, 2026 (02:30 UTC on the 13th).
const NOW = Date.parse("2026-10-13T02:30:00Z");

test("log: sessions, one spelling per piece, today / week / streak in the owner's day", () => {
  pr._reset();
  pr.logSession({ piece: "Bach Partita 2", instrument: "violin", minutes: 30, bpm: 60, at: NOW - 3 * DAY });
  pr.logSession({ piece: "bach partita 2", minutes: 25, bpm: 66, at: NOW - 2 * DAY });
  pr.logSession({ piece: "Scales", minutes: 10, at: NOW - DAY });
  pr.logSession({ piece: "Bach Partita 2", minutes: 20, bpm: 72, note: "shifts in m.12 clean", at: NOW - 60_000 });
  const st = pr.stats(undefined, NOW, "America/New_York");
  assert.equal(st.todayMin, 20, "10:29 PM is still Monday in New York");
  assert.equal(st.weekMin, 85);
  assert.equal(st.streak, 4);
  const bach = st.pieces.find((p) => p.piece === "Bach Partita 2");
  assert.equal(bach.sessions, 3, "the lower-case spelling joined the piece");
  assert.equal(bach.instrument, "violin");
  assert.deepEqual([bach.firstBpm, bach.lastBpm], [60, 72]);
  const s = pr.summary(undefined, NOW, "America/New_York");
  assert.match(s, /^Today: 20m · last 7 days: 1h 25m · streak: 4 days/);
  assert.match(s, /Bach Partita 2 \(violin\): 1h 15m over 3 sessions, last today · tempo 60→72 · last note: shifts in m\.12 clean/);
});

test("streak: today not practised yet keeps yesterday's; a gap ends it", () => {
  const at = (d) => ({ at: NOW - d * DAY, minutes: 5, piece: "x" });
  assert.equal(pr.streak([at(1), at(2)], NOW, "America/New_York"), 2);
  assert.equal(pr.streak([at(0), at(1), at(3)], NOW, "America/New_York"), 2);
  assert.equal(pr.streak([at(2)], NOW, "America/New_York"), 0);
});

test("the tool, and bad input refused", () => {
  pr._reset();
  assert.match(pr.runPracticeTool("practice log", "Clair de Lune | 45 min | 50 | piano | pedalling in the middle"), /^Logged 45m on Clair de Lune at 50 BPM\. Today: 45m, streak 1 day\.$/);
  assert.match(pr.runPracticeTool("practice log", "Clair de Lune | 0"), /⚠ Minutes/);
  assert.match(pr.runPracticeTool("practice log", " | 20"), /⚠ What did you practise/);
  assert.match(pr.runPracticeTool("practice log", "Etude | 20 | 900"), /⚠ Tempo/);
  assert.match(pr.runPracticeTool("practice piece", "clair"), /Clair de Lune: 1 session\n• today: 45m at 50 BPM — pedalling in the middle/);
  assert.match(pr.runPracticeTool("practice", ""), /^Today: 45m/);
  const id = pr.listSessions()[0].id;
  assert.equal(pr.removeSession(id), true);
  assert.equal(pr.runPracticeTool("practice", ""), "No practice logged yet.");
});

test("not touched in a week gets a nudge", () => {
  pr._reset([{ id: "a", piece: "Old Sonata", minutes: 30, at: NOW - 10 * DAY }]);
  assert.match(pr.summary(undefined, NOW), /Not played in over a week: Old Sonata/);
});
