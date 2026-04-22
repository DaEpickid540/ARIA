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
          `[RELAY] Executing: ${cmd.type} — ${JSON.stringify(cmd).slice(0, 80)}`,
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
              ({ ctrl: "^", alt: "%", shift: "+", win: "#" })[
                k.toLowerCase()
              ] || "",
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
          `powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${x},${y})"`,
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
        const click =
          button === "right"
            ? `$wsh.SendKeys('+{F10}')`
            : `[System.Windows.Forms.SendKeys]::SendWait('')`;
        // Simpler: use PowerShell mouse_event
        run(
          `powershell -Command "Add-Type @'\nusing System.Runtime.InteropServices;\npublic class M { [DllImport(\\"user32.dll\\")] public static extern void mouse_event(int f,int x,int y,int d,int e); }\n'@; [M]::mouse_event(${btn === 1 ? 6 : 10},0,0,0,0)"`,
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
          `osascript -e 'tell application "System Events" to scroll (${dir === "up" ? "-" : "+"}${amt}) using scroll wheel'`,
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

    // ── Open URL in browser ──
    case "open_url":
    case "browser": {
      const url = cmd.url || cmd.raw || "";
      if (PLATFORM === "win32") run(`start "" "${url}"`);
      else if (PLATFORM === "darwin") run(`open "${url}"`);
      else run(`xdg-open "${url}"`);
      return `opened ${url}`;
    }

    // ── New browser tab ──
    case "new_tab": {
      await dispatch({ type: "hotkey", keys: ["ctrl", "t"] });
      if (cmd.url) {
        await sleep(500);
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

    // ── Screenshot ──
    case "screenshot": {
      const fname = cmd.path || os.tmpdir() + "/aria-claw-screenshot.png";
      if (PLATFORM === "win32") {
        run(
          `powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::PrimaryScreen; $bmp = New-Object System.Drawing.Bitmap([System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Width,[System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Height); $g = [System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen(0,0,0,0,$bmp.Size); $bmp.Save('${fname}')"`,
        );
      } else if (PLATFORM === "darwin") {
        run(`screencapture -x "${fname}"`);
      } else {
        run(`import -window root "${fname}"`);
      }
      return `screenshot saved: ${fname}`;
    }

    // ── Run program / open file ──
    case "run":
    case "open_file": {
      const target = cmd.path || cmd.program || cmd.raw || "";
      if (PLATFORM === "win32") run(`start "" "${target}"`);
      else if (PLATFORM === "darwin") run(`open "${target}"`);
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
    apiPost("/api/claw/relay/heartbeat", { deviceId: DEVICE_ID }).catch(
      () => {},
    );
}, 10000);

// Graceful exit
process.on("SIGINT", () => {
  console.log("\n[RELAY] Shutting down.");
  apiPost("/api/claw/relay/unregister", { deviceId: DEVICE_ID }).catch(
    () => {},
  );
  process.exit(0);
});

// Start
register()
  .then(poll)
  .catch((e) => {
    console.error("[RELAY] Fatal:", e.message);
    process.exit(1);
  });
