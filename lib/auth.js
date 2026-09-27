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
// HOW YOU LOG IN
//   Google (preferred) — the lock screen signs in with Firebase Auth (the
//     personal-suite project, same as GRIND) and POSTs the ID token to
//     /api/auth/google. Only ARIA_OWNER_UID gets in. On by default on a
//     public deploy whenever ARIA_OWNER_UID is set; ARIA_REQUIRE_LOGIN=true
//     turns it on locally too.
//   ARIA_ACCESS_KEY — the older typed key. Still accepted, and still what
//     aria-voice-hook.js sends, until the PC side moves to Firebase as well.
//   Either way the server answers with the same HttpOnly session cookie, so
//   every fetch / EventSource the UI makes carries it with no changes. The
//   cookie is only a cache of the Google sign-in: if it is lost (the server
//   restarted with a fresh session secret), the page swaps a new ID token for
//   a new cookie without asking.
//   Non-browser callers may send `Authorization: Bearer <Firebase ID token>`.
//
// RELAYS
//   ARIA_RELAY_KEY — what machines use (claw-relay.js, the screenshot
//     watcher, the ESP32). Kept separate because it lives in files and flash
//     on devices. Falls back to ARIA_ACCESS_KEY if unset. On a public deploy
//     with neither set, only a logged-in browser may use relay routes.
//
// UNCONFIGURED
//   Locally with no key and no forced login, the API stays open exactly as
//   before. On a public deploy with no way to log in, Claw is refused; see
//   dangerousAllowed().
// ═══════════════════════════════════════════════════════════════════

import crypto from "crypto";
import { initializeApp, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FIREBASE_CONFIG } from "../public/js/firebase-config.js";

const COOKIE = "aria_auth";
const SESSION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const accessKey = () => process.env.ARIA_ACCESS_KEY || "";
const relayKey = () => process.env.ARIA_RELAY_KEY || accessKey();
const ownerUid = () => process.env.ARIA_OWNER_UID || "";

/** Running where strangers can reach it (Render sets RENDER=true). */
export const isPublicDeploy = () =>
  !!(process.env.RENDER || process.env.RENDER_EXTERNAL_URL || process.env.ARIA_PUBLIC === "true");

export const googleEnabled = () =>
  !!ownerUid() && (isPublicDeploy() || process.env.ARIA_REQUIRE_LOGIN === "true");

export const authEnabled = () => !!accessKey() || googleEnabled();

// Signs the session cookie. With no configured secret a per-process one is
// fine: a restart just logs the cookie out, and a Google session renews it
// silently. Rotating ARIA_ACCESS_KEY still logs every key session out.
const PROCESS_SECRET = crypto.randomBytes(32).toString("hex");
const sessionSecret = () =>
  process.env.ARIA_SESSION_SECRET || accessKey() || PROCESS_SECRET;

// A named app, so it never collides with lib/cloud-sync.js's default app.
// Verifying ID tokens needs only the project ID (Google's public keys do the
// rest), so this works without FIREBASE_SERVICE_ACCOUNT.
let _adminAuth = null;
function adminAuth() {
  if (!_adminAuth) {
    const app =
      getApps().find((a) => a.name === "aria-auth") ||
      initializeApp({ projectId: FIREBASE_CONFIG.projectId }, "aria-auth");
    _adminAuth = getAuth(app);
  }
  return _adminAuth;
}

/**
 * Checks a Firebase ID token and that it belongs to ARIA's owner.
 * Resolves { ok: true, uid, email } or { ok: false, error, uid?, email? }.
 */
async function checkGoogleToken(idToken) {
  let t;
  try {
    t = await adminAuth().verifyIdToken(String(idToken || ""));
  } catch {
    return { ok: false, error: "invalid_token" };
  }
  const who = { uid: t.uid, email: t.email || "" };
  if (t.firebase?.sign_in_provider !== "google.com")
    return { ok: false, error: "not_google", ...who };
  if (!ownerUid() || t.uid !== ownerUid()) return { ok: false, error: "not_owner", ...who };
  return { ok: true, ...who };
}

const looksLikeJwt = (s) => /^[\w-]+\.[\w-]+\.[\w-]+$/.test(s);

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
  "Claw is disabled: this server is public and nobody has to log in. " +
  "Set ARIA_OWNER_UID (Google sign-in) or ARIA_ACCESS_KEY in the Render environment, then restart.";

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function sign(ts) {
  return crypto.createHmac("sha256", sessionSecret()).update(`aria:${ts}`).digest("hex");
}

function setSessionCookie(req, res) {
  const ts = String(Date.now());
  const secure =
    req.secure || String(req.headers["x-forwarded-proto"] || "").startsWith("https");
  res.setHeader(
    "Set-Cookie",
    `${COOKIE}=${ts}.${sign(ts)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(
      SESSION_MS / 1000,
    )}${secure ? "; Secure" : ""}`,
  );
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

/** Session cookie or access key. A bearer ID token is checked in apiGuard. */
function validUser(req) {
  if (!authEnabled()) return true;
  if (validSession(req)) return true;
  const b = bearer(req);
  return !!b && !!accessKey() && safeEqual(b, accessKey());
}

function validRelay(req) {
  const k = relayKey();
  if (!k) {
    // No relay key. Locally that's the old open behaviour; in public, a
    // Google login alone must not leave the relay routes open to anyone.
    if (!isPublicDeploy()) return true;
    return authEnabled() && validSession(req);
  }
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
export async function apiGuard(req, res, next) {
  const p = req.path;
  if (!p.startsWith("/api/")) return next();
  if (PUBLIC.has(p) || p.startsWith("/api/auth/")) return next();
  if (DEVICE_OPEN.has(p)) return next();

  if (isRelayPath(p)) {
    if (!dangerousAllowed())
      return res.status(403).json({
        error: "claw_disabled",
        message: p.startsWith("/api/ollama/")
          ? "Relays are disabled: this server is public and nobody has to log in. " +
            "Set ARIA_OWNER_UID or ARIA_ACCESS_KEY, plus ARIA_RELAY_KEY, in the Render environment, then restart."
          : DANGEROUS_DISABLED_MSG,
      });
    if (validRelay(req)) return next();
    return res.status(401).json({ error: "bad_relay_key", message: "Relay key missing or wrong (ARIA_RELAY_KEY)." });
  }

  if (validUser(req)) return next();

  const b = bearer(req);
  if (googleEnabled() && looksLikeJwt(b)) {
    const r = await checkGoogleToken(b);
    if (r.ok) return next();
  }
  return res.status(401).json({ error: "auth_required", authRequired: true });
}

/** Mounts /api/auth/{status,login,google,logout}. */
export function mountAuthRoutes(app) {
  app.get("/api/auth/status", (req, res) => {
    res.json({
      required: authEnabled(),
      authenticated: authEnabled() ? validUser(req) : true,
      clawAllowed: dangerousAllowed(),
      // Which lock-screen doors to show.
      methods: { google: googleEnabled(), key: !!accessKey() },
    });
  });

  // Swap a Firebase ID token for the session cookie.
  app.post("/api/auth/google", async (req, res) => {
    if (!googleEnabled())
      return res.status(400).json({ ok: false, error: "google_disabled" });
    const ip = clientIp(req);
    const f = _fails.get(ip);
    if (f && f.until > Date.now())
      return res.status(429).json({ ok: false, error: "locked", retryInMs: f.until - Date.now() });

    const r = await checkGoogleToken(req.body?.idToken);
    if (!r.ok) {
      // A real Google account that isn't the owner isn't a guess, so only
      // bad tokens count toward the lockout.
      if (r.error === "invalid_token") {
        const n = (f?.n || 0) + 1;
        _fails.set(ip, n >= 5 ? { n: 0, until: Date.now() + 15 * 60 * 1000 } : { n, until: 0 });
      }
      console.warn(`[AUTH] Google sign-in refused (${r.error}) for ${r.email || "?"} uid=${r.uid || "?"}`);
      return res.status(403).json(r);
    }
    _fails.delete(ip);
    setSessionCookie(req, res);
    res.json({ ok: true, email: r.email });
  });

  app.post("/api/auth/login", (req, res) => {
    if (!authEnabled()) return res.json({ ok: true, authDisabled: true });
    if (!accessKey()) return res.status(400).json({ ok: false, error: "key_disabled" });
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
    setSessionCookie(req, res);
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
    const ways = [googleEnabled() && "Google sign-in", accessKey() && "access key"]
      .filter(Boolean)
      .join(" + ");
    const relay = process.env.ARIA_RELAY_KEY
      ? "separate"
      : accessKey()
      ? "same as access key"
      : isPublicDeploy()
      ? "NONE — relays refused (set ARIA_RELAY_KEY)"
      : "none (local, open)";
    console.log(`[AUTH] API locked (${ways}; relay key: ${relay})`);
  } else if (isPublicDeploy()) {
    console.warn(
      "\x1b[31m[AUTH] Nobody has to log in on a public deploy (no ARIA_OWNER_UID or ARIA_ACCESS_KEY) — the API is open to anyone. " +
        (dangerousAllowed()
          ? "ARIA_INSECURE_CLAW=true: Claw is ENABLED anyway."
          : "Claw is disabled until it is set.") +
        "\x1b[0m",
    );
  } else {
    console.log("[AUTH] No login required — API open (local mode).");
  }
}
