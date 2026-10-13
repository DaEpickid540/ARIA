// lib/gv-mms.js — sending a picture through Google Voice's web page
//
// aria-voice-hook.js texts by typing into GV's composer. A picture goes in
// through the composer's (hidden) photo <input>: Playwright hands it the
// file, the send button lights up once GV has attached it, and goes dark
// again once it's sent. Kept apart from the hook so it can be tested against
// a stand-in page (tests/gv-mms.test.mjs). GV's markup is the part most
// likely to change; the selectors come in from the hook's SEL table.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {import("playwright-core").Page} page  already on the conversation
 * @param {string} dataUrl  data:image/png|jpeg;base64,…
 * @param {{ input: string, attach: string, send: string }} sel
 * @param {{ attachMs?: number, sendMs?: number }} [t]
 */
export async function attachAndSend(page, dataUrl, sel, { attachMs = 15000, sendMs = 30000 } = {}) {
  const m = String(dataUrl).match(/^data:image\/(png|jpe?g);base64,([A-Za-z0-9+/=]+)$/);
  if (!m) throw new Error("not an image");
  const png = m[1] === "png";
  const box = page.locator(`${sel.input} >> visible=true`).first();
  await box.waitFor({ timeout: 10000 });
  const input = page.locator(sel.attach).first();
  if (!(await input.count())) throw new Error("Google Voice's photo picker wasn't found");
  await input.setInputFiles({
    name: `aria-screen.${png ? "png" : "jpg"}`,
    mimeType: png ? "image/png" : "image/jpeg",
    buffer: Buffer.from(m[2], "base64"),
  });
  // The send button lights up once the photo is attached…
  const send = page.locator(`${sel.send} >> visible=true`).first();
  const ready = Date.now() + attachMs;
  while (!(await send.isEnabled().catch(() => false))) {
    if (Date.now() > ready) throw new Error("the photo never finished attaching");
    await sleep(200);
  }
  await send.click({ timeout: 5000 });
  // …and goes dark again once there's nothing left to send.
  const gone = Date.now() + sendMs;
  while (await send.isEnabled().catch(() => false)) {
    if (Date.now() > gone) throw new Error("Google Voice didn't send the photo");
    await sleep(300);
  }
}
