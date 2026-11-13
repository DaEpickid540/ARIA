import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// Per-channel soft clip: c / (1 + c / max). Thousands of additive lines can sum to huge
// HDR values in the core; without this, bloom smears that energy across the whole screen.
// Saturating each channel separately also pushes the densest blues toward hot white.
const SoftClipShader = {
  uniforms: {
    tDiffuse: { value: null },
    uMax: { value: 2.5 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uMax;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      gl_FragColor = vec4(c.rgb / (1.0 + c.rgb / uMax), c.a);
    }
  `,
};

// Movie-frame finish, applied last in display space: an optional mood tint, slight RGB split
// toward the edges, a soft vignette, and fine animated grain that scales with brightness so
// black stays black.
const FilmShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uAberration: { value: 0.002 },
    uVignette: { value: 0.4 },
    uGrain: { value: 0.05 },
    uTint: { value: new THREE.Color(1, 1, 1) },
    uTintAmount: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uAberration;
    uniform float uVignette;
    uniform float uGrain;
    uniform vec3 uTint;
    uniform float uTintAmount;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 dir = vUv - 0.5;
      float r = length(dir);
      vec2 off = dir * uAberration * smoothstep(0.3, 0.7, r) * 2.0;
      vec4 base = texture2D(tDiffuse, vUv);
      vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, base.g, texture2D(tDiffuse, vUv - off).b);
      // Recolour toward the tint, keeping each pixel's peak brightness (blue luma alone is too dim).
      float peak = max(col.r, max(col.g, col.b));
      col = mix(col, peak * uTint / max(uTint.r, max(uTint.g, max(uTint.b, 1e-3))), uTintAmount);
      col *= 1.0 - uVignette * smoothstep(0.45, 0.8, r);
      float luma = dot(col, vec3(0.299, 0.587, 0.114));
      float n = hash(gl_FragCoord.xy + fract(uTime * 7.31) * 113.0) - 0.5;
      // Strongest in the mid-tones, zero in pure black.
      col += n * uGrain * min(luma * 4.0, 1.0) * (1.0 - 0.6 * luma);
      gl_FragColor = vec4(max(col, 0.0), base.a);
    }
  `,
};

// RenderPass -> SoftClip -> Bloom -> OutputPass (tone mapping + sRGB) -> Film.
// Rendered into a HalfFloat target so additive overlaps can exceed 1.0 before the clip.
export function createPost(renderer, scene, camera, cfg) {
  const target = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    samples: cfg.renderer.msaaSamples,
  });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));

  const softClip = new ShaderPass(SoftClipShader);
  softClip.uniforms.uMax.value = cfg.renderer.hdrClamp;
  composer.addPass(softClip);

  const b = cfg.bloom;
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), b.strength, b.radius, b.threshold);
  // Run bloom at a fraction of screen resolution (big win on weak GPUs).
  const bloomSetSize = bloom.setSize.bind(bloom);
  bloom.setSize = (w, h) => {
    const s = cfg.bloom.resolutionScale;
    bloomSetSize(Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s)));
  };
  composer.addPass(bloom);

  composer.addPass(new OutputPass());

  const film = new ShaderPass(FilmShader);
  film.uniforms.uAberration.value = cfg.film.aberration;
  film.uniforms.uVignette.value = cfg.film.vignette;
  film.uniforms.uGrain.value = cfg.film.grain;
  composer.addPass(film);

  return {
    composer,
    bloom,
    softClip,
    film,
    setSize(width, height, pixelRatio) {
      composer.setPixelRatio(pixelRatio);
      composer.setSize(width, height);
    },
    render(dt) {
      film.uniforms.uTime.value += dt;
      composer.render(dt);
    },
  };
}
