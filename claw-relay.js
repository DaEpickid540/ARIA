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

// ── Runtime config (updated live from server) ─────────────────
let typeDelay = 25; // ms between each character when typing
let mouseSpeed = 1; // movement speed multiplier (future use)
let monitorIdx = -1; // -1 = all monitors combined, 0 = primary, 1+ = secondary

// ── Browser detection (Windows) ──────────────────────────────
let DEFAULT_BROWSER = "default"; // detected at startup
function detectDefaultBrowser() {
  if (PLATFORM !== "win32") return;
  try {
    const progId = run(
      `powershell -Command "(Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\http\\UserChoice').ProgId"`,
    )
      .trim()
      .toLowerCase();
    if (progId.includes("msedge")) DEFAULT_BROWSER = "edge";
    else if (progId.includes("chrome")) DEFAULT_BROWSER = "chrome";
    else if (progId.includes("brave")) DEFAULT_BROWSER = "brave";
    else if (progId.includes("firefox") || progId.includes("firefoxurl"))
      DEFAULT_BROWSER = "firefox";
    else if (progId.includes("tor")) DEFAULT_BROWSER = "tor";
    else DEFAULT_BROWSER = "default";
    console.log(`[RELAY] Default browser detected: ${DEFAULT_BROWSER}`);
  } catch {
    DEFAULT_BROWSER = "default";
  }
}

// Returns the right executable / launch command for the detected browser
function browserCmd(url) {
  const q = `"${url}"`;
  switch (DEFAULT_BROWSER) {
    case "edge":
      return `start msedge ${q}`;
    case "chrome":
      return `start chrome ${q}`;
    case "brave":
      return `start brave ${q}`;
    case "firefox":
      return `start firefox ${q}`;
    case "tor": {
      // Tor Browser lives in various places; find it then launch
      const torPaths = [
        `%USERPROFILE%\\Desktop\\Tor Browser\\Browser\\firefox.exe`,
        `%APPDATA%\\Tor Browser\\Browser\\firefox.exe`,
        `C:\\Tor Browser\\Browser\\firefox.exe`,
      ];
      for (const p of torPaths) {
        try {
          const expanded = run(
            `powershell -Command "[System.Environment]::ExpandEnvironmentVariables('${p}')"`,
          ).trim();
          if (
            expanded &&
            run(`powershell -Command "Test-Path '${expanded}'"`).trim() ===
              "True"
          ) {
            return `powershell -Command "Start-Process '${expanded}' '${url.replace(
              /'/g,
              "''",
            )}'"`;
          }
        } catch {}
      }
      return `start "" ${q}`; // fallback
    }
    default:
      return `start "" ${q}`;
  }
}

// Returns flag to open a new tab in the detected browser
function newTabCmd(url) {
  const u = url ? url.replace(/'/g, "''") : "";
  switch (DEFAULT_BROWSER) {
    case "edge":
      return `powershell -Command "Start-Process msedge '${u}' '--new-tab'"`;
    case "chrome":
      return `powershell -Command "Start-Process chrome '${u}' '--new-tab'"`;
    case "brave":
      return `powershell -Command "Start-Process brave '${u}' '--new-tab'"`;
    case "firefox":
      return `powershell -Command "Start-Process firefox '-new-tab' '${u}'"`;
    case "tor":
      return browserCmd(url); // Tor: just open URL
    default:
      return `start "" "${url || ""}"`;
  }
}

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
  detectDefaultBrowser();
  await apiPost("/api/claw/relay/register", {
    deviceId: DEVICE_ID,
    platform: PLATFORM,
    hostname: os.hostname(),
    arch: os.arch(),
    browser: DEFAULT_BROWSER,
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
        if (!execLock) {
          console.log(
            "[RELAY] Kill signal received from server. Stopping execution.",
          );
          execLock = true;
        }
        continue;
      }
      if (execLock && !data.killed) {
        console.log("[RELAY] Resumed by server.");
        execLock = false;
      }
      // Apply live config pushed from claw panel sliders
      if (data.config) {
        if (data.config.typeDelay != null) typeDelay = data.config.typeDelay;
        if (data.config.mouseSpeed != null) mouseSpeed = data.config.mouseSpeed;
        if (data.config.monitorIdx != null) monitorIdx = data.config.monitorIdx;
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

    // ── Type text (with configurable per-char delay) ──
    case "type":
    case "keys": {
      const text = cmd.text || cmd.raw || "";
      if (PLATFORM === "win32") {
        if (typeDelay <= 5) {
          // Fast mode: dump all at once via SendKeys
          const escaped = text.replace(/'/g, "''");
          run(
            `powershell -Command "$wsh = New-Object -ComObject WScript.Shell; $wsh.SendKeys('${escaped}')"`,
          );
        } else {
          // Slow mode: char by char via SetForegroundWindow + SendKeys
          for (const ch of text) {
            const esc = ch
              .replace(/'/g, "''")
              .replace(/[~+^%(){}[\]]/g, "{$&}"); // escape SendKeys specials
            run(
              `powershell -Command "$wsh = New-Object -ComObject WScript.Shell; $wsh.SendKeys('${esc}')"`,
            );
            await sleep(typeDelay);
          }
        }
      } else if (PLATFORM === "darwin") {
        if (typeDelay <= 5) {
          const escaped = text.replace(/'/g, "\\'");
          run(
            `osascript -e 'tell application "System Events" to keystroke "${escaped}"'`,
          );
        } else {
          for (const ch of text) {
            const escaped = ch.replace(/'/g, "\\'");
            run(
              `osascript -e 'tell application "System Events" to keystroke "${escaped}"'`,
            );
            await sleep(typeDelay);
          }
        }
      } else {
        run(
          `xdotool type --clearmodifiers --delay ${typeDelay} "${text.replace(
            /"/g,
            '\\"',
          )}"`,
        );
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
        runPs1(`
Add-Type -TypeDefinition @"
using System.Runtime.InteropServices;
public class AriaInput {
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
}
"@ -ErrorAction SilentlyContinue
[AriaInput]::SetCursorPos(${x}, ${y})
`);
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
      if (PLATFORM === "win32") {
        const downFlag = btn === 1 ? 0x0002 : btn === 3 ? 0x0008 : 0x0020;
        const upFlag = btn === 1 ? 0x0004 : btn === 3 ? 0x0010 : 0x0040;
        const posLine =
          x != null && y != null
            ? `[AriaInput]::SetCursorPos(${x}, ${y})\r\nStart-Sleep -Milliseconds 60`
            : "";
        runPs1(`
Add-Type -TypeDefinition @"
using System.Runtime.InteropServices;
public class AriaInput {
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
}
"@ -ErrorAction SilentlyContinue
${posLine}
[AriaInput]::mouse_event(${downFlag}, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 50
[AriaInput]::mouse_event(${upFlag}, 0, 0, 0, [UIntPtr]::Zero)
`);
      } else if (PLATFORM === "darwin") {
        if (x != null)
          run(
            `osascript -e 'tell application "System Events" to set the position of the mouse to {${x}, ${y}}'`,
          );
        run(`osascript -e 'tell application "System Events" to click'`);
      } else {
        if (x != null) run(`xdotool mousemove ${x} ${y}`);
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
        runPs1(`
Add-Type -TypeDefinition @"
using System.Runtime.InteropServices;
public class AriaInput {
    [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
}
"@ -ErrorAction SilentlyContinue
[AriaInput]::mouse_event(0x0800, 0, 0, [uint](${delta}), [UIntPtr]::Zero)
`);
      } else if (PLATFORM === "darwin") {
        run(
          `osascript -e 'tell application "System Events" to scroll (${
            dir === "up" ? "-" : "+"
          }${amt}) using scroll wheel'`,
        );
      } else {
        const xbtn = dir === "up" ? 4 : 5;
        for (let i = 0; i < amt; i++) run(`xdotool click ${xbtn}`);
      }
      return `scrolled ${dir} ${amt}`;
    }

    // ── Double click ──
    case "double_click": {
      const { x, y } = cmd;
      if (PLATFORM === "win32") {
        const posLine =
          x != null && y != null
            ? `[AriaInput]::SetCursorPos(${x}, ${y})\r\nStart-Sleep -Milliseconds 60`
            : "";
        runPs1(`
Add-Type -TypeDefinition @"
using System.Runtime.InteropServices;
public class AriaInput {
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
}
"@ -ErrorAction SilentlyContinue
${posLine}
[AriaInput]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 50
[AriaInput]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 80
[AriaInput]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 50
[AriaInput]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
`);
      } else if (PLATFORM === "darwin") {
        if (x != null)
          run(
            `osascript -e 'tell application "System Events" to set the position of the mouse to {${x}, ${y}}'`,
          );
        run(
          `osascript -e 'tell application "System Events" to double click at the position of the mouse'`,
        );
      } else {
        if (x != null) run(`xdotool mousemove ${x} ${y}`);
        run(`xdotool click --repeat 2 --delay 80 1`);
      }
      return `double clicked at ${x ?? "current"},${y ?? "current"}`;
    }

    // ── Drag ──
    case "drag": {
      const { x1 = 0, y1 = 0, x2 = 0, y2 = 0 } = cmd;
      if (PLATFORM === "win32") {
        runPs1(`
Add-Type -TypeDefinition @"
using System.Runtime.InteropServices;
public class AriaInput {
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
}
"@ -ErrorAction SilentlyContinue
[AriaInput]::SetCursorPos(${x1}, ${y1})
Start-Sleep -Milliseconds 80
[AriaInput]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 50
[AriaInput]::SetCursorPos(${x2}, ${y2})
Start-Sleep -Milliseconds 100
[AriaInput]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
`);
      } else if (PLATFORM === "darwin") {
        run(
          `osascript -e 'tell application "System Events" to set the position of the mouse to {${x1}, ${y1}}'`,
        );
        run(
          `osascript -e 'tell application "System Events" to key down {button 1}'`,
        );
        await sleep(100);
        run(
          `osascript -e 'tell application "System Events" to set the position of the mouse to {${x2}, ${y2}}'`,
        );
        await sleep(80);
        run(
          `osascript -e 'tell application "System Events" to key up {button 1}'`,
        );
      } else {
        run(
          `xdotool mousemove ${x1} ${y1} mousedown 1 mousemove ${x2} ${y2} mouseup 1`,
        );
      }
      return `dragged (${x1},${y1}) → (${x2},${y2})`;
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

    // ── Open URL in default browser ──
    case "open_url":
    case "browser": {
      const url = cmd.url || cmd.raw || "";
      if (PLATFORM === "win32") {
        run(browserCmd(url));
      } else if (PLATFORM === "darwin") run(`open "${url}"`);
      else run(`xdg-open "${url}"`);
      return `opened ${url} in ${DEFAULT_BROWSER}`;
    }

    // ── New tab in default browser ──
    case "new_tab": {
      if (PLATFORM === "win32") {
        if (cmd.url) {
          run(newTabCmd(cmd.url));
          return `new tab: ${cmd.url} in ${DEFAULT_BROWSER}`;
        }
        // No URL — just Ctrl+T in whatever's focused
        await dispatch({ type: "hotkey", keys: ["ctrl", "t"] });
        return "new tab opened";
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

    // ── Screenshot — multi-monitor aware ──
    case "screenshot": {
      const fname =
        cmd.path || os.tmpdir() + "/aria-claw-shot-" + Date.now() + ".png";
      const mIdx = cmd.monitor ?? monitorIdx; // -1=all, 0=primary, 1+=secondary
      if (PLATFORM === "win32") {
        if (mIdx === -1) {
          // Capture ALL monitors combined (virtual desktop)
          run(
            `powershell -Command "` +
              `Add-Type -AssemblyName System.Windows.Forms,System.Drawing; ` +
              `$vd=[System.Windows.Forms.SystemInformation]::VirtualScreen; ` +
              `$b=New-Object System.Drawing.Bitmap($vd.Width,$vd.Height); ` +
              `$g=[System.Drawing.Graphics]::FromImage($b); ` +
              `$g.CopyFromScreen($vd.Left,$vd.Top,0,0,$b.Size); ` +
              `$b.Save('${fname}')"`,
          );
        } else {
          // Specific monitor by index
          run(
            `powershell -Command "` +
              `Add-Type -AssemblyName System.Windows.Forms,System.Drawing; ` +
              `$screens=[System.Windows.Forms.Screen]::AllScreens; ` +
              `$s=if(${mIdx} -lt $screens.Length){$screens[${mIdx}]}else{[System.Windows.Forms.Screen]::PrimaryScreen}; ` +
              `$b=New-Object System.Drawing.Bitmap($s.Bounds.Width,$s.Bounds.Height); ` +
              `$g=[System.Drawing.Graphics]::FromImage($b); ` +
              `$g.CopyFromScreen($s.Bounds.X,$s.Bounds.Y,0,0,$b.Size); ` +
              `$b.Save('${fname}')"`,
          );
        }
      } else if (PLATFORM === "darwin") {
        const mFlag = mIdx >= 0 ? `-D ${mIdx + 1}` : "";
        run(`screencapture -x ${mFlag} "${fname}"`);
      } else {
        run(`import -window root "${fname}"`);
      }
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
      const appRaw = (cmd.app || cmd.raw || "").trim(); // preserve original casing for search
      const appName = appRaw.toLowerCase(); // lowercase only for map lookup
      if (PLATFORM === "win32") {
        // ── Tier 1: known exact .exe mappings (instant) ───────
        const appMap = {
          discord: `C:\\Users\\${process.env.USERNAME}\\AppData\\Local\\Discord\\Update.exe --processStart Discord.exe`,
          "github desktop": `C:\\Users\\${process.env.USERNAME}\\AppData\\Local\\GitHubDesktop\\GitHubDesktop.exe`,
          vscode: "code",
          "visual studio code": "code",
          notepad: "notepad.exe",
          explorer: "explorer.exe",
          "file explorer": "explorer.exe",
          "file manager": "explorer.exe",
          files: "explorer.exe",
          terminal: "wt.exe",
          "windows terminal": "wt.exe",
          edge: "msedge.exe",
          "microsoft edge": "msedge.exe",
          chrome: "chrome.exe",
          "google chrome": "chrome.exe",
          firefox: "firefox.exe",
          spotify: "spotify.exe",
          calculator: "calc.exe",
          calc: "calc.exe",
          paint: "mspaint.exe",
          "task manager": "taskmgr.exe",
          taskmgr: "taskmgr.exe",
          wordpad: "wordpad.exe",
          cmd: "cmd.exe",
          powershell: "powershell.exe",
          snip: "snippingtool.exe",
          "snipping tool": "snippingtool.exe",
        };

        const mapped = appMap[appName];
        if (mapped) {
          const r = run(
            `powershell -Command "Start-Process '${mapped}' -WindowStyle Normal"`,
          );
          if (!r.startsWith("exit")) return `launched ${appName}`;
          console.log(
            `[RELAY] Mapped launch failed for "${appRaw}", falling back to Windows Search...`,
          );
        }

        // ── Tier 2: Windows Search via Ctrl+Esc ───────────────
        // Note: WScript.Shell SendKeys uses ^{ESC} for Ctrl+Esc (= Start menu).
        // {LWIN} is NOT supported by WScript.Shell — Ctrl+Esc is the correct substitute.
        console.log(`[RELAY] Using Windows Search for "${appRaw}"...`);
        const searchText = appRaw.replace(/'/g, "''");
        run(
          `powershell -Command "$wsh = New-Object -ComObject WScript.Shell; $wsh.SendKeys('^{ESC}'); Start-Sleep -Milliseconds 900; $wsh.SendKeys('${searchText}'); Start-Sleep -Milliseconds 1400; $wsh.SendKeys('{ENTER}')"`,
        );
        return `searched and launched: ${appRaw}`;
      } else if (PLATFORM === "darwin") {
        const r = run(`open -a "${appRaw}" 2>/dev/null`);
        if (r.startsWith("exit")) {
          // Spotlight fallback
          run(
            `osascript -e 'tell application "System Events" to key code 49 using command down'`,
          );
          await sleep(600);
          run(
            `osascript -e 'tell application "System Events" to keystroke "${appRaw.replace(
              /"/g,
              '\\"',
            )}"'`,
          );
          await sleep(1000);
          run(`osascript -e 'tell application "System Events" to key code 36'`);
          return `spotlight launched: ${appRaw}`;
        }
      } else {
        run(`${appRaw} &`);
      }
      return `launch attempted: ${appRaw}`;
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

// Writes a .ps1 file and runs it — avoids all quote-escaping issues
// Use this whenever the PowerShell needs Add-Type / here-strings
function runPs1(script) {
  const { writeFileSync, unlinkSync } = require("fs");
  const tmp = `${os.tmpdir()}\\aria-${Date.now()}.ps1`;
  try {
    writeFileSync(tmp, script, "utf8");
    return (
      execSync(`powershell -ExecutionPolicy Bypass -NoProfile -File "${tmp}"`, {
        encoding: "utf8",
        timeout: 12000,
      }).trim() || "ok"
    );
  } catch (e) {
    return `exit ${e.status}: ${e.stderr?.trim() || e.message}`;
  } finally {
    try {
      unlinkSync(tmp);
    } catch {}
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
