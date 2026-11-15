import * as THREE from 'three';
import { createRng } from './rng.js';
import { buildCloud } from './cloud.js';
import { createSatellites } from './satellites.js';
import { createPetals } from './petals.js';
import { createWeb } from './web.js';
import { createVeins, createFlare } from './veins.js';
import { createDust } from './dust.js';

// Builds every layer of the hologram from config. All geometry is created here once;
// per-frame motion happens in shaders via the shared uniforms, plus a few transforms.
export function buildCore(cfg, uniforms) {
  const t0 = performance.now();
  // Each layer draws from its own random stream, so retuning one layer (say, the petal
  // count) doesn't reshuffle the others. The fragment layout has its own seed.
  const rng = createRng(cfg.seed);
  const layerRng = (n) => createRng(cfg.seed * 7919 + n);
  const root = new THREE.Group();

  // Main mass: rotates on its own.
  const mass = buildCloud(
    { count: cfg.nodes.count, ...cfg.mass },
    { radius: cfg.mass.radius, rampShift: 0, brightness: 1 },
    cfg,
    rng,
    uniforms,
  );
  root.add(mass.group);

  // Crumpled membrane petals at the heart of the mass; they spin with it.
  const petals = createPetals(cfg, layerRng(1), uniforms);
  mass.group.add(petals.group);

  // Lightning veins crackling out from the centre, plus the white-hot centre flare.
  const veins = createVeins(cfg, layerRng(2), uniforms);
  mass.group.add(veins.group);
  const flare = createFlare(cfg, layerRng(3), uniforms);
  root.add(flare.group);

  // Satellite fragments: orbit independently, slower than the mass spins.
  const satellites = createSatellites(cfg, createRng(cfg.satellites.seed), uniforms);
  root.add(satellites.group);

  // Straight-line plexus tying the fragments and core together; orbits with the fragments.
  const web = createWeb(cfg, layerRng(5), uniforms, satellites.anchors);
  satellites.spinner.add(web.group);

  // Glints: mostly scattered through the fragments and over the core, a few loose ones.
  const d = cfg.dust;
  const dustRng = layerRng(4);
  const dust = {
    core: createDust(cfg, dustRng, uniforms, Math.round(d.count * d.coreShare), mass.nodes.positions),
    fragments: createDust(cfg, dustRng, uniforms, Math.round(d.count * d.fragmentShare), satellites.samplePoints),
    loose: createDust(cfg, dustRng, uniforms, Math.round(d.count * (1 - d.coreShare - d.fragmentShare))),
  };
  mass.group.add(dust.core.group);
  satellites.spinner.add(dust.fragments.group);
  root.add(dust.loose.group);
  dust.materials = [dust.core.material, dust.fragments.material, dust.loose.material];

  // Every line / point material, so the GUI can retune them all at once.
  // Line layers carry an opacityScale relative to network.opacity.
  const lineMaterials = [];
  const pointMaterials = [];
  root.traverse((o) => {
    if (o.material?.userData.ownMaterial) return; // tuned separately (e.g. dust)
    if (o.isLineSegments) {
      lineMaterials.push(o.material);
      o.material.uniforms.uOpacity.value = cfg.network.opacity * (o.material.userData.opacityScale ?? 1);
      o.material.uniforms.uPulseAmount.value = cfg.network.pulseAmount * (o.material.userData.pulseScale ?? 1);
    } else if (o.isPoints) pointMaterials.push(o.material);
  });

  const count = (type) => {
    let n = 0;
    root.traverse((o) => { if (o[type]) n += o.geometry.attributes.position.count; });
    return n;
  };

  const stats = {
    massNodes: mass.nodes.count,
    massEdges: mass.graph.edgeCount,
    satellites: satellites.items.length,
    lineVertices: count('isLineSegments'),
    points: count('isPoints'),
    buildMs: Math.round(performance.now() - t0),
  };

  let rotation = 0;

  return {
    group: root,
    mass,
    petals,
    veins,
    flare,
    dust,
    satellites,
    web,
    lineMaterials,
    pointMaterials,
    stats,
    update(dt, time) {
      rotation += (dt * Math.PI * 2) / cfg.mass.rotationPeriod;
      mass.group.rotation.y = rotation;
      satellites.update(dt, time);
      flare.update(time);
    },
    dispose() {
      root.traverse((o) => {
        o.geometry?.dispose();
        o.material?.dispose();
      });
      flare.dispose();
    },
  };
}
