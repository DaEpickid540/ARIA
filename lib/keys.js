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
  { name: "FIREBASE_SERVICE_ACCOUNT", label: "Firebase service account (JSON)", group: "Account", url: "https://console.firebase.google.com/project/personal-suite-ca587/settings/serviceaccounts/adminsdk", json: true, hint: "Syncs your chats with ARIA on Render and anywhere else. Paste the whole JSON file (Generate new private key). It can read and write the whole personal-suite project, so keep it private." },
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
  if (k.json && v) {
    // Which account it is says more than its last four characters would.
    let who = "set";
    try {
      who = decodeJson(v).client_email || who;
    } catch {}
    return { name: k.name, label: k.label, group: k.group, url: k.url || null, hint: k.hint || null, secret, set: true, preview: who };
  }
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

/**
 * A value as .env will read it back. Node's parser doesn't unescape \" in a
 * double-quoted value (it ends the value there), which is how a saved service
 * account came back as `{\`. Single quotes are taken literally, so they're
 * used whenever quoting is needed.
 */
function envQuote(value) {
  if (!/[\s#"'`]/.test(value)) return value;
  if (!value.includes("'")) return `'${value}'`;
  if (!value.includes('"')) return `"${value}"`;
  throw new Error("That value has both kinds of quote in it, which .env can't store.");
}

/** Rewrites (or appends) one NAME=value line, keeping the rest of the file. */
function writeEnvValue(name, value) {
  const file = envFile();
  let text = "";
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {}
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const line = `${name}=${envQuote(value)}`;
  const re = new RegExp(`^[ \\t]*(export[ \\t]+)?${name}[ \\t]*=.*$`, "m");
  text = re.test(text) ? text.replace(re, line) : text + (text && !text.endsWith(eol) ? eol : "") + line + eol;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

/**
 * A pasted service-account file spans many lines; .env needs one. Checked and
 * compacted here, so a half-pasted file is refused instead of saved.
 */
function normaliseJson(value) {
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("That isn't valid JSON. Paste the whole file.");
  }
  for (const f of ["project_id", "client_email", "private_key"])
    if (!parsed?.[f]) throw new Error(`That JSON has no "${f}". Is it the service-account file?`);
  // Base64: one line with nothing to quote. cloud-sync.js reads either form.
  return Buffer.from(JSON.stringify(parsed)).toString("base64");
}

/** A JSON key's value, whether stored raw or as base64. */
function decodeJson(v) {
  try {
    return JSON.parse(v);
  } catch {
    return JSON.parse(Buffer.from(v, "base64").toString("utf8"));
  }
}

/**
 * Mounts GET /api/keys and POST /api/keys.
 * @param {{ onChange?: (name: string) => void }} [opts]  e.g. start chat sync
 *        the moment a service account is saved.
 */
export function mountKeyRoutes(app, { onChange } = {}) {
  app.get("/api/keys", (req, res) => {
    const refusal = writeRefusal(req);
    res.json({ editable: !refusal, reason: refusal, keys: KEYS.map(describe) });
  });

  app.post("/api/keys", (req, res) => {
    const refusal = writeRefusal(req);
    if (refusal) return res.status(403).json({ ok: false, error: refusal });
    const { name } = req.body || {};
    let value = String(req.body?.value ?? "").trim();
    const k = BY_NAME.get(name);
    if (!k) return res.status(400).json({ ok: false, error: "Unknown key." });
    if (k.json && value) {
      try {
        value = normaliseJson(value);
      } catch (e) {
        return res.status(400).json({ ok: false, error: e.message });
      }
    }
    if (/[\r\n]/.test(value) || value.length > (k.json ? 16384 : 4096))
      return res.status(400).json({ ok: false, error: "That doesn't look like a key." });
    try {
      writeEnvValue(name, value);
    } catch (e) {
      return res.status(e.message.includes("quote") ? 400 : 500).json({ ok: false, error: e.message.includes("quote") ? e.message : `Couldn't write ${envFile()}: ${e.message}` });
    }
    if (value) process.env[name] = value;
    else delete process.env[name];
    console.log(`[KEYS] ${name} ${value ? "saved" : "cleared"}`);
    try {
      onChange?.(name);
    } catch {}
    res.json({ ok: true, key: describe(k) });
  });
}
