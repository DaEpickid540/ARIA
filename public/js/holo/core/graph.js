// k-nearest-neighbour graph over the node cloud, using a uniform spatial hash grid
// (cell size = max edge length) so it builds in milliseconds instead of O(n^2).

export function buildKnnGraph(positions, count, kMin, kMax, maxDist, rng) {
  const cell = maxDist;
  const maxD2 = maxDist * maxDist;
  const OFF = 512;
  const key = (cx, cy, cz) => ((cx + OFF) * 1024 + (cy + OFF)) * 1024 + (cz + OFF);

  const grid = new Map();
  const cellOf = new Int32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const cx = Math.floor(positions[i * 3] / cell);
    const cy = Math.floor(positions[i * 3 + 1] / cell);
    const cz = Math.floor(positions[i * 3 + 2] / cell);
    cellOf[i * 3] = cx;
    cellOf[i * 3 + 1] = cy;
    cellOf[i * 3 + 2] = cz;
    const k = key(cx, cy, cz);
    let bucket = grid.get(k);
    if (!bucket) grid.set(k, (bucket = []));
    bucket.push(i);
  }

  const seen = new Set();
  const edges = [];
  const adjacency = Array.from({ length: count }, () => []);
  const bestIdx = new Int32Array(kMax);
  const bestD2 = new Float64Array(kMax);

  for (let i = 0; i < count; i++) {
    const k = rng.int(kMin, kMax);
    let found = 0;
    const px = positions[i * 3];
    const py = positions[i * 3 + 1];
    const pz = positions[i * 3 + 2];

    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          const bucket = grid.get(key(cellOf[i * 3] + dx, cellOf[i * 3 + 1] + dy, cellOf[i * 3 + 2] + dz));
          if (!bucket) continue;
          for (const j of bucket) {
            if (j === i) continue;
            const ex = positions[j * 3] - px;
            const ey = positions[j * 3 + 1] - py;
            const ez = positions[j * 3 + 2] - pz;
            const d2 = ex * ex + ey * ey + ez * ez;
            if (d2 > maxD2) continue;
            // Insertion into a tiny sorted list of the k best.
            if (found < k) {
              let s = found++;
              while (s > 0 && bestD2[s - 1] > d2) {
                bestD2[s] = bestD2[s - 1];
                bestIdx[s] = bestIdx[s - 1];
                s--;
              }
              bestD2[s] = d2;
              bestIdx[s] = j;
            } else if (d2 < bestD2[k - 1]) {
              let s = k - 1;
              while (s > 0 && bestD2[s - 1] > d2) {
                bestD2[s] = bestD2[s - 1];
                bestIdx[s] = bestIdx[s - 1];
                s--;
              }
              bestD2[s] = d2;
              bestIdx[s] = j;
            }
          }
        }

    for (let s = 0; s < found; s++) {
      const j = bestIdx[s];
      const a = Math.min(i, j);
      const b = Math.max(i, j);
      const id = a * count + b;
      if (seen.has(id)) continue;
      seen.add(id);
      edges.push(a, b);
      adjacency[a].push(b);
      adjacency[b].push(a);
    }
  }

  return { edges: Uint32Array.from(edges), edgeCount: edges.length / 2, adjacency };
}
