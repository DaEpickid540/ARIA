// ═══════════════════════════════════════════════════════════════
//  ARIA CLAW — Electron Main Process
//  Tray app with full relay logic built in (no node claw-relay.js needed)
// ═══════════════════════════════════════════════════════════════

import {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  ipcMain,
  shell,
  dialog,
  Notification,
} from "electron";
import { execSync } from "child_process";
import os from "os";
import https from "https";
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Config ────────────────────────────────────────────────────
const CONFIG_FILE = path.join(app.getPath("userData"), "aria-claw-config.json");
const LOG_FILE = path.join(app.getPath("userData"), "aria-claw.log");

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  } catch {
    return {
      serverUrl: "http://localhost:3000",
      autoStart: true,
      pollInterval: 1500,
    };
  }
}
function saveConfig(c) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(c, null, 2));
}

let config = loadConfig();

// ── State ─────────────────────────────────────────────────────
const PLATFORM = os.platform();
const DEVICE_ID = `electron-${os.hostname()}-${PLATFORM}`;
let running = false;
let pollTimer = null;
let execLock = false;
let hbTimer = null;
let mainWindow = null;
let tray = null;
let logLines = [];
const MAX_LOG = 300;

// ── Logging ───────────────────────────────────────────────────
function log(level, msg) {
  const ts = new Date().toLocaleTimeString();
  const line = `[${ts}] [${level}] ${msg}`;
  logLines.push(line);
  if (logLines.length > MAX_LOG) logLines.shift();
  console.log(line);
  try {
    fs.appendFileSync(LOG_FILE, line + "\n");
  } catch {}
  if (mainWindow?.webContents)
    mainWindow.webContents.send("log", { level, msg, ts });
}

// ── HTTP helpers ──────────────────────────────────────────────
async function apiGet(path_) {
  return new Promise((resolve, reject) => {
    const url = new URL(path_, config.serverUrl);
    const mod = url.protocol === "https:" ? https : http;
    mod
      .get(url.toString(), (res) => {
        let body = "";
        res.on("data", (d) => (body += d));
        res.on("end", () => {
          try {
            resolve(JSON.parse(body));
          } catch {
            resolve({});
          }
        });
      })
      .on("error", reject);
  });
}

async function apiPost(path_, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const url = new URL(path_, config.serverUrl);
    const mod = url.protocol === "https:" ? https : http;
    const req = mod.request(
      url.toString(),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let b = "";
        res.on("data", (d) => (b += d));
        res.on("end", () => {
          try {
            resolve(JSON.parse(b));
          } catch {
            resolve({});
          }
        });
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ── Relay command executor (same logic as claw-relay.js) ──────
function run(cmd) {
  try {
    return execSync(cmd, { encoding: "utf8", timeout: 15000 }).trim() || "ok";
  } catch (e) {
    return `exit ${e.status}: ${(e.stderr || e.message || "").slice(0, 200)}`;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function dispatch(cmd) {
  switch (cmd.type) {
    case "shell":
      return run(cmd.cmd || cmd.raw || "");

    case "type":
    case "keys": {
      const text = cmd.text || cmd.raw || "";
      if (PLATFORM === "win32") {
        const esc = text.replace(/'/g, "''");
        run(
          `powershell -Command "$wsh=New-Object -ComObject WScript.Shell;$wsh.SendKeys('${esc}')"`,
        );
      } else if (PLATFORM === "darwin") {
        run(
          `osascript -e 'tell application "System Events" to keystroke "${text.replace(
            /'/g,
            "\\'",
          )}"'`,
        );
      } else {
        run(`xdotool type --clearmodifiers "${text.replace(/"/g, '\\"')}"`);
      }
      return "typed";
    }

    case "hotkey": {
      const keys = Array.isArray(cmd.keys)
        ? cmd.keys
        : (cmd.raw || "").split("+");
      if (PLATFORM === "win32") {
        const modMap = { ctrl: "^", alt: "%", shift: "+", win: "#" };
        const mods = keys
          .slice(0, -1)
          .map((k) => modMap[k.toLowerCase()] || "")
          .join("");
        const keyMap = {
          enter: "{ENTER}",
          esc: "{ESC}",
          tab: "{TAB}",
          del: "{DEL}",
          space: " ",
          f1: "{F1}",
          f2: "{F2}",
          f3: "{F3}",
          f4: "{F4}",
          f5: "{F5}",
          f6: "{F6}",
          f7: "{F7}",
          f8: "{F8}",
          f9: "{F9}",
          f10: "{F10}",
          f11: "{F11}",
          f12: "{F12}",
          up: "{UP}",
          down: "{DOWN}",
          left: "{LEFT}",
          right: "{RIGHT}",
          home: "{HOME}",
          end: "{END}",
          pgup: "{PGUP}",
          pgdn: "{PGDN}",
        };
        const last = keys[keys.length - 1];
        const mapped = keyMap[last.toLowerCase()] || last;
        run(
          `powershell -Command "$wsh=New-Object -ComObject WScript.Shell;$wsh.SendKeys('${
            mods + mapped
          }')"`,
        );
      } else if (PLATFORM === "darwin") {
        const macMod = {
          ctrl: "control",
          alt: "option",
          shift: "shift",
          win: "command",
          cmd: "command",
        };
        const mods = keys
          .slice(0, -1)
          .map((k) => macMod[k.toLowerCase()] || k)
          .join(", ");
        run(
          `osascript -e 'tell application "System Events" to key code (key code of key "${
            keys[keys.length - 1]
          }") using {${mods}}'`,
        );
      } else {
        run(`xdotool key "${keys.join("+")}"`);
      }
      return "hotkey: " + keys.join("+");
    }

    case "mouse_move":
    case "move": {
      const x = cmd.x ?? 0,
        y = cmd.y ?? 0;
      if (PLATFORM === "win32") {
        run(
          `powershell -Command "Add-Type -AssemblyName System.Windows.Forms,System.Drawing;[System.Windows.Forms.Cursor]::Position=[System.Drawing.Point]::new(${x},${y})"`,
        );
      } else if (PLATFORM === "darwin") {
        run(
          `osascript -e 'tell application "System Events" to set the position of the mouse to {${x},${y}}'`,
        );
      } else {
        run(`xdotool mousemove ${x} ${y}`);
      }
      return `moved to ${x},${y}`;
    }

    case "mouse_click":
    case "click": {
      const { x, y, button = "left" } = cmd;
      const btn = { left: 1, right: 3, middle: 2 }[button] || 1;
      if (x != null && y != null) await dispatch({ type: "move", x, y });
      if (PLATFORM === "win32") {
        const pinvoke = `Add-Type @"
using System;using System.Runtime.InteropServices;
public class Mouse{
  [DllImport("user32.dll")]public static extern void mouse_event(uint f,uint x,uint y,uint d,IntPtr e);
}"@ -EA SilentlyContinue`;
        const dn = btn === 1 ? 2 : btn === 3 ? 8 : 32,
          up = btn === 1 ? 4 : btn === 3 ? 16 : 64;
        run(
          `powershell -Command "${pinvoke};[Mouse]::mouse_event(${dn},0,0,0,[IntPtr]::Zero);Start-Sleep -ms 50;[Mouse]::mouse_event(${up},0,0,0,[IntPtr]::Zero)"`,
        );
      } else if (PLATFORM === "darwin") {
        run(`osascript -e 'tell application "System Events" to click'`);
      } else {
        run(`xdotool click ${btn}`);
      }
      return `clicked ${button}`;
    }

    case "scroll": {
      const dir = (cmd.direction || "down").toLowerCase(),
        amt = cmd.amount || 3;
      if (PLATFORM === "win32") {
        const delta = dir === "up" ? amt * 120 : -amt * 120;
        const pinvoke2 = `Add-Type @"
using System;using System.Runtime.InteropServices;
public class Mouse2{[DllImport("user32.dll")]public static extern void mouse_event(int f,int x,int y,int d,int e);}
"@ -EA SilentlyContinue`;
        run(
          `powershell -Command "${pinvoke2};[Mouse2]::mouse_event(0x800,0,0,${delta},0)"`,
        );
      } else if (PLATFORM === "darwin") {
        run(
          `osascript -e 'tell application "System Events" to scroll ${
            dir === "up" ? "-" : "+"
          }${amt} using scroll wheel'`,
        );
      } else {
        for (let i = 0; i < amt; i++)
          run(`xdotool click ${dir === "up" ? 4 : 5}`);
      }
      return `scrolled ${dir}`;
    }

    case "focus":
    case "switch_app": {
      const appN = cmd.app || cmd.raw || "";
      if (PLATFORM === "win32")
        run(
          `powershell -Command "$wsh=New-Object -ComObject WScript.Shell;$wsh.AppActivate('${appN}')"`,
        );
      else if (PLATFORM === "darwin")
        run(`osascript -e 'tell application "${appN}" to activate'`);
      else run(`wmctrl -a "${appN}"`);
      return "focused: " + appN;
    }

    case "open_url":
    case "browser": {
      const url = cmd.url || cmd.raw || "";
      if (PLATFORM === "win32") {
        try {
          run(`start msedge "${url}"`);
        } catch {
          run(`start "" "${url}"`);
        }
      } else if (PLATFORM === "darwin") run(`open "${url}"`);
      else run(`xdg-open "${url}"`);
      return "opened: " + url;
    }

    case "new_tab": {
      if (PLATFORM === "win32" && cmd.url) {
        try {
          run(
            `powershell -Command "Start-Process msedge '${cmd.url.replace(
              /'/g,
              "''",
            )}' -ArgumentList '--new-tab'"`,
          );
          return "edge tab: " + cmd.url;
        } catch {}
      }
      await dispatch({ type: "hotkey", keys: ["ctrl", "t"] });
      if (cmd.url) {
        await sleep(500);
        await dispatch({ type: "type", text: cmd.url });
        await dispatch({ type: "hotkey", keys: ["enter"] });
      }
      return "new tab";
    }

    case "screenshot": {
      const fname =
        cmd.path || path.join(os.tmpdir(), `aria-shot-${Date.now()}.png`);
      if (PLATFORM === "win32") {
        run(
          `powershell -Command "Add-Type -AssemblyName System.Windows.Forms,System.Drawing;$b=New-Object System.Drawing.Bitmap([System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Width,[System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Height);$g=[System.Drawing.Graphics]::FromImage($b);$g.CopyFromScreen(0,0,0,0,$b.Size);$b.Save('${fname}')"`,
        );
      } else if (PLATFORM === "darwin") {
        run(`screencapture -x "${fname}"`);
      } else {
        run(`import -window root "${fname}"`);
      }
      try {
        const b64 = fs.readFileSync(fname).toString("base64");
        await apiPost("/api/claw/relay/result", {
          deviceId: DEVICE_ID,
          cmdId: cmd.id,
          result: "screenshot_ok",
          screenshot: b64,
          fname,
        });
      } catch {}
      return "screenshot: " + fname;
    }

    case "run":
    case "open_file": {
      const target = cmd.path || cmd.program || cmd.raw || "";
      if (PLATFORM === "win32") {
        try {
          run(
            `powershell -Command "Start-Process '${target.replace(
              /'/g,
              "''",
            )}' -WindowStyle Normal"`,
          );
        } catch {
          run(`start "" "${target}"`);
        }
      } else if (PLATFORM === "darwin") run(`open "${target}"`);
      else run(`xdg-open "${target}" &`);
      return "opened: " + target;
    }

    case "launch_app": {
      const appName = (cmd.app || cmd.raw || "").toLowerCase().trim();
      const user = process.env.USERNAME || process.env.USER || "";
      if (PLATFORM === "win32") {
        const appMap = {
          discord: `C:\\Users\\${user}\\AppData\\Local\\Discord\\Update.exe --processStart Discord.exe`,
          "github desktop": `C:\\Users\\${user}\\AppData\\Local\\GitHubDesktop\\GitHubDesktop.exe`,
          vscode: "code",
          "visual studio code": "code",
          notepad: "notepad.exe",
          explorer: "explorer.exe",
          terminal: "wt.exe",
          "windows terminal": "wt.exe",
          edge: "msedge.exe",
          chrome: "chrome.exe",
          spotify: "spotify.exe",
        };
        const target = appMap[appName] || appName;
        try {
          run(
            `powershell -Command "Start-Process '${target.replace(
              /'/g,
              "''",
            )}' -WindowStyle Normal"`,
          );
        } catch {
          run(`start "" "${target}"`);
        }
      } else if (PLATFORM === "darwin") run(`open -a "${appName}"`);
      else run(appName + " &");
      return "launched: " + appName;
    }

    case "write_code": {
      if (cmd.app) await dispatch({ type: "switch_app", app: cmd.app });
      await sleep(300);
      if (cmd.replace) await dispatch({ type: "hotkey", keys: ["ctrl", "a"] });
      await dispatch({ type: "type", text: cmd.code || cmd.text || "" });
      return "code written";
    }

    case "wait":
    case "sleep":
      await sleep(cmd.ms || (cmd.seconds || 1) * 1000);
      return "waited";

    case "continuous_screen": {
      const interval = (cmd.interval || 3) * 1000,
        count = cmd.count || 10;
      for (let i = 0; i < count && !execLock; i++) {
        await dispatch({ ...cmd, type: "screenshot" });
        await sleep(interval);
      }
      return "continuous screen done";
    }

    default:
      return "unknown: " + cmd.type;
  }
}

// ── Poll loop ─────────────────────────────────────────────────
async function pollOnce() {
  try {
    const data = await apiGet(
      `/api/claw/queue?deviceId=${encodeURIComponent(DEVICE_ID)}`,
    );
    if (data.killed) {
      execLock = true;
      log("WARN", "Kill signal received");
      return;
    }
    if (data.resumed) {
      execLock = false;
      log("INFO", "Resumed");
    }
    if (!data.commands?.length || execLock) return;

    for (const cmd of data.commands) {
      if (execLock) break;
      log("CMD", `${cmd.type} — ${JSON.stringify(cmd).slice(0, 80)}`);
      let result = "ok";
      try {
        result = await dispatch(cmd);
      } catch (e) {
        result = "ERROR: " + e.message;
        log("ERR", result);
      }
      log("RES", result);
      await apiPost("/api/claw/relay/result", {
        deviceId: DEVICE_ID,
        cmdId: cmd.id,
        result,
      });
    }
    mainWindow?.webContents?.send("status-update", getStatus());
  } catch (e) {
    if (!e.message?.includes("ECONNREFUSED")) log("ERR", "Poll: " + e.message);
  }
}

function startRelay() {
  if (running) return;
  running = true;
  execLock = false;
  log("INFO", `Starting relay → ${config.serverUrl}`);
  apiPost("/api/claw/relay/register", {
    deviceId: DEVICE_ID,
    platform: PLATFORM,
    hostname: os.hostname(),
  })
    .then(() => log("INFO", "Registered with ARIA server ✓"))
    .catch((e) => log("WARN", "Register failed: " + e.message));
  pollTimer = setInterval(pollOnce, config.pollInterval || 1500);
  hbTimer = setInterval(() => {
    if (running)
      apiPost("/api/claw/relay/heartbeat", {
        deviceId: DEVICE_ID,
      }).catch(() => {});
  }, 10000);
  updateTray();
  mainWindow?.webContents?.send("status-update", getStatus());
}

function stopRelay() {
  if (!running) return;
  running = false;
  clearInterval(pollTimer);
  clearInterval(hbTimer);
  pollTimer = hbTimer = null;
  apiPost("/api/claw/relay/unregister", {
    deviceId: DEVICE_ID,
  }).catch(() => {});
  log("INFO", "Relay stopped");
  updateTray();
  mainWindow?.webContents?.send("status-update", getStatus());
}

function getStatus() {
  return {
    running,
    execLock,
    deviceId: DEVICE_ID,
    platform: PLATFORM,
    serverUrl: config.serverUrl,
  };
}

// ── Tray ──────────────────────────────────────────────────────
function updateTray() {
  if (!tray) return;
  const label = running ? "ARIA Claw — ACTIVE" : "ARIA Claw — stopped";
  tray.setToolTip(label);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label, enabled: false },
      { type: "separator" },
      {
        label: running ? "⏹ Stop Relay" : "▶ Start Relay",
        click: () => (running ? stopRelay() : startRelay()),
      },
      {
        label: "⚙ Open Settings",
        click: () => {
          createWindow();
          mainWindow?.webContents?.send("show-settings");
        },
      },
      { label: "🪟 Show Window", click: createWindow },
      { type: "separator" },
      {
        label: "🌐 Open ARIA in Edge",
        click: () => shell.openExternal(config.serverUrl),
      },
      { type: "separator" },
      {
        label: "Quit",
        click: () => {
          stopRelay();
          app.quit();
        },
      },
    ]),
  );
}

// ── Window ────────────────────────────────────────────────────
function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }
  mainWindow = new BrowserWindow({
    width: 680,
    height: 760,
    minWidth: 560,
    minHeight: 500,
    backgroundColor: "#000000",
    titleBarStyle: "hidden",
    frame: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
    icon: path.join(__dirname, "assets", "icon.png"),
  });
  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  mainWindow.on("close", (e) => {
    e.preventDefault();
    mainWindow.hide();
  });
}

// ── IPC handlers ──────────────────────────────────────────────
ipcMain.handle("get-status", () => getStatus());
ipcMain.handle("get-logs", () => logLines.slice(-200));
ipcMain.handle("get-config", () => config);
ipcMain.handle("save-config", (_, c) => {
  config = { ...config, ...c };
  saveConfig(config);
  return config;
});
ipcMain.handle("start", () => {
  startRelay();
  return getStatus();
});
ipcMain.handle("stop", () => {
  stopRelay();
  return getStatus();
});
ipcMain.handle("clear-logs", () => {
  logLines = [];
  return true;
});
ipcMain.handle("open-aria", () => shell.openExternal(config.serverUrl));
ipcMain.handle("exec-command", async (_, cmd) => {
  try {
    return await dispatch(cmd);
  } catch (e) {
    return "ERROR: " + e.message;
  }
});
ipcMain.handle("open-log-file", () => shell.openPath(LOG_FILE));

// ── App lifecycle ─────────────────────────────────────────────
app.whenReady().then(() => {
  // Build tray
  const iconPath = path.join(__dirname, "assets", "tray.png");
  const icon = fs.existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath)
    : nativeImage.createEmpty();
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.on("click", createWindow);
  updateTray();

  createWindow();

  if (config.autoStart) startRelay();

  // Show notification
  if (Notification.isSupported()) {
    new Notification({
      title: "ARIA Claw",
      body: config.autoStart
        ? "Relay started — connected to " + config.serverUrl
        : "Ready. Click tray to start.",
    }).show();
  }
});

app.on("window-all-closed", (e) => e.preventDefault()); // keep alive in tray
app.on("before-quit", () => {
  stopRelay();
});
