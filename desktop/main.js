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
//   - Claw (PC control) is on while the app runs unless you switch it off:
//     in ARIA's Claw panel (through preload.cjs's window.ariaDesktop) or the
//     ARIA menu. It runs
//     claw-relay.js against this local server, and a second copy against
//     Render (ARIA ▸ Reachable from anywhere) so ARIA opened on any other
//     machine can still control this PC. That one signs in with this PC's
//     own secret (machine.json), registered through lib/owners.js. A relay
//     that drops is restarted, backing off up to a minute.
//   - Texting (ARIA ▸ Texting) runs aria-voice-hook.js against this local
//     server, so texts reach the same server the Claw relay serves and can
//     use PC control. Needs ARIA_SMS_PASSWORD in the .env.
//   - With PC control or texting on, closing the window leaves ARIA in the
//     tray; the tray icon's dot is their state. Quit from the tray or menu.
//     ARIA ▸ Claw & texting log shows both live.
//   - Keys saved in Settings ▸ Keys go to the same .env (ARIA_ENV_FILE).
//   - The server binds 127.0.0.1 only. Locally the API has no login
//     (lib/auth.js), so it must not be reachable from the LAN.
// ═══════════════════════════════════════════════════════════════════

import {
  app,
  BrowserWindow,
  Menu,
  Notification,
  Tray,
  dialog,
  globalShortcut,
  ipcMain,
  nativeImage,
  shell,
  session,
  utilityProcess,
} from "electron";
import crypto from "crypto";
import fs from "fs";
import net from "net";
import os from "os";
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

const APP_ICON = path.join(ROOT, "public", "icons", "icon-512.png");

const HOST = "127.0.0.1";
// Fixed, so the origin (and with it localStorage: theme, lock state…) stays
// the same between launches. Only moves if something else holds it.
const PREFERRED_PORT = 3717;
const START_TIMEOUT_MS = 60_000;

let win = null;
let server = null; // utility process running server.js
let relay = null; // utility process running claw-relay.js
let cloudRelay = null; // the same relay, connected to Render instead
let voice = null; // utility process running aria-voice-hook.js (texting)
let tray = null;
let logWin = null;
let origin = "";
const DEFAULT_CLOUD_URL = "https://aria-69jr.onrender.com";
let quitting = false;

// ── Settings (desktop-only switches) ──────────────────────────────
// claw: PC control on at all; on whenever the app runs unless you switched
// it off. clawPicked: you have used the switch (older builds saved claw:false
// without you ever touching it). remote: also reachable through Render, so
// signing in to ARIA on any other machine can reach this PC. texting: run the
// Google Voice hook. trayTold: the "still running in the tray" notice showed.
// wake: the page is listening for "Hey ARIA" (public/js/wakeWord.js).
const DEFAULT_SETTINGS = {
  claw: true,
  clawPicked: false,
  remote: true,
  texting: false,
  trayTold: false,
  wake: false,
};
function loadSettings() {
  let s;
  try {
    s = { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8")) };
  } catch {
    s = { ...DEFAULT_SETTINGS };
  }
  if (!s.clawPicked) s.claw = true;
  return s;
}
function saveSettings(s) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(s, null, 2));
}
let settings = loadSettings();

// ── This PC's identity ────────────────────────────────────────────
// A random id and secret, made once. The server registers the secret's hash
// in Firestore (lib/owners.js); Render then accepts this PC's relay with no
// relay key to configure anywhere.
function machineIdentity() {
  const file = path.join(USER_DIR, "machine.json");
  try {
    const m = JSON.parse(fs.readFileSync(file, "utf8"));
    if (m.id && m.secret) return m;
  } catch {}
  const m = {
    id: `pc-${crypto.randomBytes(6).toString("hex")}`,
    secret: crypto.randomBytes(32).toString("base64url"),
  };
  fs.writeFileSync(file, JSON.stringify(m, null, 2));
  return m;
}

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

// Writes a child's output to logs/<name>.log and keeps the last lines for
// error dialogs. onLine sees each complete line (a chunk can end mid-line).
function pipeToLog(child, name, onLine) {
  const file = path.join(LOG_DIR, `${name}.log`);
  const out = fs.createWriteStream(file, { flags: "w" });
  const tail = [];
  let partial = "";
  const onData = (buf) => {
    out.write(buf);
    const lines = (partial + buf.toString()).split(/\r?\n/);
    partial = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      tail.push(line);
      onLine?.(line);
    }
    if (tail.length > 40) tail.splice(0, tail.length - 40);
  };
  child.stdout?.on("data", onData);
  child.stderr?.on("data", onData);
  child.on("exit", () => out.end());
  return { file, tail };
}

let serverLog = null;

async function startServer() {
  const machine = machineIdentity();
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
      ARIA_MACHINE_ID: machine.id,
      ARIA_MACHINE_SECRET: machine.secret,
      ARIA_MACHINE_NAME: os.hostname(),
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

// ── Claw and texting: state, log ──────────────────────────────────
// Each child's state, for the tray, the menu and the log window:
// stopped | starting | running | sign-in (texting) | retrying
const status = { relay: "stopped", cloud: "stopped", texting: "stopped" };
const LOG_LINES = 500;
const activity = []; // { at, source, line }, newest last

function setStatus(key, value) {
  if (status[key] === value) return;
  status[key] = value;
  updateTray();
  buildMenu();
}

function pushLog(source, line) {
  const entry = { at: Date.now(), source, line };
  activity.push(entry);
  if (activity.length > LOG_LINES) activity.splice(0, activity.length - LOG_LINES);
  // While it loads, the page gets the whole backlog on did-finish-load.
  if (logWin && !logWin.isDestroyed() && !logWin.webContents.isLoading())
    logWin.webContents.executeJavaScript(`add(${JSON.stringify([entry])})`).catch(() => {});
}

function notify(title, body) {
  if (Notification.isSupported()) new Notification({ title, body, icon: APP_ICON }).show();
}

// ── Claw relays ───────────────────────────────────────────────────
const RELAY_ENV = { CLAW_RELAY_TYPE: "electron" }; // the Claw panel says "Electron"
let relayTimer = null;
let relayRetries = 0;
let cloudTimer = null;

function startRelay() {
  if (!origin) return;
  startLocalRelay();
  if (settings.remote) startCloudRelay();
}

function startLocalRelay() {
  if (relay || !origin) return;
  clearTimeout(relayTimer);
  setStatus("relay", "starting");
  const child = utilityProcess.fork(path.join(ROOT, "claw-relay.js"), [origin], {
    serviceName: "ARIA Claw relay",
    stdio: "pipe",
    cwd: USER_DIR,
    env: childEnv(RELAY_ENV),
  });
  relay = child;
  pipeToLog(child, "claw-relay", (line) => {
    pushLog("claw", line);
    if (line.includes("Registered with ARIA server")) {
      relayRetries = 0;
      setStatus("relay", "running");
    }
  });
  child.once("exit", (code) => {
    if (relay !== child) return; // stopped on purpose
    relay = null;
    if (quitting || !settings.claw) return setStatus("relay", "stopped");
    // It gives up after 10 failed registrations, and a crash ends it too.
    // Back off so one that can't start doesn't spin.
    const wait = Math.min(3000 * 2 ** relayRetries++, 60_000);
    setStatus("relay", "retrying");
    pushLog("app", `Claw relay stopped (exit code ${code}); restarting in ${wait / 1000}s.`);
    relayTimer = setTimeout(startLocalRelay, wait);
  });
}

// The second relay: Render queues commands for this PC when you use ARIA
// from a machine that can't reach this one directly.
function startCloudRelay() {
  if (cloudRelay) return;
  clearTimeout(cloudTimer);
  const cloudUrl = (readEnvFile().ARIA_CLOUD_URL || DEFAULT_CLOUD_URL).replace(/\/+$/, "");
  setStatus("cloud", "starting");
  cloudRelay = utilityProcess.fork(path.join(ROOT, "claw-relay.js"), [cloudUrl], {
    serviceName: "ARIA Claw relay (cloud)",
    stdio: "pipe",
    cwd: USER_DIR,
    env: childEnv({ ...RELAY_ENV, ARIA_RELAY_KEY: machineIdentity().secret }),
  });
  const child = cloudRelay;
  pipeToLog(child, "claw-relay-cloud", (line) => {
    pushLog("claw-cloud", line);
    if (line.includes("Registered with ARIA server")) setStatus("cloud", "running");
  });
  child.once("exit", () => {
    if (cloudRelay !== child) return; // stopped on purpose
    cloudRelay = null;
    setStatus("cloud", "retrying");
    // Render sleeps when idle and may not know this PC for a few seconds
    // after boot; the relay gives up in both cases, so try again later.
    cloudTimer = setTimeout(() => {
      if (!quitting && settings.claw && settings.remote && origin) startCloudRelay();
    }, 60_000);
  });
}

function stopCloudRelay() {
  clearTimeout(cloudTimer);
  const r = cloudRelay;
  cloudRelay = null;
  r?.kill();
  setStatus("cloud", "stopped");
}

function stopRelay() {
  clearTimeout(relayTimer);
  const r = relay;
  relay = null;
  r?.kill();
  relayRetries = 0;
  setStatus("relay", "stopped");
  stopCloudRelay();
}

function setRemote(on) {
  settings = { ...settings, remote: !!on };
  saveSettings(settings);
  if (!on) stopCloudRelay();
  else if (settings.claw) startCloudRelay();
  buildMenu();
}

/** The one switch for PC control, from the page or the menu. */
function setClaw(on) {
  settings = { ...settings, claw: !!on, clawPicked: true };
  saveSettings(settings);
  if (on) startRelay();
  else stopRelay();
  buildMenu(); // keep the menu checkbox in step
  return settings.claw;
}

ipcMain.handle("aria:getClaw", () => settings.claw);
ipcMain.handle("aria:setClaw", (_e, on) => setClaw(on));

// ── "Hey ARIA" and push-to-talk ───────────────────────────────────
// The listening happens in the page; the app keeps it alive in the tray,
// stops Chromium throttling a hidden window (or the mic stalls), and
// brings the window up when it hears its name.
ipcMain.handle("aria:show", (e) => {
  if (win && e.sender === win.webContents) showWindow();
});
ipcMain.handle("aria:setWake", (e, on) => {
  if (!win || e.sender !== win.webContents) return settings.wake;
  settings = { ...settings, wake: !!on };
  saveSettings(settings);
  win.webContents.setBackgroundThrottling(!settings.wake);
  buildMenu();
  return settings.wake;
});
function toggleWake(on) {
  win?.webContents.send("aria:wake", !!on); // the page answers with aria:setWake
}
const PTT_KEY = "CommandOrControl+Shift+Space";
function registerPushToTalk() {
  const ok = globalShortcut.register(PTT_KEY, () => {
    if (!win) return;
    showWindow();
    win.webContents.send("aria:ptt");
  });
  if (!ok) console.warn(`[desktop] ${PTT_KEY} is taken by another app; push-to-talk shortcut off`);
}

// ── Texting (Google Voice) ────────────────────────────────────────
// aria-voice-hook.js against this server, so a text reaches the server the
// Claw relay is attached to and can use PC control like the chat can.
function smsPasswordProblem() {
  const pw = (readEnvFile().ARIA_SMS_PASSWORD || "").trim();
  if (!pw) return "ARIA_SMS_PASSWORD isn't set.";
  if (pw.length < 8) return "ARIA_SMS_PASSWORD is shorter than 8 characters.";
  return null;
}

function startTexting() {
  if (voice || !origin) return;
  setStatus("texting", "starting");
  const child = utilityProcess.fork(path.join(ROOT, "aria-voice-hook.js"), [origin], {
    serviceName: "ARIA texting (Google Voice)",
    stdio: "pipe",
    cwd: USER_DIR,
    // The hook's own data/ would be inside app.asar.
    env: childEnv({ ARIA_DATA_DIR: DATA_DIR }),
  });
  voice = child;
  pipeToLog(child, "voice-hook", (line) => {
    pushLog("texts", line);
    if (/Watching .* for new texts/.test(line)) setStatus("texting", "running");
    else if (line.includes("Sign in to Google Voice")) {
      setStatus("texting", "sign-in");
      notify("ARIA texting", "Sign in to Google Voice in the browser window that just opened.");
    }
  });
  child.once("exit", (code) => {
    if (voice !== child) return; // stopped on purpose
    voice = null;
    if (quitting) return;
    // Not restarted: every start opens a browser window, and what ends it
    // (the window closed, signed out of Google, a missing package) needs
    // you. The switch goes off so the menu says what's actually running.
    settings = { ...settings, texting: false };
    saveSettings(settings);
    setStatus("texting", "stopped");
    pushLog("app", `Texting stopped (exit code ${code}).`);
    if (code !== 0) notify("ARIA texting stopped", "ARIA ▸ Claw and texting log says why.");
  });
}

function stopTexting() {
  const v = voice;
  voice = null;
  v?.kill();
  setStatus("texting", "stopped");
}

async function setTexting(on) {
  const problem = on && smsPasswordProblem();
  if (problem) {
    buildMenu(); // untick the box again
    const { response } = await dialog.showMessageBox(win, {
      type: "info",
      title: "ARIA",
      message: "Texting needs a password first.",
      detail:
        `${problem}\n\nAdd ARIA_SMS_PASSWORD=<8+ characters> to your keys file. ` +
        "It's what you text ARIA's number to unlock it; anyone else who texts it gets nothing. " +
        "ARIA_SMS_ALLOW=+1555… limits which numbers can unlock it at all.\n\n" +
        "Then turn texting on again. No restart needed.",
      buttons: ["Open keys file", "Cancel"],
      cancelId: 1,
    });
    if (response === 0) shell.openPath(ENV_FILE);
    return false;
  }
  settings = { ...settings, texting: !!on };
  saveSettings(settings);
  if (on) startTexting();
  else stopTexting();
  buildMenu();
  return settings.texting;
}

async function restartAll() {
  stopRelay();
  stopTexting();
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
  stopTexting();
  win.show(); // it may be in the tray
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
    icon: APP_ICON,
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

  // PC control and texting only work while the app runs, so with either on,
  // closing the window keeps ARIA in the tray instead of quitting.
  win.on("close", (e) => {
    if (quitting || !(settings.claw || settings.texting || settings.wake)) return;
    e.preventDefault();
    win.hide();
    if (!settings.trayTold) {
      settings = { ...settings, trayTold: true };
      saveSettings(settings);
      notify("ARIA is still running", "PC control, texting and 'Hey ARIA' keep working. Quit from the tray icon.");
    }
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

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

// ── Claw & texting log window ─────────────────────────────────────
// A plain page with no preload; lines arrive through executeJavaScript as
// JSON and go in as text, never HTML.
const LOG_PAGE = `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html>
<html><head><title>ARIA — Claw &amp; texting log</title><style>
  html,body{margin:0;background:#1a1a1e;color:#cfcfd6;
    font:12px/1.5 ui-monospace,Consolas,monospace}
  #log{padding:10px 14px;white-space:pre-wrap;word-break:break-word}
  .t{color:#6e7681}
  .s{display:inline-block;min-width:11ch;color:#8b8bff}
  .s.texts{color:#d29922} .s.app{color:#f85149}
  #empty{color:#6e7681;font:14px system-ui,sans-serif;padding:24px 14px}
</style></head><body>
<div id="empty">Nothing yet. Turn on PC control or texting in the ARIA menu.</div>
<div id="log"></div>
<script>
const log = document.getElementById("log");
function add(entries) {
  if (entries.length) document.getElementById("empty")?.remove();
  const atEnd = innerHeight + scrollY >= document.body.scrollHeight - 24;
  for (const e of entries) {
    const row = document.createElement("div");
    const t = document.createElement("span");
    t.className = "t";
    t.textContent = new Date(e.at).toLocaleTimeString() + "  ";
    const s = document.createElement("span");
    s.className = "s " + e.source;
    s.textContent = e.source;
    row.append(t, s, document.createTextNode(e.line));
    log.append(row);
  }
  while (log.childElementCount > 1000) log.firstChild.remove();
  if (atEnd) scrollTo(0, document.body.scrollHeight);
}
</script></body></html>`)}`;

function openLogWindow() {
  if (logWin && !logWin.isDestroyed()) {
    logWin.show();
    logWin.focus();
    return;
  }
  logWin = new BrowserWindow({
    width: 860,
    height: 520,
    minWidth: 420,
    minHeight: 240,
    backgroundColor: "#1a1a1e",
    icon: APP_ICON,
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  logWin.setMenu(null);
  logWin.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  logWin.webContents.on("will-navigate", (e) => e.preventDefault());
  logWin.webContents.on("did-finish-load", () => {
    logWin?.webContents.executeJavaScript(`add(${JSON.stringify(activity)})`).catch(() => {});
  });
  logWin.on("closed", () => {
    logWin = null;
  });
  logWin.loadURL(LOG_PAGE);
}

// ── Tray ──────────────────────────────────────────────────────────
// ARIA's icon with a dot for PC control and texting: green when everything
// that's on is connected, amber while something connects or waits for a
// Google sign-in, red while a relay is reconnecting. No dot when both are off.
const DOT = { green: [0x3f, 0xb9, 0x50], amber: [0xd2, 0x99, 0x22], red: [0xf8, 0x51, 0x49] };

function trayState() {
  const on = [];
  if (settings.claw) on.push(status.relay);
  if (settings.texting) on.push(status.texting);
  if (!on.length) return null;
  if (on.includes("retrying")) return "red";
  return on.every((s) => s === "running") ? "green" : "amber";
}

function trayImage() {
  const base = nativeImage.createFromPath(path.join(ROOT, "public", "icons", "icon-32.png"));
  const state = trayState();
  if (!state || base.isEmpty()) return base;
  // Drawn into the raw pixels (BGRA) so no extra image files ship.
  const { width, height } = base.getSize();
  const px = base.toBitmap();
  const [r, g, b] = DOT[state];
  const cx = width * 0.75, cy = height * 0.75, radius = width * 0.22;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d > radius + 1.5) continue;
      const i = (y * width + x) * 4;
      const [cr, cg, cb] = d <= radius ? [r, g, b] : [0x1a, 0x1a, 0x1e]; // dark ring
      px[i] = cb;
      px[i + 1] = cg;
      px[i + 2] = cr;
      px[i + 3] = 0xff;
    }
  }
  return nativeImage.createFromBitmap(px, { width, height, scaleFactor: width / 16 });
}

const STATE_WORDS = {
  stopped: "off",
  starting: "connecting…",
  running: "on",
  "sign-in": "sign in to Google Voice",
  retrying: "reconnecting…",
};
const stateLabel = (on, key) => (on ? STATE_WORDS[status[key]] || status[key] : "off");

// The PC control and texting switches, shared by the tray and the ARIA menu.
function clawMenuItems() {
  return [
    {
      label: `PC control (Claw) — ${stateLabel(settings.claw, "relay")}`,
      type: "checkbox",
      checked: settings.claw,
      click: (item) => setClaw(item.checked),
    },
    {
      label: `Reachable from anywhere (through Render)${
        settings.claw && settings.remote ? ` — ${stateLabel(true, "cloud")}` : ""
      }`,
      type: "checkbox",
      checked: settings.remote,
      enabled: settings.claw,
      click: (item) => setRemote(item.checked),
    },
    {
      label: `Texting (Google Voice) — ${stateLabel(settings.texting, "texting")}`,
      type: "checkbox",
      checked: settings.texting,
      click: (item) => setTexting(item.checked),
    },
    {
      label: 'Listen for "Hey ARIA"',
      type: "checkbox",
      checked: settings.wake,
      click: (item) => toggleWake(item.checked),
    },
    { label: "Push to talk: Ctrl+Shift+Space", enabled: false },
    { label: "Claw and texting log…", click: openLogWindow },
  ];
}

function updateTray() {
  if (!tray || tray.isDestroyed()) return;
  tray.setImage(trayImage());
  tray.setToolTip(
    `ARIA\nPC control: ${stateLabel(settings.claw, "relay")}\nTexting: ${stateLabel(settings.texting, "texting")}`,
  );
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open ARIA", click: showWindow },
      { type: "separator" },
      ...clawMenuItems(),
      { type: "separator" },
      { label: "Quit ARIA", click: () => app.quit() },
    ]),
  );
}

function createTray() {
  tray = new Tray(trayImage());
  tray.on("click", showWindow);
  updateTray();
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
        ...clawMenuItems(),
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
  updateTray(); // the tray shows the same switches
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
  if (settings.texting) {
    if (smsPasswordProblem()) setTexting(false); // the password was taken out of .env
    else startTexting();
  }
  await win?.loadURL(origin);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", showWindow);

  app.whenReady().then(async () => {
    prepareUserDir();
    setPermissions();
    createTray();
    buildMenu();
    createWindow();
    registerPushToTalk();
    if (settings.wake) win.webContents.setBackgroundThrottling(false);

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
  app.on("will-quit", () => globalShortcut.unregisterAll());
  app.on("before-quit", (e) => {
    if (quitting) return;
    quitting = true;
    e.preventDefault();
    stopRelay();
    stopTexting();
    setTimeout(() => {
      stopServer();
      app.quit();
    }, 800);
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
