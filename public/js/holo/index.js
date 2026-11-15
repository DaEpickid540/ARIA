// holo/index.js — the hologram behind call mode
//
// The Holo Core from the Ultron project (github/Ultron): a mass of glowing
// filaments with petals, veins and a white-hot centre, ringed by orbiting
// fragments. Drawn with three.js. Here it takes its colour from ARIA's
// accent and its energy from the voices in the call, and it is the only
// file the rest of the app imports.
//
// Loaded on demand (callEngine.js imports it the first time a call opens),
// so three.js costs nothing until then. If WebGL isn't there, createHolo
// throws and call mode keeps its CSS orb.
//
//   const holo = createHolo(canvas, {
//     state: () => "idle" | "user" | "aria",   who is talking
//     voice: () => 0–1 | null,                 ARIA's loudness, if it can be heard
//     mic: () => 0–1 | null,                   yours
//     onTap: () => {},                         a click that wasn't a drag
//   });
//   holo.start();  holo.stop();  holo.dispose();
//
// Drag to turn it, scroll or pinch to zoom; double-click puts it back.

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CONFIG as cfg, PALETTE } from "./config.js";
import { syncPalette } from "./core/palette.js";
import { buildCore } from "./core/buildCore.js";
import { createPost } from "./post/composer.js";

// What each speaker does to the look, on top of the glow that follows the
// voice itself. tempo speeds all motion, pulse scales the sparks along the
// filaments, flicker their shimmer, wash pulls the frame toward white: call
// mode's halo is white while you talk, accent while ARIA does.
const LOOKS = {
  idle: { tempo: 0.75, pulse: 0.8, flicker: 1, wash: 0 },
  user: { tempo: 1, pulse: 1, flicker: 1, wash: 0.16 },
  aria: { tempo: 1.35, pulse: 1.8, flicker: 1.6, wash: 0 },
};
const GLOW = 0.6; // how much brighter the hologram gets at full voice
const EASE_S = 0.4; // seconds to blend from one look to the next
const TAP_PX = 6; // a press that moves less than this is a tap, not a drag

/** A CSS colour as the browser resolves it → THREE.Color, or null. */
function cssColor(value) {
  const probe = document.createElement("span");
  probe.style.color = value;
  probe.style.display = "none";
  document.body.appendChild(probe);
  const resolved = getComputedStyle(probe).color; // "rgb(r, g, b)" or "color(srgb r g b)"
  probe.remove();
  const n = (resolved.match(/-?[\d.]+(e-?\d+)?/g) || []).map(Number);
  if (n.length < 3) return null;
  const k = resolved.startsWith("color(") ? 1 : 1 / 255;
  return new THREE.Color().setRGB(n[0] * k, n[1] * k, n[2] * k, THREE.SRGBColorSpace);
}

/**
 * The hologram's colours, from the page's accent: white-hot centre, a mid
 * tone, the accent, a dark edge. Kept on the deep side so the red reads as
 * red, not pink. The backdrop is near-black with a trace of the accent,
 * whatever the theme: the light adds up, so it only reads on a dark ground.
 */
export function themePalette() {
  const accent = cssColor("var(--accent)") || new THREE.Color(PALETTE.electric);
  // In sRGB, the space the theme's colours are written in (three's default is linear).
  const hsl = accent.getHSL({}, THREE.SRGBColorSpace);
  // A grey accent has no hue to keep; anything else is held saturated enough to glow.
  const s = hsl.s < 0.08 ? 0 : Math.max(hsl.s, 0.8);
  const at = (l, sat = s) => "#" + new THREE.Color().setHSL(hsl.h, sat, l, THREE.SRGBColorSpace).getHexString();
  return {
    background: at(0.018, Math.min(s, 0.35)),
    web: at(0.2),
    deep: at(0.15),
    electric: at(Math.min(Math.max(hsl.l, 0.36), 0.42)),
    cyan: at(0.54),
    hot: at(0.9),
  };
}

export function createHolo(canvas, { state = () => "idle", voice = () => null, mic = () => null, onTap = () => {} } = {}) {
  // Throws without WebGL: the caller falls back to the CSS orb.
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
  renderer.toneMapping = THREE.NoToneMapping;

  // Phones and small laptops get a lighter build: fewer filaments, no MSAA.
  const small = (navigator.hardwareConcurrency || 8) <= 4 || Math.min(screen.width, screen.height) < 700;
  if (small) {
    cfg.nodes.count = 2600;
    cfg.dust.count = 800;
    cfg.satellites.nodesMin = 200;
    cfg.satellites.nodesMax = 380;
    cfg.renderer.msaaSamples = 0;
    cfg.renderer.pixelRatioCap = 1.5;
  }
  const calm = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(cfg.camera.fov, 1, cfg.camera.near, cfg.camera.far);
  camera.position.set(0, 0, 5); // must not sit on the target when OrbitControls starts

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = cfg.camera.damping;
  controls.enablePan = false;
  controls.minDistance = cfg.camera.minDistance;
  controls.maxDistance = cfg.camera.maxDistance;

  // Shared (by reference) across every material in the hologram.
  const uniforms = {
    uTime: { value: 0 },
    uScale: { value: 1 },
    uPixelRatio: { value: 1 },
    uIntensity: { value: cfg.renderer.brightness },
    uCamDist: { value: 5 },
    uDepthCue: { value: cfg.renderer.depthCue },
    uDepthRange: { value: cfg.mass.radius * 2.5 },
  };

  const post = createPost(renderer, scene, camera, cfg);
  post.film.uniforms.uTint.value.setRGB(1, 1, 1);

  let core = null;
  let builtFor = "";

  /** (Re)build the hologram when the accent has changed since the last build. */
  function build() {
    const next = themePalette();
    const key = Object.values(next).join();
    if (core && key === builtFor) return;
    const { web, ...palette } = next;
    Object.assign(PALETTE, palette);
    cfg.web.color = web;
    syncPalette();
    if (core) {
      scene.remove(core.group);
      core.dispose();
    }
    scene.background = new THREE.Color(PALETTE.background);
    core = buildCore(cfg, uniforms);
    scene.add(core.group);
    builtFor = key;
  }

  // Back the camera off until the whole hologram (mass + fragments) fits the
  // frame, for any shape of screen. Re-runs on resize until you move it.
  let userMoved = false;
  controls.addEventListener("start", () => (userMoved = true));

  function frameCamera() {
    const R = cfg.mass.radius;
    const s = cfg.satellites;
    const massHalf = 1 + cfg.mass.lumpAmp;
    // Fragments stretch along their orbit, which points into depth at the
    // frame edges, so only part of the stretch widens the outline.
    const fragR = s.radiusMax * s.heroScale;
    let halfW = R * Math.max(massHalf, s.distanceMax + fragR * 1.4);
    // Tall screens: favour the mass and let the outer fragments run off the sides.
    if (camera.aspect < 1) halfW = THREE.MathUtils.lerp(R * massHalf, halfW, camera.aspect);
    // A tilted orbit lifts the far side of the ring into view, so it adds height.
    const ringH = Math.max(-s.elevationMin, s.elevationMax, s.distanceMax * Math.sin(s.orbitTilt));
    const halfH = R * Math.max(massHalf, ringH + fragR);
    const vFov = THREE.MathUtils.degToRad(cfg.camera.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
    const dist = cfg.camera.fitMargin * Math.max(halfW / Math.tan(hFov / 2), halfH / Math.tan(vFov / 2));
    camera.position.set(0, cfg.camera.height, 1).normalize().multiplyScalar(dist);
    controls.target.set(0, 0, 0);
    controls.update();
  }

  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    const pr = Math.min(window.devicePixelRatio || 1, cfg.renderer.pixelRatioCap);
    renderer.setPixelRatio(pr);
    renderer.setSize(w, h, false);
    post.setSize(w, h, pr);
    uniforms.uPixelRatio.value = pr;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (!userMoved) frameCamera();
  }

  // ── Taps and drags ──
  // OrbitControls takes the drag. A press that barely moves is a tap, which
  // call mode uses to hang up; a double-click puts the view back.
  let downAt = null;
  const onDown = (e) => (downAt = { x: e.clientX, y: e.clientY, t: performance.now() });
  const onUp = (e) => {
    const d = downAt;
    downAt = null;
    if (!d || e.button > 0) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < TAP_PX && performance.now() - d.t < 400) onTap();
  };
  const onDouble = () => {
    userMoved = false;
    frameCamera();
  };
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("dblclick", onDouble);

  /**
   * How lit up the hologram should be, 0–1: the speaking animation. It rides
   * the real voice when that can be heard; otherwise a rhythm shaped like
   * speech (syllables a few times a second, a pause now and then).
   */
  function activity(who, time) {
    if (who === "aria") {
      const heard = voice();
      if (heard != null) return heard;
      const syllables = 0.5 + 0.5 * Math.sin(time * 19) * Math.sin(time * 7.3 + 1.1);
      const phrase = Math.min(1, Math.max(0, 0.75 + 0.6 * Math.sin(time * 1.9)));
      return 0.25 + 0.75 * syllables * phrase;
    }
    if (who === "user") return Math.min(1, (mic() ?? 0) * 12) * 0.7;
    return 0;
  }

  const look = { ...LOOKS.idle };
  let glow = 0;
  let last = 0;
  let running = false;

  function frame(ms) {
    const dt = Math.min((ms - last) / 1000 || 0, 0.1);
    last = ms;

    const who = state();
    const goal = LOOKS[who] || LOOKS.idle;
    const a = 1 - Math.exp(-dt / EASE_S);
    for (const k in look) look[k] += (goal[k] - look[k]) * a;

    const t = dt * (calm ? look.tempo * 0.35 : look.tempo);
    uniforms.uTime.value += t;
    const time = uniforms.uTime.value;

    // Smoothed, so it swells with a word instead of strobing with a sample.
    const want = calm ? (who === "aria" ? 0.6 : who === "user" ? 0.25 : 0) : activity(who, ms / 1000);
    glow += (want - glow) * Math.min(1, dt * 12);

    uniforms.uIntensity.value = cfg.renderer.brightness * (1 + glow * GLOW);
    post.bloom.strength = cfg.bloom.strength * (1 + glow * 0.5);
    post.film.uniforms.uTintAmount.value = look.wash;
    for (const m of core.lineMaterials) {
      m.uniforms.uPulseAmount.value = cfg.network.pulseAmount * (m.userData.pulseScale ?? 1) * look.pulse * (1 + glow * 0.6);
      m.uniforms.uFlickerAmount.value = cfg.network.flickerAmount * look.flicker;
    }
    // The whole thing swells a touch with the voice.
    core.group.scale.setScalar(1 + glow * 0.035);

    core.update(t, time);
    controls.update();
    uniforms.uCamDist.value = camera.position.distanceTo(controls.target);
    post.render(dt);
  }

  const onResize = () => running && resize();

  return {
    /** Start drawing. Picks up a changed theme and the canvas's current size. */
    start() {
      if (running) return;
      running = true;
      build();
      resize();
      last = performance.now();
      window.addEventListener("resize", onResize);
      renderer.setAnimationLoop(frame);
    },
    /** Stop drawing; the hologram is kept for the next start. */
    stop() {
      running = false;
      renderer.setAnimationLoop(null);
      window.removeEventListener("resize", onResize);
    },
    dispose() {
      this.stop();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("dblclick", onDouble);
      controls.dispose();
      core?.dispose();
      core = null;
      renderer.dispose();
    },
  };
}
