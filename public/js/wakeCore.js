// wakeCore.js — the parts of "Hey ARIA" that are just sums: cutting the
// mic into utterances, and deciding whether a transcript was the wake
// phrase. No DOM or audio here, so tests/wake.test.mjs runs them directly.

/**
 * Whisper's spellings of "Hey ARIA" heard in practice: "Hey Aria", "Hey,
 * Arya", "Hey area", "Hi Aria", "OK Aria", "Aria, …". Only at the start of
 * the utterance: "I listened to an aria" doesn't wake her.
 */
const NAME = String.raw`(?:aria|arya|ariya|ariah|aryah|area|arias|aria's)`;
const WAKE = new RegExp(String.raw`^\W*(?:(?:hey|hi|hay|ok|okay|yo)\W+${NAME}|${NAME}(?=\W*[,.!?]|\W*$))\b[\s,.!?-]*`, "i");

/**
 * @returns {{ woke: boolean, rest: string }}  rest: what was said after the
 *   wake phrase in the same breath ("Hey ARIA, what's the weather" → "what's the weather").
 */
export function matchWake(text) {
  const t = String(text || "").trim();
  const m = t.match(WAKE);
  if (!m) return { woke: false, rest: "" };
  return { woke: true, rest: t.slice(m[0].length).trim() };
}

/** "what's the weather" is a command; "um" or "." isn't. */
export const isCommand = (rest) => String(rest || "").replace(/[^a-z0-9 ]/gi, "").trim().split(/\s+/).filter((w) => w.length > 1).length >= 2;

/**
 * Cuts a stream of loudness readings into utterances. Feed it one RMS value
 * per frame; it answers what happened on that frame. The quiet level adapts
 * to the room, so a fan or a game in the background doesn't count as talking.
 *   "start"  speech began (keep the frames from a little before)
 *   "end"    a short utterance ended: { frames } long, worth checking
 *   "drop"   it ran too long to be a wake phrase (talking, a video); ignored
 */
export class Segmenter {
  constructor({ frameMs = 50, minMs = 300, maxMs = 8000, quietMs = 700, ratio = 3, minRms = 0.008, warmMs = 1000 } = {}) {
    Object.assign(this, { frameMs, minMs, maxMs, quietMs, ratio, minRms });
    this.floor = 0; // the room's level, learned as it goes
    this.warm = Math.round(warmMs / frameMs); // frames spent learning it before listening
    this.seen = 0;
    this.cooldown = false; // after a drop: wait for real quiet before listening again
    this.inSpeech = false;
    this.frames = 0;
    this.quiet = 0;
    this.loud = 0;
  }

  push(rms) {
    if (this.seen < this.warm) {
      this.seen++;
      this.floor += (rms - this.floor) / this.seen; // plain mean while warming up
      return null;
    }
    const loud = rms > Math.max(this.minRms, this.floor * this.ratio);
    if (this.cooldown) {
      // A TV or a long talk: the room may just be louder now, so keep learning.
      this.floor = this.floor * 0.98 + rms * 0.02;
      this.quiet = loud ? 0 : this.quiet + 1;
      if (this.quiet * this.frameMs >= this.quietMs) {
        this.cooldown = false;
        this.quiet = 0;
      }
      return null;
    }
    if (!this.inSpeech) {
      // Track the room only while nobody's talking.
      this.floor = this.floor * 0.95 + rms * 0.05;
      this.loud = loud ? this.loud + 1 : 0;
      if (this.loud * this.frameMs >= 100) {
        this.inSpeech = true;
        this.frames = this.loud;
        this.quiet = 0;
        return "start";
      }
      return null;
    }
    this.frames++;
    this.quiet = loud ? 0 : this.quiet + 1;
    if (this.frames * this.frameMs > this.maxMs) {
      this.reset();
      this.cooldown = true;
      return "drop";
    }
    if (this.quiet * this.frameMs >= this.quietMs) {
      const spoken = (this.frames - this.quiet) * this.frameMs;
      const frames = this.frames;
      this.reset();
      return spoken >= this.minMs ? { end: true, frames } : null;
    }
    return null;
  }

  reset() {
    this.inSpeech = false;
    this.frames = 0;
    this.quiet = 0;
    this.loud = 0;
  }
}
