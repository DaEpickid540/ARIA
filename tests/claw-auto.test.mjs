// Run: npm test   (or node --test tests/claw-auto.test.mjs)
// lib/claw-auto.js: AUTO mode plans, picks a mode per step, looks before it
// clicks, and stops when told to.
import test from "node:test";
import assert from "node:assert/strict";
import { runAuto, parseAutoReply, modeOf, dropOldImages, autoSystem } from "../lib/claw-auto.js";

// A tiny stand-in for server.js's parser.
function parse(line) {
  const m = /^(\w+)(?::\s*(.*))?$/.exec(line.trim());
  const types = { shell: "shell", open: "launch_app", click: "click", type: "type", hotkey: "hotkey", screenshot: "screenshot", wait: "wait" };
  return m && types[m[1]] ? { type: types[m[1]], arg: m[2] } : { type: "unknown" };
}

function deps(replies, extra = {}) {
  const seen = { ran: [], log: [], prompts: [] };
  return {
    seen,
    ai: async (msgs) => {
      seen.prompts.push(msgs);
      const r = replies.shift();
      if (r instanceof Error) throw r;
      return typeof r === "string" ? r : JSON.stringify(r ?? { say: "done", steps: [], done: true });
    },
    parse,
    exec: async (cmd) => {
      seen.ran.push(cmd.type);
      return cmd.type === "screenshot" ? { image: "data:image/jpeg;base64,AAAA", text: "screenshot attached" } : { text: "ok" };
    },
    needsOk: () => null,
    askOk: async () => ({ approved: true, output: "ran" }),
    stopped: () => false,
    log: (e) => seen.log.push(e),
    ...extra,
  };
}

test("PowerShell to open the app, then a look, then the mouse — modes switch on their own", async () => {
  const d = deps([
    { say: "Opening Notepad", steps: ["open: notepad", "wait: 1500", "screenshot", "click: 1,1"] },
    { say: "Clicking File", steps: ["click: B2"] },
    { say: "Done — File menu is open", steps: [], done: true },
  ]);
  const r = await runAuto("open notepad and click File", d);
  assert.equal(r.status, "done");
  assert.equal(r.say, "Done — File menu is open");
  // The click planned after the screenshot in the same batch was dropped.
  assert.deepEqual(d.seen.ran, ["launch_app", "wait", "screenshot", "click"]);
  assert.deepEqual(
    d.seen.log.filter((e) => ["app", "wait", "look", "mouse"].includes(e.mode)).map((e) => e.mode),
    ["app", "wait", "look", "look", "mouse"],
  );
  // The second turn saw the screenshot; the third only a note where it was.
  const second = d.seen.prompts[1].at(-1).content;
  assert.ok(Array.isArray(second) && second.some((p) => p.type === "image_url"));
  const third = d.seen.prompts[2];
  assert.ok(!third.some((m) => Array.isArray(m.content) && m.content.some((p) => p.type === "image_url")), "old screenshots dropped");
});

test("the step limit, a stop, and junk replies all end it cleanly", async () => {
  const many = { say: "", steps: ["shell: a", "shell: b", "shell: c", "shell: d"] };
  let r = await runAuto("x", deps([many, many, many]), { maxSteps: 6 });
  assert.equal(r.status, "limit");
  assert.equal(r.steps, 6);

  let n = 0;
  r = await runAuto("x", deps([many, many], { stopped: () => ++n > 3 }));
  assert.equal(r.status, "stopped");

  r = await runAuto("x", deps(["I'll open it now!", "still not json"]));
  assert.equal(r.status, "error");
  assert.match(r.say, /JSON/);

  r = await runAuto("x", deps(["sure", { say: "ok", steps: [], done: true }]));
  assert.equal(r.status, "done", "one bad reply gets a second chance");

  r = await runAuto("x", deps([new Error("Groq HTTP 503")]));
  assert.equal(r.status, "error");
});

test("approvals: asked when needed, and a no stops the batch", async () => {
  const asked = [];
  const d = deps(
    [
      { steps: ["screenshot"] },
      { steps: ["shell: del x", "click: A1"] },
      { say: "Okay, left it", steps: [], done: true },
    ],
    {
      needsOk: (cmd, { looked }) => (looked && cmd.type === "shell" ? "looked first" : null),
      askOk: async (cmd, reason) => {
        asked.push(reason);
        return { approved: false };
      },
    },
  );
  const r = await runAuto("x", d);
  assert.equal(r.status, "done");
  assert.deepEqual(asked, ["looked first"]);
  assert.deepEqual(d.seen.ran, ["screenshot"], "neither the shell step nor the click after it ran");
  assert.match(JSON.stringify(d.seen.prompts[2].at(-1)), /the owner said no/);
});

test("unknown steps are reported back, not run", async () => {
  const d = deps([{ steps: ["teleport: mars", "shell: dir"] }, { steps: [], done: true }]);
  await runAuto("x", d);
  assert.deepEqual(d.seen.ran, ["shell"]);
  assert.match(JSON.stringify(d.seen.prompts[1].at(-1)), /teleport: mars → not a Claw command/);
});

test("reply parsing, modes, and image trimming", () => {
  assert.deepEqual(parseAutoReply('<think>hmm {"a":1}</think>Plan: {"say":"hi","steps":["shell: dir","bad\\nline",""],"done":false}'), {
    say: "hi",
    steps: ["shell: dir"],
    done: false,
  });
  assert.throws(() => parseAutoReply("no json here"), /JSON plan/);
  assert.equal(modeOf({ type: "shell" }), "shell");
  assert.equal(modeOf({ type: "launch_app" }), "app");
  assert.equal(modeOf({ type: "drag" }), "mouse");
  assert.equal(modeOf({ type: "mouse_pos" }), "mouse");
  assert.equal(modeOf({ type: "hotkey" }), "hotkey");
  assert.equal(modeOf({ type: "screenshot" }), "look");
  const trimmed = dropOldImages([{ role: "user", content: [{ type: "image_url", image_url: { url: "x" } }, { type: "text", text: "RESULTS" }] }]);
  assert.deepEqual(trimmed[0].content.map((p) => p.type), ["text", "text"]);
  assert.match(autoSystem({ relayType: "esp32" }), /Bluetooth keyboard/);
  assert.doesNotMatch(autoSystem({ relayType: "esp32" }), /POWERSHELL/);
});
