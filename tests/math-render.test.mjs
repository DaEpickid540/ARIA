// Run: npm test   (or node --test tests/math-render.test.mjs)
// Maths in replies (public/js/chat.js): LaTeX survives the markdown pass for
// MathJax, GRAPH: lines become Plot buttons, and the plotter only ever
// compiles plain maths: _safeEval builds a Function from the text, and a
// GRAPH line comes from the model.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const src = fs.readFileSync(new URL("../public/js/chat.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
function grab(name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} not found`);
  return src.slice(start, src.indexOf("\n}\n", start) + 2);
}
const namesStart = src.indexOf("const MATH_NAMES");
const names = src.slice(namesStart, src.indexOf("]);", namesStart) + 3);
const code = [names, ...["escapeHtml", "safeLinkUrl", "safeImageUrl", "renderMarkdown", "mathOnly", "implicitMultiply", "_safeEval"].map(grab)].join("\n");
const { renderMarkdown, mathOnly, _safeEval } = new Function(`${code}; return { renderMarkdown, mathOnly, _safeEval };`)();

test("display and inline LaTeX reach MathJax intact", () => {
  const h = renderMarkdown("Area: \\( \\pi r^2 \\) where\n\n$$ a*b*c = \\frac{1}{2} $$");
  assert.match(h, /<span class="mathTex">\\\( \\pi r\^2 \\\)<\/span>/);
  assert.match(h, /<div class="mathTex mathBlock">\$\$ a\*b\*c = \\frac\{1\}\{2\} \$\$<\/div>/);
  assert.doesNotMatch(h, /<em/); // a*b*c wasn't turned into italics
});

test("single dollar signs are money, not maths", () => {
  const h = renderMarkdown("It costs $5 and $10.");
  assert.doesNotMatch(h, /mathTex/);
});

test("LaTeX can't smuggle markup in", () => {
  const h = renderMarkdown("$$ <img src=x onerror=alert(1)> $$");
  assert.doesNotMatch(h, /<img/);
  assert.match(h, /&lt;img/);
});

test("GRAPH: becomes a Plot button with the expression escaped", () => {
  const h = renderMarkdown('Done.\n\nGRAPH: x^2 - 4*x + 3');
  assert.match(h, /<button class="mathPlotBtn" data-expr="x\^2 - 4\*x \+ 3">/);
  // Numbered or bolded by the model
  assert.match(renderMarkdown("4. **Answer:** x = 1\n5. GRAPH: x^2 - 4x + 3"), /data-expr="x\^2 - 4x \+ 3"/);
  assert.match(renderMarkdown("**GRAPH:** sin(x)"), /data-expr="sin\(x\)"/);
  const evil = renderMarkdown('GRAPH: x" onmouseover="alert(1)');
  assert.doesNotMatch(evil, /\sonmouseover="/);
  assert.match(evil, /data-expr="x&quot; onmouseover=&quot;alert\(1\)"/);
});

test("mathOnly: maths in, code out", () => {
  for (const ok of ["x^2 - 4*x + 3", "sin(x) * cos(x)", "sqrt(abs(x)) + ln(x + 1)", "2.5e3 * x", "pi * t^2", "pow(x, 3) % 7"])
    assert.equal(mathOnly(ok), true, ok);
  for (const bad of ["alert(1)", "fetch('/api/claw')", "x.constructor", "constructor", "x; alert(1)", "`x`", "x[0]",
    "this", "globalThis", "x => x", "x = 1", "", "x".repeat(201), "window.location", "Function('return 1')()"])
    assert.equal(mathOnly(bad), false, bad);
});

test("_safeEval refuses anything mathOnly refuses, and still does the maths", () => {
  globalThis.__pwned = false;
  assert.ok(Number.isNaN(_safeEval("(globalThis.__pwned = true)", { x: 1 })));
  assert.ok(Number.isNaN(_safeEval("constructor.constructor('globalThis.__pwned = true')()", { x: 1 })));
  assert.equal(globalThis.__pwned, false);
  assert.equal(_safeEval("x^2 - 4*x + 3", { x: 3 }), 0);
  assert.equal(_safeEval("ln(e)", { x: 0 }), 1);
});

test("written maths plots: implied multiplication", () => {
  assert.equal(_safeEval("x^2 - 4x + 3", { x: 1 }), 0);
  assert.equal(_safeEval("2(x+1)", { x: 2 }), 6);
  assert.equal(_safeEval("(x+1)(x-1)", { x: 3 }), 8);
  assert.equal(_safeEval("x(x-1)", { x: 4 }), 12);
  assert.equal(_safeEval("3sin(x)", { x: 0 }), 0);
  assert.equal(_safeEval("2e3 + x", { x: 1 }), 2001); // scientific notation untouched
});
