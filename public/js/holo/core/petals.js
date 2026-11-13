import * as THREE from 'three';
import { createNoise3D } from 'simplex-noise';
import { PALETTE } from '../config.js';
import { cloudColor, createPolylines } from './filaments.js';
import { CORE_VERTEX_HEADER } from '../shaders/common.js';

// The inner "bloom": layered, crumpled, translucent membranes around the core, like
// folded cellophane. Each petal is a ragged spherical cap, noise-crumpled along its normal.
// Faces are nearly invisible; fresnel lights the folds and a rim lights the petal edges,
// plus a crisp 1px outline traces each petal's border.
export function createPetals(cfg, rng, uniforms) {
  const p = cfg.petals;
  const R = cfg.mass.radius;
  const noise = createNoise3D(rng.next);
  const rings = p.rings;
  const spokes = p.spokes;
  const perPetal = (rings + 1) * spokes;

  const pos = new Float32Array(p.count * perPetal * 3);
  const rho = new Float32Array(p.count * perPetal);
  const seedAttr = new Float32Array(p.count * perPetal);
  const index = [];
  const outlines = [];
  const c = new THREE.Color();

  const dir = new THREE.Vector3();
  const t1 = new THREE.Vector3();
  const t2 = new THREE.Vector3();
  const v = new THREE.Vector3();
  const helper = new THREE.Vector3();

  for (let i = 0; i < p.count; i++) {
    const d = rng.unitVector([0, 0, 0]);
    dir.set(d[0], d[1], d[2]);
    helper.set(Math.abs(dir.y) < 0.9 ? 0 : 1, Math.abs(dir.y) < 0.9 ? 1 : 0, 0);
    t1.crossVectors(dir, helper).normalize();
    t2.crossVectors(dir, t1);

    const shell = R * rng.range(p.radiusMin, p.radiusMax);
    const extent = rng.range(p.extentMin, p.extentMax);
    const seed = rng.range(0, 100);
    const petalSeed = rng.next();
    const base = i * perPetal;
    const outline = new Float32Array((spokes + 1) * 3);
    const outlineCol = new Float32Array((spokes + 1) * 3);

    for (let j = 0; j <= rings; j++) {
      const r01 = j / rings;
      for (let k = 0; k < spokes; k++) {
        const a = (k / spokes) * Math.PI * 2;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        // Ragged petal outline.
        const edge = 1 + p.raggedness * noise(ca * 1.3 + seed, sa * 1.3, seed * 0.37);
        const ang = r01 * extent * edge;
        // Rotate dir toward the spoke direction by `ang` -> point on the sphere.
        v.copy(dir).multiplyScalar(Math.cos(ang)).addScaledVector(t1, ca * Math.sin(ang)).addScaledVector(t2, sa * Math.sin(ang));
        // Edges flare outward; crumple along the normal, more toward the rim.
        const radius = shell * (1 + p.curl * r01 * r01);
        const fx = v.x * radius, fy = v.y * radius, fz = v.z * radius;
        const f = p.crumpleFreq / R;
        const crumple = noise(fx * f + seed, fy * f, fz * f) * 0.85 + noise(fx * f * 1.9, fy * f * 1.9 + seed, fz * f * 1.9) * 0.15;
        const disp = crumple * p.crumple * R * (0.25 + 0.75 * r01);
        const vi = base + j * spokes + k;
        pos[vi * 3] = fx + v.x * disp;
        pos[vi * 3 + 1] = fy + v.y * disp;
        pos[vi * 3 + 2] = fz + v.z * disp;
        rho[vi] = r01;
        seedAttr[vi] = petalSeed;

        if (j === rings) {
          outline.set(pos.subarray(vi * 3, vi * 3 + 3), k * 3);
          cloudColor(0, { radius: 1, rampShift: 0.03 + 0.12 * rng.next(), brightness: p.outlineBrightness }, cfg.colorRamp, c);
          outlineCol[k * 3] = c.r; outlineCol[k * 3 + 1] = c.g; outlineCol[k * 3 + 2] = c.b;
        }
      }
    }
    // Close the outline loop.
    outline.set(outline.subarray(0, 3), spokes * 3);
    outlineCol.set(outlineCol.subarray(0, 3), spokes * 3);
    outlines.push({ points: outline, colors: outlineCol });

    for (let j = 0; j < rings; j++) {
      for (let k = 0; k < spokes; k++) {
        const k2 = (k + 1) % spokes;
        const a = base + j * spokes + k;
        const b = base + j * spokes + k2;
        const cc = base + (j + 1) * spokes + k;
        const dd = base + (j + 1) * spokes + k2;
        index.push(a, cc, b, b, cc, dd);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute('aRho', new THREE.BufferAttribute(rho, 1));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seedAttr, 1));
  geometry.setIndex(index);
  geometry.computeVertexNormals();

  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...uniforms,
      uRadius: { value: R },
      uHot: { value: new THREE.Color(PALETTE.hot) },
      uCyan: { value: new THREE.Color(PALETTE.cyan) },
      uElectric: { value: new THREE.Color(PALETTE.electric) },
      uFace: { value: p.faceOpacity },
      uFresnel: { value: p.fresnel },
      uFresnelPower: { value: p.fresnelPower },
      uRim: { value: p.rim },
      uRimStart: { value: p.rimStart },
    },
    vertexShader: /* glsl */ `
      ${CORE_VERTEX_HEADER}
      attribute float aRho;
      attribute float aSeed;
      uniform float uRadius;
      varying vec3 vNormal;
      varying vec3 vView;
      varying float vRho;
      varying float vRad;
      varying float vSeed;
      varying float vDepth;
      void main() {
        vec3 p = displace(position);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vView = normalize(-mv.xyz);
        vRho = aRho;
        vRad = length(position) / uRadius;
        vSeed = aSeed;
        vDepth = depthCue(mv);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uIntensity;
      uniform vec3 uHot;
      uniform vec3 uCyan;
      uniform vec3 uElectric;
      uniform float uFace;
      uniform float uFresnel;
      uniform float uFresnelPower;
      uniform float uRim;
      uniform float uRimStart;
      varying vec3 vNormal;
      varying vec3 vView;
      varying float vRho;
      varying float vRad;
      varying float vSeed;
      varying float vDepth;
      void main() {
        float facing = abs(dot(normalize(vNormal), normalize(vView)));
        float fres = pow(1.0 - facing, uFresnelPower);
        float rim = smoothstep(uRimStart, 1.0, vRho);
        vec3 col = mix(uHot, uCyan, smoothstep(0.1, 0.45, vRad));
        col = mix(col, uElectric, smoothstep(0.5, 0.8, vRad) * 0.6);
        // Edge-on folds catch the light white-hot, like crumpled cellophane.
        col = mix(col, uHot, fres * 0.7);
        float shimmer = 0.85 + 0.15 * sin(uTime * 1.3 + vSeed * 40.0);
        float a = (uFace + fres * uFresnel + rim * uRim) * shimmer;
        gl_FragColor = vec4(col * uIntensity * vDepth, a);
      }
    `,
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;

  const outlineLines = createPolylines(outlines, cfg.network, uniforms, cfg.network.opacity * p.outlineOpacity, rng);
  outlineLines.material.userData.opacityScale = p.outlineOpacity;

  const group = new THREE.Group();
  group.add(mesh, outlineLines);
  return { group, mesh, outlineLines };
}
