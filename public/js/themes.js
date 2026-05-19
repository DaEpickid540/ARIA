// themes.js — ARIA Theme System V2 (Mark 1.3)
// ═══════════════════════════════════════════════════════════════════
//
// Architecture:
//   THEME MODE  = visual style (cyberpunk, professional, terminal, minimal)
//   ACCENT COLOR = the primary color (12+ presets + custom HSL picker)
//
// Each mode defines its own typography, spacing, glow intensity, scanlines,
// border radius, animations, etc. The accent color is applied on top.
//
// All theming flows through CSS custom properties on :root. Components
// reference variables, never hardcoded colors.
//
// ═══════════════════════════════════════════════════════════════════

/* ── MODE DEFINITIONS ─────────────────────────────────────────── */
export const THEME_MODES = {
  cyberpunk: {
    label: "Cyberpunk",
    description: "Neon glow, scanlines, monospace, glitch effects",
    vars: {
      "--font-body": '"Share Tech Mono", "Consolas", monospace',
      "--font-head": '"Orbitron", "Rajdhani", sans-serif',
      "--font-mono": '"Share Tech Mono", monospace',
      "--text-spacing": "0.02em",
      "--radius-sm": "2px",
      "--radius-md": "4px",
      "--radius-lg": "6px",
      "--glow-intensity": "1",
      "--scanline-opacity": "0.18",
      "--cursor-style": "crosshair",
      "--bg-void": "#000000",
      "--bg-abyss": "#030303",
      "--bg-panel": "#080808",
      "--bg-elevated": "#0d0d0d",
      "--bg-raised": "#111111",
      "--text-blaze": "#ffffff",
      "--text-muted": "#553333",
      "--text-dim": "#331111",
      "--shadow-card": "0 4px 16px rgba(0, 0, 0, 0.6)",
      "--anim-speed": "1",
    },
    bodyClass: "mode-cyberpunk",
  },

  professional: {
    label: "Professional",
    description: "Clean, minimal, soft tones — like a focused writing app",
    vars: {
      "--font-body":
        '-apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", system-ui, sans-serif',
      "--font-head":
        '-apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", system-ui, sans-serif',
      "--font-mono":
        '"JetBrains Mono", "Cascadia Code", "Consolas", monospace',
      "--text-spacing": "0",
      "--radius-sm": "6px",
      "--radius-md": "10px",
      "--radius-lg": "14px",
      "--glow-intensity": "0",
      "--scanline-opacity": "0",
      "--cursor-style": "default",
      "--bg-void": "#fafaf9",
      "--bg-abyss": "#f4f4f3",
      "--bg-panel": "#ffffff",
      "--bg-elevated": "#ffffff",
      "--bg-raised": "#f9f9f8",
      "--text-blaze": "#1a1a1a",
      "--text-muted": "#6b6b6b",
      "--text-dim": "#9a9a9a",
      "--shadow-card":
        "0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)",
      "--anim-speed": "0.6",
    },
    bodyClass: "mode-professional",
  },

  terminal: {
    label: "Terminal",
    description: "Pure terminal aesthetic — phosphor green on black, blinking cursor",
    vars: {
      "--font-body": '"Fira Code", "JetBrains Mono", "Consolas", monospace',
      "--font-head": '"Fira Code", "JetBrains Mono", monospace',
      "--font-mono": '"Fira Code", "JetBrains Mono", monospace',
      "--text-spacing": "0",
      "--radius-sm": "0",
      "--radius-md": "0",
      "--radius-lg": "0",
      "--glow-intensity": "0.4",
      "--scanline-opacity": "0.25",
      "--cursor-style": "text",
      "--bg-void": "#000000",
      "--bg-abyss": "#0a0a0a",
      "--bg-panel": "#0d0d0d",
      "--bg-elevated": "#101010",
      "--bg-raised": "#141414",
      "--text-blaze": "#e0e0e0",
      "--text-muted": "#666666",
      "--text-dim": "#404040",
      "--shadow-card": "none",
      "--anim-speed": "0.5",
    },
    bodyClass: "mode-terminal",
  },

  minimal: {
    label: "Minimal Dark",
    description: "Subtle dark mode — clean, modern, low contrast",
    vars: {
      "--font-body":
        '-apple-system, BlinkMacSystemFont, "Inter", system-ui, sans-serif',
      "--font-head":
        '-apple-system, BlinkMacSystemFont, "Inter", system-ui, sans-serif',
      "--font-mono": '"JetBrains Mono", "Consolas", monospace',
      "--text-spacing": "0",
      "--radius-sm": "6px",
      "--radius-md": "10px",
      "--radius-lg": "14px",
      "--glow-intensity": "0.2",
      "--scanline-opacity": "0",
      "--cursor-style": "default",
      "--bg-void": "#0a0a0c",
      "--bg-abyss": "#101013",
      "--bg-panel": "#16161a",
      "--bg-elevated": "#1c1c22",
      "--bg-raised": "#22222a",
      "--text-blaze": "#e8e8ea",
      "--text-muted": "#7a7a82",
      "--text-dim": "#4a4a52",
      "--shadow-card":
        "0 2px 8px rgba(0,0,0,0.3), 0 1px 2px rgba(0,0,0,0.2)",
      "--anim-speed": "0.7",
    },
    bodyClass: "mode-minimal",
  },
};

/* ── ACCENT COLOR PRESETS ─────────────────────────────────────── */
// Each entry defines its core hue; we derive the rest via HSL math.
export const ACCENT_PRESETS = {
  red: { label: "Crimson", core: "#ff2040" },
  orange: { label: "Ember", core: "#ff6600" },
  amber: { label: "Amber", core: "#ffb300" },
  gold: { label: "Gilded", core: "#ffd700" },
  green: { label: "Matrix", core: "#00ff66" },
  forest: { label: "Forest", core: "#3aa55c" },
  teal: { label: "Teal", core: "#00d4b8" },
  cyan: { label: "Neon Cyan", core: "#00e5ff" },
  blue: { label: "Ocean", core: "#3b82f6" },
  indigo: { label: "Indigo", core: "#5865f2" },
  purple: { label: "Synthwave", core: "#cc00ff" },
  pink: { label: "Hot Pink", core: "#ff2db5" },
  magenta: { label: "Magenta", core: "#ff00aa" },
  rose: { label: "Rose", core: "#fb7185" },
  slate: { label: "Slate", core: "#94a3b8" },
  white: { label: "Mono", core: "#ffffff" },
};

/* ── COLOR MATH ───────────────────────────────────────────────── */
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
    Math.round((n + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/* ── DERIVE FULL PALETTE FROM A SINGLE COLOR ──────────────────── */
// Given one accent color, generate the full set of variants
// (hot, neon, deep, dim, ember) so the existing CSS works unchanged.
export function derivePalette(coreHex) {
  const [h, s, l] = hexToHsl(coreHex);
  return {
    "--red-core": coreHex,
    "--red-hot": hslToHex(h, Math.min(s + 5, 100), Math.max(l - 5, 0)),
    "--red-neon": hslToHex(h, Math.min(s + 10, 100), Math.min(l + 10, 95)),
    "--red-deep": hslToHex(h, s, Math.max(l - 25, 5)),
    "--red-dim": hslToHex(h, Math.max(s - 20, 10), Math.max(l - 40, 5)),
    "--red-ember": hslToHex((h + 20) % 360, s, Math.min(l + 15, 90)),
    "--accent-h": String(Math.round(h)),
    "--accent-s": `${Math.round(s)}%`,
    "--accent-l": `${Math.round(l)}%`,
  };
}

/* ── APPLY MODE + ACCENT ──────────────────────────────────────── */
export function applyThemeFull(mode, accentHex) {
  const root = document.documentElement;
  const body = document.body;

  // 1. Apply mode variables
  const modeDef = THEME_MODES[mode] || THEME_MODES.cyberpunk;
  Object.entries(modeDef.vars).forEach(([k, v]) =>
    root.style.setProperty(k, v),
  );

  // 2. Switch mode body class
  Object.values(THEME_MODES).forEach((m) => body.classList.remove(m.bodyClass));
  body.classList.add(modeDef.bodyClass);

  // 3. Apply accent color → full palette
  const palette = derivePalette(accentHex);
  Object.entries(palette).forEach(([k, v]) => root.style.setProperty(k, v));

  // 4. Recompute glows based on intensity
  const glowMul = parseFloat(modeDef.vars["--glow-intensity"] || "1");
  const core = accentHex;
  if (glowMul > 0) {
    root.style.setProperty("--glow-sm", `0 0 ${8 * glowMul}px ${core}99`);
    root.style.setProperty(
      "--glow-md",
      `0 0 ${16 * glowMul}px ${core}bb, 0 0 ${32 * glowMul}px ${core}55`,
    );
    root.style.setProperty(
      "--glow-lg",
      `0 0 ${24 * glowMul}px ${core}ee, 0 0 ${48 * glowMul}px ${core}88, 0 0 ${80 * glowMul}px ${core}33`,
    );
    root.style.setProperty(
      "--glow-ultra",
      `0 0 4px #fff, 0 0 ${14 * glowMul}px ${core}, 0 0 ${40 * glowMul}px ${core}, 0 0 ${80 * glowMul}px ${core}88`,
    );
  } else {
    root.style.setProperty("--glow-sm", "none");
    root.style.setProperty("--glow-md", "none");
    root.style.setProperty("--glow-lg", "none");
    root.style.setProperty("--glow-ultra", "none");
  }

  // 5. Derived border colors
  root.style.setProperty("--border-cut", palette["--red-dim"]);
  root.style.setProperty("--border-glow", palette["--red-deep"]);
  root.style.setProperty("--border-live", core);
  root.style.setProperty("--text-hot", core + "cc");

  // 6. Update active swatch in UI
  document
    .querySelectorAll(".themeSwatchV2")
    .forEach((s) =>
      s.classList.toggle("active", s.dataset.accent === accentHex),
    );
  document
    .querySelectorAll(".themeModeCard")
    .forEach((s) => s.classList.toggle("active", s.dataset.mode === mode));

  // 7. Persist
  localStorage.setItem("aria_theme_mode", mode);
  localStorage.setItem("aria_theme_accent", accentHex);
}

/* ── LOAD PERSISTED THEME ─────────────────────────────────────── */
export function loadSavedTheme() {
  const mode = localStorage.getItem("aria_theme_mode") || "cyberpunk";
  const accent = localStorage.getItem("aria_theme_accent") || "#ff2040";
  return { mode, accent };
}

export function applySavedTheme() {
  const { mode, accent } = loadSavedTheme();
  applyThemeFull(mode, accent);
}

/* ── CUSTOM SAVED COLORS ──────────────────────────────────────── */
export function getCustomColors() {
  try {
    return JSON.parse(localStorage.getItem("aria_custom_colors") || "[]");
  } catch {
    return [];
  }
}
export function saveCustomColor(hex, name) {
  const list = getCustomColors();
  list.unshift({ hex, name: name || hex, savedAt: Date.now() });
  // Keep max 8 custom slots
  localStorage.setItem("aria_custom_colors", JSON.stringify(list.slice(0, 8)));
}
export function deleteCustomColor(hex) {
  const list = getCustomColors().filter((c) => c.hex !== hex);
  localStorage.setItem("aria_custom_colors", JSON.stringify(list));
}
