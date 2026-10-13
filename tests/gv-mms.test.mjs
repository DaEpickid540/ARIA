// Run: npm test   (or node --test tests/gv-mms.test.mjs)
// lib/gv-mms.js against a stand-in for Google Voice's composer, in headless
// Edge/Chrome through playwright-core. Skipped when no browser is installed.
import test from "node:test";
import assert from "node:assert/strict";
import { attachAndSend } from "../lib/gv-mms.js";

let chromium = null;
try {
  ({ chromium } = await import("playwright-core"));
} catch {}

async function launch() {
  for (const channel of ["msedge", "chrome"]) {
    try {
      return await chromium.launch({ channel, headless: true });
    } catch {}
  }
  return null;
}

const browser = chromium ? await launch() : null;
test.after(() => browser?.close());

// The parts of GV's composer the hook relies on: a textarea, a hidden photo
// input, and a send button that lights up when there's something to send.
const COMPOSER = (opts = {}) => `<!doctype html><textarea class="message-input" placeholder="Type a message"></textarea>
${opts.noPicker ? "" : '<input type="file" accept="image/*" style="display:none">'}
<button aria-label="Send message" disabled>Send</button>
<script>
  window.__sent = [];
  const input = document.querySelector('input[type=file]');
  const send = document.querySelector('button');
  input?.addEventListener('change', () => {
    ${opts.neverAttaches ? "" : "setTimeout(() => (send.disabled = false), 150);"}
  });
  send.addEventListener('click', () => {
    const f = input.files[0];
    window.__sent.push({ name: f.name, type: f.type, size: f.size });
    setTimeout(() => { send.disabled = true; input.value = ''; }, 250);
  });
</script>`;

const SEL = {
  input: 'textarea.message-input, textarea[placeholder*="Type a message" i]',
  send: 'button[aria-label*="Send message" i]',
  attach: 'input[type="file"][accept*="image" i], input[type="file"]',
};
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

test("attaches the picture, waits for GV to take it, sends it", { skip: !browser && "no Edge/Chrome for playwright-core" }, async () => {
  const page = await browser.newPage();
  await page.setContent(COMPOSER());
  await attachAndSend(page, PNG, SEL);
  const sent = await page.evaluate(() => window.__sent);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, "image/png");
  assert.equal(sent[0].name, "aria-screen.png");
  assert.ok(sent[0].size > 50);
  await page.close();
});

test("says why when GV's page isn't what it expects", { skip: !browser && "no Edge/Chrome for playwright-core" }, async () => {
  const page = await browser.newPage();
  await page.setContent(COMPOSER({ noPicker: true }));
  await assert.rejects(attachAndSend(page, PNG, SEL), /photo picker wasn't found/);
  await page.setContent(COMPOSER({ neverAttaches: true }));
  await assert.rejects(attachAndSend(page, PNG, SEL, { attachMs: 800 }), /never finished attaching/);
  await assert.rejects(attachAndSend(page, "https://x.com/a.png", SEL), /not an image/);
  await page.close();
});
