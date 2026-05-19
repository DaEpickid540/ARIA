#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
//  ARIA SCREENSHOT WATCHER
//  Runs on the target machine (Chromebook, Windows, Linux, macOS).
//  Watches for new screenshot files and POSTs them to ARIA server
//  so the AI can see the screen after ACTION: claw | screenshot.
//
//  Usage:
//    node aria-screenshot-watcher.js
//    node aria-screenshot-watcher.js https://your-render-url.onrender.com
//
//  ChromeOS: screenshots go to ~/Downloads as "Screenshot YYYY-MM-DD..."
//  Windows:  screenshots go to ~/Pictures/Screenshots
//  Linux:    configurable, default ~/Pictures
//  macOS:    ~/Desktop (or custom via Settings)
//
//  Zero npm installs — pure Node.js built-ins only.
// ═══════════════════════════════════════════════════════════════════

import fs from "fs";
import os from "os";
import path from "path";
import https from "https";
import http from "http";

const SERVER_URL = process.argv[2] || "http://localhost:3000";
const PLATFORM = os.platform();
const DEVICE_ID = `screenwatcher-${os.hostname()}-${PLATFORM}`;
const POLL_MS = 800; // how often to scan for new files

// ── Screenshot folder detection ────────────────────────────────
function detectScreenshotDir() {
  const home = os.homedir();
  const candidates = [];

  if (PLATFORM === "linux") {
    // ChromeOS Linux (crostini) or regular Linux
    candidates.push(
      path.join(home, "Downloads"),            // ChromeOS saves here from host
      path.join(home, "Pictures", "Screenshots"),
      path.join(home, "Pictures"),
      path.join(home, "Desktop"),
    );
  } else if (PLATFORM === "win32") {
    candidates.push(
      path.join(home, "Pictures", "Screenshots"),
      path.join(home, "OneDrive", "Pictures", "Screenshots"),
      path.join(home, "Desktop"),
    );
  } else if (PLATFORM === "darwin") {
    candidates.push(
      path.join(home, "Desktop"),
      path.join(home, "Pictures", "Screenshots"),
    );
  }

  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  return home; // fallback
}

// Allow override via env var
const WATCH_DIR = process.env.ARIA_SCREENSHOT_DIR || detectScreenshotDir();

// ── Screenshot filename patterns ───────────────────────────────
// ChromeOS: "Screenshot 2024-01-15 at 10.30.00 AM.png"
// Windows:  "Screenshot 2024-01-15 150000.png" or "Screenshot (1).png"
// macOS:    "Screenshot 2024-01-15 at 10.30.00 AM.png"
// gnome-screenshot: "Screenshot from 2024-01-15 10-30-00.png"
function isScreenshot(filename) {
  const lower = filename.toLowerCase();
  if (!lower.endsWith(".png") && !lower.endsWith(".jpg")) return false;
  return (
    lower.startsWith("screenshot") ||
    lower.startsWith("screen shot") ||
    lower.startsWith("capture") ||
    lower.includes("screenshot")
  );
}

// ── State ──────────────────────────────────────────────────────
const seenFiles = new Set();
let lastUploadTs = 0;
const MIN_UPLOAD_INTERVAL_MS = 1500; // debounce rapid screenshots

// Seed seen files so we don't upload old ones on startup
function seedExistingFiles() {
  try {
    const files = fs.readdirSync(WATCH_DIR);
    for (const f of files) {
      if (isScreenshot(f)) seenFiles.add(f);
    }
    console.log(`[WATCHER] Seeded ${seenFiles.size} existing screenshot(s) — watching for new ones.`);
  } catch (e) {
    console.warn("[WATCHER] Could not read watch dir:", e.message);
  }
}

// ── Upload ─────────────────────────────────────────────────────
async function uploadScreenshot(filepath) {
  const now = Date.now();
  if (now - lastUploadTs < MIN_UPLOAD_INTERVAL_MS) return; // debounce
  lastUploadTs = now;

  try {
    // Wait briefly for the file to finish writing
    await sleep(300);
    const buf = fs.readFileSync(filepath);
    const b64 = buf.toString("base64");
    const fname = path.basename(filepath);
    const ext = path.extname(filepath).slice(1).toLowerCase();
    const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/png";
    const dataUri = `data:${mime};base64,${b64}`;

    console.log(`[WATCHER] Uploading screenshot: ${fname} (${Math.round(buf.length / 1024)}KB)`);

    await apiPost("/api/claw/relay/result", {
      deviceId: DEVICE_ID,
      result: "screenshot_ok",
      screenshot: dataUri,
      fname,
    });

    console.log(`[WATCHER] ✓ Uploaded: ${fname}`);
  } catch (e) {
    console.error(`[WATCHER] Upload failed: ${e.message}`);
  }
}

// ── Watch loop ─────────────────────────────────────────────────
function watchLoop() {
  try {
    const files = fs.readdirSync(WATCH_DIR);
    for (const f of files) {
      if (!isScreenshot(f) || seenFiles.has(f)) continue;
      seenFiles.add(f);
      const fullPath = path.join(WATCH_DIR, f);

      // Make sure it's recent (within last 30 seconds) to avoid uploading old files
      // that appeared in the directory after we started (e.g. from Downloads sync)
      try {
        const stat = fs.statSync(fullPath);
        const ageMs = Date.now() - stat.mtimeMs;
        if (ageMs > 30000) continue; // too old, skip
      } catch { continue; }

      uploadScreenshot(fullPath);
    }
  } catch (e) {
    // Directory might be temporarily unavailable
  }
}

// ── Register with server ───────────────────────────────────────
async function register() {
  try {
    await apiPost("/api/claw/relay/register", {
      deviceId: DEVICE_ID,
      platform: `${PLATFORM}-screenwatcher`,
      hostname: os.hostname(),
      relayType: "screenwatcher",
    });
    console.log("[WATCHER] Registered with ARIA server ✓");
  } catch (e) {
    console.warn("[WATCHER] Could not register (server may not be up yet):", e.message);
  }
}

// ── Heartbeat ──────────────────────────────────────────────────
setInterval(() => {
  apiPost("/api/claw/relay/heartbeat", { deviceId: DEVICE_ID }).catch(() => {});
}, 10000);

// ── Helpers ────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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
          try { resolve(JSON.parse(b)); } catch { resolve({}); }
        });
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ── Start ──────────────────────────────────────────────────────
console.log(`
╔══════════════════════════════════════════════════════╗
║  ARIA SCREENSHOT WATCHER                             ║
║  Watching : ${WATCH_DIR.slice(0, 38).padEnd(38)} ║
║  Server   : ${SERVER_URL.slice(0, 38).padEnd(38)} ║
║  Platform : ${PLATFORM.padEnd(38)} ║
╚══════════════════════════════════════════════════════╝

  Screenshots are auto-uploaded to ARIA when captured.
  Press Ctrl+C to stop.
`);

seedExistingFiles();
register();
setInterval(watchLoop, POLL_MS);

process.on("SIGINT", () => {
  console.log("\n[WATCHER] Shutting down.");
  process.exit(0);
});
