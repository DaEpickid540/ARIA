import * as THREE from 'three';
import { cloudColor } from './filaments.js';
import { CORE_VERTEX_HEADER } from '../shaders/common.js';

// Soft glowing points at every node: the junctions where filaments meet.
export function createNodePoints(nodes, graph, cfg, look, rng, uniforms, bend = null) {
  const { positions, count } = nodes;
  const col = new Float32Array(count * 3);
  const size = new Float32Array(count);
  const seed = new Float32Array(count);
  const c = new THREE.Color();

  for (let i = 0; i < count; i++) {
    const r = Math.hypot(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
    cloudColor(r, look, cfg.colorRamp, c);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    // Well-connected nodes read as bigger junctions.
    const degree = graph.adjacency[i].length;
    size[i] = (0.6 + 0.12 * degree) * rng.range(0.6, 1.4);
    seed[i] = rng.next();
  }

  let finalPositions = positions;
  if (bend) {
    finalPositions = new Float32Array(positions.length);
    const out = [0, 0, 0];
    for (let i = 0; i < count; i++) {
      bend(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2], out);
      finalPositions.set(out, i * 3);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(finalPositions, 3));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));

  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...uniforms,
      uSize: { value: cfg.nodes.size },
      uOpacity: { value: cfg.nodes.opacity },
      uTwinkleSpeed: { value: cfg.nodes.twinkleSpeed },
    },
    vertexShader: /* glsl */ `
      ${CORE_VERTEX_HEADER}
      attribute vec3 aColor;
      attribute float aSize;
      attribute float aSeed;
      uniform float uSize;
      uniform float uPixelRatio;
      uniform float uTwinkleSpeed;
      varying vec3 vColor;
      void main() {
        vec3 p = displace(position);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float tw = 0.55 + 0.45 * sin(uTime * uTwinkleSpeed * (0.7 + aSeed * 2.0) + aSeed * 40.0);
        vColor = aColor * tw * depthCue(mv);
        gl_PointSize = uSize * aSize * uPixelRatio * (3.0 / -mv.z);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uOpacity;
      uniform float uIntensity;
      varying vec3 vColor;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(vColor * uIntensity, a * a * uOpacity);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  return points;
}
