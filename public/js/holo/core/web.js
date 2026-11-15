import * as THREE from 'three';
import { createPolylines } from './filaments.js';
import { createNodePoints } from './nodePoints.js';

// Sparse "plexus" of long, soft, gently curved deep-blue lines with bright junction dots. It
// ties the composition together: junctions sit on the fragments (tips, inner ends), on the
// core's outline, and in a loose band wrapping the outside of the whole mass, and each
// links to a few of its nearest neighbours beyond a minimum length, so the lines bridge the
// gaps and close into triangles. Lives in the fragments' orbit frame (orbit plane = x/z).
// anchors: [x, y, z] points on the fragments, in that frame.
export function createWeb(cfg, rng, uniforms, anchors) {
  const w = cfg.web;
  const R = cfg.mass.radius;
  const pts = anchors.slice();
  const dir = [0, 0, 0];

  for (let i = 0; i < w.coreCount; i++) {
    rng.unitVector(dir);
    const r = R * w.coreRadius * rng.range(0.9, 1.1);
    pts.push([dir[0] * r, dir[1] * r, dir[2] * r]);
  }
  for (let i = 0; i < w.bandCount; i++) {
    const a = rng.range(0, Math.PI * 2);
    const r = R * rng.range(w.bandInner, w.bandOuter);
    pts.push([Math.cos(a) * r, rng.range(-1, 1) * w.bandHeight * R, Math.sin(a) * r]);
  }

  // Each junction links to its k nearest neighbours within [minEdge, maxEdge].
  const n = pts.length;
  const minD = w.minEdge * R;
  const maxD = w.maxEdge * R;
  const seen = new Set();
  const edges = [];
  const adjacency = Array.from({ length: n }, () => []);
  const cand = [];
  for (let i = 0; i < n; i++) {
    cand.length = 0;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const d = Math.hypot(pts[j][0] - pts[i][0], pts[j][1] - pts[i][1], pts[j][2] - pts[i][2]);
      if (d >= minD && d <= maxD) cand.push([d, j]);
    }
    cand.sort((a, b) => a[0] - b[0]);
    const k = rng.int(w.kMin, w.kMax);
    for (let s = 0; s < Math.min(k, cand.length); s++) {
      const j = cand[s][1];
      const id = Math.min(i, j) * n + Math.max(i, j);
      if (seen.has(id)) continue;
      seen.add(id);
      edges.push([i, j]);
      adjacency[i].push(j);
      adjacency[j].push(i);
    }
  }

  // Each link is a smooth arc, bowed sideways by `curve` x its length, fading at both ends.
  const base = new THREE.Color(w.color);
  const S = 12;
  const side = [0, 0, 0];
  const paths = edges.map(([i, j]) => {
    const a = pts[i];
    const b = pts[j];
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const len = Math.hypot(dx, dy, dz);
    rng.unitVector(side);
    let px = dy * side[2] - dz * side[1];
    let py = dz * side[0] - dx * side[2];
    let pz = dx * side[1] - dy * side[0];
    const pl = Math.hypot(px, py, pz) || 1;
    const bow = w.curve * len * rng.range(0.5, 1);
    px = (px / pl) * bow; py = (py / pl) * bow; pz = (pz / pl) * bow;
    const bright = w.brightness * rng.range(0.6, 1.2);
    const points = new Float32Array((S + 1) * 3);
    const colors = new Float32Array((S + 1) * 3);
    for (let s = 0; s <= S; s++) {
      const t = s / S;
      const arc = 4 * t * (1 - t);
      points.set([a[0] + dx * t + px * arc, a[1] + dy * t + py * arc, a[2] + dz * t + pz * arc], s * 3);
      const f = bright * (0.35 + 0.65 * arc);
      colors.set([base.r * f, base.g * f, base.b * f], s * 3);
    }
    return { points, colors };
  });
  const lines = createPolylines(paths, cfg.network, uniforms, cfg.network.opacity * w.opacity, rng);
  lines.material.userData.opacityScale = w.opacity;
  lines.material.userData.pulseScale = w.pulseScale;

  // Bright cyan dots where lines meet (huge look radius = colour from rampShift alone).
  const positions = Float32Array.from(pts.flat());
  const dots = createNodePoints(
    { positions, count: n },
    { adjacency },
    cfg,
    { radius: 1e9, rampShift: 0.4, brightness: w.dotBrightness },
    rng,
    uniforms,
  );

  const group = new THREE.Group();
  group.add(lines, dots);
  return { group, lines, dots, edgeCount: edges.length };
}
