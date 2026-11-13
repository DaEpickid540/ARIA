import * as THREE from 'three';
import { cloudColor, createPolylines } from './filaments.js';
import { lightningPath } from './satellites.js';
import { PALETTE } from '../config.js';

// '#rrggbb' + alpha -> a canvas colour, so the flare follows the palette.
const rgba = (hex, a) => `rgba(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)},${a})`;

// Crackling lightning veins radiating out from the centre: hot white at the root,
// cooling to cyan and fading toward the tips, with the odd forked branch.
export function createVeins(cfg, rng, uniforms) {
  const v = cfg.veins;
  const R = cfg.mass.radius;
  const paths = [];
  const c = new THREE.Color();
  const look = { radius: R, rampShift: 0, brightness: v.brightness };
  const dir = [0, 0, 0];

  const addPath = (pts, fadeFrom = 0, fadeScale = 1) => {
    const n = pts.length;
    const points = new Float32Array(n * 3);
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const t = fadeFrom + (1 - fadeFrom) * (i / (n - 1));
      points.set(pts[i], i * 3);
      cloudColor(Math.hypot(...pts[i]), look, cfg.colorRamp, c).multiplyScalar(fadeScale * (1 - 0.85 * t * t));
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    paths.push({ points, colors });
  };

  for (let i = 0; i < v.count; i++) {
    rng.unitVector(dir);
    const reach = rng.range(v.reachMin, v.reachMax) * R;
    const start = [dir[0] * 0.03 * R, dir[1] * 0.03 * R, dir[2] * 0.03 * R];
    const end = [dir[0] * reach, dir[1] * reach, dir[2] * reach];
    const pts = lightningPath(start, end, v.depth, v.roughness, rng);
    addPath(pts);

    // Forks peel off partway along and keep heading roughly outward.
    let forks = 0;
    while (forks < 2 && rng.next() < v.branchChance) {
      forks++;
      const at = Math.floor(rng.range(0.2, 0.7) * pts.length);
      const from = pts[at];
      const side = rng.unitVector([0, 0, 0]);
      const len = reach * rng.range(0.25, 0.5);
      const to = [
        from[0] + (dir[0] + side[0] * 0.8) * len,
        from[1] + (dir[1] + side[1] * 0.8) * len,
        from[2] + (dir[2] + side[2] * 0.8) * len,
      ];
      addPath(lightningPath(from, to, v.depth - 1, v.roughness, rng), at / pts.length, 0.8);
    }
  }

  const lines = createPolylines(paths, cfg.network, uniforms, cfg.network.opacity * v.opacity, rng);
  lines.material.userData.opacityScale = v.opacity;
  lines.material.userData.pulseScale = v.pulseScale;
  lines.material.uniforms.uFlashAmount.value = v.flashAmount;
  lines.material.uniforms.uFlashRate.value = v.flashRate;
  return { group: lines, lines };
}

// Camera-facing hotspot: a white-hot centre with a halo in the palette's mid tone and thin rays.
export function createFlare(cfg, rng, uniforms) {
  const f = cfg.flare;
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d');
  const h = size / 2;

  const halo = g.createRadialGradient(h, h, 0, h, h, h);
  halo.addColorStop(0, 'rgba(255,255,255,1)');
  halo.addColorStop(0.03, rgba(PALETTE.hot, 0.85));
  halo.addColorStop(0.12, rgba(PALETTE.cyan, 0.25));
  halo.addColorStop(0.4, rgba(PALETTE.electric, 0.05));
  halo.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = halo;
  g.fillRect(0, 0, size, size);

  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < f.rays; i++) {
    const a = rng.range(0, Math.PI * 2);
    const len = h * rng.range(0.4, 0.95);
    const ray = g.createLinearGradient(h, h, h + Math.cos(a) * len, h + Math.sin(a) * len);
    ray.addColorStop(0, rgba(PALETTE.hot, 0.55));
    ray.addColorStop(1, rgba(PALETTE.cyan, 0));
    g.strokeStyle = ray;
    g.lineWidth = rng.range(0.8, 2);
    g.beginPath();
    g.moveTo(h, h);
    g.lineTo(h + Math.cos(a) * len, h + Math.sin(a) * len);
    g.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({
    map: texture,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    transparent: true,
  });
  const sprite = new THREE.Sprite(material);
  sprite.renderOrder = 10;

  return {
    group: sprite,
    sprite,
    update(time) {
      const pulse = 1 + f.pulseAmount * Math.sin(time * f.pulseSpeed * Math.PI);
      sprite.scale.setScalar(f.size * cfg.mass.radius * pulse);
      material.color.setScalar(f.intensity * uniforms.uIntensity.value * pulse);
    },
    dispose() {
      texture.dispose();
    },
  };
}
