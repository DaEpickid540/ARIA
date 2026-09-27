// lib/keys.js — see and set API keys from Settings ▸ Keys
// ═══════════════════════════════════════════════════════════════════
//
// Keys live in an .env file: ARIA_ENV_FILE (the desktop app points it at
// %APPDATA%\ARIA\.env) or ./.env. Saving one writes the file AND sets
// process.env, and every provider reads process.env when it is called, so a
// new key works on the next message with no restart.
//
// Values never leave the server: the page only sees whether a key is set and
// its last four characters.
//
// Editing is refused on a public deploy. Render's disk is wiped on every
// deploy, so a key saved there would vanish; set those in the Render
// dashboard instead. Locally with no login configured, only this machine
// (loopback) may write, since `npm start` also listens on the LAN.
// ═══════════════════════════════════════════════════════════════════

import fs from "fs";
import path from "path";
import { parseEnv } from "util";
import { ROOT } from "./paths.js";
import { isPublicDeploy, authEnabled } from "./auth.js";

/** What the Keys tab shows, in order. */
export const KEYS = [
  { name: "OPENROUTER_API_KEY", label: "OpenRouter", group: "Chat models", url: "https://openrouter.ai/keys", hint: "Default cloud chat model; many free models." },
  { name: "GROQ_API_KEY", label: "Groq", group: "Chat models", url: "https://console.groq.com/keys", hint: "Fast chat, and voice-to-text (Whisper). Free tier." },
  { name: "DEEPSEEK_KEY", label: "DeepSeek", group: "Chat models", url: "https://platform.deepseek.com/api_keys" },
  { name: "NEMOTRON_NVIDIA", label: "NVIDIA (Nemotron)", group: "Chat models", url: "https://build.nvidia.com" },
  { name: "CLOUDFLARE_ACCOUNT_ID", label: "Cloudflare account ID", group: "Chat models", url: "https://dash.cloudflare.com", secret: false },
  { name: "CLOUDFLARE_AI_API", label: "Cloudflare AI token", group: "Chat models", url: "https://dash.cloudflare.com/profile/api-tokens", hint: "Workers AI chat and FLUX images." },
  { name: "OPENAI_KEY", label: "OpenAI", group: "Images & voice", url: "https://platform.openai.com/api-keys", hint: "DALL·E images and voice-to-text." },
  { name: "TAVILY_API_KEY", label: "Tavily", group: "Tools", url: "https://app.tavily.com/home", hint: "Best web research: search results arrive with the page text, and pages that block ARIA still get read. Free tier: 1,000 searches a month." },
  { name: "SERPAPI_KEY", label: "SerpApi", group: "Tools", url: "https://serpapi.com/manage-api-key", hint: "Google results for research. Without Tavily or this, ARIA uses DuckDuckGo." },
  { name: "NEWSDATA_KEY", label: "NewsData", group: "Tools", url: "https://newsdata.io/api-key" },
  { name: "OLLAMA_URL", label: "Ollama address", group: "Local models", secret: false, hint: "Default http://localhost:11434" },
  { name: "ARIA_OWNER_UID", label: "Owners (Google user IDs)", group: "Account", secret: false, hint: "Lets ARIA's website use this PC when you sign in with one of these accounts. The website shows each account's ID; separate several with commas. IDs are case-sensitive." },
];
const BY_NAME = new Map(KEYS.map((k) => [k.name, k]));

export const envFile = () => process.env.ARIA_ENV_FILE || path.join(ROOT, ".env");

/**
 * Loads the .env file into process.env without overriding anything already
 * set. server.js never read .env before, so `npm start` only saw keys that
 * were exported in the shell.
 */
export function loadEnvFile() {
  try {
    const vals = parseEnv(fs.readFileSync(envFile(), "utf8"));
    for (const [k, v] of Object.entries(vals)) if (process.env[k] === undefined && v !== "") process.env[k] = v;
  } catch {
    /* no .env — fine */
  }
}

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

function writeRefusal(req) {
  if (isPublicDeploy())
    return "Keys can't be saved on a public deploy (its disk is wiped on every deploy). Set them in the Render dashboard.";
  if (!authEnabled() && !LOOPBACK.has(req.socket?.remoteAddress || ""))
    return "Keys can only be changed from this computer.";
  return null;
}

function describe(k) {
  const v = process.env[k.name] || "";
  const secret = k.secret !== false;
  return {
    name: k.name,
    label: k.label,
    group: k.group,
    url: k.url || null,
    hint: k.hint || null,
    secret,
    set: !!v,
    // Enough to tell two keys apart, never enough to use one.
    preview: !v ? "" : secret ? (v.length >= 12 ? `…${v.slice(-4)}` : "set") : v,
  };
}

/** Rewrites (or appends) one NAME=value line, keeping the rest of the file. */
function writeEnvValue(name, value) {
  const file = envFile();
  let text = "";
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {}
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const needsQuotes = /[\s#"'`]/.test(value);
  const line = value === "" ? `${name}=` : `${name}=${needsQuotes ? JSON.stringify(value) : value}`;
  const re = new RegExp(`^[ \\t]*(export[ \\t]+)?${name}[ \\t]*=.*$`, "m");
  text = re.test(text) ? text.replace(re, line) : text + (text && !text.endsWith(eol) ? eol : "") + line + eol;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

/** Mounts GET /api/keys and POST /api/keys. */
export function mountKeyRoutes(app) {
  app.get("/api/keys", (req, res) => {
    const refusal = writeRefusal(req);
    res.json({ editable: !refusal, reason: refusal, keys: KEYS.map(describe) });
  });

  app.post("/api/keys", (req, res) => {
    const refusal = writeRefusal(req);
    if (refusal) return res.status(403).json({ ok: false, error: refusal });
    const { name } = req.body || {};
    const value = String(req.body?.value ?? "").trim();
    const k = BY_NAME.get(name);
    if (!k) return res.status(400).json({ ok: false, error: "Unknown key." });
    if (/[\r\n]/.test(value) || value.length > 4096)
      return res.status(400).json({ ok: false, error: "That doesn't look like a key." });
    try {
      writeEnvValue(name, value);
    } catch (e) {
      return res.status(500).json({ ok: false, error: `Couldn't write ${envFile()}: ${e.message}` });
    }
    if (value) process.env[name] = value;
    else delete process.env[name];
    console.log(`[KEYS] ${name} ${value ? "saved" : "cleared"}`);
    res.json({ ok: true, key: describe(k) });
  });
}
