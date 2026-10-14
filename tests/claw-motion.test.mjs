// Run: npm test   (or node --test tests/claw-motion.test.mjs)
// lib/claw-motion.js: curvy, eased, slightly random mouse paths that always
// land exactly on the target.
import test from "node:test";
import assert from "node:assert/strict";
import { mousePath, applyPath, encodePath, moveDurationMs, speedFactor, STYLES, PATH_POINTS } from "../lib/claw-motion.js";

test("every style starts at the start, ends on the target, and isn't a straight line", () => {
  for (const style of STYLES) {
    for (let seed = 1; seed <= 20; seed++) {
      const p = mousePath({ seed, style });
      assert.equal(p.style, style);
      assert.equal(p.pts.length, PATH_POINTS);
      assert.deepEqual(p.pts[0], [0, 0, 0]);
      assert.deepEqual(p.pts.at(-1), [1, 0, 1]);
      const maxOff = Math.max(...p.pts.map(([, b]) => Math.abs(b)));
      assert.ok(maxOff > 0.01, `${style} seed ${seed} bends (max ${maxOff})`);
      assert.ok(maxOff < 0.6, `${style} seed ${seed} stays near the line (max ${maxOff})`);
      // Time only moves forward.
      for (let i = 1; i < p.pts.length; i++) assert.ok(p.pts[i][2] > p.pts[i - 1][2]);
    }
  }
});

test("random by default, repeatable with a seed", () => {
  assert.deepEqual(mousePath({ seed: 7 }), mousePath({ seed: 7 }));
  assert.notDeepEqual(mousePath({ seed: 7 }).pts, mousePath({ seed: 8 }).pts);
  const styles = new Set(Array.from({ length: 200 }, () => mousePath().style));
  assert.ok(styles.size >= 4, `a mix of styles: ${[...styles]}`);
});

test("applyPath lands exactly on the target, in whole pixels, across monitors", () => {
  const from = { x: -1800, y: 200 };
  const to = { x: 1450, y: 870 };
  const pts = applyPath(mousePath({ seed: 3 }), from, to, 1);
  assert.deepEqual(pts[0].slice(0, 2), [from.x, from.y]);
  assert.deepEqual(pts.at(-1).slice(0, 2), [to.x, to.y]);
  assert.equal(pts.at(-1)[2], moveDurationMs(Math.hypot(to.x - from.x, to.y - from.y), 1));
  for (const [x, y, ms] of pts) assert.ok(Number.isInteger(x) && Number.isInteger(y) && Number.isInteger(ms));
  for (let i = 1; i < pts.length; i++) assert.notDeepEqual(pts[i].slice(0, 2), pts[i - 1].slice(0, 2), "no repeated points");
});

test("a tiny move just jumps; speed makes it quicker; longer moves take longer", () => {
  assert.deepEqual(applyPath(mousePath({ seed: 1 }), { x: 10, y: 10 }, { x: 11, y: 11 }), [[11, 11, 0]]);
  assert.ok(moveDurationMs(1000, 10) < moveDurationMs(1000, 1) / 4);
  assert.ok(moveDurationMs(2000, 1) > moveDurationMs(200, 1));
  assert.equal(speedFactor(0), 1, "clamped to 1×");
  assert.equal(speedFactor(99), speedFactor(10), "clamped to 10×");
});

test("the PowerShell form is a;-separated list of a,b,w triples", () => {
  const enc = encodePath(mousePath({ seed: 5 }));
  const parts = enc.split(";");
  assert.equal(parts.length, PATH_POINTS);
  for (const p of parts) assert.match(p, /^-?\d+(\.\d+)?,-?\d+(\.\d+)?,\d+(\.\d+)?$/);
  assert.equal(parts.at(-1), "1,0,1");
});
