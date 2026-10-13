// Run: npm test   (or node --test tests/wake.test.mjs)
// public/js/wakeCore.js: what counts as "Hey ARIA", and cutting the mic
// into utterances worth transcribing.
import test from "node:test";
import assert from "node:assert/strict";
import { matchWake, isCommand, Segmenter } from "../public/js/wakeCore.js";

test("the wake phrase, as Whisper spells it, only at the start", () => {
  for (const t of ["Hey ARIA.", "hey aria", "Hey, Aria!", "Hi Arya", "Okay, Aria.", "Hey area", "Aria?", "Aria.", " Hey Aria's"]) {
    assert.equal(matchWake(t).woke, true, t);
  }
  for (const t of ["I listened to an aria.", "Maria, come here", "Hey Mario", "area 51 is weird", "Arianna", "hey there", "", "Ariana Grande"]) {
    assert.equal(matchWake(t).woke, false, t);
  }
});

test("a command in the same breath comes along", () => {
  assert.deepEqual(matchWake("Hey ARIA, what's the weather?"), { woke: true, rest: "what's the weather?" });
  assert.deepEqual(matchWake("Aria, open Spotify."), { woke: true, rest: "open Spotify." });
  assert.equal(isCommand("what's the weather?"), true);
  assert.equal(isCommand("um."), false);
  assert.equal(isCommand(""), false);
  assert.equal(isCommand("Thanks"), false, "one word isn't a command");
});

/** Frames of loudness: quiet, a short phrase, quiet. */
const run = (seg, levels) => levels.map((r) => seg.push(r)).filter(Boolean);
const rep = (v, n) => Array(n).fill(v);

test("a short phrase is one utterance; long talking is dropped; clicks are ignored", () => {
  const seg = new Segmenter();
  const ev = run(seg, [...rep(0.001, 40), ...rep(0.05, 24), ...rep(0.001, 20)]); // 1.2 s of speech
  assert.equal(ev[0], "start");
  assert.equal(ev[1].end, true);
  assert.ok(ev[1].frames >= 24 + 14 - 1, `frames ${ev[1].frames}`);
  // A 10-second ramble is not a wake phrase.
  assert.deepEqual(run(new Segmenter(), [...rep(0.001, 40), ...rep(0.05, 200)]), ["start", "drop"]);
  // A single loud frame (a click, a key) never starts one.
  assert.deepEqual(run(new Segmenter(), [...rep(0.001, 40), 0.3, ...rep(0.001, 40)]), []);
  // Short pauses inside the phrase ("hey… ARIA") don't split it.
  const ev2 = run(new Segmenter(), [...rep(0.001, 40), ...rep(0.05, 8), ...rep(0.001, 6), ...rep(0.05, 10), ...rep(0.001, 20)]);
  assert.equal(ev2.filter((e) => e.end).length, 1);
});

test("the quiet level adapts: a noisy room needs louder speech", () => {
  const seg = new Segmenter();
  // A fan at 0.02 for a while: never "speech".
  assert.deepEqual(run(seg, rep(0.02, 200)), []);
  // Talking well above it still counts.
  const ev = run(seg, [...rep(0.12, 20), ...rep(0.02, 20)]);
  assert.equal(ev[0], "start");
  assert.equal(ev[1].end, true);
});
