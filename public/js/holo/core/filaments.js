import * as THREE from 'three';
import { rampColor } from './palette.js';
import { CORE_VERTEX_HEADER } from '../shaders/common.js';

// Shared additive 1px line material: per-vertex colour with a per-filament shimmer, plus
// energy pulses that run along each filament (aT = 0..1 along it) and, where enabled,
// whole-filament flashes like a lightning strike.
export function createFilamentMaterial(net, uniforms, opacity = net.opacity) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...uniforms,
      uOpacity: { value: opacity },
      uFlickerAmount: { value: net.flickerAmount },
      uFlickerSpeed: { value: net.flickerSpeed },
      uPulseAmount: { value: net.pulseAmount },
      uPulseSpeed: { value: net.pulseSpeed },
      uPulseWidth: { value: net.pulseWidth },
      uPulseFraction: { value: net.pulseFraction },
      uFlashAmount: { value: 0 },
      uFlashRate: { value: 0 },
    },
    vertexShader: /* glsl */ `
      ${CORE_VERTEX_HEADER}
      attribute vec3 aColor;
      attribute float aSeed;
      attribute float aT;
      uniform float uFlickerAmount;
      uniform float uFlickerSpeed;
      varying vec3 vColor;
      varying float vSeed;
      varying float vT;
      void main() {
        vec3 p = displace(position);
        float shimmer = 0.5 + 0.5 * sin(uTime * uFlickerSpeed * (0.5 + aSeed) + aSeed * 61.0);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vColor = aColor * (1.0 - uFlickerAmount * shimmer) * depthCue(mv);
        vSeed = aSeed;
        vT = aT;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uOpacity;
      uniform float uIntensity;
      uniform float uPulseAmount;
      uniform float uPulseSpeed;
      uniform float uPulseWidth;
      uniform float uPulseFraction;
      uniform float uFlashAmount;
      uniform float uFlashRate;
      varying vec3 vColor;
      varying float vSeed;
      varying float vT;
      float hash(float n) { return fract(sin(n) * 43758.5453); }
      void main() {
        // Each cycle a random subset of filaments carries one pulse from end to end.
        float cycle = uTime * uPulseSpeed * (0.5 + vSeed) + vSeed * 17.0;
        float on = step(1.0 - uPulseFraction, hash(floor(cycle) * 12.9898 + vSeed * 78.233));
        float d = (vT - (fract(cycle) * 1.4 - 0.2)) / uPulseWidth;
        float pulse = on * exp(-d * d);
        // Rare, sharp whole-filament flash that decays quickly.
        float fc = uTime * uFlashRate + vSeed * 31.0;
        float flash = step(0.88, hash(floor(fc) * 7.13 + vSeed * 19.1)) * pow(1.0 - fract(fc), 6.0);
        float peak = max(vColor.r, max(vColor.g, vColor.b));
        vec3 col = mix(vColor, vec3(peak), min(1.0, pulse * 0.7));
        col *= 1.0 + uPulseAmount * pulse + uFlashAmount * flash;
        gl_FragColor = vec4(col * uIntensity, uOpacity);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

// Colour for a point at distance `dist` from its cloud's centre.
// look: { radius, rampShift, brightness } -- rampShift > 0 skips the hot-white end (satellites).
export function cloudColor(dist, look, ramp, out) {
  return rampColor(look.rampShift + dist / look.radius, ramp, out).multiplyScalar(look.brightness);
}

function buildLineSegments(pos, col, seed, along, material) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  geometry.setAttribute('aT', new THREE.BufferAttribute(along, 1));
  const lines = new THREE.LineSegments(geometry, material);
  lines.frustumCulled = false;
  return lines;
}

// One merged LineSegments for a cloud's whole kNN network. Each edge is split into a few
// bowed, jittered sub-segments so the bulk reads as lightning, not a wireframe.
// bend(x, y, z, out): optional final warp; colour is still taken from the local position.
export function createFilaments(nodes, graph, cfg, look, rng, uniforms, bend = null) {
  const net = cfg.network;
  const S = Math.max(1, net.subdivisions);
  const { positions } = nodes;
  const { edges, edgeCount } = graph;

  const vertCount = edgeCount * S * 2;
  const pos = new Float32Array(vertCount * 3);
  const col = new Float32Array(vertCount * 3);
  const seed = new Float32Array(vertCount);
  const along = new Float32Array(vertCount);

  const pts = new Float32Array((S + 1) * 3);
  const c = new THREE.Color();
  const tmp = [0, 0, 0];
  const bent = [0, 0, 0];
  let v = 0;

  for (let e = 0; e < edgeCount; e++) {
    const a = edges[e * 2];
    const b = edges[e * 2 + 1];
    const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2];
    const bx = positions[b * 3], by = positions[b * 3 + 1], bz = positions[b * 3 + 2];
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dy, dz);

    // Random perpendicular for the bow: cross(edgeDir, randomDir).
    rng.unitVector(tmp);
    let px = dy * tmp[2] - dz * tmp[1];
    let py = dz * tmp[0] - dx * tmp[2];
    let pz = dx * tmp[1] - dy * tmp[0];
    const pl = Math.hypot(px, py, pz) || 1;
    const bow = rng.range(-1, 1) * net.curvature * len;
    px = (px / pl) * bow; py = (py / pl) * bow; pz = (pz / pl) * bow;

    for (let s = 0; s <= S; s++) {
      const t = s / S;
      const arc = 4 * t * (1 - t);
      let x = ax + dx * t + px * arc;
      let y = ay + dy * t + py * arc;
      let z = az + dz * t + pz * arc;
      if (s > 0 && s < S) {
        rng.unitVector(tmp);
        const j = net.jitter * len * rng.next();
        x += tmp[0] * j; y += tmp[1] * j; z += tmp[2] * j;
      }
      pts[s * 3] = x; pts[s * 3 + 1] = y; pts[s * 3 + 2] = z;
    }

    const bright = rng.range(net.brightnessMin, net.brightnessMax);
    const edgeSeed = rng.next();

    for (let s = 0; s < S; s++) {
      for (let end = 0; end < 2; end++) {
        const p = (s + end) * 3;
        let x = pts[p], y = pts[p + 1], z = pts[p + 2];
        cloudColor(Math.hypot(x, y, z), look, cfg.colorRamp, c).multiplyScalar(bright);
        if (bend) {
          bend(x, y, z, bent);
          [x, y, z] = bent;
        }
        pos[v * 3] = x; pos[v * 3 + 1] = y; pos[v * 3 + 2] = z;
        col[v * 3] = c.r; col[v * 3 + 1] = c.g; col[v * 3 + 2] = c.b;
        seed[v] = edgeSeed;
        along[v] = (s + end) / S;
        v++;
      }
    }
  }

  return buildLineSegments(pos, col, seed, along, createFilamentMaterial(net, uniforms));
}

// Arbitrary polylines (e.g. lightning strands) as one LineSegments.
// paths: [{ points: Float32Array xyz..., colors: Float32Array rgb... }]
export function createPolylines(paths, net, uniforms, opacity, rng) {
  let segs = 0;
  for (const p of paths) segs += p.points.length / 3 - 1;
  const pos = new Float32Array(segs * 6);
  const col = new Float32Array(segs * 6);
  const seed = new Float32Array(segs * 2);
  const along = new Float32Array(segs * 2);
  let v = 0;
  for (const p of paths) {
    const n = p.points.length / 3;
    const s = rng.next();
    for (let i = 0; i < n - 1; i++) {
      for (let end = 0; end < 2; end++) {
        const k = (i + end) * 3;
        pos.set(p.points.subarray(k, k + 3), v * 3);
        col.set(p.colors.subarray(k, k + 3), v * 3);
        seed[v] = s;
        along[v] = (i + end) / (n - 1);
        v++;
      }
    }
  }
  return buildLineSegments(pos, col, seed, along, createFilamentMaterial(net, uniforms, opacity));
}
