// lib/auth.js — server-side access control for ARIA's API
// ═══════════════════════════════════════════════════════════════════
//
// WHY THIS EXISTS
//   The lock screen used to check a PIN in public/js/lock.js — a file the
//   server hands to anyone who asks. The API behind it had no check at all,
//   so anyone who found the Render URL could POST /api/claw (or just ask
//   /api/chat to "run shell: …") and execute commands on whichever PC had
//   claw-relay.js running.
//
// TWO SECRETS
//   ARIA_ACCESS_KEY — what the owner types on the lock screen. A successful
//     login sets an HttpOnly cookie, so every fetch / EventSource the UI
//     already makes carries it without any frontend changes.
//   ARIA_RELAY_KEY  — what machines use (claw-relay.js, the screenshot
//     watcher, the ESP32). Kept separate because it lives
//     in files and flash on devices. Falls back to ARIA_ACCESS_KEY if unset.
//
// UNCONFIGURED
//   With no ARIA_ACCESS_KEY the API stays open exactly as before (local dev
//   keeps working). On a public deploy (Render) relays are refused instead;
//   see dangerousAllowed().
// ═══════════════════════════════════════════════════════════════════

import crypto from "crypto";

const COOKIE = "aria_auth";
const SESSION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const accessKey = () => process.env.ARIA_ACCESS_KEY || "";
const relayKey = () => process.env.ARIA_RELAY_KEY || accessKey();

export const authEnabled = () => !!accessKey();

/** Running where strangers can reach it (Render sets RENDER=true). */
export const isPublicDeploy = () =>
  !!(process.env.RENDER || process.env.RENDER_EXTERNAL_URL || process.env.ARIA_PUBLIC === "true");

/**
 * Whether PC control may operate at all. Off only in the one case
 * that is actually dangerous: reachable from the internet with no key.
 * ARIA_INSECURE_CLAW=true restores the old behaviour for anyone who insists.
 */
export function dangerousAllowed() {
  if (authEnabled()) return true;
  if (!isPublicDeploy()) return true;
  return process.env.ARIA_INSECURE_CLAW === "true";
}

export const DANGEROUS_DISABLED_MSG =
  "Claw is disabled: this server is public and ARIA_ACCESS_KEY is not set. " +
  "Set ARIA_ACCESS_KEY (and ARIA_RELAY_KEY) in the Render environment, then restart.";

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

// The HMAC key is the access key itself, so rotating ARIA_ACCESS_KEY logs
// every existing session out — which is what you want after a leak.
function sign(ts) {
  return crypto.createHmac("sha256", accessKey()).update(`aria:${ts}`).digest("hex");
}

function readCookie(req, name) {
  const raw = req.headers.cookie || "";
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i === -1) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

function validSession(req) {
  const c = readCookie(req, COOKIE);
  if (!c) return false;
  const [ts, mac] = c.split(".");
  if (!ts || !mac || !/^\d+$/.test(ts)) return false;
  if (Date.now() - Number(ts) > SESSION_MS) return false;
  return safeEqual(mac, sign(ts));
}

function bearer(req) {
  const h = req.headers.authorization || "";
  return h.startsWith("Bearer ") ? h.slice(7).trim() : "";
}

function validUser(req) {
  if (!authEnabled()) return true;
  if (validSession(req)) return true;
  const b = bearer(req);
  return !!b && safeEqual(b, accessKey());
}

function validRelay(req) {
  const k = relayKey();
  if (!k) return true; // unconfigured → dangerousAllowed() decides instead
  const given =
    req.headers["x-aria-relay-key"] || req.query?.relayKey || bearer(req) || "";
  if (given && (safeEqual(given, k) || (accessKey() && safeEqual(given, accessKey()))))
    return true;
  // A logged-in browser may also poke relay endpoints (e.g. the claw panel).
  return authEnabled() && validSession(req);
}

// ── Route classes ──────────────────────────────────────────────
const PUBLIC = new Set(["/api/health", "/api/ping", "/api/version"]);

// Machines, not people. The Ollama hook counts as dangerous too: whatever it
// sends back is model output, and model output can call tools — Claw
// included — so a hook nobody authenticated could run commands on your PC.
const RELAY_PREFIXES = ["/api/claw/relay/", "/api/ollama/relay/"];
const RELAY_EXACT = new Set(["/api/claw/queue"]);

// Flashed IoT boards (templates/ARIA_IoT_Template.ino) predate keys and only
// ever receive LED/relay commands. Left open so existing boards keep working;
// they accept a relay key if one is sent. Sending commands TO them
// (/api/devices/command) is a user route and does need login.
const DEVICE_OPEN = new Set([
  "/api/devices/register",
  "/api/devices/heartbeat",
  "/api/devices/state",
  "/api/devices/queue",
  "/api/devices/unregister",
]);

export const isRelayPath = (p) =>
  RELAY_EXACT.has(p) || RELAY_PREFIXES.some((x) => p.startsWith(x));

// ── Login throttle (per IP) ────────────────────────────────────
const _fails = new Map(); // ip → { n, until }
function clientIp(req) {
  return (
    String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    req.socket?.remoteAddress ||
    "?"
  );
}

/** Express middleware for everything under /api. */
export function apiGuard(req, res, next) {
  const p = req.path;
  if (!p.startsWith("/api/")) return next();
  if (PUBLIC.has(p) || p.startsWith("/api/auth/")) return next();
  if (DEVICE_OPEN.has(p)) return next();

  if (isRelayPath(p)) {
    if (!dangerousAllowed())
      return res.status(403).json({
        error: "claw_disabled",
        message: p.startsWith("/api/ollama/")
          ? "Relays are disabled: this server is public and ARIA_ACCESS_KEY is not set. " +
            "Set ARIA_ACCESS_KEY (and ARIA_RELAY_KEY) in the Render environment, then restart."
          : DANGEROUS_DISABLED_MSG,
      });
    if (validRelay(req)) return next();
    return res.status(401).json({ error: "bad_relay_key", message: "Relay key missing or wrong (ARIA_RELAY_KEY)." });
  }

  if (validUser(req)) return next();
  return res.status(401).json({ error: "auth_required", authRequired: true });
}

/** Mounts /api/auth/{status,login,logout}. */
export function mountAuthRoutes(app) {
  app.get("/api/auth/status", (req, res) => {
    res.json({
      required: authEnabled(),
      authenticated: authEnabled() ? validUser(req) : true,
      clawAllowed: dangerousAllowed(),
    });
  });

  app.post("/api/auth/login", (req, res) => {
    if (!authEnabled()) return res.json({ ok: true, authDisabled: true });
    const ip = clientIp(req);
    const f = _fails.get(ip);
    if (f && f.until > Date.now())
      return res.status(429).json({ ok: false, error: "locked", retryInMs: f.until - Date.now() });

    const given = String(req.body?.key ?? req.body?.password ?? "");
    if (!given || !safeEqual(given, accessKey())) {
      const n = (f?.n || 0) + 1;
      // 5 misses → 15 minute lockout for that IP.
      _fails.set(ip, n >= 5 ? { n: 0, until: Date.now() + 15 * 60 * 1000 } : { n, until: 0 });
      return res.status(401).json({ ok: false, error: "invalid" });
    }
    _fails.delete(ip);

    const ts = String(Date.now());
    const secure =
      req.secure || String(req.headers["x-forwarded-proto"] || "").startsWith("https");
    res.setHeader(
      "Set-Cookie",
      `${COOKIE}=${ts}.${sign(ts)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(
        SESSION_MS / 1000,
      )}${secure ? "; Secure" : ""}`,
    );
    res.json({ ok: true });
  });

  app.post("/api/auth/logout", (_req, res) => {
    res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    res.json({ ok: true });
  });
}

/** One-line startup summary so a misconfigured deploy is obvious in logs. */
export function logAuthPosture() {
  if (authEnabled()) {
    console.log(
      `[AUTH] API locked (ARIA_ACCESS_KEY set; relay key: ${
        process.env.ARIA_RELAY_KEY ? "separate" : "same as access key"
      })`,
    );
  } else if (isPublicDeploy()) {
    console.warn(
      "\x1b[31m[AUTH] ARIA_ACCESS_KEY is NOT set on a public deploy — the API is open to anyone. " +
        (dangerousAllowed()
          ? "ARIA_INSECURE_CLAW=true: Claw is ENABLED anyway."
          : "Claw is disabled until it is set.") +
        "\x1b[0m",
    );
  } else {
    console.log("[AUTH] ARIA_ACCESS_KEY not set — API open (local mode).");
  }
}
