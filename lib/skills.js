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
// ═══════════════════════════════════════════════════════════════════

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILLS_ROOT = path.join(__dirname, "..", "skills");
const PUBLIC_DIR = path.join(SKILLS_ROOT, "public");
const USER_DIR = path.join(SKILLS_ROOT, "user");
const PREFS_FILE = path.join(__dirname, "..", "data", "skills-prefs.json");

// Ensure dirs exist
for (const dir of [PUBLIC_DIR, USER_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ── YAML frontmatter parser (no deps) ────────────────────────
function parseFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: raw };
  const meta = {};
  for (const line of match[1].split(/\r?\n/)) {
    const m = line.match(/^(\w[\w-]*):\s*(.+)$/);
    if (!m) continue;
    const key = m[1].trim();
    let val = m[2].trim().replace(/^["']|["']$/g, "");
    // Simple array parsing: ["a", "b"] or [a, b]
    if (val.startsWith("[") && val.endsWith("]")) {
      val = val.slice(1, -1).split(",").map(s => s.trim().replace(/^["']|["']$/g, ""));
    }
    // Multi-line description with |
    if (val === "|") {
      meta[key] = ""; // will be filled by continuation lines
      continue;
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
          allowedTools: [],
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

export function listSkills() {
  if (_cache && Date.now() - _cacheTime < CACHE_TTL) return _cache;
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

  const blocks = toInject.map(s =>
    `## SKILL: ${s.name}${s.description ? ` — ${s.description}` : ""}\n\n${s.body}`
  ).join("\n\n---\n\n");

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
  const dir = path.dirname(skill.path);
  fs.rmSync(dir, { recursive: true, force: true });
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
    })),
  };
}
