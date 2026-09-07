// themes.js — ARIA Theme System V3 (ES-module facade)
// ═══════════════════════════════════════════════════════════════════
//
// Architecture:
//   THEME MODE   = surface palette + typography (dark, light, dim, mono)
//   ACCENT COLOR = the primary hue (16 presets + custom HSL picker)
//
// The tables and the colour math live in js/themePreload.js, a plain blocking
// script in <head>. It has to be a classic script so it can run before first
// paint (modules are deferred), and the definitions can't be in both places
// without drifting — so this module is a facade over what that file exposes on
// window.ARIA_Theme. Import from here; edit the tables there.
//
// Modes write the design-system tokens (--bg, --bg-card, --text, …) that
// base.css defines. Everything the app draws — including the legacy
// --bg-void / --red-core / --text-blaze names — is aliased onto those tokens,
// so setting that small set repaints the whole UI.
//
// ═══════════════════════════════════════════════════════════════════

const T = window.ARIA_Theme;

if (!T) {
  // Only reachable if index.html stopped loading js/themePreload.js before its
  // modules. Fail loudly rather than silently rendering an unthemed page.
  throw new Error(
    "[ARIA] themes.js requires js/themePreload.js to be loaded first (blocking <script> in <head>).",
  );
}

export const THEME_MODES = T.THEME_MODES;
export const ACCENT_PRESETS = T.ACCENT_PRESETS;
export const DEFAULT_ACCENT = T.DEFAULT_ACCENT;

export const derivePalette = T.derivePalette;
export const applyThemeFull = T.applyThemeFull;
export const loadSavedTheme = T.loadSavedTheme;
export const applySavedTheme = T.applySavedTheme;
export const getCustomColors = T.getCustomColors;
export const saveCustomColor = T.saveCustomColor;
export const deleteCustomColor = T.deleteCustomColor;
