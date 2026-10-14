// lib/claw-motion.js — smooth, curvy, slightly random mouse paths for Claw
// ═══════════════════════════════════════════════════════════════════
//
// A move from A to B never goes in a straight line: it picks one of a few
// shapes (an arc, an S, a wave, a little loop, an overshoot, a spiral into
// the target), eases in and out, and wobbles a touch.
//
// A path is NORMALISED: a frame where the start is (0,0) and the target is
// (1,0). Each point is [a, b, w]: `a` along the line, `b` across it (both in
// units of the distance), `w` the share of the move's time (0 → 1). That way
// the relay's PowerShell side can read the cursor itself and place the path
// without a second round trip: x = fx + a·dx − b·dy, y = fy + a·dy + b·dx.
// applyPath() below is the same sum, for Linux and the tests.
// ═══════════════════════════════════════════════════════════════════

export const STYLES = ["arc", "scurve", "wave", "curl", "overshoot", "spiral"];
export const PATH_POINTS = 90;

// Duration = (BASE + PER_DOUBLING·log2(1 + dist/SCALE)) / speedFactor ms.
// Fitts-like: long moves take longer, but not proportionally longer.
export const DURATION = { base: 220, perDoubling: 140, scale: 40, min: 40 };

/** 1× (slow, showy) … 10× (snappy). The Claw panel's "Mouse speed" slider. */
export const speedFactor = (speed = 1) => 1 + (Math.min(10, Math.max(1, Number(speed) || 1)) - 1) * 0.6;

export function moveDurationMs(dist, speed = 1) {
  const { base, perDoubling, scale, min } = DURATION;
  return Math.max(min, Math.round((base + perDoubling * Math.log2(1 + Math.abs(dist) / scale)) / speedFactor(speed)));
}

/** Small seeded RNG (mulberry32) so a path can be replayed in tests. */
export function rng(seed = Math.floor(Math.random() * 2 ** 32)) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const lerp = (a, b, t) => a + (b - a) * t;
const smoother = (t) => t * t * t * (t * (t * 6 - 15) + 10);
function bezier(p0, p1, p2, p3, t) {
  const u = 1 - t;
  return [
    u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
    u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
  ];
}

/**
 * One normalised path. `style` is picked at random unless given.
 * @returns {{ style: string, pts: Array<[number, number, number]> }}
 */
export function mousePath({ seed, style } = {}) {
  const r = rng(seed);
  const pick = (lo, hi) => lerp(lo, hi, r());
  const side = r() < 0.5 ? -1 : 1;
  style = STYLES.includes(style) ? style : STYLES[Math.floor(r() * STYLES.length)];

  // The gentle arc every style starts from.
  const h1 = side * pick(0.06, 0.28);
  const h2 = (style === "scurve" ? -1 : 1) * side * pick(0.06, 0.28);
  const c1 = [pick(0.2, 0.4), h1];
  const c2 = [pick(0.6, 0.8), h2];
  const base = (s) => bezier([0, 0], c1, c2, [1, 0], s);

  // Style extras.
  const waves = 2 + Math.floor(r() * 3);
  const waveAmp = pick(0.025, 0.07);
  const loopAt = pick(0.35, 0.6);
  const loopW = pick(0.18, 0.28);
  const loopR = pick(0.045, 0.08);
  const over = [1 + pick(0.04, 0.12), side * pick(-0.05, 0.05)];
  const spiralR = pick(0.05, 0.1);
  const spiralTurns = 1.5 + r() * 1.5;

  const shape = (s) => {
    switch (style) {
      case "wave": {
        const [a, b] = base(s);
        return [a, b * 0.4 + waveAmp * Math.sin(waves * Math.PI * s) * Math.sin(Math.PI * s)];
      }
      case "curl": {
        const [a, b] = base(s);
        const v = (s - (loopAt - loopW / 2)) / loopW;
        if (v <= 0 || v >= 1) return [a, b];
        // A full circle that starts and ends where it joined the arc: the
        // along-axis part runs backwards for a moment, which is the loop.
        const th = 2 * Math.PI * v;
        return [a + loopR * Math.sin(th), b + side * loopR * (1 - Math.cos(th))];
      }
      case "overshoot": {
        const k = 0.82;
        if (s < k) return bezier([0, 0], c1, [c2[0] + 0.1, c2[1]], over, s / k);
        const t = smoother((s - k) / (1 - k));
        return [lerp(over[0], 1, t), lerp(over[1], 0, t)];
      }
      case "spiral": {
        const [a, b] = base(s);
        const v = (s - 0.55) / 0.45;
        if (v <= 0) return [a, b];
        const env = Math.sin(Math.PI * v) * (1 - v);
        const ph = 2 * Math.PI * spiralTurns * v;
        return [a + spiralR * env * Math.cos(ph) - spiralR * env, b + side * spiralR * env * Math.sin(ph)];
      }
      default:
        return base(s);
    }
  };

  // Time → progress: a touch lopsided (people speed up and slow down
  // differently), then eased at both ends.
  const skew = pick(0.85, 1.18);
  const jitter = pick(0.001, 0.004);
  const pts = [];
  for (let i = 0; i < PATH_POINTS; i++) {
    const w = i / (PATH_POINTS - 1);
    const s = smoother(Math.pow(w, skew));
    let [a, b] = shape(s);
    const wobble = Math.sin(Math.PI * s); // none at either end
    a += (r() - 0.5) * jitter * wobble;
    b += (r() - 0.5) * jitter * wobble;
    pts.push([a, b, w]);
  }
  pts[0] = [0, 0, 0];
  pts[PATH_POINTS - 1] = [1, 0, 1];
  return { style, pts };
}

/** The compact form the relay hands to PowerShell: "a,b,w;a,b,w;…". */
export const encodePath = (path) => path.pts.map((p) => p.map((n) => +n.toFixed(5)).join(",")).join(";");

/**
 * Screen points for a path from `from` to `to`: [[x, y, ms], …], integers,
 * consecutive repeats dropped, ending exactly on `to`.
 */
export function applyPath(path, from, to, speed = 1) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 3) return [[Math.round(to.x), Math.round(to.y), 0]];
  const ms = moveDurationMs(dist, speed);
  const out = [];
  for (const [a, b, w] of path.pts) {
    const x = Math.round(from.x + a * dx - b * dy);
    const y = Math.round(from.y + a * dy + b * dx);
    const last = out[out.length - 1];
    if (last && last[0] === x && last[1] === y) {
      if (w === 1) last[2] = ms; // eased right up to the target already: arrive on time
      continue;
    }
    out.push([x, y, Math.round(w * ms)]);
  }
  const end = out[out.length - 1];
  if (end[0] !== Math.round(to.x) || end[1] !== Math.round(to.y)) out.push([Math.round(to.x), Math.round(to.y), ms]);
  return out;
}
