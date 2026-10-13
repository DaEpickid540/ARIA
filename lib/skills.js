// lib/skills.js — ARIA Skills System (Mark 1.5)
// ═══════════════════════════════════════════════════════════════════
//
// Works exactly like Claude's skills system:
//   • Skills are Markdown files with YAML frontmatter
//   • Stored in skills/user/ or skills/public/
//   • Active skills are injected into the system prompt
//   • ARIA reads the skill content and applies it
//
// File format (same as Claude SKILL.md):
//   ---
//   name: my-skill
//   description: What this skill does and when to use it
//   version: 1.0
//   triggers: ["keyword1", "keyword2"]   # optional auto-activation
//   ---
//   # Skill content...
//   Instructions the AI follows when this skill is active.
//
// A folder skill can also bring its own tool: a tool.js beside SKILL.md, in
// the same shape as a drop-in tool (tools/dice.js):
//   export const TOOL_META = { name, desc, args?, local? };
//   export async function run(input, { skill, dataDir }) { … }
// The model is told about it, and may call it, only while the skill is on
// (or triggered by the message); a slash command (/name) always works. It
// can't take a built-in tool's name. Its answer counts as outside text
// (PC actions after it need an OK) unless it says local: true.
//
// ═══════════════════════════════════════════════════════════════════

import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { ROOT, DATA_DIR } from "./paths.js";

const SKILLS_ROOT = path.join(ROOT, "skills");
const PUBLIC_DIR = path.join(SKILLS_ROOT, "public");
// Skills you write are data: with ARIA_DATA_DIR set (desktop app) they live
// beside the rest of it, since the install folder is replaced on update.
const USER_DIR = process.env.ARIA_DATA_DIR
  ? path.join(DATA_DIR, "skills")
  : path.join(SKILLS_ROOT, "user");
const PREFS_FILE = path.join(DATA_DIR, "skills-prefs.json");
const SKILL_DATA = path.join(DATA_DIR, "skill-data");

// Ensure dirs exist
for (const dir of [PUBLIC_DIR, USER_DIR]) {
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch {
    /* read-only install (desktop app): no bundled public skills, that's fine */
  }
}

// ── YAML frontmatter parser (no deps) ────────────────────────
function parseFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: raw };
  const meta = {};
  const fmLines = match[1].split(/\r?\n/);
  for (let i = 0; i < fmLines.length; i++) {
    const m = fmLines[i].match(/^(\w[\w-]*):\s*(.+)$/);
    if (!m) continue;
    const key = m[1].trim();
    let val = m[2].trim().replace(/^["']|["']$/g, "");
    // Multi-line block scalar: `key: |` (keep newlines) or `key: >` (fold to spaces)
    if (val === "|" || val === ">") {
      const parts = [];
      while (i + 1 < fmLines.length && /^\s+\S/.test(fmLines[i + 1])) {
        parts.push(fmLines[++i].trim());
      }
      meta[key] = parts.join(val === ">" ? " " : "\n");
      continue;
    }
    // Simple array parsing: ["a", "b"] or [a, b]
    if (val.startsWith("[") && val.endsWith("]")) {
      val = val.slice(1, -1).split(",").map(s => s.trim().replace(/^["']|["']$/g, ""));
    }
    meta[key] = val;
  }
  return { meta, body: match[2].trim() };
}

// ── Scan a directory for SKILL.md files ──────────────────────
function scanDir(dir) {
  const skills = [];
  if (!fs.existsSync(dir)) return skills;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const skillFile = path.join(dir, entry.name, "SKILL.md");
      const toolFile = path.join(dir, entry.name, "tool.js");
      if (fs.existsSync(skillFile)) {
        try {
          const raw = fs.readFileSync(skillFile, "utf8");
          const { meta, body } = parseFrontmatter(raw);
          skills.push({
            id: entry.name,
            name: meta.name || entry.name,
            description: meta.description || "",
            version: meta.version || "1.0",
            triggers: Array.isArray(meta.triggers) ? meta.triggers : [],
            allowedTools: Array.isArray(meta["allowed-tools"]) ? meta["allowed-tools"] : [],
            author: meta.author || "",
            location: "user",
            path: skillFile,
            toolFile: fs.existsSync(toolFile) ? toolFile : null,
            body,
            loadedAt: Date.now(),
          });
        } catch (e) {
          console.warn(`[SKILLS] Failed to load ${skillFile}:`, e.message);
        }
      }
    } else if (entry.isFile() && entry.name.endsWith(".md") && entry.name !== "README.md") {
      // Flat .md file directly in skills dir (simpler format)
      try {
        const raw = fs.readFileSync(path.join(dir, entry.name), "utf8");
        const { meta, body } = parseFrontmatter(raw);
        const id = entry.name.replace(/\.md$/, "");
        skills.push({
          id,
          name: meta.name || id,
          description: meta.description || "",
          version: meta.version || "1.0",
          triggers: Array.isArray(meta.triggers) ? meta.triggers : [],
          allowedTools: Array.isArray(meta["allowed-tools"]) ? meta["allowed-tools"] : [],
          author: meta.author || "",
          location: "user",
          path: path.join(dir, entry.name),
          body,
          loadedAt: Date.now(),
        });
      } catch {}
    }
  }
  return skills;
}

// ── Prefs: which skills are active ───────────────────────────
function loadPrefs() {
  try { return JSON.parse(fs.readFileSync(PREFS_FILE, "utf8")); } catch { return { active: [] }; }
}
function savePrefs(prefs) {
  try { fs.writeFileSync(PREFS_FILE, JSON.stringify(prefs, null, 2)); } catch {}
}

// ── Cache ─────────────────────────────────────────────────────
let _cache = null;
let _cacheTime = 0;
const CACHE_TTL = 10_000; // 10s — reload from disk if skills change

let _cacheDirs = "";
const dirStamp = () =>
  [USER_DIR, PUBLIC_DIR]
    .map((d) => {
      try {
        return fs.statSync(d).mtimeMs;
      } catch {
        return 0;
      }
    })
    .join();

export function listSkills() {
  // A skill folder added or removed shows at once (the folder's time
  // changes); an edit inside one within CACHE_TTL.
  const stamp = dirStamp();
  if (_cache && stamp === _cacheDirs && Date.now() - _cacheTime < CACHE_TTL) return _cache;
  _cacheDirs = stamp;
  const user = scanDir(USER_DIR).map(s => ({ ...s, location: "user" }));
  const pub = scanDir(PUBLIC_DIR).map(s => ({ ...s, location: "public" }));
  // user skills override public skills with same id
  const seen = new Set();
  const all = [...user, ...pub].filter(s => {
    if (seen.has(s.id)) return false;
    seen.add(s.id);
    return true;
  });
  _cache = all;
  _cacheTime = Date.now();
  return all;
}

// ── Skill tools (tool.js) ─────────────────────────────────────
const TOOL_NAME = /^[a-z][a-z0-9_-]{1,30}$/;
const _toolMods = new Map(); // tool.js path → what it exported, by file time
let _tools = new Map(); // tool name → { name, desc, args, local, run, skillId, skillName }
let _toolErrors = new Map(); // skill id → why its tool isn't available
let _reserved = new Set();

/** Names skill tools can't take: the built-in tools. server.js sets this. */
export function reserveToolNames(names) {
  _reserved = new Set([...names].map((n) => String(n).toLowerCase().trim()));
}

async function loadToolModule(file) {
  let mtime;
  try {
    mtime = fs.statSync(file).mtimeMs;
  } catch {
    return { error: "tool.js is gone" };
  }
  const hit = _toolMods.get(file);
  if (hit && hit.mtime === mtime) return hit;
  let entry;
  try {
    // The file time in the URL makes an edited tool.js load fresh.
    const mod = await import(`${pathToFileURL(file).href}?v=${mtime}`);
    const meta = mod.TOOL_META || {};
    const name = String(meta.name || "").toLowerCase().trim();
    if (typeof mod.run !== "function") entry = { error: "tool.js doesn't export run(input)" };
    else if (!TOOL_NAME.test(name)) entry = { error: `TOOL_META.name must be one lowercase word (got "${meta.name ?? ""}")` };
    else
      entry = {
        name,
        desc: String(meta.desc || "").slice(0, 200),
        args: String(meta.args || "<input>").slice(0, 120),
        local: meta.local === true,
        run: mod.run,
      };
  } catch (e) {
    entry = { error: `tool.js didn't load: ${e.message}` };
  }
  entry.mtime = mtime;
  _toolMods.set(file, entry);
  return entry;
}

/** Loads each skill's tool.js (again only when the file changed). Cheap: one stat per tool. */
export async function refreshSkillTools() {
  const tools = new Map();
  const errors = new Map();
  const loaded = [];
  for (const s of listSkills()) {
    if (!s.toolFile) continue;
    const t = await loadToolModule(s.toolFile);
    if (t.error) errors.set(s.id, t.error);
    else if (_reserved.has(t.name)) errors.set(s.id, `"${t.name}" is a built-in tool's name; pick another in TOOL_META`);
    else loaded.push({ ...t, skillId: s.id, skillName: s.name });
  }
  // Two skills, one name: the skill that already had it keeps it, so adding
  // a skill never takes a tool away from one you were using.
  const had = (t) => _tools.get(t.name)?.skillId === t.skillId;
  for (const t of [...loaded.filter(had), ...loaded.filter((t) => !had(t))]) {
    if (tools.has(t.name)) errors.set(t.skillId, `"${t.name}" is already the ${tools.get(t.name).skillName} skill's tool`);
    else tools.set(t.name, t);
  }
  _tools = tools;
  _toolErrors = errors;
  return tools;
}

/** Every loaded skill tool, for listings. */
export function listSkillTools() {
  return [..._tools.values()].map(({ name, desc, args, local, skillId, skillName }) => ({ name, desc, args, local, skillId, skillName }));
}

export function skillTool(name) {
  return _tools.get(String(name || "").toLowerCase().trim()) || null;
}

const toolOfSkill = (id) => [..._tools.values()].find((t) => t.skillId === id) || null;

/** The tools the model may use for this message: those of skills that are on or triggered. */
export function enabledSkillTools(message = "") {
  const ids = new Set([...getActiveSkillIds(), ...detectTriggeredSkills(message)]);
  return [..._tools.values()].filter((t) => ids.has(t.skillId));
}

/** Runs a skill's tool with a time limit; the answer is text, capped. */
export async function runSkillTool(name, input, { timeoutMs = 30_000 } = {}) {
  const t = skillTool(name);
  if (!t) return `Unknown tool: ${name}`;
  const dataDir = path.join(SKILL_DATA, t.skillId);
  let timer;
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    const out = await Promise.race([
      Promise.resolve().then(() => t.run(String(input ?? ""), { skill: t.skillId, dataDir })),
      new Promise((_, reject) => (timer = setTimeout(() => reject(new Error(`no answer in ${Math.round(timeoutMs / 1000)}s`)), timeoutMs))),
    ]);
    const text = typeof out === "string" ? out : JSON.stringify(out ?? "");
    return text.length > 8000 ? text.slice(0, 8000) + "\n…(cut)" : text;
  } catch (e) {
    return `Tool error (${t.name}, from the ${t.skillName} skill): ${e?.message || e}`;
  } finally {
    clearTimeout(timer);
  }
}

export function getSkill(id) {
  return listSkills().find(s => s.id === id);
}

// ── Active skill management ───────────────────────────────────
export function getActiveSkillIds() {
  return loadPrefs().active || [];
}
export function setSkillActive(id, active) {
  const prefs = loadPrefs();
  if (!prefs.active) prefs.active = [];
  if (active && !prefs.active.includes(id)) prefs.active.push(id);
  else if (!active) prefs.active = prefs.active.filter(x => x !== id);
  savePrefs(prefs);
  _cache = null; // invalidate
}
export function toggleSkill(id) {
  const active = getActiveSkillIds();
  setSkillActive(id, !active.includes(id));
  return !active.includes(id);
}

// ── Auto-trigger detection ────────────────────────────────────
// Returns skill IDs that should auto-activate based on message content
export function detectTriggeredSkills(message) {
  const lower = message.toLowerCase();
  const skills = listSkills();
  const triggered = [];
  for (const skill of skills) {
    if (!skill.triggers?.length) continue;
    if (skill.triggers.some(t => lower.includes(t.toLowerCase()))) {
      triggered.push(skill.id);
    }
  }
  return triggered;
}

// ── Build system prompt injection ────────────────────────────
// Generates the skill block to inject into the system prompt.
// Uses active skills + auto-triggered skills for this message.
export function buildSkillsContext(message = "") {
  const activeIds = getActiveSkillIds();
  const triggeredIds = detectTriggeredSkills(message);
  const allIds = [...new Set([...activeIds, ...triggeredIds])];
  if (!allIds.length) return "";

  const skills = listSkills();
  const toInject = allIds.map(id => skills.find(s => s.id === id)).filter(Boolean);
  if (!toInject.length) return "";

  const blocks = toInject.map(s => {
    const own = toolOfSkill(s.id);
    const allowed = own && s.allowedTools?.length ? [...s.allowedTools, own.name] : s.allowedTools;
    const toolsLine = allowed?.length
      ? `\n(While this skill is active, only use these tools: ${allowed.join(", ")})`
      : "";
    const ownLine = own ? `\nThis skill's tool (same ACTION format):\nACTION: ${own.name} | ${own.args}   — ${own.desc}` : "";
    return `## SKILL: ${s.name}${s.description ? ` — ${s.description}` : ""}${toolsLine}${ownLine}\n\n${s.body}`;
  }).join("\n\n---\n\n");

  return `\n\n[ACTIVE SKILLS — follow these instructions when they apply to the current task]\n\n${blocks}\n\n[END SKILLS]`;
}

// ── CRUD for user skills ──────────────────────────────────────
export function createSkill(id, content) {
  // id must be a safe directory name
  const safeId = id.replace(/[^a-z0-9-_]/gi, "-").toLowerCase().slice(0, 60);
  const dir = path.join(USER_DIR, safeId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), content, "utf8");
  _cache = null;
  return safeId;
}

export function updateSkill(id, content) {
  const skill = getSkill(id);
  if (!skill) throw new Error(`Skill "${id}" not found`);
  if (skill.location !== "user") throw new Error(`Cannot edit built-in skill "${id}"`);
  fs.writeFileSync(skill.path, content, "utf8");
  _cache = null;
}

export function deleteSkill(id) {
  const skill = getSkill(id);
  if (!skill) return false;
  if (skill.location !== "user") throw new Error(`Cannot delete built-in skill "${id}"`);
  if (path.basename(skill.path) === "SKILL.md") {
    // Directory-style skill: remove its folder
    fs.rmSync(path.dirname(skill.path), { recursive: true, force: true });
  } else {
    // Flat .md skill: remove only the file — dirname here is skills/user itself
    fs.rmSync(skill.path, { force: true });
  }
  setSkillActive(id, false);
  _cache = null;
  return true;
}

// ── Stats ─────────────────────────────────────────────────────
export function getStats() {
  const skills = listSkills();
  const active = getActiveSkillIds();
  return {
    total: skills.length,
    user: skills.filter(s => s.location === "user").length,
    public: skills.filter(s => s.location === "public").length,
    active: active.length,
    skills: skills.map(s => ({
      id: s.id, name: s.name, description: s.description,
      version: s.version, location: s.location,
      active: active.includes(s.id),
      hasTriggers: s.triggers?.length > 0,
      tool: (({ name, desc, args } = {}) => (name ? { name, desc, args } : null))(toolOfSkill(s.id) || {}),
      ...(_toolErrors.has(s.id) ? { toolError: _toolErrors.get(s.id) } : {}),
    })),
  };
}
