// version.js — single source of truth for ARIA version
// To update: change MARK and POINT below, redeploy. Everything updates automatically.
//
// Format: Mark {MARK}.{POINT} ARIA
// Examples: Mark 1.0 ARIA, Mark 2.3 ARIA, Mark 4.1 ARIA

export const ARIA_VERSION = {
  mark: 1, // ← change this for major releases
  point: 0, // ← change this for minor updates

  // Auto-computed — do not edit below this line
  get full() {
    return `Mark ${this.mark}.${this.point} ARIA`;
  },
  get short() {
    return `M${this.mark}.${this.point}`;
  },
  get tag() {
    return `M${this.mark}.${this.point} // ARIA`;
  },
};

/* ============================================================
   INJECT VERSION INTO ALL UI LOCATIONS
   Call this once on page load — it stamps the version string
   into every element that has data-aria-version on it, plus
   the specific known hardcoded spots.
   ============================================================ */
export function applyVersion() {
  const v = ARIA_VERSION;

  // Any element with data-aria-version gets the full string injected
  document.querySelectorAll("[data-aria-version]").forEach((el) => {
    const fmt = el.dataset.ariaVersion;
    if (fmt === "full") el.textContent = v.full;
    if (fmt === "short") el.textContent = v.short;
    if (fmt === "tag") el.textContent = v.tag;
    if (!fmt) el.textContent = v.full;
  });

  // Hardcoded known locations
  const map = {
    ".lockVersion": `${v.short} // SECURE NODE`,
    ".aboutVersion": `${v.full} // Personal AI OS`,
  };
  Object.entries(map).forEach(([sel, text]) => {
    document.querySelectorAll(sel).forEach((el) => {
      el.textContent = text;
    });
  });

  // Page title
  document.title = `ARIA — ${v.full}`;

  console.log(`[ARIA] ${v.full}`);
}
