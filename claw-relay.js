#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
//  ARIA CLAW RELAY — runs on YOUR machine, zero npm installs
//  Polls the ARIA server for commands, executes them locally.
//
//  Usage:
//    node claw-relay.js
//    node claw-relay.js https://your-render-url.onrender.com --key=<ARIA_RELAY_KEY>
//
//  Headless (no window on your screen, keeps running after you close the
//  terminal; log in ~/.aria/claw-relay.log):
//    node claw-relay.js <url> --key=<key> --background   start it
//    node claw-relay.js --stop                           stop it
//    node claw-relay.js <url> --key=<key> --startup      Windows: also start
//                                                        hidden at every login
//    node claw-relay.js --no-startup                     undo --startup
//
//  Supports: Windows (PowerShell/nircmd), macOS (osascript), Linux (xdotool/bash)
//  Kill switch: click the red ⬡ KILL CLAW button in any ARIA tab
// ═══════════════════════════════════════════════════════════════

import { execSync, execFileSync, exec, spawn } from "child_process";
import { writeFileSync, unlinkSync, readFileSync, mkdirSync, appendFileSync, statSync, renameSync } from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import https from "https";
import http from "http";
import { mousePath, encodePath, applyPath, DURATION, speedFactor } from "./lib/claw-motion.js";

// Positional arg = server URL; --key=<ARIA_RELAY_KEY> (or the ARIA_RELAY_KEY
// env var) authenticates to a server that has ARIA_ACCESS_KEY set.
const _args = process.argv.slice(2);
const SERVER_URL =
  _args.find((a) => !a.startsWith("--")) || "http://localhost:3000";
const HEADLESS = _args.includes("--headless");
const RELAY_KEY =
  _args.find((a) => a.startsWith("--key="))?.slice(6) ||
  process.env.ARIA_RELAY_KEY ||
  "";
const POLL_MS = 1500; // how often to check for commands
const DEVICE_ID = `relay-${os.hostname()}-${os.platform()}`;
const PLATFORM = os.platform(); // "win32" | "darwin" | "linux"


// ── Headless: run in the background, out of sight ─────────────
// --background starts a detached copy with no window (Windows hides every
// console it or its PowerShell children would open) and returns at once.
// That copy writes its pid so --stop can find it. --startup does the same at
// every Windows login, through a one-line .vbs in the Startup folder (a .vbs
// can start node with its window hidden; a shortcut can't).
const SELF = fileURLToPath(import.meta.url);
const BG_DIR = path.join(os.homedir(), ".aria");
const PID_FILE = path.join(BG_DIR, "claw-relay.pid");
const LOG_FILE = path.join(BG_DIR, "claw-relay.log");
const STARTUP_VBS = path.join(
  process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"),
  "Microsoft", "Windows", "Start Menu", "Programs", "Startup", "ARIA Claw Relay.vbs",
);
const BG_FLAGS = new Set(["--background", "--bg", "--stop", "--startup", "--no-startup", "--headless"]);
const passArgs = () => _args.filter((a) => !BG_FLAGS.has(a));

function runningPid() {
  try {
    const pid = Number(readFileSync(PID_FILE, "utf8").trim());
    if (!pid) return 0;
    process.kill(pid, 0); // throws when it's gone
    return pid;
  } catch {
    return 0;
  }
}

function startBackground() {
  const pid = runningPid();
  if (pid) {
    console.log(`Claw relay is already running in the background (pid ${pid}). Stop it: node claw-relay.js --stop`);
    return;
  }
  const child = spawn(process.execPath, [SELF, ...passArgs(), "--headless"], {
    detached: true,
    windowsHide: true,
    stdio: "ignore", // a headless relay writes its own log
    env: process.env,
  });
  child.unref();
  console.log(`Claw relay is running in the background (pid ${child.pid}).\n  Log : ${LOG_FILE}\n  Stop: node claw-relay.js --stop`);
}

function stopBackground() {
  const pid = runningPid();
  if (!pid) return console.log("No background Claw relay is running.");
  try {
    process.kill(pid, "SIGTERM");
    console.log(`Stopped the background Claw relay (pid ${pid}).`);
  } catch (e) {
    console.log(`Couldn't stop pid ${pid}: ${e.message}`);
  }
  try { unlinkSync(PID_FILE); } catch {}
}

function installStartup(on) {
  if (os.platform() !== "win32") return console.log("--startup is for Windows. Elsewhere, add `node claw-relay.js <url> --key=… --background` to your login items.");
  if (!on) {
    try { unlinkSync(STARTUP_VBS); console.log("Removed the Claw relay from Windows startup."); } catch { console.log("It wasn't set to start with Windows."); }
    return;
  }
  // VBScript strings double their quotes; a quote can't be part of a URL or key anyway.
  const q = (s) => `""${String(s).replace(/"/g, "")}""`;
  const cmd = [process.execPath, SELF, ...passArgs()].map(q).join(" ") + " --headless";
  writeFileSync(
    STARTUP_VBS,
    `' ARIA Claw relay, started hidden at login. Remove: node claw-relay.js --no-startup\r\n` +
      `Set sh = CreateObject("WScript.Shell")\r\n` +
      `sh.CurrentDirectory = "${path.dirname(SELF).replace(/"/g, "")}"\r\n` +
      `sh.Run "${cmd}", 0, False\r\n`,
  );
  console.log(`Claw relay will start hidden at every login (${STARTUP_VBS}).` + (RELAY_KEY ? "\n  Note: your relay key is stored in that file, in your user profile." : ""));
}

if (_args.includes("--stop")) {
  stopBackground();
  process.exit(0);
}
if (_args.includes("--no-startup")) {
  installStartup(false);
  process.exit(0);
}
if (_args.includes("--startup")) {
  installStartup(true);
  mkdirSync(BG_DIR, { recursive: true });
  startBackground();
  process.exit(0);
}
if (_args.includes("--background") || _args.includes("--bg")) {
  startBackground();
  process.exit(0);
}
if (HEADLESS) {
  try {
    mkdirSync(BG_DIR, { recursive: true });
    writeFileSync(PID_FILE, String(process.pid));
  } catch {}
  // Keep the log from growing forever: one old copy, then start fresh.
  try { if (statSync(LOG_FILE).size > 5 * 1024 * 1024) renameSync(LOG_FILE, LOG_FILE + ".old"); } catch {}
  // No console to print to: everything goes to the log file instead.
  for (const k of ["log", "warn", "error"]) {
    console[k] = (...a) => {
      try {
        appendFileSync(LOG_FILE, `${new Date().toISOString()} ${a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ")}\n`);
      } catch {}
    };
  }
  process.on("exit", () => {
    try { if (readFileSync(PID_FILE, "utf8").trim() === String(process.pid)) unlinkSync(PID_FILE); } catch {}
  });
}

let running = true;
let execLock = false; // prevent parallel execution

// ── Runtime config (updated live from server) ─────────────────
let typeDelay = 25; // ms between each character when typing
let mouseSpeed = 1; // 1× (slow, showy glide) … 10× (snappy) — lib/claw-motion.js
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
  // Inside "…" for cmd.exe: a quote in the URL would end it. %22 is the same
  // character to the browser.
  url = String(url).replace(/"/g, "%22");
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

  ${HEADLESS ? `Running headless (pid ${process.pid}). Stop: node claw-relay.js --stop` : "Press Ctrl+C or click ⬡ KILL CLAW in ARIA to stop."}
`);

// ── Register with server (with retry/backoff) ─────────────────
async function register() {
  detectDefaultBrowser();
  let delay = 1000;
  // Headless (e.g. started at login before the network is up) keeps trying;
  // in a terminal, ten tries and it says so.
  for (let attempt = 1; HEADLESS || attempt <= 10; attempt++) {
    try {
      const r = await apiPost("/api/claw/relay/register", {
        deviceId: DEVICE_ID,
        platform: PLATFORM,
        hostname: os.hostname(),
        arch: os.arch(),
        browser: DEFAULT_BROWSER,
        // The desktop app sets "electron", so the Claw panel shows where the
        // relay runs. Unset, the server infers it from the device id.
        relayType: process.env.CLAW_RELAY_TYPE || undefined,
      });
      if (r?.error === "bad_relay_key" || r?.error === "claw_disabled") {
        // Retrying cannot fix either of these.
        console.error(`[RELAY] Server refused: ${r.message || r.error}`);
        process.exit(1);
      }
      console.log("[RELAY] Registered with ARIA server ✓");
      return;
    } catch (e) {
      console.warn(
        `[RELAY] Register failed (attempt ${attempt}${HEADLESS ? "" : "/10"}): ${e.message}. Retrying in ${delay / 1000}s…`,
      );
      await sleep(delay);
      delay = Math.min(delay * 1.5, HEADLESS ? 60000 : 15000);
    }
  }
  console.error("[RELAY] Could not register after 10 attempts. Exiting.");
  process.exit(1);
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
      // The text never goes into a command line: it's handed over in an
      // environment variable (or as an argument with no shell), so a quote
      // in it can't end anything and start a command of its own.
      const text = String(cmd.text || cmd.raw || "");
      if (PLATFORM === "win32") {
        // SendKeys reads + ^ % ~ ( ) { } [ ] as keys; braced, they're typed.
        const keys = [...text].map((ch) =>
          ch === "\n" ? "{ENTER}" : ch === "\t" ? "{TAB}" : ch === "\r" ? "" : ch.replace(/[~+^%(){}[\]]/g, "{$&}"),
        );
        const fast = typeDelay <= 5;
        return runFile(
          "powershell",
          [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            fast
              ? "$wsh = New-Object -ComObject WScript.Shell; $wsh.SendKeys(($env:ARIA_KEYS | ConvertFrom-Json) -join '')"
              : `$wsh = New-Object -ComObject WScript.Shell; foreach ($k in ($env:ARIA_KEYS | ConvertFrom-Json)) { $wsh.SendKeys($k); Start-Sleep -Milliseconds ${Math.max(0, Math.round(typeDelay))} }`,
          ],
          { ARIA_KEYS: JSON.stringify(keys.filter(Boolean)) },
          Math.max(15000, keys.length * (typeDelay + 60) + 5000),
        ).startsWith("exit")
          ? "exit 1: typing failed"
          : "typed";
      } else if (PLATFORM === "darwin") {
        // AppleScript reads the text from the environment itself.
        return runFile("osascript", ["-e", 'tell application "System Events" to keystroke (system attribute "ARIA_KEYS")'], { ARIA_KEYS: text }).startsWith("exit")
          ? "exit 1: typing failed"
          : "typed";
      } else {
        return runFile("xdotool", ["type", "--clearmodifiers", "--delay", String(typeDelay), "--", text]).startsWith("exit")
          ? "exit 1: typing failed"
          : "typed";
      }
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

    // ── Where the pointer is ──
    case "mouse_pos":
    case "where": {
      const p = await mousePos();
      return p ? `mouse at ${p.x},${p.y}` : "exit 1: can't read the mouse position here";
    }

    // ── Mouse move: a smooth, curvy glide (lib/claw-motion.js) ──
    case "mouse_move":
    case "move": {
      const x = Math.round(Number(cmd.x) || 0);
      const y = Math.round(Number(cmd.y) || 0);
      if (PLATFORM === "win32") {
        const g = glide(x, y);
        const r = winMouse([g.line], g.env);
        if (r.startsWith("exit")) return r;
      } else if (PLATFORM === "darwin") {
        run(
          `osascript -e 'tell application "System Events" to set the position of the mouse to {${x}, ${y}}'`,
        );
      } else {
        const r = await unixGlide(x, y);
        if (r.startsWith("exit")) return r;
      }
      return `mouse moved to ${x},${y}`;
    }

    // ── Mouse click (glides there first when given a spot) ──
    case "mouse_click":
    case "click": {
      const { button = "left" } = cmd;
      const has = cmd.x != null && cmd.y != null;
      const x = has ? Math.round(Number(cmd.x) || 0) : null;
      const y = has ? Math.round(Number(cmd.y) || 0) : null;
      const btn = { left: 1, right: 3, middle: 2 }[button] || 1;
      if (PLATFORM === "win32") {
        // SendInput flags: LEFTDOWN=0x2 LEFTUP=0x4 RIGHTDOWN=0x8 RIGHTUP=0x10 MIDDLEDOWN=0x20 MIDDLEUP=0x40
        const [downFlag, upFlag] =
          btn === 3 ? [0x0008, 0x0010] : btn === 2 ? [0x0020, 0x0040] : [0x0002, 0x0004];
        const g = has ? glide(x, y) : null;
        const r = winMouse(
          [...(g ? [g.line, "Start-Sleep -Milliseconds 40"] : []), `[AriaMouse]::Button(${downFlag}, ${upFlag}, 1)`],
          g?.env,
        );
        if (r.startsWith("exit")) return r;
      } else if (PLATFORM === "darwin") {
        if (has)
          run(
            `osascript -e 'tell application "System Events" to set the position of the mouse to {${x}, ${y}}'`,
          );
        run(`osascript -e 'tell application "System Events" to click'`);
      } else {
        if (has) await unixGlide(x, y);
        run(`xdotool click ${btn}`);
      }
      return `clicked ${button} at ${x ?? "current"},${y ?? "current"}`;
    }

    // ── Mouse scroll ──
    case "scroll": {
      const dir = (cmd.direction || cmd.raw || "down").toLowerCase();
      const amt = Math.max(1, Math.min(50, Math.round(Number(cmd.amount) || 3)));
      if (PLATFORM === "win32") {
        const delta = dir === "up" ? amt * 120 : -amt * 120;
        const r = winMouse([`[AriaMouse]::Wheel(${delta})`]);
        if (r.startsWith("exit")) return r;
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
      const has = cmd.x != null && cmd.y != null;
      const x = has ? Math.round(Number(cmd.x) || 0) : null;
      const y = has ? Math.round(Number(cmd.y) || 0) : null;
      if (PLATFORM === "win32") {
        const g = has ? glide(x, y) : null;
        const r = winMouse(
          [...(g ? [g.line, "Start-Sleep -Milliseconds 40"] : []), "[AriaMouse]::Button(0x0002, 0x0004, 2)"],
          g?.env,
        );
        if (r.startsWith("exit")) return r;
      } else if (PLATFORM === "darwin") {
        if (has)
          run(
            `osascript -e 'tell application "System Events" to set the position of the mouse to {${x}, ${y}}'`,
          );
        run(
          `osascript -e 'tell application "System Events" to double click at the position of the mouse'`,
        );
      } else {
        if (has) await unixGlide(x, y);
        run(`xdotool click --repeat 2 --delay 80 1`);
      }
      return `double clicked at ${x ?? "current"},${y ?? "current"}`;
    }

    // ── Drag: glide to the start, press, glide (curvy) to the end, let go ──
    case "drag": {
      const [x1, y1, x2, y2] = [cmd.x1, cmd.y1, cmd.x2, cmd.y2].map((v) => Math.round(Number(v) || 0));
      if (PLATFORM === "win32") {
        const g1 = glide(x1, y1, "ARIA_PATH1");
        const g2 = glide(x2, y2, "ARIA_PATH2");
        const r = winMouse(
          [
            g1.line,
            "Start-Sleep -Milliseconds 60",
            "[AriaMouse]::Hold(0x0002)", // LEFTDOWN
            "Start-Sleep -Milliseconds 80",
            g2.line, // every step is a real move event, so apps see a drag
            "Start-Sleep -Milliseconds 60",
            "[AriaMouse]::Hold(0x0004)", // LEFTUP
          ],
          { ...g1.env, ...g2.env },
        );
        if (r.startsWith("exit")) return r;
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
        await unixGlide(x1, y1);
        run("xdotool mousedown 1");
        await unixGlide(x2, y2);
        run("xdotool mouseup 1");
      }
      return `dragged (${x1},${y1}) → (${x2},${y2})`;
    }

    // ── Focus / switch to app ──
    case "focus":
    case "switch_app": {
      // A window name goes inside quotes in a shell command: it must not be
      // able to close them (an app called x'); Start-Process calc; (' would).
      const app = String(cmd.app || cmd.raw || "").replace(/["`$\r\n]/g, "");
      if (PLATFORM === "win32") {
        run(
          `powershell -Command "$wsh = New-Object -ComObject WScript.Shell; $wsh.AppActivate('${app.replace(/'/g, "''")}')"`,
        );
      } else if (PLATFORM === "darwin") {
        run(`osascript -e 'tell application "${app.replace(/['\\]/g, "")}" to activate'`);
      } else {
        run(`wmctrl -a "${app.replace(/\\/g, "")}"`);
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
      // Where the captured image sits on the desktop, in the same coordinates
      // click:/drag: use — lets the POV panel map a click on the image back.
      let bounds = null;
      let monitors = [];
      if (PLATFORM === "win32") {
        if (mIdx === -1) {
          // Capture ALL monitors combined (virtual desktop)
          bounds = run(
            `powershell -Command "` +
              `Add-Type -AssemblyName System.Windows.Forms,System.Drawing; ` +
              `$vd=[System.Windows.Forms.SystemInformation]::VirtualScreen; ` +
              `$b=New-Object System.Drawing.Bitmap($vd.Width,$vd.Height); ` +
              `$g=[System.Drawing.Graphics]::FromImage($b); ` +
              `$g.CopyFromScreen($vd.Left,$vd.Top,0,0,$b.Size); ` +
              `$b.Save('${fname}'); ` +
              `$ms=[System.Windows.Forms.Screen]::AllScreens | ForEach-Object { '' + $_.Bounds.X + ',' + $_.Bounds.Y + ',' + $_.Bounds.Width + ',' + $_.Bounds.Height + ',' + [int]$_.Primary }; Write-Output ('MON ' + ($ms -join ';')); ` +
              `Write-Output ('' + $vd.Left + ',' + $vd.Top + ',' + $vd.Width + ',' + $vd.Height)"`,
          );
        } else {
          // Specific monitor by index
          bounds = run(
            `powershell -Command "` +
              `Add-Type -AssemblyName System.Windows.Forms,System.Drawing; ` +
              `$screens=[System.Windows.Forms.Screen]::AllScreens; ` +
              `$s=if(${mIdx} -lt $screens.Length){$screens[${mIdx}]}else{[System.Windows.Forms.Screen]::PrimaryScreen}; ` +
              `$b=New-Object System.Drawing.Bitmap($s.Bounds.Width,$s.Bounds.Height); ` +
              `$g=[System.Drawing.Graphics]::FromImage($b); ` +
              `$g.CopyFromScreen($s.Bounds.X,$s.Bounds.Y,0,0,$b.Size); ` +
              `$b.Save('${fname}'); ` +
              `$ms=[System.Windows.Forms.Screen]::AllScreens | ForEach-Object { '' + $_.Bounds.X + ',' + $_.Bounds.Y + ',' + $_.Bounds.Width + ',' + $_.Bounds.Height + ',' + [int]$_.Primary }; Write-Output ('MON ' + ($ms -join ';')); ` +
              `Write-Output ('' + $s.Bounds.X + ',' + $s.Bounds.Y + ',' + $s.Bounds.Width + ',' + $s.Bounds.Height)"`,
          );
        }
        // Every monitor's rectangle, so the grid can outline each screen.
        monitors = (/MON ([-\d,;]+)/.exec(bounds || "")?.[1] || "")
          .split(";")
          .map((r) => r.split(",").map(Number))
          .filter((r) => r.length === 5 && r.every(Number.isFinite))
          .map(([x, y, w, h, primary]) => ({ x, y, w, h, primary: primary === 1 }));
        const m = /(-?\d+),(-?\d+),(\d+),(\d+)\s*$/.exec(bounds || "");
        bounds = m ? { x: +m[1], y: +m[2], w: +m[3], h: +m[4] } : null;
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
          bounds,
          monitors,
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
      // Quotes and shell metacharacters can't be part of an app name, and would
      // close the quotes it's put in below.
      const appRaw = String(cmd.app || cmd.raw || "").replace(/["'`$&|;<>^()\r\n]/g, "").trim(); // preserve original casing for search
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

        // ── Tier 2: resolve against the Start Menu (.lnk shortcuts + Store apps) ──
        const hit = findStartMenuApp(appRaw);
        if (hit) {
          const target = hit.lnk
            ? `Start-Process -FilePath '${hit.lnk.replace(/'/g, "''")}'`
            : `Start-Process explorer.exe -ArgumentList 'shell:AppsFolder\\${hit.appId.replace(/'/g, "''")}'`;
          const r = runPs1(target);
          if (!r.startsWith("exit")) return `launched ${hit.name}`;
          console.log(`[RELAY] Start Menu launch failed for "${hit.name}": ${r}`);
        }

        // ── Tier 3 (last resort): type the name into Start search ──
        // WScript.Shell SendKeys uses ^{ESC} for Ctrl+Esc (= Start menu).
        console.log(`[RELAY] No Start Menu match for "${appRaw}", using Windows Search...`);
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
// windowsHide everywhere: a relay with no console of its own (headless, the
// desktop app) would otherwise flash a console window for every command.
function run(cmd) {
  try {
    return execSync(cmd, { encoding: "utf8", timeout: 15000, windowsHide: true }).trim() || "ok";
  } catch (e) {
    return `exit ${e.status}: ${e.stderr?.trim() || e.message}`;
  }
}

/** A program with arguments and no shell, extra environment variables added. */
function runFile(file, args, env = {}, timeout = 15000) {
  try {
    return (
      execFileSync(file, args, { encoding: "utf8", timeout, windowsHide: true, env: { ...process.env, ...env } }).trim() || "ok"
    );
  } catch (e) {
    return `exit ${e.status ?? 1}: ${e.stderr?.trim() || e.message}`;
  }
}

// ── Mouse (Windows): one C# helper for every pointer action ──────
// Glide() reads the cursor itself and lays the normalised path from
// lib/claw-motion.js between there and the target, timed with a stopwatch
// (and a 1 ms timer) so the speed is the same on every PC. Each step is a
// SetCursorPos plus a zero-move SendInput, which is what apps listen for.
const MOUSE_CS = `
using System;
using System.Diagnostics;
using System.Globalization;
using System.Threading;
using System.Runtime.InteropServices;
public class AriaMouse {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("winmm.dll")] static extern uint timeBeginPeriod(uint p);
  [DllImport("winmm.dll")] static extern uint timeEndPeriod(uint p);
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public MOUSEINPUT mi; }
  [DllImport("user32.dll", SetLastError=true)] static extern uint SendInput(uint n, INPUT[] i, int cb);
  static void Send(uint flags, uint data) {
    var a = new INPUT[1]; a[0].type = 0; a[0].mi.dwFlags = flags; a[0].mi.mouseData = data;
    SendInput(1, a, Marshal.SizeOf(typeof(INPUT)));
  }
  static double D(string s) { return double.Parse(s, CultureInfo.InvariantCulture); }
  public static string Pos() { POINT p; GetCursorPos(out p); return p.X + "," + p.Y; }
  public static void Glide(string path, int tx, int ty, double baseMs, double perDoubling, double scale, double minMs, double factor) {
    POINT p; GetCursorPos(out p);
    double dx = tx - p.X, dy = ty - p.Y, dist = Math.Sqrt(dx * dx + dy * dy);
    if (dist < 3 || String.IsNullOrEmpty(path)) { SetCursorPos(tx, ty); Send(1, 0); return; }
    double ms = Math.Max(minMs, (baseMs + perDoubling * Math.Log(1 + dist / scale, 2)) / factor);
    string[] pts = path.Split(';');
    timeBeginPeriod(1);
    try {
      var sw = Stopwatch.StartNew();
      int lx = int.MinValue, ly = int.MinValue;
      for (int i = 0; i < pts.Length; i++) {
        string[] f = pts[i].Split(',');
        if (i + 1 < pts.Length && sw.Elapsed.TotalMilliseconds > D(pts[i + 1].Split(',')[2]) * ms) continue; // behind: skip ahead
        double due = D(f[2]) * ms;
        while (sw.Elapsed.TotalMilliseconds < due) Thread.Sleep(1);
        double a = D(f[0]), b = D(f[1]);
        int x = (int)Math.Round(p.X + a * dx - b * dy), y = (int)Math.Round(p.Y + a * dy + b * dx);
        if (x == lx && y == ly) continue;
        SetCursorPos(x, y); Send(1, 0); lx = x; ly = y;
      }
    } finally { timeEndPeriod(1); }
    SetCursorPos(tx, ty); Send(1, 0);
  }
  public static void Button(uint down, uint up, int times) {
    for (int i = 0; i < times; i++) { Send(down, 0); Thread.Sleep(30); Send(up, 0); if (i < times - 1) Thread.Sleep(70); }
  }
  public static void Hold(uint flag) { Send(flag, 0); }
  public static void Wheel(int delta) { Send(0x0800, (uint)delta); }
}`;

function winMouse(lines, env = {}) {
  return runPs1(`Add-Type -TypeDefinition @"\n${MOUSE_CS}\n"@ -ErrorAction Stop\n${lines.join("\n")}\n`, env);
}

/** A Glide() line for PowerShell, its path handed over in an env var. */
function glide(x, y, key = "ARIA_PATH") {
  const { base, perDoubling, scale, min } = DURATION;
  return {
    line: `[AriaMouse]::Glide($env:${key}, ${x}, ${y}, ${base}, ${perDoubling}, ${scale}, ${min}, ${speedFactor(mouseSpeed)})`,
    env: { [key]: encodePath(mousePath()) },
  };
}

async function mousePos() {
  if (PLATFORM === "win32") {
    const m = /(-?\d+),(-?\d+)\s*$/.exec(winMouse(["[AriaMouse]::Pos()"]));
    return m ? { x: +m[1], y: +m[2] } : null;
  }
  if (PLATFORM === "linux") {
    const out = runFile("xdotool", ["getmouselocation", "--shell"]);
    const x = /X=(-?\d+)/.exec(out)?.[1];
    const y = /Y=(-?\d+)/.exec(out)?.[1];
    return x != null && y != null ? { x: +x, y: +y } : null;
  }
  return null; // macOS has no built-in way to read it
}

/** Linux: the same glide, as one xdotool call (mousemove … sleep … ). */
async function unixGlide(x, y) {
  const from = await mousePos();
  if (!from) return runFile("xdotool", ["mousemove", String(x), String(y)]);
  const pts = applyPath(mousePath(), from, { x, y }, mouseSpeed);
  const args = [];
  let t = 0;
  for (const [px, py, ms] of pts) {
    if (ms > t) args.push("sleep", ((ms - t) / 1000).toFixed(3));
    t = ms;
    args.push("mousemove", String(px), String(py)); // X11 coordinates are never negative
  }
  return runFile("xdotool", args, {}, 20000);
}

// Finds the Start Menu entry that best matches `query`: every .lnk under the
// all-users and per-user Start Menu, plus Get-StartApps for Store/UWP apps.
// The list is cached for a minute so repeated launches stay fast.
let _startMenuCache = { at: 0, items: [] };
function listStartMenuApps() {
  if (Date.now() - _startMenuCache.at < 60000 && _startMenuCache.items.length)
    return _startMenuCache.items;
  const out = runPs1(`
$ErrorActionPreference = 'SilentlyContinue'
$items = @()
foreach ($root in @("$env:ProgramData\\Microsoft\\Windows\\Start Menu\\Programs", "$env:AppData\\Microsoft\\Windows\\Start Menu\\Programs")) {
  Get-ChildItem -Path $root -Recurse -Filter *.lnk | ForEach-Object {
    $items += [pscustomobject]@{ name = $_.BaseName; lnk = $_.FullName; appId = $null }
  }
}
Get-StartApps | ForEach-Object {
  $items += [pscustomobject]@{ name = $_.Name; lnk = $null; appId = $_.AppID }
}
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$items | ConvertTo-Json -Compress
`);
  let items = [];
  try {
    const parsed = JSON.parse(out);
    items = Array.isArray(parsed) ? parsed : [parsed];
  } catch {}
  _startMenuCache = { at: Date.now(), items };
  return items;
}

function findStartMenuApp(query) {
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const q = norm(query);
  if (!q) return null;
  const qTokens = q.split(" ");
  const junk = /\b(uninstall|readme|help|documentation|release notes|website|support)\b/;
  let best = null;
  for (const it of listStartMenuApps()) {
    const n = norm(it.name);
    if (!n || junk.test(n)) continue;
    let score = 0;
    if (n === q) score = 100;
    else if (n.startsWith(q)) score = 80;
    else if (n.split(" ").includes(q)) score = 70;
    else if (n.includes(q)) score = 60;
    else if (qTokens.every((t) => n.includes(t))) score = 50;
    else {
      const hits = qTokens.filter((t) => t.length > 2 && n.includes(t)).length;
      if (hits) score = 20 + (30 * hits) / qTokens.length;
    }
    if (!score) continue;
    score -= Math.min(n.length - q.length, 30) * 0.2; // prefer the tighter name
    if (it.lnk) score += 1; // a real shortcut beats a Store alias of the same name
    if (!best || score > best.score) best = { ...it, score };
  }
  return best && best.score >= 30 ? best : null;
}

// Writes a .ps1 file and runs it — avoids all quote-escaping issues
// Use this whenever the PowerShell needs Add-Type / here-strings
let _ps1Seq = 0;
function runPs1(script, env = {}) {
  const tmp = path.join(os.tmpdir(), `aria-${process.pid}-${Date.now()}-${_ps1Seq++}.ps1`);
  try {
    writeFileSync(tmp, script, "utf8");
    return (
      execSync(`powershell -ExecutionPolicy Bypass -NoProfile -NonInteractive -File "${tmp}"`, {
        encoding: "utf8",
        timeout: 15000,
        windowsHide: true,
        env: { ...process.env, ...env },
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
      .get(
        url.toString(),
        { headers: RELAY_KEY ? { "x-aria-relay-key": RELAY_KEY } : {} },
        (res) => {
        let body = "";
        res.on("data", (d) => (body += d));
        res.on("end", () => {
          try {
            resolve(JSON.parse(body));
          } catch {
            resolve({});
          }
        });
        },
      )
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
          ...(RELAY_KEY ? { "x-aria-relay-key": RELAY_KEY } : {}),
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

// ── What's in front (for ARIA's triggers, lib/triggers.js) ────
// Only while the server says a trigger needs it (heartbeat → wantContext,
// which it says only while a trigger's time window is open): the foreground
// app's name, seconds since the last key or mouse input, and the window
// title ONLY when it contains one of the triggers' words (contextMatch), so
// an email subject or a private tab never leaves the PC. Sent when it
// changes, and every 30s so the server knows it's current.
const FG_SAMPLE_MS = 5000;
const FG_KEEPALIVE_MS = 30000;
let fgWanted = false;
let fgProc = null; // Windows: one long-lived PowerShell that prints a line per sample
let fgTimer = null; // macOS / Linux: a sample per tick
let fgLast = "";
let fgLastSent = 0;
let fgMatch = []; // lowercase words a title must contain to be sent
let fgQuickExits = 0; // PowerShell dying right after starting: blocked, not flaky
let fgPausedUntil = 0;

// GetForegroundWindow / GetWindowText / GetLastInputInfo. TickCount is a
// signed 32-bit int that wraps after ~25 days, hence the modulo.
const FG_PS = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text;
public class AriaFg {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  [StructLayout(LayoutKind.Sequential)] public struct LII { public uint cbSize; public uint dwTime; }
  [DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LII p);
}
"@
# Windows doesn't end a child when its parent is killed: stop with the relay.
while (Get-Process -Id ${process.pid} -ErrorAction SilentlyContinue) {
  $h = [AriaFg]::GetForegroundWindow()
  $sb = New-Object System.Text.StringBuilder 512
  [void][AriaFg]::GetWindowText($h, $sb, 512)
  $procId = 0
  [void][AriaFg]::GetWindowThreadProcessId($h, [ref]$procId)
  $name = ""
  try { $name = (Get-Process -Id $procId -ErrorAction Stop).ProcessName } catch {}
  $l = New-Object AriaFg+LII
  $l.cbSize = 8
  [void][AriaFg]::GetLastInputInfo([ref]$l)
  $tc = [int64]([Environment]::TickCount) -band 0xFFFFFFFF
  $idle = [int]((($tc - [int64]$l.dwTime) + 4294967296) % 4294967296 / 1000)
  try {
    [Console]::Out.WriteLine((@{ app = $name; title = $sb.ToString(); idleSec = $idle } | ConvertTo-Json -Compress))
    [Console]::Out.Flush()
  } catch { exit }
  Start-Sleep -Milliseconds ${FG_SAMPLE_MS}
}`;

function fgReport(sample) {
  if (!fgWanted) return; // a sampler still winding down after a stop
  const t = String(sample.title || "");
  const low = t.toLowerCase();
  // The app name decides most rules; a title is only sent when it's what a
  // rule is looking for (a site name in a browser tab, say).
  sample = { ...sample, title: fgMatch.some((w) => w && low.includes(w)) ? t : "" };
  const key = `${sample.app}|${sample.title}|${sample.idleSec > 600}`;
  if (key === fgLast && Date.now() - fgLastSent < FG_KEEPALIVE_MS) return;
  fgLast = key;
  fgLastSent = Date.now();
  apiPost("/api/claw/relay/context", { deviceId: DEVICE_ID, ...sample })
    .then((r) => {
      // The answer carries the same request as a heartbeat: stop as soon as
      // no window is open any more, and pick up changed words.
      if (r && "wantContext" in r) setForegroundWanted(r.wantContext === true, r.contextMatch);
    })
    .catch(() => {});
}

function sampleUnix() {
  const cmd =
    PLATFORM === "darwin"
      ? `osascript -e 'tell application "System Events" to set p to first application process whose frontmost is true' -e 'set n to name of p' -e 'set t to ""' -e 'try' -e 'set t to name of front window of p' -e 'end try' -e 'return n & linefeed & t'; ioreg -c IOHIDSystem | awk '/HIDIdleTime/ {print int($NF/1000000000); exit}'`
      : `w=$(xdotool getactivewindow 2>/dev/null) && ps -p "$(xdotool getwindowpid "$w")" -o comm= && xdotool getwindowname "$w"; (xprintidle 2>/dev/null || echo 0) | awk '{print int($1/1000)}'`;
  exec(cmd, { timeout: 4000, shell: "/bin/sh" }, (err, out) => {
    if (err || !fgWanted) return;
    const [app = "", title = "", idle = "0"] = String(out).split("\n").map((s) => s.trim());
    fgReport({ app, title, idleSec: Number(idle) || 0 });
  });
}

function startForeground() {
  if (fgProc || fgTimer) return;
  if (Date.now() < fgPausedUntil) return;
  console.log("[RELAY] ARIA has a trigger that needs the foreground app — reporting it.");
  if (PLATFORM === "win32") {
    const encoded = Buffer.from(FG_PS, "utf16le").toString("base64");
    const proc = (fgProc = spawn("powershell", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    }));
    let buf = "";
    const started = Date.now();
    proc.stdout.setEncoding("utf8"); // a character split across chunks stays whole
    proc.stdout.on("data", (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).replace(/^\uFEFF/, "").trim(); // UTF-8 output may open with a BOM
        buf = buf.slice(i + 1);
        try {
          const s = JSON.parse(line);
          fgReport({ app: String(s.app || ""), title: String(s.title || ""), idleSec: Number(s.idleSec) || 0 });
        } catch {}
      }
    });
    proc.on("exit", (code) => {
      // Only if it's still the current one: a quick stop-then-start must not
      // lose track of the new process (and leave it running unkilled).
      if (fgProc === proc) fgProc = null;
      if (!fgWanted || fgProc) return;
      // Died on its own while still wanted. Within seconds of starting, three
      // times running: PowerShell is being blocked (Constrained Language
      // Mode, AppLocker, antivirus), and retrying every heartbeat won't help.
      fgQuickExits = Date.now() - started < 10000 ? fgQuickExits + 1 : 0;
      if (fgQuickExits >= 3) {
        fgPausedUntil = Date.now() + 30 * 60000;
        fgQuickExits = 0;
        console.warn(`[RELAY] Can't read the foreground app (PowerShell exited with ${code} right after starting — blocked by policy or antivirus?). App triggers won't work; trying again in 30 min.`);
      }
    });
  } else {
    sampleUnix();
    fgTimer = setInterval(sampleUnix, FG_SAMPLE_MS);
  }
}

function stopForeground() {
  if (fgProc) fgProc.kill();
  if (fgTimer) clearInterval(fgTimer);
  if (fgProc || fgTimer) console.log("[RELAY] No trigger needs the foreground app any more — stopped reporting it.");
  fgProc = null;
  fgTimer = null;
  fgLast = "";
}

function setForegroundWanted(want, match = []) {
  fgMatch = (Array.isArray(match) ? match : []).map((w) => String(w).toLowerCase()).filter(Boolean);
  fgWanted = !!want;
  if (fgWanted) startForeground();
  else stopForeground();
}

// Heartbeat — also detects server restart and re-registers if needed
let _heartbeatFailures = 0;
setInterval(async () => {
  if (!running) return;
  try {
    const r = await apiPost("/api/claw/relay/heartbeat", { deviceId: DEVICE_ID });
    _heartbeatFailures = 0;
    setForegroundWanted(r?.wantContext === true, r?.contextMatch);
    // If server doesn't recognize us (e.g. after a restart), re-register
    if (r?.error === "unknown_device" || r?.needsRegister) {
      console.log("[RELAY] Server doesn't recognize us — re-registering…");
      await register();
    }
  } catch {
    _heartbeatFailures++;
    if (_heartbeatFailures === 1) {
      console.warn("[RELAY] Heartbeat failed — server may be down.");
    }
    if (_heartbeatFailures > 6) {
      // 60+ seconds offline → try to re-register
      console.log("[RELAY] Long disconnect — attempting re-register…");
      try { await register(); _heartbeatFailures = 0; } catch {}
    }
  }
}, 10000);

// Graceful exit
function shutdown(signal) {
  console.log(`\n[RELAY] Received ${signal}, shutting down.`);
  running = false;
  stopForeground();
  apiPost("/api/claw/relay/unregister", { deviceId: DEVICE_ID })
    .catch(() => {})
    .finally(() => process.exit(0));
  // Force-exit if unregister hangs
  setTimeout(() => process.exit(0), 2000);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// Start
register()
  .then(poll)
  .catch((e) => {
    console.error("[RELAY] Fatal:", e.message);
    process.exit(1);
  });
