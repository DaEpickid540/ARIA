// lib/intent.js — what a message needs, decided per message.
//
// Math, code and study used to be modes you switched on from the Tools menu,
// and "Generate Image" only changed the input's placeholder. Now each message
// is read for what it needs: the matching guidance is added to ARIA's normal
// prompt (her voice stays), and an unmistakable image request goes straight
// to the image generator instead of hoping the model writes ACTION: imagine.
//
// Everything here is a cheap regex pass that runs before the model is called,
// so it errs towards "no": a missed detection just leaves the model to decide
// (it still has every tool), while a false one would change the answer.

/* ── Skills: guidance added to the system prompt ───────────────────── */

const MATH_WORDS =
  /\b(solve|calculat\w*|compute|simplify|factori[sz]e|factor|expand|evaluate|derivative|differentiate|integra(l|te)|antiderivative|limit of|equation|inequalit(y|ies)|quadratic|polynomial|logarithm|exponent|matri(x|ces)|determinant|eigen\w*|vector|probability|permutation|combination|binomial|standard deviation|variance|mean of|median|theorem|prove that|proof|trig(onometry)?|sine|cosine|tangent|hypotenuse|pythag\w*|slope|intercept|asymptote|parabola|geometry|algebra|calculus|statistics|percent(age)? of|fraction|decimal|square root|cube root)\b/i;
// "3x + 2 = 11", "2+2", "2^10", "sin(x)", "x^2", LaTeX, "12 * 7", "10 - 4".
// Minus and slash count only with spaces, so 555-1234 and 10/11/2026 don't.
const MATH_SYMBOLS =
  /(\d\s*[a-z]\s*[+\-*/^=]|\b[a-z]\s*\^\s*\d|\b(sin|cos|tan|log|ln|sqrt)\s*\(|\\(frac|int|sum|sqrt|lim)\b|\d\s*[+*^×÷]\s*\d|\d\s+[-/]\s+\d|[a-z0-9)]\s*=\s*[a-z0-9(].*[+\-*/^])/i;

const CODE_WORDS =
  /\b(code|coding|program(ming)?|function|method|class|variable|array|loop|recursion|algorithm|regex|api|endpoint|script|compile[rd]?|syntax|bug|debug|stack ?trace|traceback|exception|refactor|unit test|repo|git|npm|pip|docker|sql|query|json|yaml|html|css|javascript|typescript|python|java|c\+\+|c#|rust|golang|kotlin|swift|php|ruby|bash|powershell|react|node(\.js)?|express|django|flask)\b/i;
const CODE_SYNTAX =
  /```|^\s*(def|class|function|import|from|const|let|var|#include|public|private|SELECT|CREATE TABLE)\b|=>|\w+\.\w+\(|\b\w+\.(js|ts|py|java|cpp|rs|go|rb|php|cs|html|css|json|sh)\b|;\s*$/im;

// Unambiguous music words only: "scale", "interval" and "tempo" alone are
// as often maths or plain English.
const MUSIC_WORDS =
  /\b(piano|violin|viola|cello|rcm|chords?|arpeggios?|clef|key signature|time signature|music theory|bowing|sight[- ]?reading|cadences?|sonatas?|[eé]tudes?|sonatinas?|(major|minor|chromatic|pentatonic) scales?|scales? in [a-g]( sharp| flat|#|b)?|circle of fifths|roman numeral (analysis|harmony))\b/i;

const STUDY_WORDS =
  /\b(quiz me|test me|flash ?cards?|practice (questions|problems|test)|study (guide|for|with)|help me (study|revise|review)|review (this|these|my notes)|exam prep|key points|summari[sz]e (this|these|my|the (notes|chapter|document|reading)))\b/i;

/**
 * Which kinds of guidance a message calls for.
 * @param {string} message
 * @param {{ hasDocument?: boolean }} opts  a document is attached (study material)
 * @returns {{ math: boolean, code: boolean, study: boolean, music: boolean }}
 */
export function detectSkills(message, { hasDocument = false } = {}) {
  const m = String(message || "");
  const code = CODE_SYNTAX.test(m) || CODE_WORDS.test(m);
  // Operators inside code aren't maths; maths words still are ("big-O of
  // this function", "probability in this sim").
  const math = MATH_WORDS.test(m) || (!code && MATH_SYMBOLS.test(m));
  const study = STUDY_WORDS.test(m) || (hasDocument && /\b(quiz|questions|study|learn|revise|summar)/i.test(m));
  const music = MUSIC_WORDS.test(m);
  return { math, code, study, music };
}

export const SKILL_PROMPTS = {
  math: `

[MATH — this message is maths. Work it like a patient tutor:]
- If the input is malformed, say so first: ⚠ Malformed: [reason].
- Number every step and name the rule used (distribute, chain rule, factorise…).
- Write maths in LaTeX: inline as \\( ... \\), displayed as $$ ... $$. Never use single $ signs.
- Put the final result on its own line: **Answer: ...**
- If the result is a function that can be plotted, add one line at the very end: GRAPH: <expression in x>, e.g. GRAPH: x^2 - 4*x + 3
- For word problems, list Knowns, Unknowns and the Equation before solving.
- Mention one common mistake for this kind of problem when it helps.`,

  code: `

[CODE — this message is about programming:]
- Give complete, runnable code: no placeholders or "..." stubs.
- Name the language on every fenced block; prefix each file with // FILE: path when there are several.
- For a fix, show what changed (- old / + new) and why.
- After the code, a short "How it works", plus complexity for algorithms and the edge cases worth testing.
- For HTML/CSS/JS, one self-contained file unless asked otherwise.`,

  study: `

[STUDY — the user is learning from their material:]
- Ground answers in the attached document or notes; say when something isn't in them.
- When asked, quiz them (multiple choice or short answer), one question at a time, and wait for the answer.
- Explain why a wrong answer is wrong, then give the right concept.
- Summaries: tight bullet points of the key ideas.
- Flashcards: save them (ACTION: flashcards add | <deck> | front => back ;; …) instead of only listing them, and after a quiz offer to save the ones they missed.`,

  music: `

[MUSIC — teach like an RCM piano and violin teacher:]
- Tie concepts to RCM levels (Prep A through Level 10 and ARCT) where it helps.
- Piano: both clefs, hand coordination, pedalling. Violin: bowing, bow arm, positions (1st-7th), shifting, vibrato.
- For each concept: the theory, how it looks in notation, and an exercise to practise it.
- Use interval names, scale degrees and Roman-numeral harmony (I, IV, V7…).
- For pieces: composer and period, the technical challenges, fingering tips.`,
};

/* ── Image requests ─────────────────────────────────────────────────── */

const IMAGE_NOUN =
  "(image|picture|pic|photo|photograph|drawing|illustration|artwork|art|painting|portrait|wallpaper|poster|logo|icon|sketch|render|meme|avatar|banner)";
// Words that only say "a picture": dropped from the prompt. The rest (logo,
// wallpaper, portrait…) describe what to make, so they stay in it.
const GENERIC_NOUN = "(image|picture|pic|photo|photograph|drawing|illustration|artwork|art|render)";

// "draw a fox", "can you paint me…", "imagine a city…" (not "imagine if…")
const DRAW_VERB =
  /^\s*(please\s+)?((can|could|would|will)\s+you\s+(please\s+)?)?(draw|paint|sketch|illustrate|imagine)\b(?!\s+(if|that|how|what|why|when|you|we|i|being|living|having|it)\b)/i;
// "generate an image of…", "make me a wallpaper of…", "create a logo for…"
const MAKE_IMAGE = new RegExp(
  `\\b(generate|create|make|design|produce|give me|draw|paint)\\b[^.?!\\n]{0,30}?\\b${IMAGE_NOUN}s?\\b`,
  "i",
);
// Things that mention pictures, or "draw", without asking for one to be made.
const NOT_GENERATION = new RegExp(
  [
    // figurative draw
    "\\bdraw (up|on|from|out|in|back|near|attention|conclusions?|a conclusion|parallels?|a comparison|the line|a line under|blood|breath|lots|straws)\\b",
    // editing a picture that already exists
    "\\b(bigger|smaller|larger|brighter|darker|sharper|edit|rotate|flip|enhance|upscale|blur|compress|resize|crop|convert)\\b",
    // web/code work that mentions images
    "\\b(html|css|svg|tag|element|component|src=|code|function|script|api|alt text|format)\\b|<img",
    // asking about a picture, or the screen
    "\\b(upload(ed)?|attach(ed)?|screenshot|screen|describe|look at)\\b",
    "\\b(this|that|my) (image|picture|photo|pic)\\b|\\bthe (image|picture|photo|pic) (i|you)\\b|\\bwhat('?s| is) in\\b",
    "\\bhow (do|to|can|would) (i|you|we)\\b",
  ].join("|"),
  "i",
);
const STRIP_REQUEST = new RegExp(
  `^(generate|create|make|design|produce|give me|draw|paint|sketch|illustrate|imagine):?(\\s+(me|us))?` +
    `(\\s+(an?|the|some)\\s+${GENERIC_NOUN}s?(\\s+(of|showing|with|that shows))?|\\s+${GENERIC_NOUN}s?(\\s+(of|showing|with|that shows))?)?\\s+`,
  "i",
);

/**
 * The image to generate, when a message is plainly asking for one; else null.
 * @param {string} message
 * @param {{ hasImages?: boolean }} opts  an image is attached (that's vision)
 * @returns {string|null} the prompt to send to the image generator
 */
export function imageRequest(message, { hasImages = false } = {}) {
  // "Hey ARIA, draw…" is still a draw request.
  const m = String(message || "")
    .trim()
    .replace(/^((hey|hi|ok(ay)?|yo)\b[\s,!]*)?(aria\b[\s,:!]*)?/i, "");
  if (!m || hasImages || m.length > 600 || NOT_GENERATION.test(m)) return null;
  if (!DRAW_VERB.test(m) && !MAKE_IMAGE.test(m)) return null;
  const prompt = m
    .replace(/^(please\s+)?((can|could|would|will)\s+you\s+(please\s+)?)?/i, "")
    .replace(STRIP_REQUEST, "")
    .replace(/(\s*,?\s*please)?[\s.!?]*$/i, "")
    .trim();
  return prompt.length >= 3 ? prompt : m;
}

/* ── Repos ──────────────────────────────────────────────────────────── */

/** A GitHub repo named in the message, for workspace context; else null. */
export function repoFromMessage(message) {
  const m = String(message || "").match(
    /(?:\bhttps?:\/\/)?(?:www\.)?\bgithub\.com\/([\w.-]+)\/([\w-]+(?:\.(?!git\b)[\w-]+)*)(?:\.git)?(?=[\s/#?)\],;:!.]|$)/i,
  );
  return m ? `https://github.com/${m[1]}/${m[2]}` : null;
}
