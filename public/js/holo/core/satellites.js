import * as THREE from 'three';
import { buildCloud } from './cloud.js';
import { cloudColor, createPolylines } from './filaments.js';

// Jagged path from a to b by recursive midpoint displacement. Returns flat xyz array.
export function lightningPath(a, b, depth, roughness, rng) {
  let pts = [a, b];
  const dir = [0, 0, 0];
  for (let d = 0; d < depth; d++) {
    const next = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i];
      const q = pts[i + 1];
      const len = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
      rng.unitVector(dir);
      const o = len * roughness;
      next.push([
        (p[0] + q[0]) / 2 + dir[0] * o,
        (p[1] + q[1]) / 2 + dir[1] * o,
        (p[2] + q[2]) / 2 + dir[2] * o,
      ]);
      next.push(q);
    }
    pts = next;
  }
  return pts;
}

// Wraps a fragment's local cloud onto a curved shell facing the core.
// Local x runs along the orbit, y up, z outward. The shell is a piece of a sphere whose
// centre sits between the core and the fragment, so the hollow side faces inward;
// a smaller bend radius curls the patch more tightly than its orbit. `lean` shears the
// outer part along the orbit, so every fragment sweeps the same way like pinwheel blades.
// `taper` makes one end of the blade reach further out than the other, and `flare` widens
// the blade toward its outer edge like a fan (size = local radius).
function makeShellBend(az, el, dist, bendRadius, stretch, vScale, thickness, lean, taper, flare, size) {
  const ce = Math.cos(el);
  const k = dist - bendRadius;
  const cx = ce * Math.cos(az) * k;
  const cy = Math.sin(el) * k;
  const cz = ce * Math.sin(az) * k;
  return (x, y, z, out) => {
    const depth = z * thickness * (1 + taper * Math.max(-1, Math.min(1, x / size)));
    const widen = 1 + flare * Math.max(-1, Math.min(1, z / size));
    const phi = az + (x * stretch * widen + depth * lean) / bendRadius;
    const theta = el + (y * vScale) / bendRadius;
    const r = bendRadius + depth;
    const ct = Math.cos(theta);
    out[0] = cx + r * ct * Math.cos(phi);
    out[1] = cy + r * Math.sin(theta);
    out[2] = cz + r * ct * Math.sin(phi);
  };
}

// "Data panel" fill for a shell: rows of short parallel dashes inside a ragged oval, laid
// out in the fragment's local x/z plane and pointing mostly outward (local z), so they fan
// away from the core once bent onto the shell.
function createDashField(radius, bend, cfg, rng, uniforms) {
  const s = cfg.satellites;
  const paths = [];
  const c = new THREE.Color();
  const theta = Math.PI / 2 + rng.range(-0.35, 0.35);
  const ct = Math.cos(theta);
  const st = Math.sin(theta);
  const ph1 = rng.range(0, 6.28);
  const ph2 = rng.range(0, 6.28);
  const a = [0, 0, 0];
  const b = [0, 0, 0];

  const push = (x0, y0, x1, y1, h) => {
    bend(x0 * ct - y0 * st, h, x0 * st + y0 * ct, a);
    bend(x1 * ct - y1 * st, h, x1 * st + y1 * ct, b);
    return Float32Array.of(...a, ...b);
  };

  for (let row = -radius; row <= radius; row += s.dashRowSpacing * radius) {
    const rowBright = rng.range(0.5, 1.2);
    let x = -radius * 1.2;
    while (x < radius * 1.2) {
      const len = rng.range(s.dashMin, s.dashMax) * radius;
      const gap = rng.range(s.gapMin, s.gapMax) * radius;
      const mx = x + len / 2;
      const ang = Math.atan2(row, mx);
      const edge = radius * (0.75 + 0.15 * Math.sin(3 * ang + ph1) + 0.1 * Math.sin(5 * ang + ph2));
      if (Math.hypot(mx, row) < edge && rng.next() < s.dashFill) {
        const h = rng.range(-1, 1) * radius * 0.3;
        cloudColor(0, { radius: 1, rampShift: rng.range(0.4, 0.8), brightness: rowBright * rng.range(0.6, 1.3) * s.dashBrightness }, cfg.colorRamp, c);
        const colors = Float32Array.of(c.r, c.g, c.b, c.r, c.g, c.b);
        paths.push({ points: push(x, row, x + len, row, h), colors });
        // A second, slightly offset line gives the dash some thickness.
        const off = s.dashThickness * radius;
        paths.push({ points: push(x, row + off, x + len, row + off, h), colors });
      }
      x += len + gap;
    }
  }

  const lines = createPolylines(paths, cfg.network, uniforms, cfg.network.opacity * s.dashOpacity, rng);
  lines.material.userData.opacityScale = s.dashOpacity;
  return lines;
}

// Small detached fragments floating around the main mass: curved shell pieces that wrap
// around the core, filled with data dashes and a little filament cloud, tied back to it
// by faint lightning strands. The whole set orbits slowly.
export function createSatellites(cfg, rng, uniforms) {
  const s = cfg.satellites;
  const R = cfg.mass.radius;
  const group = new THREE.Group();
  const items = [];
  const samples = [];
  const anchors = [];
  const strandPaths = [];
  const c = new THREE.Color();
  const look = { radius: 1, rampShift: s.rampShift, brightness: s.brightness };

  // Asymmetry: fragments drift from even spacing toward a few clusters, leaving gaps.
  let heroAz = 0;
  const clusterAz = Array.from({ length: Math.max(1, s.clusters) }, () => rng.range(0, Math.PI * 2));

  for (let i = 0; i < s.count; i++) {
    // Sizes skew small, with a couple of oversized "hero" panels.
    // The last few are small "outlier" chunks floating further out than the rest.
    const outlier = i >= s.count - s.outlierCount;
    const hero = i < s.heroCount ? s.heroScale : outlier ? s.outlierScale : 1;
    const radius = (s.radiusMin + (s.radiusMax - s.radiusMin) * Math.pow(rng.next(), s.sizeSkew)) * hero * R;
    const shape = {
      count: Math.round(rng.range(s.nodesMin, s.nodesMax)),
      radius,
      radialBias: s.radialBias,
      lumpAmp: s.lumpAmp,
      lumpFreq: cfg.mass.lumpFreq,
      warpAmp: cfg.mass.warpAmp,
      warpFreq: cfg.mass.warpFreq,
      strayFraction: s.strayFraction,
      strayReach: cfg.mass.strayReach,
    };

    // Spread evenly around the core with jitter, then bend into a shell facing inward.
    const step = (Math.PI * 2) / s.count;
    const evenAz = i * step + rng.range(-0.35, 0.35) * step;
    const clustered = clusterAz[i % clusterAz.length] + rng.range(-1, 1) * s.clusterSpread;
    const diff = Math.atan2(Math.sin(clustered - evenAz), Math.cos(clustered - evenAz));
    // The second hero sits roughly opposite the first, so the core stays centred in the
    // overall shape as the set orbits.
    let az = evenAz + diff * s.asymmetry;
    if (i === 0) heroAz = az;
    else if (i === 1 && s.heroCount > 1) az = heroAz + Math.PI * 0.92;
    const horiz = rng.range(s.distanceMin, s.distanceMax) * R * (outlier ? s.outlierDistance : 1);
    const y = rng.range(s.elevationMin, s.elevationMax) * R;
    const dist = Math.hypot(horiz, y);
    const el = Math.atan2(y, horiz);
    const bend = makeShellBend(
      az,
      el,
      dist,
      dist * s.bendRadius,
      rng.range(s.stretchMin, s.stretchMax),
      rng.range(s.flattenMin, s.flattenMax),
      rng.range(s.thicknessMin, s.thicknessMax),
      s.lean,
      s.taper * (rng.next() < 0.5 ? -1 : 1),
      s.flare,
      radius,
    );
    const cloud = buildCloud(shape, { ...look, radius }, cfg, rng, uniforms, bend);
    cloud.group.add(createDashField(radius, bend, cfg, rng, uniforms));

    // Pivot sits on the core, so tilting / swaying it slides the shell around the mass
    // while it keeps facing inward.
    const pivot = new THREE.Group();
    pivot.rotation.set(rng.range(-s.tiltMax, s.tiltMax), 0, rng.range(-s.tiltMax, s.tiltMax));
    pivot.add(cloud.group);
    group.add(pivot);

    items.push({ pivot, cloud, phase: rng.next() * Math.PI * 2 });

    // This fragment's node positions in the orbit frame, for the plexus and the glints.
    const local = cloud.nodePoints.geometry.attributes.position.array;
    const v = new THREE.Vector3();
    let tip = null;
    let inner = null;
    for (let k = 0; k < local.length; k += 3) {
      v.fromArray(local, k).applyEuler(pivot.rotation);
      samples.push(v.x, v.y, v.z);
      const d = v.length();
      if (!tip || d > tip[3]) tip = [v.x, v.y, v.z, d];
      if (!inner || d < inner[3]) inner = [v.x, v.y, v.z, d];
    }
    anchors.push(tip.slice(0, 3), inner.slice(0, 3));
    for (let k = 0; k < s.anchorsPerSatellite; k++) {
      const j = Math.floor(rng.next() * (local.length / 3)) * 3;
      v.fromArray(local, j).applyEuler(pivot.rotation);
      anchors.push([v.x, v.y, v.z]);
    }

    // Lightning strands from the mass surface out to this fragment.
    const target = new THREE.Vector3(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az))
      .multiplyScalar(dist)
      .applyEuler(pivot.rotation);
    const toward = target.clone().normalize();
    for (let k = 0; k < s.strandsPerSatellite; k++) {
      const start = toward.clone().multiplyScalar(R * rng.range(0.55, 0.9));
      start.x += rng.range(-0.15, 0.15) * R;
      start.y += rng.range(-0.15, 0.15) * R;
      start.z += rng.range(-0.15, 0.15) * R;
      const end = target.clone().addScaledVector(toward, -radius * 0.3);
      end.x += rng.range(-0.5, 0.5) * radius;
      end.y += rng.range(-0.4, 0.4) * radius;
      end.z += rng.range(-0.5, 0.5) * radius;
      addStrand(lightningPath(start.toArray(), end.toArray(), s.strandDepth, s.strandRoughness, rng));
    }
  }

  // Colour runs cyan at the core end to deep blue at the fragment, dimmest mid-span.
  function addStrand(pts) {
    const n = pts.length;
    const points = new Float32Array(n * 3);
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      points.set(pts[i], i * 3);
      cloudColor(0, { radius: 1, rampShift: 0.4 + 0.6 * t, brightness: 1 - 0.55 * Math.sin(Math.PI * t) }, cfg.colorRamp, c);
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    strandPaths.push({ points, colors });

    // Occasional short side branch, like a forked bolt.
    if (rng.next() < s.branchChance && n > 8) {
      const from = pts[Math.floor(rng.range(0.25, 0.75) * n)];
      const dir = rng.unitVector([0, 0, 0]);
      const len = rng.range(0.15, 0.35) * R;
      const to = [from[0] + dir[0] * len, from[1] + dir[1] * len * 0.5, from[2] + dir[2] * len];
      const bp = lightningPath(from, to, s.strandDepth - 2, s.strandRoughness, rng);
      const bpts = new Float32Array(bp.length * 3);
      const bcol = new Float32Array(bp.length * 3);
      for (let i = 0; i < bp.length; i++) {
        bpts.set(bp[i], i * 3);
        cloudColor(0, { radius: 1, rampShift: 0.7, brightness: 0.7 * (1 - i / bp.length) }, cfg.colorRamp, c);
        bcol[i * 3] = c.r; bcol[i * 3 + 1] = c.g; bcol[i * 3 + 2] = c.b;
      }
      strandPaths.push({ points: bpts, colors: bcol });
    }
  }

  const strands = createPolylines(strandPaths, cfg.network, uniforms, cfg.network.opacity * s.strandOpacity, rng);
  strands.material.userData.opacityScale = s.strandOpacity;
  strands.material.userData.pulseScale = s.strandPulseScale;
  group.add(strands);

  // The orbit plane leans toward the camera, so the fragments ring the core on screen
  // instead of bunching into an edge-on band. `group` spins inside it.
  const orbit = new THREE.Group();
  orbit.add(group);

  return {
    group: orbit,
    spinner: group,
    items,
    samplePoints: Float32Array.from(samples),
    anchors,
    strands,
    update(dt, time) {
      orbit.rotation.x = s.orbitTilt;
      group.rotation.y += (dt * Math.PI * 2) / s.orbitPeriod;
      for (const it of items) {
        it.pivot.position.y = Math.sin(time * s.bobSpeed + it.phase) * s.bobAmp * R;
        it.cloud.group.rotation.y = Math.sin(time * s.swaySpeed + it.phase * 1.7) * s.swayAmp;
      }
    },
  };
}
