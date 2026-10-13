// Run: npm test   (or node --test tests/intent.test.mjs)
// lib/intent.js decides, before the model is called, which guidance a
// message gets and whether it's a plain image request. It errs towards "no":
// these cases pin both the hits and the near-misses.
import test from "node:test";
import assert from "node:assert/strict";
import { detectSkills, imageRequest, repoFromMessage, SKILL_PROMPTS } from "../lib/intent.js";

const on = (m, opts) => Object.entries(detectSkills(m, opts)).filter(([, v]) => v).map(([k]) => k).join(",");

test("maths is recognised from words and from notation", () => {
  for (const m of ["solve 3x + 2 = 11", "what is 2+2", "what is 12 * 7", "10 - 4", "derivative of sin(x)^2",
    "x^2 - 4x + 3", "find the probability of two heads", "simplify \\frac{2}{4}", "what's 15 percent of 80"])
    assert.match(on(m), /math/, m);
});

test("numbers that aren't maths stay plain", () => {
  for (const m of ["call 555-1234", "due 10/11/2026", "the meeting is at 3:30", "my rent is $1200 and utilities $300",
    "hi how are you", "plan my week", "what time is it"])
    assert.equal(on(m), "", m);
});

test("code, study and music", () => {
  assert.equal(on("my python function throws a KeyError"), "code");
  assert.equal(on("```js\nconst a = b * 2;\n```"), "code"); // operators inside code aren't maths
  assert.equal(on("write a react component"), "code");
  assert.equal(on("quiz me on chapter 3"), "study");
  assert.equal(on("what are the key ideas?", { hasDocument: true }), "");
  assert.equal(on("make me practice questions from this", { hasDocument: true }), "study");
  assert.equal(on("how do I practise the C major scale on piano"), "music");
  assert.equal(on("explain the circle of fifths"), "music");
  assert.equal(on("scale this image down"), "");
});

test("every skill has guidance, and maths asks for renderable LaTeX and GRAPH:", () => {
  for (const k of ["math", "code", "study", "music"]) assert.ok(SKILL_PROMPTS[k].length > 50, k);
  assert.match(SKILL_PROMPTS.math, /\\\\\( \.\.\. \\\\\)|\\\( \.\.\. \\\)/);
  assert.match(SKILL_PROMPTS.math, /GRAPH:/);
  assert.match(SKILL_PROMPTS.math, /Never use single \$/);
});

test("plain image requests become prompts", () => {
  const cases = {
    "draw a fox in a snowy forest": "a fox in a snowy forest",
    "can you paint me a sunset over the ocean please": "a sunset over the ocean",
    "generate an image of a cyberpunk city at night": "a cyberpunk city at night",
    "create a logo for my bakery called Crumb": "a logo for my bakery called Crumb",
    "make me a wallpaper of mountains": "a wallpaper of mountains",
    "imagine a dragon made of glass": "a dragon made of glass",
    "Hey ARIA, can you draw me a robot reading a book?": "a robot reading a book",
    "give me a picture of a cozy cabin": "a cozy cabin",
  };
  for (const [m, want] of Object.entries(cases)) assert.equal(imageRequest(m), want, m);
});

test("mentions of pictures that aren't requests to make one", () => {
  for (const m of ["draw conclusions from this data", "imagine if we had flying cars", "how do I draw a circle in CSS",
    "create an image tag in html", "what is in this image", "resize this picture", "can you make the picture bigger",
    "I uploaded a photo, describe it", "show me pictures of cats", "take a screenshot", "write alt text for my logo"])
    assert.equal(imageRequest(m), null, m);
  // An attached image means "look at this", not "make one".
  assert.equal(imageRequest("draw a fox", { hasImages: true }), null);
});

test("repos named in a message", () => {
  assert.equal(repoFromMessage("look at https://github.com/DaEpickid540/ARIA and fix it"), "https://github.com/DaEpickid540/ARIA");
  assert.equal(repoFromMessage("see github.com/x/y."), "https://github.com/x/y");
  assert.equal(repoFromMessage("https://github.com/a/b.git, thanks"), "https://github.com/a/b");
  assert.equal(repoFromMessage("github.com/vercel/next.js"), "https://github.com/vercel/next.js");
  assert.equal(repoFromMessage("no repo here"), null);
  assert.equal(repoFromMessage("https://notgithub.com/a/b"), null);
});
