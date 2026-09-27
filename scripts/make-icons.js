// scripts/make-icons.js — regenerate every app icon: `node scripts/make-icons.js`
//
// Matches the UI: the app background (#1a1a1e), a white serif capital like
// the "ARIA" wordmark, and one bar of the accent (#f8291c). Writes
// public/icons/icon-<size>.png, the maskable pair (full-bleed, glyph inside
// the 80% safe zone the OS may crop to) and public/favicon.ico.
//
// Renders with sharp (already a dependency). The glyph is Georgia Bold, which
// Windows and macOS ship; on a machine without it librsvg substitutes another
// serif, so check the output.

import fs from "fs";
import path from "path";
import sharp from "sharp";
import { fileURLToPath } from "url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const ICONS = path.join(ROOT, "public", "icons");

const BG = "#1a1a1e";
const FG = "#f0f0f0";
const ACCENT = "#f8291c";

/** @param {number} scale glyph size relative to the standard icon */
function svg({ rounded, scale = 1 }) {
  const c = 256;
  const t = (v) => c + (v - c) * scale; // scale around the centre
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" ${rounded ? 'rx="112"' : ""} fill="${BG}"/>
  <text x="256" y="${t(372)}" text-anchor="middle" font-family="Georgia" font-weight="700"
        font-size="${340 * scale}" fill="${FG}">A</text>
  <rect x="${t(196)}" y="${t(404)}" width="${120 * scale}" height="${22 * scale}"
        rx="${4 * scale}" fill="${ACCENT}"/>
</svg>`;
}

const render = (s, size) =>
  sharp(Buffer.from(s), { density: Math.max(72, (72 * size) / 512 * 4) })
    .resize(size, size)
    .png()
    .toBuffer();

/** A .ico is a small directory of PNGs (supported since Windows Vista). */
function ico(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(pngs.length, 4);
  let offset = 6 + 16 * pngs.length;
  const entries = pngs.map(({ size, data }) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt16LE(1, 4); // colour planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    return e;
  });
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

const standard = svg({ rounded: true });
for (const size of [16, 32, 48, 64, 72, 96, 128, 144, 152, 192, 384, 512]) {
  fs.writeFileSync(path.join(ICONS, `icon-${size}.png`), await render(standard, size));
}

// Maskable: no rounding of our own (the OS applies its shape), and the glyph
// shrunk so nothing important falls outside the central 80%.
const maskable = svg({ rounded: false, scale: 0.78 });
for (const size of [192, 512]) {
  fs.writeFileSync(path.join(ICONS, `icon-maskable-${size}.png`), await render(maskable, size));
}

const icoPngs = [];
for (const size of [16, 32, 48]) icoPngs.push({ size, data: await render(standard, size) });
fs.writeFileSync(path.join(ROOT, "public", "favicon.ico"), ico(icoPngs));

console.log("Icons written to public/icons and public/favicon.ico");
