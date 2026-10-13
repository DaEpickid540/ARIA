// Run: npm test   (or node --test tests/skill-tools.test.mjs)
// A skill folder's tool.js: offered only while the skill is on, can't take a
// built-in's name, reloads when edited, has a time limit; and the bundled
// music-theory skill's chord tool spells notes by letter.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "aria-skill-tools-"));
process.env.ARIA_DATA_DIR = dataDir; // user skills then live in <dataDir>/skills
const skills = await import("../lib/skills.js");
const userDir = path.join(dataDir, "skills");

function addSkill(id, tool, front = "") {
  const dir = path.join(userDir, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), `---\nname: ${id}\ndescription: test skill ${id}\n${front}---\nUse the tool.\n`);
  if (tool != null) fs.writeFileSync(path.join(dir, "tool.js"), tool);
}
// listSkills() caches for 10 s; a new folder needs a fresh scan.
const rescan = () => {
  skills.setSkillActive("__nothing__", false);
};

test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

test("a skill's tool loads, is offered only while the skill is on, and runs with its own data folder", async () => {
  addSkill(
    "echoer",
    `export const TOOL_META = { name: "echo", desc: "Says it back", args: "<text>", local: true };
     export async function run(input, ctx) { return "echo: " + input + " | " + ctx.skill + " | " + require_free(ctx.dataDir); }
     function require_free(d) { return d.endsWith("echoer") ? "own folder" : d; }`,
    `triggers: ["parrot"]\n`,
  );
  rescan();
  skills.reserveToolNames(["weather", "calc"]);
  await skills.refreshSkillTools();
  assert.equal(skills.skillTool("echo").skillId, "echoer");
  assert.deepEqual(skills.enabledSkillTools("hello"), [], "off and not triggered");
  assert.equal(skills.buildSkillsContext("hello"), "");
  assert.deepEqual(skills.enabledSkillTools("be a parrot").map((t) => t.name), ["echo"], "a trigger turns it on for that message");
  skills.setSkillActive("echoer", true);
  assert.deepEqual(skills.enabledSkillTools("hello").map((t) => t.name), ["echo"]);
  assert.match(skills.buildSkillsContext("hello"), /This skill's tool \(same ACTION format\):\nACTION: echo \| <text>   — Says it back/);
  assert.equal(await skills.runSkillTool("echo", "hi"), "echo: hi | echoer | own folder");
  assert.ok(fs.existsSync(path.join(dataDir, "skill-data", "echoer")));
  const stat = skills.getStats().skills.find((s) => s.id === "echoer");
  assert.deepEqual(stat.tool, { name: "echo", desc: "Says it back", args: "<text>" });
  skills.setSkillActive("echoer", false);
});

test("allowed-tools on a skill keeps its own tool usable", async () => {
  addSkill("narrow", `export const TOOL_META = { name: "narrowtool" }; export const run = () => "ok";`, `allowed-tools: ["calc"]\n`);
  rescan();
  await skills.refreshSkillTools();
  skills.setSkillActive("narrow", true);
  assert.match(skills.buildSkillsContext(""), /only use these tools: calc, narrowtool\)/);
  skills.setSkillActive("narrow", false);
});

test("bad tools are reported, not loaded: built-in names, taken names, bad names, no run(), syntax errors", async () => {
  addSkill("clash", `export const TOOL_META = { name: "weather" }; export const run = () => "x";`);
  addSkill("dupe", `export const TOOL_META = { name: "echo" }; export const run = () => "x";`);
  addSkill("spaced", `export const TOOL_META = { name: "two words" }; export const run = () => "x";`);
  addSkill("norun", `export const TOOL_META = { name: "norun" };`);
  addSkill("broken", `export const TOOL_META = { name: "broken" ; `);
  addSkill("plain", null); // no tool.js: an ordinary skill
  rescan();
  await skills.refreshSkillTools();
  const by = Object.fromEntries(skills.getStats().skills.map((s) => [s.id, s]));
  assert.match(by.clash.toolError, /"weather" is a built-in tool's name/);
  assert.match(by.dupe.toolError, /already the echoer skill's tool/);
  assert.match(by.spaced.toolError, /one lowercase word/);
  assert.match(by.norun.toolError, /doesn't export run/);
  assert.match(by.broken.toolError, /didn't load/);
  assert.equal(by.plain.tool, null);
  assert.equal(by.plain.toolError, undefined);
  assert.equal(skills.skillTool("echo").skillId, "echoer", "the first one keeps the name");
  assert.equal(skills.skillTool("weather"), null);
});

test("an edited tool.js is picked up; a slow one times out; a throw is reported", async () => {
  const file = path.join(userDir, "echoer", "tool.js");
  fs.writeFileSync(file, `export const TOOL_META = { name: "echo" }; export const run = (i) => "v2 " + i;`);
  const later = new Date(Date.now() + 5000);
  fs.utimesSync(file, later, later);
  await skills.refreshSkillTools();
  assert.equal(await skills.runSkillTool("echo", "x"), "v2 x");
  assert.equal(skills.skillTool("echo").local, false, "not marked local any more");

  addSkill("slow", `export const TOOL_META = { name: "slow" }; export const run = () => new Promise(() => {});`);
  addSkill("thrower", `export const TOOL_META = { name: "thrower" }; export const run = () => { throw new Error("nope"); };`);
  rescan();
  await skills.refreshSkillTools();
  assert.match(await skills.runSkillTool("slow", "", { timeoutMs: 100 }), /^Tool error \(slow, from the slow skill\): no answer in 0s/);
  assert.equal(await skills.runSkillTool("thrower", ""), "Tool error (thrower, from the thrower skill): nope");
  assert.equal(await skills.runSkillTool("nothere", ""), "Unknown tool: nothere");
});

test("music-theory: chords, slash chords, scales and keys spelled by letter", async () => {
  const { run } = await import("../skills/public/music-theory/tool.js");
  assert.equal(await run("Cmaj7"), "Cmaj7: C E G B");
  assert.equal(await run("Bbm7b5"), "Bbm7b5: Bb Db Fb Ab");
  assert.equal(await run("Ebdim7"), "Ebdim7: Eb Gb Bbb Dbb");
  assert.equal(await run("F#M7"), "F#maj7: F# A# C# E#", "M7 is major");
  assert.equal(await run("am"), "Am: A C E");
  assert.equal(await run("C/E"), "C/E: C E G (E in the bass)");
  assert.equal(await run("C/D"), "C/D: C E G with D added in the bass");
  assert.equal(await run("Dm7, G7, Cmaj7"), "Dm7: D F A C\nG7: G B D F\nCmaj7: C E G B");
  assert.equal(await run("G# major scale"), "G# major: G# A# B# C# D# E# F##");
  assert.equal(await run("Gb major scale"), "Gb major: Gb Ab Bb Cb Db Eb F");
  assert.equal(await run("scale D dorian"), "D dorian: D E F G A B C");
  assert.equal(await run("F♯ harmonic minor scale"), "F# harmonic minor: F# G# A B C# D E#");
  assert.equal(await run("A blues"), "A blues: A C D Eb E G");
  assert.equal(
    await run("chords in Eb major"),
    "Chords in Eb major: I Eb · ii Fm · iii Gm · IV Ab · V Bb · vi Cm · vii° Ddim\nWith sevenths: Ebmaj7 Fm7 Gm7 Abmaj7 Bb7 Cm7 Dm7b5",
  );
  assert.match(await run("key of A minor"), /^Chords in A minor: i Am · ii° Bdim · III C · iv Dm · v Em · VI F · VII G\n.*\nIn minor the V is usually made major \(from harmonic minor\): E \/ E7 = E G# B D$/);
  assert.match(await run("Hmaj7"), /^I couldn't read "Hmaj7" as a chord/);
  assert.match(await run(""), /^Usage:/);
});
