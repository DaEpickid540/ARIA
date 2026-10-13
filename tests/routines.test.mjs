// Run: npm test   (or node --test tests/routines.test.mjs)
// lib/routines.js: what counts as a routine, filling blanks (and refusing
// shell syntax in them), for-each plans, teaching through a fake model.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.ARIA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "aria-rout-"));
const R = await import("../lib/routines.js");

// A stand-in for server.js's claw parser: known prefixes → a type.
const KNOWN = ["open:", "switch:", "new_tab:", "close_tab", "hotkey:", "type:", "shell:", "screenshot", "write_code:", "scroll:", "move:", "click:", "right_click:", "double_click:", "drag:"];
const parse = (s) => ({ type: KNOWN.some((k) => s.trim().startsWith(k)) ? s.split(":")[0] : "unknown" });
R.init({ parse });

const backup = {
  name: "Backup File",
  description: "Copies a file into D:\\Backup and opens the folder",
  params: [{ name: "file", desc: "full path" }],
  steps: ['shell: copy "{{file}}" "D:\\Backup\\"', "open: D:\\Backup"],
};

test("validate: names are slugged, blanks must be declared, steps must be Claw steps", () => {
  const v = R.validate(backup);
  assert.equal(v.name, "backup-file");
  assert.deepEqual(v.params, [{ name: "file", desc: "full path" }]);
  assert.throws(() => R.validate({ ...backup, params: [] }), /no parameter called "file"/);
  assert.throws(() => R.validate({ ...backup, steps: ["make coffee"] }), /isn't a Claw step/);
  assert.throws(() => R.validate({ ...backup, steps: [] }), /at least one step/);
  assert.throws(() => R.validate({ ...backup, name: "!!!" }), /needs a name/);
  // Declared but unused parameters are dropped.
  assert.deepEqual(R.validate({ ...backup, params: ["file", "unused"] }).params.map((p) => p.name), ["file"]);
});

test("fill: values go in; shell steps refuse anything that could start a second command", () => {
  assert.equal(R.fill('shell: copy "{{file}}" x', { file: "C:\\My Notes\\a.txt" }), 'shell: copy "C:\\My Notes\\a.txt" x');
  for (const evil of ['a.txt" & del /q C:\\*', "a.txt | iex", "$(rm -rf ~)", "a`b", "a;b", "%COMSPEC%", "a^&b"])
    assert.throws(() => R.fill('shell: copy "{{file}}" x', { file: evil }), /could change the command/, evil);
  // Outside shell steps, the same text is just text.
  assert.equal(R.fill("type: {{msg}}", { msg: "Tom & Jerry; 50% off" }), "type: Tom & Jerry; 50% off");
  assert.throws(() => R.fill("type: {{msg}}", { msg: "a\nb" }), /line break/);
  assert.throws(() => R.fill("type: {{msg}}", {}), /No value for \{\{msg\}\}/);
});

test("plan: one run, or one per item; missing values are named", () => {
  R._reset();
  R.saveRoutine(backup);
  const one = R.plan("backup-file", { values: { file: "C:\\a.txt" } });
  assert.equal(one.length, 1);
  assert.equal(one[0].steps[0], 'shell: copy "C:\\a.txt" "D:\\Backup\\"');
  const many = R.plan("backup-file", { each: ["C:\\a.txt", "C:\\b.txt", "C:\\c.txt"] });
  assert.deepEqual(many.map((r) => r.values.file), ["C:\\a.txt", "C:\\b.txt", "C:\\c.txt"]);
  assert.throws(() => R.plan("backup-file", {}), /needs file \(full path\)/);
  assert.throws(() => R.plan("backup-file", { each: Array(21).fill("x") }), /At most 20/);
  assert.throws(() => R.plan("nope", {}), /No such routine/);
});

test("args: bare value, name=value pairs, for each lists", () => {
  const r = R.validate(backup);
  assert.deepEqual(R.parseArgs(r, "C:\\a.txt"), { values: { file: "C:\\a.txt" }, each: null });
  assert.deepEqual(R.parseArgs(r, 'file="C:\\a b.txt"'), { values: { file: "C:\\a b.txt" }, each: null });
  assert.deepEqual(R.parseArgs(r, "for each: C:\\a.txt, C:\\b.txt").each, ["C:\\a.txt", "C:\\b.txt"]);
  assert.deepEqual(R.parseArgs(r, 'for each file in: ["x","y"]').each, ["x", "y"]);
  const two = R.validate({ name: "mv", params: ["a", "b"], steps: ['shell: move "{{a}}" "{{b}}"'] });
  assert.throws(() => R.parseArgs(two, "just one"), /takes a, b/);
  assert.deepEqual(R.parseArgs(two, "a=1; b=2").values, { a: "1", b: "2" });
});

test("teach: the model's JSON is validated, the given name wins, junk is refused", async () => {
  let seen = "";
  const ai = async (msgs) => {
    seen = msgs[1].content;
    return '<think>hmm</think>{"name":"x","description":"Back up a file","params":[{"name":"file","desc":"path"}],"steps":["shell: copy \\"{{file}}\\" D:\\\\Backup"]}';
  };
  const r = await R.teach({ name: "Backup", description: "do this for any file", steps: ['shell: copy "C:\\a.txt" D:\\Backup'], ai });
  assert.equal(r.name, "backup");
  assert.equal(r.params[0].name, "file");
  assert.match(seen, /STEPS THAT WERE RUN:\n1\. shell: copy/);
  await assert.rejects(R.teach({ description: "x", ai: async () => "no json here" }), /didn't return a routine/);
  await assert.rejects(R.teach({ description: "x", ai: async () => '{"name":"x","steps":["format the disk"]}' }), /isn't a Claw step/);
  await assert.rejects(R.teach({ ai }), /Describe what the routine should do/);
});

test("store: replace by name keeps run counts; survives a reload", () => {
  R._reset();
  R.saveRoutine(backup);
  R.noteRun("backup-file", 3);
  R.saveRoutine({ ...backup, description: "Updated" });
  const r = R.getRoutine("Backup File");
  assert.equal(r.description, "Updated");
  assert.equal(r.runs, 3);
  R._reset();
  R.init({ parse });
  assert.equal(R.listRoutines().length, 1);
  assert.match(R.summary(R.getRoutine("backup-file")), /^backup-file\(file\): Updated — 2 steps$/);
  assert.equal(R.removeRoutine("backup-file"), true);
  assert.equal(R.listRoutines().length, 0);
});

test("recorded macro steps (objects) turn back into Claw text", () => {
  const cmds = [
    { type: "shell", cmd: "dir" },
    { type: "hotkey", keys: ["ctrl", "s"] },
    { type: "click", x: 5, y: 6, button: "right" },
    { type: "browser", url: "https://x.com" },
    { type: "launch_app", app: "Spotify" },
    { type: "drag", x1: 1, y1: 2, x2: 3, y2: 4 },
    { type: "wait", ms: 100 },
  ];
  assert.deepEqual(cmds.map(R.clawInputOf), ["shell: dir", "hotkey: ctrl+s", "right_click: 5,6", "open: https://x.com", "open: Spotify", "drag: 1,2 to 3,4", null]);
});

test("sub-agent tool sets: research helpers get no private data, trigger asks can't fetch URLs", async () => {
  const { subAgentMay } = await import("../lib/agent-tools.js");
  for (const t of ["debrief", "calendar", "claw", "routine", "task", "spawn"]) assert.equal(subAgentMay("spawn", t), false, `spawn: ${t}`);
  assert.equal(subAgentMay("spawn", "scrape"), true);
  for (const t of ["scrape", "claw", "routine", "agent", "spawn"]) assert.equal(subAgentMay("trigger", t), false, `trigger: ${t}`);
  assert.equal(subAgentMay("trigger", "debrief"), true);
  assert.equal(subAgentMay(undefined, "debrief"), false, "unknown kind = the narrower research set");
});

test("values can't break out of quotes in any step that becomes a command, and shell blanks must be quoted", () => {
  // switch:/open: end up inside quotes in PowerShell/cmd on the relay.
  assert.throws(() => R.fill("switch: {{app}}", { app: "x'); Start-Process calc; ('" }), /could change the command/);
  assert.equal(R.fill("open: {{url}}", { url: 'https://x.com/" & calc' }), "open: https://x.com/%22%20&%20calc", "a URL's quote is encoded, not obeyed");
  assert.throws(() => R.fill('shell: copy "{{f}}" x', { f: "Bob's notes.txt" }), /could change the command/);
  // Typed text and the code half of write_code are just text.
  assert.equal(R.fill("type: {{t}}", { t: "it's 50% & more" }), "type: it's 50% & more");
  assert.equal(R.fill("write_code: Visual Studio Code|{{c}}", { c: 'console.log("a & b")' }), 'write_code: Visual Studio Code|console.log("a & b")');
  assert.throws(() => R.fill("write_code: {{app}}|x", { app: "a'b" }), /could change the command/);
  // Unquoted shell blanks would split a value with spaces into extra arguments.
  assert.equal(R.shellBlanksQuoted('shell: del "{{f}}"'), true);
  assert.equal(R.shellBlanksQuoted("shell: del {{f}}"), false);
  assert.equal(R.shellBlanksQuoted('shell: copy "{{a}}" {{b}}'), false);
  assert.throws(() => R.validate({ name: "x", params: ["f"], steps: ["shell: del {{f}}"] }), /inside double quotes/);
});

test("chat can't overwrite a routine; 'untrusted' is kept until saved without it", () => {
  R._reset();
  R.saveRoutine(backup);
  assert.throws(() => R.saveRoutine({ ...backup, description: "hijacked" }, { replace: false }), /already a routine called "backup-file"/);
  R.saveRoutine({ ...backup, name: "from-web", untrusted: true }, { replace: false });
  assert.equal(R.getRoutine("from-web").untrusted, true);
  R.saveRoutine({ ...backup, name: "from-web" }); // the owner re-saves it from the panel
  assert.equal(R.getRoutine("from-web").untrusted, undefined);
});

test("URL blanks keep & and %, with quote characters percent-encoded; app blanks are still strict", () => {
  assert.equal(R.fill("open: {{url}}", { url: "https://x.com/?a=1&b=2%20c" }), "open: https://x.com/?a=1&b=2%20c");
  assert.equal(R.fill("new_tab: {{url}}", { url: 'https://x.com/"&calc' }), "new_tab: https://x.com/%22&calc");
  assert.equal(R.fill("open: {{url}}", { url: "https://x.com/a b'c" }), "open: https://x.com/a%20b%27c");
  assert.throws(() => R.fill("open: {{app}}", { app: "notepad & calc" }), /could change the command/);
});
