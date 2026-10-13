// skills/public/music-theory/tool.js — the music-theory skill's own tool.
//
// Spells chords, scales and the chords of a key letter by letter, so
// G# major comes out with F## and Gb major with Cb, the way a teacher
// writes them, instead of whatever sharps a model happens to reach for.
// Nothing here leaves the machine (local: true).

export const TOOL_META = {
  name: "chord",
  desc: "Spell chords, scales and the chords in a key, with the right sharps and flats",
  args: "Cmaj7 | Bbm7b5 C/E | F# harmonic minor scale | chords in Eb major",
  local: true,
};

const LETTERS = "CDEFGAB";
const NATURAL = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

// Degree → [semitones above the root, letters above the root].
const DEG = {
  1: [0, 0], b2: [1, 1], 2: [2, 1], "#2": [3, 1], b3: [3, 2], 3: [4, 2], 4: [5, 3], "#4": [6, 3],
  b5: [6, 4], 5: [7, 4], "#5": [8, 4], b6: [8, 5], 6: [9, 5], bb7: [9, 6], b7: [10, 6], 7: [11, 6],
  b9: [1, 1], 9: [2, 1], "#9": [3, 1], 11: [5, 3], "#11": [6, 3], 13: [9, 5],
};

const CHORDS = {
  "": "1 3 5", m: "1 b3 5", dim: "1 b3 b5", aug: "1 3 #5", 5: "1 5",
  sus2: "1 2 5", sus4: "1 4 5", 6: "1 3 5 6", m6: "1 b3 5 6",
  7: "1 3 5 b7", maj7: "1 3 5 7", m7: "1 b3 5 b7", mmaj7: "1 b3 5 7", m7b5: "1 b3 b5 b7", dim7: "1 b3 b5 bb7",
  "7sus4": "1 4 5 b7", aug7: "1 3 #5 b7", "7b9": "1 3 5 b7 b9", "7#9": "1 3 5 b7 #9",
  add9: "1 3 5 9", madd9: "1 b3 5 9", 9: "1 3 5 b7 9", maj9: "1 3 5 7 9", m9: "1 b3 5 b7 9",
  11: "1 3 5 b7 9 11", m11: "1 b3 5 b7 9 11", 13: "1 3 5 b7 9 13", maj13: "1 3 5 7 9 13", m13: "1 b3 5 b7 9 13",
};
// Other ways people write the same chords. Case matters: M7 is major, m7 minor.
const ALIAS = {
  maj: "", M: "", major: "", min: "m", minor: "m", "-": "m", mi: "m",
  "°": "dim", o: "dim", "+": "aug", "#5": "aug",
  M7: "maj7", Maj7: "maj7", "Δ": "maj7", "Δ7": "maj7", ma7: "maj7",
  min7: "m7", "-7": "m7", mi7: "m7", "ø": "m7b5", "ø7": "m7b5", "m7-5": "m7b5", "-7b5": "m7b5",
  "°7": "dim7", o7: "dim7", sus: "sus4", "+7": "aug7", "7#5": "aug7", "7+": "aug7",
  mM7: "mmaj7", mMaj7: "mmaj7", "m(maj7)": "mmaj7", "-maj7": "mmaj7",
  M9: "maj9", Maj9: "maj9", min9: "m9", "-9": "m9", add2: "add9", M13: "maj13", min6: "m6", "-6": "m6",
};

const SCALES = {
  major: "1 2 3 4 5 6 7", ionian: "1 2 3 4 5 6 7",
  minor: "1 2 b3 4 5 b6 b7", "natural minor": "1 2 b3 4 5 b6 b7", aeolian: "1 2 b3 4 5 b6 b7",
  "harmonic minor": "1 2 b3 4 5 b6 7", "melodic minor": "1 2 b3 4 5 6 7",
  dorian: "1 2 b3 4 5 6 b7", phrygian: "1 b2 b3 4 5 b6 b7", lydian: "1 2 3 #4 5 6 7",
  mixolydian: "1 2 3 4 5 6 b7", locrian: "1 b2 b3 4 b5 b6 b7",
  "major pentatonic": "1 2 3 5 6", pentatonic: "1 2 3 5 6", "minor pentatonic": "1 b3 4 5 b7", blues: "1 b3 4 b5 5 b7",
};

const norm = (s) => String(s).replace(/♯/g, "#").replace(/♭/g, "b").replace(/𝄪/g, "##").trim();

function parseNote(s) {
  const m = /^([A-Ga-g])(##|bb|#|b)?$/.exec(s);
  if (!m) return null;
  const acc = { "##": 2, "#": 1, b: -1, bb: -2 }[m[2]] || 0;
  return { letter: m[1].toUpperCase(), acc };
}
const pitch = (n) => (NATURAL[n.letter] + n.acc + 12) % 12;
const name = (n) => n.letter + (n.acc > 0 ? "#".repeat(n.acc) : "b".repeat(-n.acc));

/** The note `deg` above `root`, spelled from the letter count, not the nearest key. */
function above(root, deg) {
  const [semis, steps] = DEG[deg];
  const letter = LETTERS[(LETTERS.indexOf(root.letter) + steps) % 7];
  let acc = (((pitch(root) + semis - NATURAL[letter]) % 12) + 12) % 12;
  if (acc > 6) acc -= 12;
  return { letter, acc };
}
const build = (root, formula) => formula.split(" ").map((d) => above(root, d));
const tooOdd = (notes) => notes.some((n) => Math.abs(n.acc) > 2);

/** "Cmaj7", "F#m7b5", "C/E" → the notes, or null if it isn't a chord. */
export function spellChord(text) {
  const m = /^([A-Ga-g](?:##|bb|#|b)?)(.*?)(?:\/([A-Ga-g](?:##|bb|#|b)?))?$/.exec(norm(text));
  if (!m) return null;
  // A bare lowercase "b" root followed by a quality is fine ("bm7"); "Bb" as a root wins over "B" + "b...".
  const root = parseNote(m[1].charAt(0).toUpperCase() + m[1].slice(1));
  let q = m[2].replace(/^\((.*)\)$/, "$1");
  q = q in ALIAS ? ALIAS[q] : q;
  if (!(q in CHORDS)) return null;
  const notes = build(root, CHORDS[q]);
  if (tooOdd(notes)) return { error: `${text} needs triple sharps or flats; try its other name` };
  const bass = m[3] ? parseNote(m[3].charAt(0).toUpperCase() + m[3].slice(1)) : null;
  const label = name(root) + q + (bass ? `/${name(bass)}` : "");
  let line = `${label}: ${notes.map(name).join(" ")}`;
  if (bass) {
    const inChord = notes.find((n) => pitch(n) === pitch(bass));
    line += inChord ? ` (${name(inChord)} in the bass)` : ` with ${name(bass)} added in the bass`;
  }
  return { line, notes: notes.map(name) };
}

export function spellScale(rootText, scaleName) {
  const root = parseNote(norm(rootText));
  const formula = SCALES[scaleName.toLowerCase().replace(/\s+/g, " ").trim()];
  if (!root || !formula) return null;
  const notes = build(root, formula);
  if (tooOdd(notes)) return { error: `${name(root)} ${scaleName} needs triple sharps or flats; try its other name` };
  return { line: `${name(root)} ${scaleName.toLowerCase()}: ${notes.map(name).join(" ")}`, notes: notes.map(name) };
}

// Stacked-thirds qualities: [third, fifth] and [third, fifth, seventh] in semitones.
const TRIAD = { "4,7": "", "3,7": "m", "3,6": "dim", "4,8": "aug" };
const SEVENTH = { "4,7,11": "maj7", "4,7,10": "7", "3,7,10": "m7", "3,6,10": "m7b5", "3,6,9": "dim7", "3,7,11": "mmaj7", "4,8,11": "maj7#5" };
const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII"];

export function chordsInKey(rootText, mode) {
  const minor = /^m(in(or)?)?$/i.test(mode || "");
  const scale = spellScale(rootText, minor ? "minor" : "major");
  if (!scale || scale.error) return scale;
  const notes = scale.notes.map(parseNote);
  const iv = (a, b) => (pitch(b) - pitch(a) + 12) % 12;
  const triads = [];
  const sevenths = [];
  for (let i = 0; i < 7; i++) {
    const [r, t, f, s] = [0, 2, 4, 6].map((k) => notes[(i + k) % 7]);
    const tq = TRIAD[`${iv(r, t)},${iv(r, f)}`] ?? "?";
    const sq = SEVENTH[`${iv(r, t)},${iv(r, f)},${iv(r, s)}`] ?? "?";
    let num = ROMAN[i];
    if (tq === "m" || tq === "dim") num = num.toLowerCase();
    if (tq === "dim") num += "°";
    if (tq === "aug") num += "+";
    triads.push(`${num} ${name(r)}${tq}`);
    sevenths.push(`${name(r)}${sq}`);
  }
  const key = `${scale.notes[0]} ${minor ? "minor" : "major"}`;
  const lines = [`Chords in ${key}: ${triads.join(" · ")}`, `With sevenths: ${sevenths.join(" ")}`];
  if (minor) {
    const v = above(notes[0], 5);
    lines.push(`In minor the V is usually made major (from harmonic minor): ${name(v)} / ${name(v)}7 = ${build(v, CHORDS[7]).map(name).join(" ")}`);
  }
  return { line: lines.join("\n") };
}

export async function run(input = "") {
  const text = norm(input).replace(/[?.!]+$/, "");
  if (!text) return `Usage: ${TOOL_META.args}`;

  // "chords in G major", "key of Eb minor", "diatonic chords in A"
  let m = /^(?:(?:the\s+)?(?:diatonic\s+)?chords?\s+(?:in|of)(?:\s+the\s+key\s+of)?|key\s+of|diatonic(?:\s+chords)?(?:\s+(?:in|of))?)\s+([A-Ga-g](?:##|bb|#|b)?)\s*(major|minor|maj|min|m)?$/i.exec(text);
  if (m) {
    const r = chordsInKey(m[1], m[2]);
    return r ? r.error || r.line : `I don't know the key "${m[1]}".`;
  }

  // "F# harmonic minor scale", "scale D dorian", "Bb blues"
  m = /^(?:(?:the\s+)?scale\s+(?:of\s+)?)?([A-Ga-g](?:##|bb|#|b)?)\s+(.+?)(?:\s+scale)?$/i.exec(text);
  if (m && SCALES[m[2].toLowerCase().replace(/\s+/g, " ")]) {
    const r = spellScale(m[1], m[2]);
    return r.error || r.line;
  }

  // One chord or a progression: "Cmaj7", "C Am F G", "Dm7, G7, Cmaj7"
  const tokens = text.split(/[\s,|]+/).filter((t) => t && t !== "-" && t !== "→");
  const lines = [];
  for (const t of tokens) {
    const r = spellChord(t);
    if (!r) return `I couldn't read "${t}" as a chord. Examples: ${TOOL_META.args}. Scales I know: ${Object.keys(SCALES).join(", ")}.`;
    lines.push(r.error || r.line);
  }
  return lines.join("\n");
}
