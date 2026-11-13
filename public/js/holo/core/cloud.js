import * as THREE from 'three';
import { generateNodes } from './nodes.js';
import { buildKnnGraph } from './graph.js';
import { createFilaments } from './filaments.js';
import { createNodePoints } from './nodePoints.js';

// One self-contained filament cloud (nodes + kNN network + junction points), centred on
// its local origin. Used for the main mass and for each satellite fragment.
// shape: see generateNodes. look: { radius, rampShift, brightness }.
// bend: optional (x, y, z, out) warp applied to the finished geometry (see satellites).
export function buildCloud(shape, look, cfg, rng, uniforms, bend = null) {
  const nodes = generateNodes(shape, rng);
  const R = shape.radius;
  const meanSpacing = Math.cbrt(((4 / 3) * Math.PI * R * R * R) / nodes.count);
  const graph = buildKnnGraph(
    nodes.positions,
    nodes.count,
    cfg.network.kMin,
    cfg.network.kMax,
    cfg.network.maxEdgeFactor * meanSpacing,
    rng,
  );

  const filaments = createFilaments(nodes, graph, cfg, look, rng, uniforms, bend);
  const nodePoints = createNodePoints(nodes, graph, cfg, look, rng, uniforms, bend);
  const group = new THREE.Group();
  group.add(filaments, nodePoints);

  return { group, nodes, graph, filaments, nodePoints };
}
