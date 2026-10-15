// lib/claw-grid.js — the labelled grid Claw sees over your screen(s)
// ═══════════════════════════════════════════════════════════════════
//
// When a model looks at a Claw screenshot, it gets a copy with a grid drawn
// on it: columns A, B, C… and rows 1, 2, 3…, every cell labelled, monitor
// edges outlined. Nothing is drawn on the real screen; the grid only exists
// in the picture the model reads. The model then says "click: F7" (the
// middle of cell F7) or "click: F7.3" (cell F7 cut 3×3, part 3 = its top
// right) and the server turns that into desktop pixels, across every
// monitor, negative coordinates included.
// ═══════════════════════════════════════════════════════════════════

export const DEFAULT_CELL = 100; // desktop pixels per cell
export const MAX_COLS = 40;
export const MAX_ROWS = 30;

/**
 * The grid over a captured area. `bounds` is where the screenshot sits on
 * the desktop ({x, y, w, h}, as the relay reports it). Cells grow on very
 * wide setups so labels stay readable.
 */
export function gridSpec(bounds, { cell = DEFAULT_CELL } = {}) {
  const b = { x: Math.round(+bounds?.x || 0), y: Math.round(+bounds?.y || 0), w: Math.max(1, Math.round(+bounds?.w || 0)), h: Math.max(1, Math.round(+bounds?.h || 0)) };
  const size = Math.max(cell, Math.ceil(b.w / MAX_COLS), Math.ceil(b.h / MAX_ROWS));
  return { ...b, cell: size, cols: Math.ceil(b.w / size), rows: Math.ceil(b.h / size) };
}

/** 0 → A, 25 → Z, 26 → AA. */
export function colName(i) {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

function colIndex(letters) {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export const cellName = (col, row) => `${colName(col)}${row + 1}`;

/** "F7" or "F7.3" → { col, row, sub } (sub 1–9 in reading order, 5 = centre). Null if it isn't one. */
export function parseCell(s) {
  const m = /^\s*([A-Za-z]{1,2})(\d{1,3})(?:\.([1-9]))?\s*$/.exec(String(s ?? ""));
  if (!m) return null;
  return { col: colIndex(m[1]), row: Number(m[2]) - 1, sub: m[3] ? Number(m[3]) : 5 };
}

/** Desktop pixel for a cell label, or null when the label is off the grid. */
export function cellPoint(spec, label) {
  const c = parseCell(label);
  if (!c || c.col < 0 || c.row < 0 || c.col >= spec.cols || c.row >= spec.rows) return null;
  const sx = (c.sub - 1) % 3;
  const sy = Math.floor((c.sub - 1) / 3);
  const x = spec.x + c.col * spec.cell + ((sx + 0.5) * spec.cell) / 3;
  const y = spec.y + c.row * spec.cell + ((sy + 0.5) * spec.cell) / 3;
  // The last row/column can be cut short by the screen's edge.
  return {
    x: Math.round(Math.min(x, spec.x + spec.w - 1)),
    y: Math.round(Math.min(y, spec.y + spec.h - 1)),
  };
}

/** The cell a desktop pixel falls in, or null when it's outside the capture. */
export function pointCell(spec, x, y) {
  const col = Math.floor((x - spec.x) / spec.cell);
  const row = Math.floor((y - spec.y) / spec.cell);
  if (col < 0 || row < 0 || col >= spec.cols || row >= spec.rows) return null;
  return cellName(col, row);
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/**
 * An SVG the size of the (possibly shrunk) screenshot, to lay over it:
 * thin lines, a label in each cell's corner, monitors outlined and named.
 * `monitors` are desktop rectangles ({x, y, w, h, primary}).
 */
export function gridSvg(spec, imgW, imgH, monitors = []) {
  const kx = imgW / spec.w;
  const ky = imgH / spec.h;
  const cellPx = spec.cell * Math.min(kx, ky);
  const font = Math.max(7, Math.min(14, Math.round(cellPx * 0.3)));
  const parts = [];
  for (let c = 1; c < spec.cols; c++) {
    const x = (c * spec.cell * kx).toFixed(1);
    parts.push(`<line x1="${x}" y1="0" x2="${x}" y2="${imgH}"/>`);
  }
  for (let r = 1; r < spec.rows; r++) {
    const y = (r * spec.cell * ky).toFixed(1);
    parts.push(`<line x1="0" y1="${y}" x2="${imgW}" y2="${y}"/>`);
  }
  const labels = [];
  for (let r = 0; r < spec.rows; r++)
    for (let c = 0; c < spec.cols; c++)
      labels.push(`<text x="${(c * spec.cell * kx + 2).toFixed(1)}" y="${(r * spec.cell * ky + font).toFixed(1)}">${cellName(c, r)}</text>`);
  const mons = (monitors || [])
    .filter((m) => m && m.w > 0 && m.h > 0)
    .map((m, i) => {
      const x = ((m.x - spec.x) * kx).toFixed(1);
      const y = ((m.y - spec.y) * ky).toFixed(1);
      const name = esc(`Screen ${i}${m.primary ? " (main)" : ""}`);
      return (
        `<rect x="${x}" y="${y}" width="${(m.w * kx).toFixed(1)}" height="${(m.h * ky).toFixed(1)}"/>` +
        `<text class="m" x="${(+x + 8).toFixed(1)}" y="${(+y + m.h * ky - 8).toFixed(1)}">${name}</text>`
      );
    });
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${imgW}" height="${imgH}">` +
    `<style>line{stroke:#ff00e6;stroke-opacity:.45;stroke-width:1}` +
    `text{font:bold ${font}px sans-serif;fill:#fff;stroke:#000;stroke-width:2.5px;paint-order:stroke;fill-opacity:.9}` +
    `rect{fill:none;stroke:#00e5ff;stroke-width:3;stroke-opacity:.8}text.m{font-size:${font + 4}px;fill:#00e5ff}</style>` +
    `<g>${parts.join("")}</g><g>${labels.join("")}</g><g>${mons.join("")}</g></svg>`
  );
}

/** One line telling the model how to read the picture. */
export function gridNote(spec) {
  return (
    `A labelled grid is drawn on this screenshot (it is NOT on the real screen): columns ${colName(0)}–${colName(spec.cols - 1)}, ` +
    `rows 1–${spec.rows}, each cell ${spec.cell}px. To point at something, name its cell — click: F7 — or a ninth of a cell ` +
    `for small targets — click: F7.3 (1 = top-left … 5 = centre … 9 = bottom-right). Exact pixels (click: X,Y) still work; ` +
    `the capture's top-left is ${spec.x},${spec.y}.`
  );
}
