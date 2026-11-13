import * as THREE from 'three';
import { PALETTE } from '../config.js';

// Linear-space palette colours (THREE converts the sRGB hex on set).
// Re-read with syncPalette() after PALETTE changes (a new theme), before a build.
const hot = new THREE.Color();
const cyan = new THREE.Color();
const electric = new THREE.Color();
const deep = new THREE.Color();

export function syncPalette() {
  hot.set(PALETTE.hot);
  cyan.set(PALETTE.cyan);
  electric.set(PALETTE.electric);
  deep.set(PALETTE.deep);
}
syncPalette();

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// Colour + brightness for a point at normalised radius r (distance / mass radius).
// Writes premultiplied RGB into out (THREE.Color) and returns it.
export function rampColor(r, ramp, out) {
  if (r <= ramp.hotEnd) {
    out.copy(hot);
  } else if (r <= ramp.cyanAt) {
    out.copy(hot).lerp(cyan, smooth(ramp.hotEnd, ramp.cyanAt, r));
  } else if (r <= ramp.electricAt) {
    out.copy(cyan).lerp(electric, smooth(ramp.cyanAt, ramp.electricAt, r));
  } else {
    out.copy(electric).lerp(deep, smooth(ramp.electricAt, ramp.deepAt, r));
  }
  const b = ramp.brightnessCore + (ramp.brightnessEdge - ramp.brightnessCore) * smooth(0, ramp.deepAt, r);
  return out.multiplyScalar(b);
}
