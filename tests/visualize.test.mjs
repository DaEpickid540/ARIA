// Run: npm test   (or node --test tests/visualize.test.mjs)
// The visualize tool draws SVG/HTML in a sandboxed frame. Component source
// (React/JSX, Vue…) isn't a page: rendered as one it came out as giant
// headings, {expressions} as text and broken images, and the user had asked
// for the code. The tool refuses it, and the client shows saved ones as code.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { looksLikeComponent, runVisualize } from "../tools/visualize.js";

const JSX = `import React, { useState } from "react";
export default function Dashboard() {
  const [books, setBooks] = useState([]);
  return <div className="dash"><h1>Bookware</h1>{books.map(b => <img src={b.cover} />)}</div>;
}`;
const HTML_WIDGET = `<style>.card{padding:8px}</style><div class="card"><h1>Budget</h1>
<button onclick="go()">Go</button></div><script>function go(){ const totals = { a: 1 }; }</script>`;
const SVG = `<svg viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg"><rect width="5" height="5"/></svg>`;

test("component source is recognised; pages and drawings aren't", () => {
  assert.equal(looksLikeComponent(JSX), true);
  assert.equal(looksLikeComponent('<div className="x">hi</div>'), true);
  assert.equal(looksLikeComponent("<Card title={name} />"), true);
  assert.equal(looksLikeComponent('<template><div/></template><script>import { ref } from "vue"</script>'), true);
  assert.equal(looksLikeComponent(HTML_WIDGET), false);
  assert.equal(looksLikeComponent(SVG), false);
});

test("the tool refuses components and says to send code", async () => {
  const r = await runVisualize({ title: "Dashboard", code: JSX });
  assert.match(r, /^Tool error: .*component source.*fenced blocks/);
});

test("ordinary widgets still render", async () => {
  for (const code of [HTML_WIDGET, SVG]) assert.match(await runVisualize({ title: "w", code }), /^__VISUAL__/);
});

test("the client's copy of the check matches the server's", () => {
  const src = fs.readFileSync(new URL("../public/js/visualize.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const start = src.indexOf("export function looksLikeComponent(");
  const fn = new Function(src.slice(start, src.indexOf("\n}\n", start) + 2).replace("export ", "") + "; return looksLikeComponent;")();
  for (const code of [JSX, HTML_WIDGET, SVG, '<div className="x"/>', "<Card title={name} />"])
    assert.equal(fn(code), looksLikeComponent(code), code.slice(0, 30));
});
