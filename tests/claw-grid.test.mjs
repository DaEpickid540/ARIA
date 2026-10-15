// Run: npm test   (or node --test tests/claw-grid.test.mjs)
// lib/claw-grid.js: the labelled grid drawn on Claw screenshots, and turning
// a cell the model names back into desktop pixels.
import test from "node:test";
import assert from "node:assert/strict";
import { gridSpec, colName, cellName, parseCell, cellPoint, pointCell, gridSvg, gridNote, MAX_COLS } from "../lib/claw-grid.js";

test("column names run A…Z, AA…", () => {
  assert.equal(colName(0), "A");
  assert.equal(colName(25), "Z");
  assert.equal(colName(26), "AA");
  assert.equal(colName(27), "AB");
  assert.equal(cellName(5, 6), "F7");
});

test("parseCell reads cells and ninths, nothing else", () => {
  assert.deepEqual(parseCell("F7"), { col: 5, row: 6, sub: 5 });
  assert.deepEqual(parseCell(" f7.3 "), { col: 5, row: 6, sub: 3 });
  assert.deepEqual(parseCell("AB12"), { col: 27, row: 11, sub: 5 });
  for (const no of ["", "7F", "F", "F7.0", "500,300", "click F7", null]) assert.equal(parseCell(no), null, String(no));
});

test("cells map to desktop pixels, offsets and negative monitors included", () => {
  // Two 1920×1080 monitors, the second to the LEFT of the main one.
  const spec = gridSpec({ x: -1920, y: 0, w: 3840, h: 1080 });
  assert.equal(spec.cell, 100);
  assert.equal(spec.cols, 39);
  assert.equal(spec.rows, 11);
  assert.deepEqual(cellPoint(spec, "A1"), { x: -1870, y: 50 });
  assert.deepEqual(cellPoint(spec, "A1.1"), { x: -1903, y: 17 });
  assert.deepEqual(cellPoint(spec, "A1.9"), { x: -1837, y: 83 });
  assert.equal(pointCell(spec, -1870, 50), "A1");
  // The last row is cut short by the screen's bottom edge: stays on screen.
  const last = cellPoint(spec, "AM11");
  assert.ok(last.x <= 1919 && last.y <= 1079);
  assert.equal(cellPoint(spec, "AN1"), null, "off the grid");
  assert.equal(pointCell(spec, 5000, 50), null);
});

test("very wide setups get bigger cells so labels stay readable", () => {
  const spec = gridSpec({ x: 0, y: 0, w: 7680, h: 1440 });
  assert.ok(spec.cols <= MAX_COLS);
  assert.ok(spec.cell > 100);
});

test("the SVG has a label per cell and an outline per monitor, and the note explains it", () => {
  const spec = gridSpec({ x: 0, y: 0, w: 400, h: 200 });
  const svg = gridSvg(spec, 400, 200, [{ x: 0, y: 0, w: 200, h: 200, primary: true }, { x: 200, y: 0, w: 200, h: 200 }]);
  assert.match(svg, /^<svg /);
  assert.equal((svg.match(/<text /g) || []).length, 4 * 2 + 2);
  assert.match(svg, />A1</);
  assert.match(svg, />D2</);
  assert.match(svg, /Screen 0 \(main\)/);
  assert.equal((svg.match(/<rect /g) || []).length, 2);
  const note = gridNote(spec);
  assert.match(note, /NOT on the real screen/);
  assert.match(note, /columns A–D, rows 1–2/);
});
