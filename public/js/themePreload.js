// themePreload.js — applies the saved theme before first paint.
//
// Loaded as a plain blocking <script src> in <head> (no defer/async), the same
// pattern BookWare uses. Two reasons it has to run this early:
//
//   1. Bootstrap's stylesheet loads after ARIA's and repaints `body` white with
//      its own font stack. The mode's tokens land on :root as inline styles,
//      which outrank any stylesheet, so applying them here settles the page
//      before anything is drawn.
//   2. Without it the lock and home screens paint in the default dark palette
//      and then snap to the saved one once settings.js lazily loads.
//
// ─── THIS FILE OWNS THE MODE + ACCENT TABLES ────────────────────────────────
// themes.js is a thin ES-module wrapper over window.ARIA_Theme defined here. A
// classic script can't be a module (modules are deferred, which defeats the
// point of running before paint), so the sharing goes in this direction. Do not
// copy the tables into themes.js — two copies drift.
(function () {
  var FONT_SANS = '"DM Sans", system-ui, -apple-system, "Segoe UI", sans-serif';
  var FONT_SERIF = '"DM Serif Display", Georgia, serif';
  var FONT_MONO =
    '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

  /* ── MODE DEFINITIONS ───────────────────────────────────────── */
  var MODES = {
    dark: {
      label: "Dark",
      description: "The default — soft dark gray, rounded, quiet shadows",
      light: false,
      bodyClass: "mode-dark",
      vars: {
        "--font-body": FONT_SANS,
        "--font-head": FONT_SANS,
        "--font-display": FONT_SERIF,
        "--font-mono": FONT_MONO,
        "--text-spacing": "0",
        "--radius-sm": "6px",
        "--radius-md": "10px",
        "--radius-lg": "14px",
        "--cursor-style": "default",
        "--bg": "#1a1a1e",
        "--bg-card": "#22222a",
        "--bg-inset": "#16161a",
        "--bg-hover": "#2a2a34",
        "--border": "#2d2d38",
        "--border-strong": "#3b3b48",
        "--text": "#f0f0f0",
        "--text-2": "#b0b0be",
        "--text-3": "#6e6e80",
        "--shadow-sm": "0 1px 3px rgba(0,0,0,0.25)",
        "--shadow": "0 4px 16px rgba(0,0,0,0.35)",
        "--shadow-lg": "0 12px 40px rgba(0,0,0,0.55)",
        "--shadow-card": "0 1px 3px rgba(0,0,0,0.25)",
        "--anim-speed": "1",
      },
    },

    light: {
      label: "Light",
      description: "Clean white page, ink-dark text, the same geometry",
      light: true,
      bodyClass: "mode-light",
      vars: {
        "--font-body": FONT_SANS,
        "--font-head": FONT_SANS,
        "--font-display": FONT_SERIF,
        "--font-mono": FONT_MONO,
        "--text-spacing": "0",
        "--radius-sm": "6px",
        "--radius-md": "10px",
        "--radius-lg": "14px",
        "--cursor-style": "default",
        "--bg": "#ffffff",
        "--bg-card": "#f5f5f8",
        "--bg-inset": "#ececf0",
        "--bg-hover": "#e4e4ea",
        "--border": "#dcdce8",
        "--border-strong": "#c6c6d4",
        "--text": "#18181b",
        "--text-2": "#4a4a58",
        "--text-3": "#8a8a9a",
        "--shadow-sm": "0 1px 3px rgba(0,0,0,0.08)",
        "--shadow": "0 4px 16px rgba(0,0,0,0.10)",
        "--shadow-lg": "0 12px 40px rgba(0,0,0,0.16)",
        "--shadow-card": "0 1px 3px rgba(0,0,0,0.08)",
        "--anim-speed": "1",
      },
    },

    dim: {
      label: "Dim",
      description: "Lower contrast, warmer grays — easier at night",
      light: false,
      bodyClass: "mode-dim",
      vars: {
        "--font-body": FONT_SANS,
        "--font-head": FONT_SANS,
        "--font-display": FONT_SERIF,
        "--font-mono": FONT_MONO,
        "--text-spacing": "0",
        "--radius-sm": "6px",
        "--radius-md": "10px",
        "--radius-lg": "14px",
        "--cursor-style": "default",
        "--bg": "#232228",
        "--bg-card": "#2b2a32",
        "--bg-inset": "#1e1d23",
        "--bg-hover": "#33323c",
        "--border": "#3a3944",
        "--border-strong": "#4a4955",
        "--text": "#e2e0e6",
        "--text-2": "#a8a5b2",
        "--text-3": "#77747f",
        "--shadow-sm": "0 1px 3px rgba(0,0,0,0.2)",
        "--shadow": "0 4px 16px rgba(0,0,0,0.28)",
        "--shadow-lg": "0 12px 40px rgba(0,0,0,0.4)",
        "--shadow-card": "0 1px 3px rgba(0,0,0,0.2)",
        "--anim-speed": "0.8",
      },
    },

    mono: {
      label: "Mono",
      description: "Monospaced throughout, square corners, no shadows",
      light: false,
      bodyClass: "mode-mono",
      vars: {
        "--font-body": FONT_MONO,
        "--font-head": FONT_MONO,
        "--font-display": FONT_MONO,
        "--font-mono": FONT_MONO,
        "--text-spacing": "0",
        "--radius-sm": "2px",
        "--radius-md": "3px",
        "--radius-lg": "4px",
        "--cursor-style": "default",
        "--bg": "#17171b",
        "--bg-card": "#1e1e24",
        "--bg-inset": "#131317",
        "--bg-hover": "#26262e",
        "--border": "#2b2b34",
        "--border-strong": "#3a3a45",
        "--text": "#e8e8ea",
        "--text-2": "#a6a6b2",
        "--text-3": "#6a6a76",
        "--shadow-sm": "none",
        "--shadow": "none",
        "--shadow-lg": "none",
        "--shadow-card": "none",
        "--anim-speed": "0.6",
      },
    },
  };

  // Modes renamed in V3. A V2 value in localStorage lands on its closest
  // equivalent instead of silently falling back to the default.
  var LEGACY_MODE_MAP = {
    cyberpunk: "dark",
    professional: "light",
    terminal: "mono",
    minimal: "dim",
  };

  /* ── ACCENT PRESETS ─────────────────────────────────────────── */
  // Flat-UI hues rather than neon: saturated enough to carry a filled button,
  // calm enough to sit under a page of text.
  var PRESETS = {
    red: { label: "Crimson", core: "#f8291c" },
    sunset: { label: "Sunset", core: "#e67e22" },
    amber: { label: "Amber", core: "#f39c12" },
    gold: { label: "Gold", core: "#d4a017" },
    forest: { label: "Forest", core: "#27ae60" },
    emerald: { label: "Emerald", core: "#2ecc71" },
    teal: { label: "Teal", core: "#12a594" },
    cyan: { label: "Cyan", core: "#0e9bb5" },
    ocean: { label: "Ocean", core: "#1c80be" },
    indigo: { label: "Indigo", core: "#4f5bd5" },
    amethyst: { label: "Amethyst", core: "#9b2dc4" },
    orchid: { label: "Orchid", core: "#b5389e" },
    pink: { label: "Pink", core: "#d6336c" },
    rose: { label: "Rose", core: "#e05561" },
    slate: { label: "Slate", core: "#5a7d8e" },
    graphite: { label: "Graphite", core: "#7a7a8c" },
  };

  var DEFAULT_ACCENT = PRESETS.red.core;

  /* ── COLOR MATH ─────────────────────────────────────────────── */
  function hexToHsl(hex) {
    hex = hex.replace("#", "");
    var r = parseInt(hex.slice(0, 2), 16) / 255;
    var g = parseInt(hex.slice(2, 4), 16) / 255;
    var b = parseInt(hex.slice(4, 6), 16) / 255;
    var max = Math.max(r, g, b),
      min = Math.min(r, g, b);
    var h = 0,
      s = 0,
      l = (max + min) / 2;
    if (max !== min) {
      var d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6;
    }
    return [h * 360, s * 100, l * 100];
  }

  function hslToHex(h, s, l) {
    s /= 100;
    l /= 100;
    var c = (1 - Math.abs(2 * l - 1)) * s;
    var x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    var m = l - c / 2;
    var rgb;
    if (h < 60) rgb = [c, x, 0];
    else if (h < 120) rgb = [x, c, 0];
    else if (h < 180) rgb = [0, c, x];
    else if (h < 240) rgb = [0, x, c];
    else if (h < 300) rgb = [x, 0, c];
    else rgb = [c, 0, x];
    return (
      "#" +
      rgb
        .map(function (n) {
          return Math.round((n + m) * 255)
            .toString(16)
            .padStart(2, "0");
        })
        .join("")
    );
  }

  function hexToRgb(hex) {
    hex = hex.replace("#", "");
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
    ];
  }

  /** Derive the accent family from one hue.
   *
   *  --accent keeps the raw hue: a filled button paints #fff on it, and
   *  lightening it there would cost the label its legibility. Accent-coloured
   *  TEXT is a separate token, re-lightened against the current surface — a
   *  mid-lightness hue like Ocean carries a fill fine but nearly vanishes as
   *  11px text on #1a1a1e. */
  function derivePalette(coreHex, isLight) {
    var hsl = hexToHsl(coreHex);
    var h = hsl[0],
      s = hsl[1],
      l = hsl[2];
    var rgb = hexToRgb(coreHex);
    var textL = isLight ? Math.min(l, 44) : Math.max(l, 62);

    return {
      "--accent-base": coreHex,
      "--accent": coreHex,
      "--accent-text": hslToHex(h, s, textL),
      "--accent-hover": hslToHex(h, s, Math.max(l - 12, 8)),
      "--accent-bg": "rgba(" + rgb.join(", ") + ", 0.10)",
      "--accent-border": "rgba(" + rgb.join(", ") + ", 0.24)",
      "--accent-h": String(Math.round(h)),
      "--accent-s": Math.round(s) + "%",
      "--accent-l": Math.round(l) + "%",
    };
  }

  function resolveMode(key) {
    return MODES[key] ? key : LEGACY_MODE_MAP[key] || "dark";
  }

  function loadSavedTheme() {
    var mode, accent;
    try {
      mode = resolveMode(localStorage.getItem("aria_theme_mode"));
      accent = localStorage.getItem("aria_theme_accent") || DEFAULT_ACCENT;
    } catch (e) {
      mode = "dark";
      accent = DEFAULT_ACCENT;
    }
    return { mode: mode, accent: accent };
  }

  /** Paint a mode + accent onto :root. Safe to call before <body> exists —
   *  everything that touches document.body is guarded. */
  function applyThemeFull(mode, accentHex) {
    var key = resolveMode(mode);
    var def = MODES[key];
    var root = document.documentElement;

    // 1. Surface + typography tokens
    Object.keys(def.vars).forEach(function (k) {
      root.style.setProperty(k, def.vars[k]);
    });
    root.style.setProperty("color-scheme", def.light ? "light" : "dark");

    // 2. Light/dark hooks the stylesheets key off
    root.setAttribute("data-theme", def.light ? "light" : "dark");
    root.classList.toggle("light-mode", !!def.light);

    // 3. Accent family
    var palette = derivePalette(accentHex, def.light);
    Object.keys(palette).forEach(function (k) {
      root.style.setProperty(k, palette[k]);
    });

    // 4. The old neon --glow-* tokens are elevation shadows now.
    var flat = def.vars["--shadow"] === "none";
    root.style.setProperty("--glow-sm", flat ? "none" : def.vars["--shadow-sm"]);
    root.style.setProperty("--glow-md", flat ? "none" : def.vars["--shadow"]);
    root.style.setProperty("--glow-lg", flat ? "none" : def.vars["--shadow-lg"]);
    root.style.setProperty("--glow-ultra", flat ? "none" : def.vars["--shadow-lg"]);

    // 5. Status-bar / task-switcher colour follows the theme
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", def.vars["--bg"]);

    // 6. Mode body class + settings-UI selection state (post-paint only)
    var body = document.body;
    if (body) {
      Object.keys(MODES).forEach(function (m) {
        body.classList.remove(MODES[m].bodyClass);
      });
      body.classList.add(def.bodyClass);

      document.querySelectorAll(".themeSwatchV2").forEach(function (s) {
        s.classList.toggle("active", s.dataset.accent === accentHex);
      });
      document.querySelectorAll(".themeModeCard").forEach(function (s) {
        s.classList.toggle("active", s.dataset.mode === key);
      });
    }

    // 7. Persist
    try {
      localStorage.setItem("aria_theme_mode", key);
      localStorage.setItem("aria_theme_accent", accentHex);
    } catch (e) {}
  }

  function applySavedTheme() {
    var saved = loadSavedTheme();
    applyThemeFull(saved.mode, saved.accent);
  }

  /* ── CUSTOM SAVED COLORS ────────────────────────────────────── */
  function getCustomColors() {
    try {
      return JSON.parse(localStorage.getItem("aria_custom_colors") || "[]");
    } catch (e) {
      return [];
    }
  }
  function saveCustomColor(hex, name) {
    var list = getCustomColors();
    list.unshift({ hex: hex, name: name || hex, savedAt: Date.now() });
    // Keep max 8 custom slots
    try {
      localStorage.setItem("aria_custom_colors", JSON.stringify(list.slice(0, 8)));
    } catch (e) {}
  }
  function deleteCustomColor(hex) {
    var list = getCustomColors().filter(function (c) {
      return c.hex !== hex;
    });
    try {
      localStorage.setItem("aria_custom_colors", JSON.stringify(list));
    } catch (e) {}
  }

  window.ARIA_Theme = {
    THEME_MODES: MODES,
    ACCENT_PRESETS: PRESETS,
    DEFAULT_ACCENT: DEFAULT_ACCENT,
    derivePalette: derivePalette,
    applyThemeFull: applyThemeFull,
    loadSavedTheme: loadSavedTheme,
    applySavedTheme: applySavedTheme,
    getCustomColors: getCustomColors,
    saveCustomColor: saveCustomColor,
    deleteCustomColor: deleteCustomColor,
  };

  // ── Apply the saved theme now, before paint ──
  applySavedTheme();

  // The mode body class needs <body>, which doesn't exist yet at this point.
  document.addEventListener("DOMContentLoaded", applySavedTheme);
})();
