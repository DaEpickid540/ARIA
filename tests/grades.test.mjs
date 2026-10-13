// Run: npm test   (or node --test tests/grades.test.mjs)
// lib/grades.js: the running percent, what the next assignment needs, which
// class is closest to the line, and the ACTION: grades tool.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

process.env.ARIA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "aria-grades-"));
const g = await import("../lib/grades.js");

const NOW = Date.parse("2026-10-12T16:00:00Z");
const bio = () => ({
  name: "Bio",
  categories: [
    { name: "Tests", weight: 50, earned: 170, possible: 200 }, // 85%
    { name: "Quizzes", weight: 30, earned: 95, possible: 100 }, // 95%
    { name: "Homework", weight: 20, earned: 0, possible: 0 }, // nothing yet
  ],
});

test("weighted percent uses only categories with points, renormalised", () => {
  // (50*.85 + 30*.95) / 80 = 88.75
  assert.equal(g.percent(bio()), 88.8);
  assert.equal(g.percent({ name: "x", earned: 45, possible: 50 }), 90);
  assert.equal(g.percent({ name: "x", earned: 0, possible: 0 }), null, "nothing graded: no percent");
});

test("needed: weighted category, and the answer really lands on the target", () => {
  const c = bio();
  const n = g.needed(c, { title: "Unit 4 Test", points: 100, category: "Tests" }, 90);
  assert.equal(n.possible, true);
  assert.equal(n.already, false);
  // Put the points in and check the class is at (or just over) 90.
  const after = bio();
  after.categories[0].earned += n.points;
  after.categories[0].possible += 100;
  assert.ok(g.percent(after) >= 90 && g.percent(after) < 90.2, `got ${g.percent(after)}`);
  // A new category joins the weights once it has points.
  const hw = g.needed(c, { title: "HW 1", points: 10, category: "Homework" }, 90);
  const after2 = bio();
  after2.categories[2] = { name: "Homework", weight: 20, earned: hw.points, possible: 10 };
  assert.ok(g.percent(after2) >= 90, `got ${g.percent(after2)}`);
});

test("needed: points pool, out of reach, and already safe", () => {
  const c = { name: "Math", earned: 80, possible: 100 };
  assert.deepEqual(g.needed(c, { points: 100 }, 90), { points: 100, pct: 100, possible: true, already: false });
  assert.equal(g.needed(c, { points: 10 }, 90).possible, false, "80/100 can't reach 90 on a 10-point quiz");
  assert.equal(g.needed({ name: "Art", earned: 99, possible: 100 }, { points: 5 }, 90).already, true);
  assert.throws(() => g.needed(bio(), { points: 10, category: "Labs" }), /no category "Labs"/);
  assert.throws(() => g.needed(c, { points: 0 }), /points value/);
});

test("atRisk puts the class below its line first; focus picks its next assignment", () => {
  const book = {
    target: 90,
    classes: [
      { name: "Art", earned: 98, possible: 100, upcoming: [] },
      { ...bio(), upcoming: [{ title: "Later", points: 50, category: "Tests", due: "2026-11-30" }, { title: "Unit 4 Test", points: 100, category: "Tests", due: "2026-10-20" }] },
      { name: "Gym", earned: 0, possible: 0 },
    ],
  };
  assert.deepEqual(g.atRisk(book).map((x) => x.c.name), ["Bio", "Art"]);
  const f = g.focus(book, NOW);
  assert.equal(f.cls.name, "Bio");
  assert.equal(f.next.title, "Unit 4 Test", "soonest due first");
  const s = g.summary(book, NOW);
  assert.match(s, /Bio: 88\.8% \(1\.2 BELOW the 90% line\)/);
  assert.match(s, /No grades yet: Gym/);
  assert.match(s, /Focus: Bio\. Next: Unit 4 Test \(due Tue, Oct 20\), 100 pts — needs \d+(\.\d)?\/100/);
});

test("a class's own target beats the book's", () => {
  const book = { target: 90, classes: [{ name: "AP Chem", target: 80, earned: 85, possible: 100 }, { name: "Eng", earned: 91, possible: 100 }] };
  assert.equal(g.atRisk(book)[0].c.name, "Eng", "1 above 90 is closer than 5 above 80");
});

test("the tool: add a class, record scores, add an assignment, ask what it needs", () => {
  g._reset();
  assert.match(g.runGradesTool("grades class", "Bio | Tests 50, Quizzes 30%, Homework: 20"), /Added Bio \(Tests 50%, Quizzes 30%, Homework 20%\)/);
  assert.match(g.runGradesTool("grades score", "bio | 41/50 | Quiz 3 | quizzes"), /Recorded 41\/50 in Bio\. It's at 82% now/);
  assert.match(g.runGradesTool("grades score", "Bio | 41 out of 50"), /Which category\? Bio has Tests, Quizzes, Homework/);
  assert.match(g.runGradesTool("grades add", "Bio | Unit 4 Test | 100 | Tests | 2026-10-20"), /Added Unit 4 Test \(100 pts\) to Bio\. Bio stays at 90%\+|Bio needs/);
  // Scoring the assignment by title files it in its category and takes it off the list.
  assert.match(g.runGradesTool("grades score", "Bio | 92/100 | unit 4 test"), /Recorded 92\/100 in Bio/);
  assert.equal(g.getClass("bio").upcoming.length, 0);
  assert.match(g.runGradesTool("grades need", "Bio"), /no upcoming assignment/);
  assert.match(g.runGradesTool("grades add", "Bio | Lab | 20 | Labs"), /⚠ Which category/);
  assert.match(g.runGradesTool("grades add", "Bio | Lab | 20 | Homework | next friday"), /isn't a date/);
  // Re-declaring weights keeps the points already in.
  g.runGradesTool("grades class", "Bio | Tests 60, Quizzes 20, Homework 20");
  assert.equal(g.getClass("Bio").categories[1].earned, 41);
  assert.match(g.runGradesTool("grades", ""), /^Bio: \d/);
  assert.match(g.runGradesTool("grades remove", "Bio"), /Removed/);
  assert.equal(g.runGradesTool("grades", ""), "No classes in the gradebook yet.");
});

test("it saves to grades.json and loads it back", () => {
  g._reset();
  g.runGradesTool("grades class", "Math");
  g.runGradesTool("grades score", "Math | 18/20");
  g._reset();
  g.init();
  assert.equal(g.percent(g.getClass("math")), 90);
  assert.throws(() => g.setTarget(30), /between 50 and 100/);
});
