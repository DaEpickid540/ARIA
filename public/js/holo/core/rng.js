// Seeded PRNG (mulberry32) plus helpers, so a given seed always builds the same mass.

export function createRng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    range: (min, max) => min + (max - min) * next(),
    int: (min, max) => Math.floor(min + (max - min + 1) * next()),
    // Uniform direction on the unit sphere, written into out[0..2].
    unitVector(out) {
      const z = next() * 2 - 1;
      const phi = next() * Math.PI * 2;
      const s = Math.sqrt(1 - z * z);
      out[0] = s * Math.cos(phi);
      out[1] = s * Math.sin(phi);
      out[2] = z;
      return out;
    },
  };
}
