// Run: node --test tests/markdown.test.mjs
// Pulls the real renderer out of public/js/chat.js (a browser script with no
// exports) and checks that model output can't become live HTML.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const src = fs.readFileSync(new URL("../public/js/chat.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
function grab(name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} not found`);
  const end = src.indexOf("\n}\n", start);
  return src.slice(start, end + 2);
}
const code = ["escapeHtml", "safeLinkUrl", "safeImageUrl", "renderMarkdown"].map(grab).join("\n");
const lib = new Function(`${code}; return { escapeHtml, safeLinkUrl, safeImageUrl, renderMarkdown };`)();
const { renderMarkdown, safeLinkUrl, safeImageUrl } = lib;

// Every tag the renderer emits, minus text content: no event handlers and no
// non-http(s) URLs may appear inside any tag.
const tags = (html) => html.match(/<[a-z][^>]*>/gi) || [];
function assertInert(html) {
  for (const t of tags(html)) {
    assert.doesNotMatch(t, /\son[a-z]+\s*=/i, `event handler in ${t}`);
    assert.doesNotMatch(t, /(href|src)\s*=\s*"\s*(javascript|vbscript|data:text)/i, `bad URL in ${t}`);
  }
  assert.doesNotMatch(html, /<(script|iframe|object|embed|svg|math|style)\b/i);
}

test("image markdown can't break out of src (the reported payload)", () => {
  const html = renderMarkdown(`chart: ![x](x" onerror="location='javascript:alert%281%29')`);
  assertInert(html);
});

test("javascript:/data: links are left as text", () => {
  for (const md of [
    "[docs](javascript:alert%281%29)",
    "[docs](JaVaScRiPt:alert`1`)",
    "[docs](java\tscript:alert`1`)",
    "[docs]( javascript:alert`1`)",
    "[docs](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)",
    "[docs](//evil.example/x)",
    "![i](javascript:alert`1`)",
  ]) {
    const html = renderMarkdown(md);
    assertInert(html);
    assert.doesNotMatch(html, /<a |<img /, md);
  }
});

test("emphasis/code passes can't inject markup into a URL", () => {
  const html = renderMarkdown("[a](https://e.example/*x\" autofocus onfocus=\"alert`1`*) and `x`");
  assertInert(html);
});

test("raw HTML and think/code blocks stay inert", () => {
  assertInert(renderMarkdown(`<img src=x onerror=alert(1)> <script>alert(1)</script>`));
  assertInert(renderMarkdown("<think>[STEP 1 — PLAN]: <img src=x onerror=alert(1)></think>ok"));
  assertInert(renderMarkdown("```html\n<img src=x onerror=alert(1)>\n```"));
});

test("normal markdown still renders", () => {
  const html = renderMarkdown("# Title\n\nSee [the docs](https://example.com/a?b=1&c=2) and **bold**.\n\n![chart](https://example.com/c.png)\n\n- one\n- two");
  assert.match(html, /<h1 class="mdH1">Title<\/h1>/);
  assert.match(html, /<a href="https:\/\/example\.com\/a\?b=1&amp;c=2" target="_blank" rel="noopener noreferrer" class="mdLink">the docs<\/a>/);
  assert.match(html, /<strong class="mdBold">bold<\/strong>/);
  assert.match(html, /<div class="msgImageWrap"><img src="https:\/\/example\.com\/c\.png"/);
  assert.doesNotMatch(html, /<p class="mdPara"><div class="msgImageWrap">/); // images stay block-level
  assert.match(html, /<ul class="mdList"><li>one<\/li><li>two<\/li><\/ul>/);
  assert.match(renderMarkdown("![g](data:image/png;base64,iVBORw0KGgo=)"), /<img src="data:image\/png;base64,iVBORw0KGgo="/);
  assert.match(renderMarkdown("[home](/settings)"), /<a href="\/settings"/);
});

test("URL allowlists", () => {
  assert.equal(safeLinkUrl("https://x.com"), "https://x.com");
  assert.equal(safeLinkUrl("mailto:a@b.c"), "mailto:a@b.c");
  assert.equal(safeLinkUrl("javascript:alert(1)"), "");
  assert.equal(safeLinkUrl("//evil.com"), "");
  assert.equal(safeImageUrl("data:image/heic;base64,AAAA"), "data:image/heic;base64,AAAA");
  assert.equal(safeImageUrl("data:text/html;base64,AAAA"), "");
  assert.equal(safeImageUrl("x\" onerror=\"alert(1)"), "");
});
