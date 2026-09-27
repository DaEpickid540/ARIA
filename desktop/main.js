// desktop/main.js — ARIA as a desktop app (Electron main process)
// ═══════════════════════════════════════════════════════════════════
//
// WHAT IT DOES
//   Runs the same server.js that Render runs, on this PC, and shows it in its
//   own window. Nothing is rewritten for the desktop: the window is the web UI
//   at http://127.0.0.1:<port>.
//
//   - server.js runs in an Electron utility process (a Node child), so a crash
//     there shows an error instead of taking the window down with it.
//   - Keys come from %APPDATA%\ARIA\.env (seeded from .env.example on first
//     run; ARIA ▸ Edit API keys opens it). server.js itself never loads .env.
//   - Data (chats, memory, tasks, notes…) goes to %APPDATA%\ARIA\data through
//     ARIA_DATA_DIR, so updating or uninstalling the app never touches it.
//   - Ollama needs no hook: the server is on the same PC, so it talks to
//     OLLAMA_URL (localhost:11434) directly and the model switcher lists them.
//   - Claw (PC control) is off until you turn it on: in ARIA's Claw panel
//     (through preload.cjs's window.ariaDesktop) or the ARIA menu. It runs
//     claw-relay.js against this local server.
//   - Keys saved in Settings ▸ Keys go to the same .env (ARIA_ENV_FILE).
//   - The server binds 127.0.0.1 only. Locally the API has no login
//     (lib/auth.js), so it must not be reachable from the LAN.
// ═══════════════════════════════════════════════════════════════════

import {
  app,
  BrowserWindow,
  Menu,
  dialog,
  ipcMain,
  shell,
  session,
  utilityProcess,
} from "electron";
import fs from "fs";
import net from "net";
import path from "path";
import { parseEnv } from "util";
import { fileURLToPath } from "url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
// A second, separate copy (e.g. a dev build next to the installed app): its
// own keys, data and single-instance lock.
if (process.env.ARIA_USER_DATA) app.setPath("userData", process.env.ARIA_USER_DATA);
const USER_DIR = app.getPath("userData");
const DATA_DIR = path.join(USER_DIR, "data");
const LOG_DIR = path.join(USER_DIR, "logs");
const SETTINGS_FILE = path.join(USER_DIR, "desktop.json");
// Running from a checkout (`npm run desktop`) uses the repo's .env if there is
// one, so you don't keep two copies of your keys in sync while developing.
const REPO_ENV = path.join(ROOT, ".env");
const ENV_FILE =
  !app.isPackaged && fs.existsSync(REPO_ENV) ? REPO_ENV : path.join(USER_DIR, ".env");

const HOST = "127.0.0.1";
// Fixed, so the origin (and with it localStorage: theme, lock state…) stays
// the same between launches. Only moves if something else holds it.
const PREFERRED_PORT = 3717;
const START_TIMEOUT_MS = 60_000;

let win = null;
let server = null; // utility process running server.js
let relay = null; // utility process running claw-relay.js
let origin = "";
let quitting = false;

// ── Settings (desktop-only switches) ──────────────────────────────
function loadSettings() {
  try {
    return { claw: false, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8")) };
  } catch {
    return { claw: false };
  }
}
function saveSettings(s) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(s, null, 2));
}
let settings = loadSettings();

// ── First run ─────────────────────────────────────────────────────
function prepareUserDir() {
  for (const d of [USER_DIR, DATA_DIR, LOG_DIR]) fs.mkdirSync(d, { recursive: true });

  if (!fs.existsSync(ENV_FILE)) {
    const template = path.join(ROOT, ".env.example");
    fs.writeFileSync(ENV_FILE, fs.existsSync(template) ? fs.readFileSync(template) : "");
  }

  // Skills that ship in the repo's skills/user/ become your own editable copies.
  const skillsDir = path.join(DATA_DIR, "skills");
  const bundled = path.join(ROOT, "skills", "user");
  if (!fs.existsSync(skillsDir) && fs.existsSync(bundled)) {
    try {
      copyDir(bundled, skillsDir);
    } catch (e) {
      console.warn("[desktop] couldn't copy bundled skills:", e.message);
    }
  }
}

// fs.cpSync can't read out of app.asar; readdir/readFile can.
function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dst);
    else fs.writeFileSync(dst, fs.readFileSync(src));
  }
}

function readEnvFile() {
  try {
    return parseEnv(fs.readFileSync(ENV_FILE, "utf8"));
  } catch {
    return {};
  }
}

/** Has at least one cloud provider key, or Ollama to fall back on? */
function hasAnyProviderKey(env) {
  return [
    "OPENROUTER_API_KEY",
    "GROQ_API_KEY",
    "DEEPSEEK_KEY",
    "NEMOTRON_NVIDIA",
    "CLOUDFLARE_AI_API",
  ].some((k) => env[k]);
}

// ── Port ──────────────────────────────────────────────────────────
function portFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.listen(port, HOST, () => s.close(() => resolve(true)));
  });
}
async function pickPort() {
  for (let p = PREFERRED_PORT; p < PREFERRED_PORT + 20; p++) {
    if (await portFree(p)) return p;
  }
  throw new Error(`No free port between ${PREFERRED_PORT} and ${PREFERRED_PORT + 19}.`);
}

// ── Child processes ───────────────────────────────────────────────
function childEnv(extra) {
  const env = { ...process.env, ...readEnvFile(), ...extra };
  // A .env copied from a Render setup must not flip the local server into
  // public-deploy mode (that turns Claw off and demands a login).
  delete env.RENDER;
  delete env.RENDER_EXTERNAL_URL;
  delete env.ARIA_PUBLIC;
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

function pipeToLog(child, name) {
  const file = path.join(LOG_DIR, `${name}.log`);
  const out = fs.createWriteStream(file, { flags: "w" });
  const tail = [];
  const onData = (buf) => {
    out.write(buf);
    tail.push(...buf.toString().split(/\r?\n/).filter(Boolean));
    if (tail.length > 40) tail.splice(0, tail.length - 40);
  };
  child.stdout?.on("data", onData);
  child.stderr?.on("data", onData);
  child.on("exit", () => out.end());
  return { file, tail };
}

let serverLog = null;

async function startServer() {
  const port = await pickPort();
  origin = `http://${HOST}:${port}`;
  const child = utilityProcess.fork(path.join(ROOT, "server.js"), [], {
    serviceName: "ARIA server",
    stdio: "pipe",
    cwd: USER_DIR,
    env: childEnv({
      PORT: String(port),
      ARIA_HOST: HOST,
      ARIA_DATA_DIR: DATA_DIR,
      ARIA_ENV_FILE: ENV_FILE,
      // Tells the server to point at the Claw panel's switch, not at
      // `node claw-relay.js`, when PC control is off.
      ARIA_DESKTOP: "1",
      NODE_ENV: "production",
    }),
  });
  server = child;
  serverLog = pipeToLog(child, "server");

  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.once("exit", (code) => {
    // stopServer() clears `server` first, so a deliberate stop lands here
    // with server !== child and stays quiet.
    if (server !== child) return;
    server = null;
    if (!quitting) showServerDied(code);
  });

  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const early = await Promise.race([exited.then(() => true), sleep(400).then(() => false)]);
    if (early) throw new Error("The ARIA server exited while starting.");
    try {
      const r = await fetch(`${origin}/api/health`);
      if (r.ok) return;
    } catch {
      /* not listening yet */
    }
  }
  throw new Error("The ARIA server did not start within 60 seconds.");
}

function stopServer() {
  const s = server;
  server = null;
  s?.kill();
}

function startRelay() {
  if (relay || !origin) return;
  relay = utilityProcess.fork(path.join(ROOT, "claw-relay.js"), [origin], {
    serviceName: "ARIA Claw relay",
    stdio: "pipe",
    cwd: USER_DIR,
    env: childEnv({}),
  });
  const child = relay;
  pipeToLog(child, "claw-relay");
  child.once("exit", () => {
    if (relay === child) relay = null;
  });
}

function stopRelay() {
  const r = relay;
  relay = null;
  r?.kill();
}

/** The one switch for PC control, from the page or the menu. */
function setClaw(on) {
  settings = { ...settings, claw: !!on };
  saveSettings(settings);
  if (on) startRelay();
  else stopRelay();
  buildMenu(); // keep the menu checkbox in step
  return settings.claw;
}

ipcMain.handle("aria:getClaw", () => settings.claw);
ipcMain.handle("aria:setClaw", (_e, on) => setClaw(on));

async function restartAll() {
  stopRelay();
  stopServer();
  await sleep(600);
  await boot();
}

// ── Errors ────────────────────────────────────────────────────────
function lastLogLines() {
  return serverLog?.tail.slice(-12).join("\n") || "(no output)";
}

async function showServerDied(code) {
  if (!win || win.isDestroyed()) return;
  stopRelay();
  const { response } = await dialog.showMessageBox(win, {
    type: "error",
    title: "ARIA",
    message: `The ARIA server stopped (exit code ${code}).`,
    detail: lastLogLines(),
    buttons: ["Restart", "Open log", "Quit"],
    defaultId: 0,
    cancelId: 2,
  });
  if (response === 0) restartAll();
  else if (response === 1) shell.openPath(serverLog.file);
  else app.quit();
}

// ── Window ────────────────────────────────────────────────────────
const SPLASH = `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html>
<html><head><style>
  html,body{margin:0;height:100%;background:#1a1a1e;color:#cfcfd6;
    font:15px system-ui,sans-serif;display:grid;place-items:center}
  .d{width:10px;height:10px;border-radius:50%;background:#8b8bff;display:inline-block;
    margin-right:10px;animation:p 1s ease-in-out infinite alternate}
  @keyframes p{from{opacity:.25}to{opacity:1}}
</style></head><body><div><span class="d"></span>Starting ARIA…</div></body></html>`)}`;

function isLocal(url) {
  return origin && (url === origin || url.startsWith(origin + "/"));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 420,
    minHeight: 520,
    backgroundColor: "#1a1a1e",
    title: "ARIA",
    icon: path.join(ROOT, "public", "icons", "icon-512.png"),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      preload: path.join(ROOT, "desktop", "preload.cjs"),
    },
  });
  win.once("ready-to-show", () => win.show());

  // Links out of ARIA open in your browser, not in a bare Electron window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url) && !isLocal(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (isLocal(url) || url.startsWith("data:")) return;
    e.preventDefault();
    if (/^https?:/i.test(url)) shell.openExternal(url);
  });

  win.on("closed", () => {
    win = null;
  });
  win.loadURL(SPLASH);
}

// Voice chat needs the microphone; grant what ARIA's own page asks for and
// nothing to anything else.
function setPermissions() {
  const allowed = new Set(["media", "notifications", "clipboard-sanitized-write", "fullscreen"]);
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => {
    cb(isLocal(wc.getURL()) && allowed.has(permission));
  });
  session.defaultSession.setPermissionCheckHandler((wc, permission, requestingOrigin) => {
    // Electron may pass the origin with or without a trailing slash.
    return isLocal(requestingOrigin) && allowed.has(permission);
  });
}

// ── Menu ──────────────────────────────────────────────────────────
function buildMenu() {
  const template = [
    {
      label: "ARIA",
      submenu: [
        {
          label: "Edit API keys (.env)…",
          click: async () => {
            await shell.openPath(ENV_FILE);
            dialog.showMessageBox(win, {
              type: "info",
              title: "ARIA",
              message: "Save the file, then use ARIA ▸ Restart server to load the new keys.",
            });
          },
        },
        { label: "Restart server", accelerator: "CmdOrCtrl+Shift+R", click: () => restartAll() },
        { type: "separator" },
        {
          label: "PC control (Claw relay)",
          type: "checkbox",
          checked: settings.claw,
          click: (item) => setClaw(item.checked),
        },
        { type: "separator" },
        { label: "Open in browser", click: () => origin && shell.openExternal(origin) },
        { label: "Open data folder", click: () => shell.openPath(DATA_DIR) },
        { label: "Open logs folder", click: () => shell.openPath(LOG_DIR) },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── Boot ──────────────────────────────────────────────────────────
async function boot() {
  try {
    await startServer();
  } catch (e) {
    const { response } = await dialog.showMessageBox(win, {
      type: "error",
      title: "ARIA",
      message: e.message,
      detail: lastLogLines(),
      buttons: ["Open log", "Quit"],
    });
    if (response === 0) await shell.openPath(serverLog?.file || LOG_DIR);
    app.quit();
    return;
  }
  if (settings.claw) startRelay();
  await win?.loadURL(origin);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(async () => {
    prepareUserDir();
    setPermissions();
    buildMenu();
    createWindow();

    if (!hasAnyProviderKey(readEnvFile())) {
      dialog
        .showMessageBox(win, {
          type: "info",
          title: "ARIA",
          message: "Add an AI provider key to get replies.",
          detail:
            "ARIA can use Ollama on this PC with no key. For cloud models, open Settings ▸ Keys " +
            "and add one (OpenRouter or Groq; both have free tiers). A Groq key also makes " +
            "voice input faster.",
          buttons: ["OK"],
        });
    }

    await boot();
  });

  app.on("window-all-closed", () => app.quit());

  // Give the server a moment to finish its debounced (500 ms) JSON writes;
  // on Windows kill() ends it outright, so SIGTERM handlers never run.
  app.on("before-quit", (e) => {
    if (quitting) return;
    quitting = true;
    e.preventDefault();
    stopRelay();
    setTimeout(() => {
      stopServer();
      app.quit();
    }, 800);
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
