// colorWheel.js — Continuous HSL color wheel picker
// ═══════════════════════════════════════════════════════════════════
// Renders an HSL color wheel on a <canvas>. The user drags a marker
// around to pick any hue. A separate lightness slider controls L.
//
// Usage:
//   import { mountColorWheel } from "./colorWheel.js";
//   mountColorWheel(containerEl, { initial: "#ff2040", onPick: hex => {...} });
// ═══════════════════════════════════════════════════════════════════

function hexToHsl(hex) {
  hex = hex.replace("#", "");
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  let h = 0,
    s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return [h * 360, s * 100, l * 100];
}

function hslToHex(h, s, l) {
  s /= 100;
  l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r, g, b;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const toHex = (n) =>
    Math.round((n + m) * 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function mountColorWheel(container, { initial = "#ff2040", onPick } = {}) {
  // ── Markup ───────────────────────────────────────────────
  container.innerHTML = `
    <div class="colorWheelV2">
      <div class="colorWheelWrap">
        <canvas class="colorWheelCanvas" width="240" height="240"></canvas>
        <div class="colorWheelMarker"></div>
      </div>
      <div class="colorWheelControls">
        <div class="cwCurrentPreview">
          <div class="cwSwatch"></div>
          <div class="cwValues">
            <input type="text" class="cwHexInput" maxlength="7" />
            <div class="cwHsl"></div>
          </div>
        </div>
        <label class="cwSliderRow">
          <span>Lightness</span>
          <input type="range" class="cwLightness" min="10" max="90" value="50" />
        </label>
        <label class="cwSliderRow">
          <span>Saturation</span>
          <input type="range" class="cwSaturation" min="10" max="100" value="100" />
        </label>
        <button class="cwSaveBtn">+ Save as Custom</button>
      </div>
    </div>
  `;

  const canvas = container.querySelector(".colorWheelCanvas");
  const marker = container.querySelector(".colorWheelMarker");
  const swatch = container.querySelector(".cwSwatch");
  const hexInput = container.querySelector(".cwHexInput");
  const hslLabel = container.querySelector(".cwHsl");
  const lightSlider = container.querySelector(".cwLightness");
  const satSlider = container.querySelector(".cwSaturation");
  const saveBtn = container.querySelector(".cwSaveBtn");
  const wrap = container.querySelector(".colorWheelWrap");

  const ctx = canvas.getContext("2d");
  const size = canvas.width;
  const radius = size / 2;
  const cx = radius;
  const cy = radius;

  // ── State ────────────────────────────────────────────────
  let [h0, s0, l0] = hexToHsl(initial);
  let H = h0,
    S = s0 || 100,
    L = l0 || 50;
  lightSlider.value = String(Math.round(L));
  satSlider.value = String(Math.round(S));

  // ── Draw the wheel ───────────────────────────────────────
  // Hue → angle, saturation → radius from center, fixed lightness for the wheel face.
  function drawWheel(lightness) {
    const img = ctx.createImageData(size, size);
    const data = img.data;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x - cx;
        const dy = y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > radius) continue;
        const sat = Math.min(100, (dist / radius) * 100);
        let hue = Math.atan2(dy, dx) * (180 / Math.PI);
        if (hue < 0) hue += 360;
        const hex = hslToHex(hue, sat, lightness);
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        const i = (y * size + x) * 4;
        data[i] = r;
        data[i + 1] = g;
        data[i + 2] = b;
        data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    // Outline
    ctx.beginPath();
    ctx.arc(cx, cy, radius - 1, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,255,255,0.1)";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // ── Marker position from H/S ─────────────────────────────
  function updateMarker() {
    const angle = (H * Math.PI) / 180;
    const dist = (S / 100) * (radius - 6);
    const mx = cx + Math.cos(angle) * dist;
    const my = cy + Math.sin(angle) * dist;
    marker.style.left = `${mx}px`;
    marker.style.top = `${my}px`;
  }

  function refresh() {
    drawWheel(L);
    updateMarker();
    const hex = hslToHex(H, S, L);
    swatch.style.background = hex;
    hexInput.value = hex.toUpperCase();
    hslLabel.textContent = `H ${Math.round(H)}° · S ${Math.round(S)}% · L ${Math.round(L)}%`;
    if (onPick) onPick(hex);
  }

  // ── Pick from canvas (click / drag) ──────────────────────
  function pickFrom(ev) {
    const rect = canvas.getBoundingClientRect();
    const x = (ev.touches?.[0]?.clientX ?? ev.clientX) - rect.left;
    const y = (ev.touches?.[0]?.clientY ?? ev.clientY) - rect.top;
    const dx = x - cx;
    const dy = y - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > radius) {
      // Clamp to edge
      const angle = Math.atan2(dy, dx);
      H = (angle * 180) / Math.PI;
      if (H < 0) H += 360;
      S = 100;
    } else {
      let angle = Math.atan2(dy, dx) * (180 / Math.PI);
      if (angle < 0) angle += 360;
      H = angle;
      S = Math.min(100, (dist / radius) * 100);
    }
    satSlider.value = String(Math.round(S));
    refresh();
  }

  let dragging = false;
  wrap.addEventListener("mousedown", (e) => {
    dragging = true;
    pickFrom(e);
  });
  wrap.addEventListener("touchstart", (e) => {
    dragging = true;
    pickFrom(e);
    e.preventDefault();
  });
  window.addEventListener("mousemove", (e) => {
    if (dragging) pickFrom(e);
  });
  window.addEventListener("touchmove", (e) => {
    if (dragging) {
      pickFrom(e);
      e.preventDefault();
    }
  });
  window.addEventListener("mouseup", () => (dragging = false));
  window.addEventListener("touchend", () => (dragging = false));

  // ── Slider controls ──────────────────────────────────────
  lightSlider.addEventListener("input", () => {
    L = parseInt(lightSlider.value);
    refresh();
  });
  satSlider.addEventListener("input", () => {
    S = parseInt(satSlider.value);
    refresh();
  });

  // ── Hex input direct entry ───────────────────────────────
  hexInput.addEventListener("change", () => {
    let v = hexInput.value.trim();
    if (!v.startsWith("#")) v = "#" + v;
    if (/^#[0-9a-f]{6}$/i.test(v)) {
      const [nh, ns, nl] = hexToHsl(v);
      H = nh;
      S = ns;
      L = nl;
      lightSlider.value = String(Math.round(L));
      satSlider.value = String(Math.round(S));
      refresh();
    }
  });

  // ── Save custom ──────────────────────────────────────────
  saveBtn.addEventListener("click", () => {
    const hex = hslToHex(H, S, L);
    window.dispatchEvent(
      new CustomEvent("aria-save-custom-color", { detail: { hex } }),
    );
    saveBtn.textContent = "✓ Saved";
    setTimeout(() => (saveBtn.textContent = "+ Save as Custom"), 1500);
  });

  refresh();

  return {
    setColor(hex) {
      const [nh, ns, nl] = hexToHsl(hex);
      H = nh;
      S = ns;
      L = nl;
      lightSlider.value = String(Math.round(L));
      satSlider.value = String(Math.round(S));
      refresh();
    },
    getColor() {
      return hslToHex(H, S, L);
    },
  };
}
