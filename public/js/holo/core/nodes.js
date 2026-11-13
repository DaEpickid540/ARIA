import { createNoise3D } from 'simplex-noise';

// Samples the node cloud: centre-heavy, lumpy outline, domain-warped interior,
// plus a few "stray" wisps poking out past the surface.
// `shape`: { count, radius, radialBias, lumpAmp, lumpFreq, warpAmp, warpFreq, strayFraction, strayReach }
export function generateNodes(shape, rng) {
  const { count } = shape;
  const m = shape;
  const R = m.radius;
  const noise = createNoise3D(rng.next);
  const positions = new Float32Array(count * 3);
  const dir = [0, 0, 0];

  // Outline radius in a given direction: 2-octave noise on the unit sphere.
  const boundary = (x, y, z) => {
    const f = m.lumpFreq;
    const n = 0.65 * noise(x * f, y * f, z * f) + 0.35 * noise(x * f * 2.1 + 5.2, y * f * 2.1, z * f * 2.1 - 3.7);
    const side = x * bias[0] + y * bias[1] + z * bias[2];
    return R * (1 + m.lumpAmp * n) * (1 + lopsided * side);
  };

  // Lopsided: the outline bulges toward one random direction and shrinks on the far side.
  const bias = rng.unitVector([0, 0, 0]);
  const lopsided = m.lopsided ?? 0;

  // A handful of outward directions the stray wisps cluster around.
  const wisps = [];
  for (let i = 0; i < 9; i++) wisps.push(rng.unitVector([0, 0, 0]));

  const strayCount = Math.floor(count * m.strayFraction);

  for (let i = 0; i < count; i++) {
    let r;
    if (i < strayCount) {
      // Jittered direction around one of the wisp axes, pushed past the surface.
      const w = wisps[i % wisps.length];
      rng.unitVector(dir);
      const spread = 0.28;
      dir[0] = w[0] + dir[0] * spread;
      dir[1] = w[1] + dir[1] * spread;
      dir[2] = w[2] + dir[2] * spread;
      const l = Math.hypot(dir[0], dir[1], dir[2]);
      dir[0] /= l; dir[1] /= l; dir[2] /= l;
      r = boundary(dir[0], dir[1], dir[2]) * (0.9 + Math.pow(rng.next(), 1.6) * m.strayReach);
    } else {
      rng.unitVector(dir);
      r = boundary(dir[0], dir[1], dir[2]) * Math.pow(rng.next(), m.radialBias);
    }

    let x = dir[0] * r;
    let y = dir[1] * r;
    let z = dir[2] * r;

    // Domain warp: bends straight radial structure into organic folds.
    const wf = m.warpFreq / R; // folds scale with the cloud, not the world
    const wa = m.warpAmp * R;
    const wx = noise(x * wf + 11.1, y * wf, z * wf);
    const wy = noise(x * wf, y * wf + 23.7, z * wf);
    const wz = noise(x * wf, y * wf, z * wf + 37.3);
    x += wx * wa;
    y += wy * wa;
    z += wz * wa;

    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
  }

  return { positions, count };
}
