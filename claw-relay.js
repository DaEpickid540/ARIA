#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
//  ARIA CLAW RELAY — runs on YOUR machine, zero npm installs
//  Polls the ARIA server for commands, executes them locally.
//
//  Usage:
//    node claw-relay.js
//    node claw-relay.js https://your-render-url.onrender.com
//
//  Supports: Windows (PowerShell/nircmd), macOS (osascript), Linux (xdotool/bash)
//  Kill switch: click the red ⬡ KILL CLAW button in any ARIA tab
// ═══════════════════════════════════════════════════════════════

import { execSync, exec } from "child_process";
import { createInterface } from "readline";
import os from "os";
import https from "https";
import http from "http";

const SERVER_URL = process.argv[2] || "http://localhost:3000";
const POLL_MS = 1500; // how often to check for commands
const DEVICE_ID = `relay-${os.hostname()}-${os.platform()}`;
const PLATFORM = os.platform(); // "win32" | "darwin" | "linux"

let running = true;
let execLock = false; // prevent parallel execution

console.log(`
╔═══════════════════════════════════════════════╗
║  ARIA CLAW RELAY  v1.0                        ║
║  Device : ${DEVICE_ID.slice(0, 35).padEnd(35)} ║
║  Platform: ${PLATFORM.padEnd(34)} ║
║  Server  : ${SERVER_URL.slice(0, 35).padEnd(35)} ║
╚═══════════════════════════════════════════════╝

  Press Ctrl+C or click ⬡ KILL CLAW in ARIA to stop.
`);

// ── Register with server ──────────────────────────────────────
async function register() {
  await apiPost("/api/claw/relay/register", {
    deviceId: DEVICE_ID,
    platform: PLATFORM,
    hostname: os.hostname(),
    arch: os.arch(),
  });
  console.log("[RELAY] Registered with ARIA server ✓");
}

// ── Main poll loop ─────────────────────────────────────────────
async function poll() {
  while (running) {
    await sleep(POLL_MS);
    try {
      const data = await apiGet(
        `/api/claw/queue?deviceId=${encodeURIComponent(DEVICE_ID)}`,
      );
      if (data.killed) {
        console.log(
          "[RELAY] Kill signal received from server. Stopping execution.",
        );
        execLock = true;
        continue;
      }
      if (data.resumed) {
        console.log("[RELAY] Resumed by server.");
        execLock = false;
      }
      if (!data.commands?.length || execLock) continue;

      for (const cmd of data.commands) {
        if (execLock) break;
        console.log(
          `[RELAY] Executing: ${cmd.type} — ${JSON.stringify(cmd).slice(
            0,
            80,
          )}`,
        );
        let result = "ok";
        try {
          result = await dispatch(cmd);
        } catch (e) {
          result = `ERROR: ${e.message}`;
          console.error(`[RELAY] ${result}`);
        }
        await apiPost("/api/claw/relay/result", {
          deviceId: DEVICE_ID,
          cmdId: cmd.id,
          result,
        });
      }
    } catch (e) {
      // Network error — server might be restarting, just wait
      if (e.message !== "ECONNREFUSED") {
        console.warn("[RELAY] Poll error:", e.message);
      }
    }
  }
}

// ── Command dispatcher ─────────────────────────────────────────
async function dispatch(cmd) {
  switch (cmd.type) {
    // ── Shell / terminal ──
    case "shell": {
      const raw = cmd.cmd || cmd.raw || "";
      if (!raw.trim()) return "no command";
      return run(raw);
    }

    // ── Type text ──
    case "type":
    case "keys": {
      const text = cmd.text || cmd.raw || "";
      if (PLATFORM === "win32") {
        // PowerShell SendKeys via WScript.Shell
        const escaped = text.replace(/'/g, "''");
        run(
          `powershell -Command "$wsh = New-Object -ComObject WScript.Shell; $wsh.SendKeys('${escaped}')"`,
        );
      } else if (PLATFORM === "darwin") {
        const escaped = text.replace(/'/g, "\\'");
        run(
          `osascript -e 'tell application "System Events" to keystroke "${escaped}"'`,
        );
      } else {
        run(`xdotool type --clearmodifiers "${text.replace(/"/g, '\\"')}"`);
      }
      return "typed";
    }

    // ── Hotkey / shortcut ──
    case "hotkey": {
      const keys = Array.isArray(cmd.keys)
        ? cmd.keys
        : (cmd.keys || cmd.raw || "").split("+");
      if (PLATFORM === "win32") {
        // Map to WScript SendKeys notation
        const map = {
          ctrl: "{^}",
          alt: "{%}",
          shift: "{+}",
          win: "{#}",
          tab: "{TAB}",
          enter: "{ENTER}",
          esc: "{ESC}",
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
        // Build SendKeys string: modifiers first, then key
        const mods = keys
          .slice(0, -1)
          .map(
            (k) =>
              ({ ctrl: "^", alt: "%", shift: "+", win: "#" }[k.toLowerCase()] ||
              ""),
          );
        const last = keys[keys.length - 1];
        const mapped = map[last.toLowerCase()] || last;
        const combo = mods.join("") + mapped;
        run(
          `powershell -Command "$wsh = New-Object -ComObject WScript.Shell; $wsh.SendKeys('${combo}')"`,
        );
      } else if (PLATFORM === "darwin") {
        const macMap = {
          ctrl: "control",
          alt: "option",
          shift: "shift",
          win: "command",
          cmd: "command",
        };
        const mods = keys
          .slice(0, -1)
          .map((k) => macMap[k.toLowerCase()] || k)
          .join(", ");
        const last = keys[keys.length - 1];
        run(
          `osascript -e 'tell application "System Events" to key code (key code of key "${last}") using {${mods}}'`,
        );
      } else {
        const combo = keys.join("+");
        run(`xdotool key "${combo}"`);
      }
      return `hotkey: ${keys.join("+")}`;
    }

    // ── Mouse move ──
    case "mouse_move":
    case "move": {
      const { x = 0, y = 0 } = cmd;
      if (PLATFORM === "win32") {
        run(
          `powershell -Command "Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; [System.Windows.Forms.Cursor]::Position = [System.Drawing.Point]::new(${x},${y})"`,
        );
      } else if (PLATFORM === "darwin") {
        run(
          `osascript -e 'tell application "System Events" to set the position of the mouse to {${x}, ${y}}'`,
        );
      } else {
        run(`xdotool mousemove ${x} ${y}`);
      }
      return `mouse moved to ${x},${y}`;
    }

    // ── Mouse click ──
    case "mouse_click":
    case "click": {
      const { x, y, button = "left" } = cmd;
      const btn = { left: 1, right: 3, middle: 2 }[button] || 1;
      if (x != null && y != null) await dispatch({ ...cmd, type: "move" });
      if (PLATFORM === "win32") {
        // Move first if coords given, then click with proper flags
        const pinvoke = `Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Mouse {
  [DllImport("user32.dll")] public static extern void mouse_event(uint f,uint x,uint y,uint d,IntPtr e);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
}
"@ -ErrorAction SilentlyContinue`;
        const downFlag = btn === 1 ? 2 : btn === 3 ? 8 : 32;
        const upFlag = btn === 1 ? 4 : btn === 3 ? 16 : 64;
        const posCmd =
          x != null && y != null
            ? `[Mouse]::SetCursorPos(${x},${y}); Start-Sleep -Milliseconds 80;`
            : "";
        run(
          `powershell -Command "${pinvoke}; ${posCmd} [Mouse]::mouse_event(${downFlag},0,0,0,[IntPtr]::Zero); Start-Sleep -Milliseconds 50; [Mouse]::mouse_event(${upFlag},0,0,0,[IntPtr]::Zero)"`,
        );
      } else if (PLATFORM === "darwin") {
        run(`osascript -e 'tell application "System Events" to click'`);
      } else {
        run(`xdotool click ${btn}`);
      }
      return `clicked ${button} at ${x ?? "current"},${y ?? "current"}`;
    }

    // ── Mouse scroll ──
    case "scroll": {
      const dir = (cmd.direction || cmd.raw || "down").toLowerCase();
      const amt = cmd.amount || 3;
      if (PLATFORM === "win32") {
        const delta = dir === "up" ? amt * 120 : -amt * 120;
        run(
          `powershell -Command "Add-Type @'\nusing System.Runtime.InteropServices;\npublic class M { [DllImport(\\"user32.dll\\")] public static extern void mouse_event(int f,int x,int y,int d,int e); }\n'@; [M]::mouse_event(0x800,0,0,${delta},0)"`,
        );
      } else if (PLATFORM === "darwin") {
        run(
          `osascript -e 'tell application "System Events" to scroll (${
            dir === "up" ? "-" : "+"
          }${amt}) using scroll wheel'`,
        );
      } else {
        const btn = dir === "up" ? 4 : 5;
        for (let i = 0; i < amt; i++) run(`xdotool click ${btn}`);
      }
      return `scrolled ${dir} ${amt}`;
    }

    // ── Focus / switch to app ──
    case "focus":
    case "switch_app": {
      const app = cmd.app || cmd.raw || "";
      if (PLATFORM === "win32") {
        run(
          `powershell -Command "$wsh = New-Object -ComObject WScript.Shell; $wsh.AppActivate('${app}')"`,
        );
      } else if (PLATFORM === "darwin") {
        run(`osascript -e 'tell application "${app}" to activate'`);
      } else {
        run(`wmctrl -a "${app}"`);
      }
      return `switched to ${app}`;
    }

    // ── Open URL in Edge (or default browser) ──
    case "open_url":
    case "browser": {
      const url = cmd.url || cmd.raw || "";
      if (PLATFORM === "win32") {
        // Try Edge first, fall back to start
        try {
          run(`start msedge "${url}"`);
        } catch {
          run(`start "" "${url}"`);
        }
      } else if (PLATFORM === "darwin") run(`open "${url}"`);
      else run(`xdg-open "${url}"`);
      return `opened ${url}`;
    }

    // ── New Edge tab ──
    case "new_tab": {
      if (PLATFORM === "win32" && cmd.url) {
        // Open URL directly in Edge new tab
        try {
          run(
            `powershell -Command "Start-Process msedge '${cmd.url.replace(
              /'/g,
              "''",
            )}' -ArgumentList '--new-tab'"`,
          );
          return "edge tab opened: " + cmd.url;
        } catch {}
      }
      await dispatch({ type: "hotkey", keys: ["ctrl", "t"] });
      if (cmd.url) {
        await sleep(600);
        await dispatch({ type: "type", text: cmd.url });
        await dispatch({ type: "hotkey", keys: ["enter"] });
      }
      return "new tab opened";
    }

    // ── Close tab ──
    case "close_tab": {
      await dispatch({ type: "hotkey", keys: ["ctrl", "w"] });
      return "tab closed";
    }

    // ── Screenshot — saves AND returns base64 for ARIA to see ──
    case "screenshot": {
      const fname =
        cmd.path || os.tmpdir() + "/aria-claw-shot-" + Date.now() + ".png";
      if (PLATFORM === "win32") {
        run(
          `powershell -Command "Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $b=New-Object System.Drawing.Bitmap([System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Width,[System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Height); $g=[System.Drawing.Graphics]::FromImage($b); $g.CopyFromScreen(0,0,0,0,$b.Size); $b.Save('${fname}')"`,
        );
      } else if (PLATFORM === "darwin") {
        run(`screencapture -x "${fname}"`);
      } else {
        run(`import -window root "${fname}"`);
      }
      // Send screenshot back to server so ARIA can see it
      try {
        const { readFileSync } = await import("fs");
        const b64 = readFileSync(fname).toString("base64");
        await apiPost("/api/claw/relay/result", {
          deviceId: DEVICE_ID,
          cmdId: cmd.id,
          result: "screenshot_ok",
          screenshot: b64,
          fname,
        });
        return `screenshot: ${fname}`;
      } catch {
        return `screenshot saved: ${fname}`;
      }
    }

    // ── Run program / open file ──
    case "run":
    case "open_file": {
      const target = cmd.path || cmd.program || cmd.raw || "";
      if (PLATFORM === "win32") {
        // Use Start-Process -WindowStyle Normal to prevent black window flash
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
      return `opened: ${target}`;
    }

    // ── Write text to VS Code / Arduino IDE (type into active window) ──
    case "write_code": {
      const code = cmd.code || cmd.text || "";
      // Focus editor first if app specified
      if (cmd.app) await dispatch({ type: "switch_app", app: cmd.app });
      await sleep(300);
      // Select all if replace mode
      if (cmd.replace) await dispatch({ type: "hotkey", keys: ["ctrl", "a"] });
      await dispatch({ type: "type", text: code });
      return "code written";
    }

    // ── Sleep/wait ──
    case "wait":
    case "sleep": {
      const ms = cmd.ms || cmd.seconds * 1000 || 1000;
      await sleep(ms);
      return `waited ${ms}ms`;
    }

    // ── Continuous screen watch — sends screenshots every N seconds ──
    case "continuous_screen": {
      const interval = (cmd.interval || 3) * 1000;
      const count = cmd.count || 10;
      let sent = 0;
      while (sent < count && !execLock) {
        await dispatch({ ...cmd, type: "screenshot" });
        await sleep(interval);
        sent++;
      }
      return `continuous screen: ${sent} shots sent`;
    }

    // ── app search — find an app by name and launch it ──
    case "launch_app": {
      const appName = (cmd.app || cmd.raw || "").toLowerCase().trim();
      if (PLATFORM === "win32") {
        // Common app mappings
        const appMap = {
          discord:
            "C:\\Users\\${process.env.USERNAME}\\AppData\\Local\\Discord\\Update.exe --processStart Discord.exe",
          "github desktop":
            "C:\\Users\\${process.env.USERNAME}\\AppData\\Local\\GitHubDesktop\\GitHubDesktop.exe",
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
        const mapped = appMap[appName];
        if (mapped) {
          try {
            run(
              `powershell -Command "Start-Process '${mapped}' -WindowStyle Normal"`,
            );
            return `launched ${appName}`;
          } catch {}
        }
        // Fallback: search Start Menu
        run(`powershell -Command "Start-Process '${appName}'" `);
        return `attempted: ${appName}`;
      } else if (PLATFORM === "darwin") {
        run(`open -a "${appName}"`);
      } else {
        run(`${appName} &`);
      }
      return `launch attempted: ${appName}`;
    }

    default:
      return `unknown command type: ${cmd.type}`;
  }
}

// ── Helpers ───────────────────────────────────────────────────
function run(cmd) {
  try {
    return execSync(cmd, { encoding: "utf8", timeout: 15000 }).trim() || "ok";
  } catch (e) {
    return `exit ${e.status}: ${e.stderr?.trim() || e.message}`;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function apiGet(path) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, SERVER_URL);
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

async function apiPost(path, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const url = new URL(path, SERVER_URL);
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

// Heartbeat
setInterval(() => {
  if (running)
    apiPost("/api/claw/relay/heartbeat", {
      deviceId: DEVICE_ID,
    }).catch(() => {});
}, 10000);

// Graceful exit
process.on("SIGINT", () => {
  console.log("\n[RELAY] Shutting down.");
  apiPost("/api/claw/relay/unregister", {
    deviceId: DEVICE_ID,
  }).catch(() => {});
  process.exit(0);
});

// Start
register()
  .then(poll)
  .catch((e) => {
    console.error("[RELAY] Fatal:", e.message);
    process.exit(1);
  });
