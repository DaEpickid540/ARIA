// lib/claw-apps.js — which running process is "the app the owner named"
// ═══════════════════════════════════════════════════════════════════
//
// Shared by claw-relay.js (close: <app>, apps) and its tests. Nothing here
// touches the machine: the relay lists processes and hands them over as
// { id, name, description, product, title? }, and these functions decide
// which of them a name like "github desktop" means, and which are never
// closed at all.
// ═══════════════════════════════════════════════════════════════════

// Never closed by close: — Windows itself, and ARIA (the relay runs in it).
export const CLOSE_NEVER = new Set([
  "aria", "explorer", "dwm", "csrss", "winlogon", "svchost", "sihost", "ctfmon",
  "conhost", "runtimebroker", "searchhost", "startmenuexperiencehost",
  "shellexperiencehost", "textinputhost", "lockapp", "msedgewebview2",
  "applicationframehost", "systemsettings", "taskmgr", "fontdrvhost", "lsass",
  // ARIA run from source (npm run desktop) is a process called "electron".
  "electron",
]);

// Names people say that match nothing a process calls itself.
export const CLOSE_ALIASES = {
  vscode: "Visual Studio Code",
  "vs code": "Visual Studio Code",
  word: "Microsoft Word",
  excel: "Microsoft Excel",
  powerpoint: "Microsoft PowerPoint",
  "file explorer": "explorer",
  files: "explorer",
};

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** How well a running process matches an app name, 0–100 (the Start Menu scoring). */
export function processScore(query, p) {
  const q = norm(query);
  if (!q) return 0;
  const qc = q.replace(/ /g, "");
  const qTokens = q.split(" ");
  let best = 0;
  // "GitHubDesktop" (process) and "GitHub Desktop" (description) both match
  // "github desktop". The product name counts a little less: an app's own
  // installer or updater shares it ("Visual Studio Code").
  for (const [label, weight] of [[p.name, 0], [p.description, 0], [p.product, 1]]) {
    const n = norm(label);
    if (!n) continue;
    const nc = n.replace(/ /g, "");
    let score = 0;
    if (n === q || nc === qc) score = 100;
    else if (n.startsWith(q) || nc.startsWith(qc)) score = 80;
    else if (n.split(" ").includes(q)) score = 70;
    else if (qc.length >= 4 && nc.includes(qc)) score = 60;
    else if (qTokens.every((t) => n.includes(t))) score = 50;
    if (!score) continue;
    score -= Math.min(Math.abs(n.length - q.length), 30) * 0.2 + weight;
    best = Math.max(best, score);
  }
  return best;
}

/** True for a name close: refuses outright. */
export function neverClose(name) {
  return CLOSE_NEVER.has(String(name || "").toLowerCase().replace(/\.exe$/, "").replace(/[^a-z0-9]/g, ""));
}

/**
 * The processes close: <appRaw> means.
 * @returns {{ refused: string } | { app: string, hits: object[] }}
 *   hits is empty when nothing running matches.
 */
export function pickProcesses(procs, appRaw, { selfPid = -1 } = {}) {
  const app = CLOSE_ALIASES[String(appRaw || "").toLowerCase().trim()] || String(appRaw || "").trim();
  if (!app) return { refused: "no app named" };
  if (neverClose(app)) return { refused: `won't close ${app} (Windows or ARIA itself)` };

  const scored = (procs || [])
    .filter((p) => p && p.id !== selfPid && !neverClose(p.name))
    .map((p) => ({ ...p, score: processScore(app, p) }))
    .filter((p) => p.score >= 50);
  if (!scored.length) return { app, hits: [] };
  // Only the best name: "edge" closes Edge, not every app whose description
  // mentions Edge further down. An app's helper processes share its name.
  const top = Math.max(...scored.map((p) => p.score));
  let hits = scored.filter((p) => p.score >= top - 0.5);
  // On a tie, the process actually named after the app wins: msedge over
  // other things whose description says "Microsoft Edge".
  const named = hits.filter((p) => processScore(app, { name: p.name }) >= 50);
  if (named.length) hits = named;
  return { app, hits };
}

/**
 * Windowed processes → one line per app, for `apps` and the Claw panel.
 * Several windows of one app collapse into one entry with a count.
 * @returns {{ name: string, label: string, title: string, windows: number }[]}
 */
export function summarizeApps(procs) {
  const by = new Map();
  for (const p of procs || []) {
    const name = String(p?.name || "").trim();
    if (!name || neverClose(name)) continue;
    const k = name.toLowerCase();
    const title = String(p.title || "").replace(/\s+/g, " ").trim();
    const label = String(p.description || "").trim() || name;
    const e = by.get(k);
    if (e) {
      e.windows++;
      if (!e.title && title) e.title = title;
    } else by.set(k, { name, label: label.slice(0, 60), title: title.slice(0, 80), windows: 1 });
  }
  return [...by.values()].sort((a, b) => a.label.localeCompare(b.label));
}

/** The `apps` result as the model and the panel read it. */
export function formatApps(apps) {
  if (!apps.length) return "No apps with a window are open.";
  return (
    `${apps.length} app${apps.length === 1 ? "" : "s"} open:\n` +
    apps.map((a) => `- ${a.label}${a.windows > 1 ? ` ×${a.windows}` : ""}${a.title && a.title !== a.label ? ` — ${a.title}` : ""}`).join("\n")
  );
}

/** `apps` output back into names (the panel's chips). */
export function parseAppsText(text) {
  return String(text || "")
    .split("\n")
    .map((l) => /^- (.+?)(?: ×\d+)?(?: — (.*))?$/.exec(l.trim()))
    .filter(Boolean)
    .map((m) => ({ label: m[1], title: m[2] || "" }));
}
