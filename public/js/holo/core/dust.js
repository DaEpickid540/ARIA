import * as THREE from 'three';
import { cloudColor } from './filaments.js';
import { CORE_VERTEX_HEADER } from '../shaders/common.js';

// Bright cyan-white glints scattered through the hologram, each wandering a little and
// twinkling fully on and off; a few "hero" glints flare much brighter.
// sources: optional Float32Array of xyz points to scatter around (e.g. a cloud's nodes);
// without it, glints fill a loose shell between radiusMin and radiusMax.
export function createDust(cfg, rng, uniforms, count, sources = null) {
  const d = cfg.dust;
  const R = cfg.mass.radius;
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const size = new Float32Array(count);
  const seed = new Float32Array(count);
  const dir = [0, 0, 0];
  const c = new THREE.Color();

  for (let i = 0; i < count; i++) {
    rng.unitVector(dir);
    if (sources) {
      const k = Math.floor(rng.next() * (sources.length / 3)) * 3;
      const j = d.jitter * R * rng.next();
      pos.set([sources[k] + dir[0] * j, sources[k + 1] + dir[1] * j, sources[k + 2] + dir[2] * j], i * 3);
    } else {
      const r = R * rng.range(d.radiusMin, d.radiusMax);
      pos.set([dir[0] * r, dir[1] * r, dir[2] * r], i * 3);
    }
    const hero = rng.next() < d.heroFraction;
    cloudColor(0, { radius: 1, rampShift: rng.range(0, 0.35), brightness: d.brightness * rng.range(0.5, 1.2) * (hero ? 3 : 1) }, cfg.colorRamp, c);
    col.set([c.r, c.g, c.b], i * 3);
    size[i] = rng.range(0.7, 1.2) * (hero ? 1.6 : 1);
    seed[i] = rng.next();
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));

  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...uniforms,
      uSize: { value: d.size },
      uOpacity: { value: d.opacity },
      uDrift: { value: d.drift * R },
      uDriftSpeed: { value: d.driftSpeed },
      uTwinkleSpeed: { value: d.twinkleSpeed },
    },
    vertexShader: /* glsl */ `
      ${CORE_VERTEX_HEADER}
      attribute vec3 aColor;
      attribute float aSize;
      attribute float aSeed;
      uniform float uSize;
      uniform float uPixelRatio;
      uniform float uDrift;
      uniform float uDriftSpeed;
      uniform float uTwinkleSpeed;
      varying vec3 vColor;
      void main() {
        float t = uTime * uDriftSpeed * (0.6 + aSeed);
        vec3 wander = vec3(sin(t + aSeed * 40.0), sin(t * 0.8 + aSeed * 23.0), sin(t * 1.3 + aSeed * 11.0));
        vec4 mv = modelViewMatrix * vec4(displace(position) + wander * uDrift, 1.0);
        gl_Position = projectionMatrix * mv;
        float tw = 0.5 + 0.5 * sin(uTime * uTwinkleSpeed * (0.5 + aSeed * 2.0) + aSeed * 60.0);
        vColor = aColor * tw * tw * tw * depthCue(mv);
        gl_PointSize = max(1.5 * uPixelRatio, uSize * aSize * uPixelRatio * (3.0 / -mv.z));
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uOpacity;
      uniform float uIntensity;
      varying vec3 vColor;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float halo = smoothstep(0.5, 0.0, d);
        float core = smoothstep(0.18, 0.0, d);
        gl_FragColor = vec4(vColor * uIntensity, (halo * halo * 0.5 + core) * uOpacity);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  material.userData.ownMaterial = true;

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  return { group: points, points, material };
}
