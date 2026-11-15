// Run: npm test   (or node --test tests/claw-apps.test.mjs)
// close: <app> and `apps` — which running process a spoken app name means,
// what is never closed, and how the list of open apps reads. The relay does
// the listing and closing (claw-relay.js); the choosing is here.
import test from "node:test";
import assert from "node:assert/strict";
import { processScore, pickProcesses, neverClose, summarizeApps, formatApps, parseAppsText } from "../lib/claw-apps.js";

const PROCS = [
  { id: 1, name: "msedge", description: "Microsoft Edge", product: "Microsoft Edge" },
  { id: 2, name: "msedge", description: "Microsoft Edge", product: "Microsoft Edge" },
  { id: 3, name: "msedgewebview2", description: "Microsoft Edge WebView2", product: "Microsoft Edge WebView2" },
  { id: 4, name: "GitHubDesktop", description: "GitHub Desktop", product: "GitHub Desktop" },
  { id: 5, name: "Code", description: "Visual Studio Code", product: "Visual Studio Code" },
  { id: 6, name: "CodeSetup-stable", description: "Visual Studio Code Setup", product: "Visual Studio Code" },
  { id: 7, name: "EpicGamesLauncher", description: "EpicGamesLauncher", product: "Unreal Engine" },
  { id: 8, name: "explorer", description: "Windows Explorer", product: "Microsoft Windows" },
  { id: 9, name: "ARIA", description: "ARIA", product: "ARIA" },
  { id: 10, name: "Spotify", description: "Spotify", product: "Spotify" },
  { id: 11, name: "SearchHost", description: "Edge search helper", product: "Microsoft Windows" },
];
const names = (r) => [...new Set(r.hits.map((p) => p.name))];

test("a spoken name finds the app's processes, however it's spaced", () => {
  assert.deepEqual(names(pickProcesses(PROCS, "github desktop")), ["GitHubDesktop"]);
  assert.deepEqual(names(pickProcesses(PROCS, "GitHub Desktop")), ["GitHubDesktop"]);
  assert.deepEqual(names(pickProcesses(PROCS, "epic games launcher")), ["EpicGamesLauncher"]);
  assert.deepEqual(names(pickProcesses(PROCS, "spotify")), ["Spotify"]);
  assert.equal(pickProcesses(PROCS, "spotify").hits.length, 1);
});

test("'edge' closes Edge (all its processes), not WebView2 or things that mention Edge", () => {
  const r = pickProcesses(PROCS, "edge");
  assert.deepEqual(names(r), ["msedge"]);
  assert.equal(r.hits.length, 2, "both msedge processes");
  assert.deepEqual(names(pickProcesses(PROCS, "microsoft edge")), ["msedge"]);
});

test("aliases: 'vscode' is Visual Studio Code, and its installer isn't closed with it", () => {
  for (const q of ["vscode", "VS Code", "visual studio code"]) assert.deepEqual(names(pickProcesses(PROCS, q)), ["Code"], q);
});

test("Windows and ARIA are refused by name, and never among the hits", () => {
  for (const q of ["explorer", "ARIA", "aria.exe", "File Explorer", "dwm", "electron"]) assert.match(pickProcesses(PROCS, q).refused || "", /won't close/, q);
  assert.equal(neverClose("SearchHost"), true);
  // A loose name that also matches a protected process's description.
  assert.ok(!pickProcesses(PROCS, "edge").hits.some((p) => p.name === "SearchHost"));
  assert.equal(pickProcesses(PROCS, "").refused, "no app named");
});

test("nothing matching is 'not running', and the relay's own process is skipped", () => {
  assert.deepEqual(pickProcesses(PROCS, "blender"), { app: "blender", hits: [] });
  assert.deepEqual(pickProcesses(PROCS, "spotify", { selfPid: 10 }).hits, []);
  assert.equal(processScore("", { name: "x" }), 0);
});

test("apps: one line per app, windows counted, protected processes left out", () => {
  const apps = summarizeApps([
    { name: "msedge", description: "Microsoft Edge", title: "Inbox - Mail" },
    { name: "msedge", description: "Microsoft Edge", title: "Docs" },
    { name: "Code", description: "Visual Studio Code", title: "server.js - ARIA" },
    { name: "explorer", description: "Windows Explorer", title: "Downloads" },
    { name: "Notepad", description: "", title: "Notepad" },
  ]);
  assert.deepEqual(apps.map((a) => [a.label, a.windows]), [["Microsoft Edge", 2], ["Notepad", 1], ["Visual Studio Code", 1]]);
  const text = formatApps(apps);
  assert.match(text, /^3 apps open:\n- Microsoft Edge ×2 — Inbox - Mail\n- Notepad\n- Visual Studio Code — server\.js - ARIA$/);
  assert.deepEqual(parseAppsText(text).map((a) => a.label), ["Microsoft Edge", "Notepad", "Visual Studio Code"]);
  assert.equal(formatApps([]), "No apps with a window are open.");
  assert.equal(formatApps(summarizeApps([{ name: "Spotify" }])), "1 app open:\n- Spotify");
});
