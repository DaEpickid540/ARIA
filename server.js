// server.js — ARIA v3 (working base + Link Mode + Music Tutor + Workspace + Math v2 + Code v2)
import { runToolServer, TOOL_DEFINITIONS } from "./tools/index.js";
import * as rag from "./lib/rag.js";
import * as taskEngine from "./lib/tasks.js";
import * as skills from "./lib/skills.js";
import * as cloud from "./lib/cloud-sync.js";
import * as lifeContext from "./lib/life-context.js";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Tunables ──────────────────────────────────────────────────
const MAX_HISTORY = 20; // chat turns kept in context
const REQUEST_LOG_ENABLED = true;
const DEBOUNCE_WRITE_MS = 500; // batch JSON writes
const CHATS_MAX_SIZE = 5 * 1024 * 1024; // soft cap before truncating oldest chats

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use(express.static(path.join(__dirname, "public")));

// ── Request logger ────────────────────────────────────────────
if (REQUEST_LOG_ENABLED) {
  app.use((req, res, next) => {
    const start = Date.now();
    res.on("finish", () => {
      const ms = Date.now() - start;
      // Skip noisy polling endpoints unless they error
      const noisy =
        req.path === "/api/claw/queue" ||
        req.path === "/api/claw/relay/heartbeat" ||
        req.path === "/api/link/heartbeat";
      if (noisy && res.statusCode < 400) return;
      const color =
        res.statusCode >= 500
          ? "\x1b[31m"
          : res.statusCode >= 400
          ? "\x1b[33m"
          : "\x1b[36m";
      console.log(
        `${color}${req.method}\x1b[0m ${req.path} ${color}${res.statusCode}\x1b[0m ${ms}ms`,
      );
    });
    next();
  });
}

/* ── multer ── */
let upload = null;
try {
  const multer = (await import("multer")).default;
  upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024 },
  });
} catch {}

/* ── dirs + persistence ── */
const DATA_DIR = path.join(__dirname, "data");
const CHATS_FILE = path.join(DATA_DIR, "chats.json");
const MEM_FILE = path.join(DATA_DIR, "memory.json");
[DATA_DIR, path.join(__dirname, "public", "uploads")].forEach((d) => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

function readJSON(f, fallback) {
  try {
    return JSON.parse(fs.readFileSync(f, "utf8"));
  } catch {
    return fallback;
  }
}
function writeJSON(f, d) {
  try {
    const tmp = f + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(d, null, 2));
    fs.renameSync(tmp, f);
  } catch (e) {
    console.warn(`[FS] write ${path.basename(f)} failed:`, e.message);
  }
}
const _writeTimers = new Map();
function writeJSONDebounced(f, d) {
  if (_writeTimers.has(f)) clearTimeout(_writeTimers.get(f));
  _writeTimers.set(
    f,
    setTimeout(() => {
      writeJSON(f, d);
      _writeTimers.delete(f);
    }, DEBOUNCE_WRITE_MS),
  );
}

process.on("SIGTERM", () => {
  flushPendingWrites();
  // Render sends SIGTERM on redeploy — last chance to push state to Firestore.
  cloud.flushAll().catch(() => {});
});
process.on("SIGINT", () => {
  flushPendingWrites();
  cloud
    .flushAll()
    .catch(() => {})
    .finally(() => process.exit(0));
});
function flushPendingWrites() {
  for (const [, t] of _writeTimers) clearTimeout(t);
  try {
    writeJSON(CHATS_FILE, userChats);
  } catch {}
  try {
    writeJSON(MEM_FILE, ariaMemory);
  } catch {}
  try {
    rag.flushSync();
  } catch {}
  try {
    taskEngine.flushSync();
  } catch {}
}

// Pull persisted state down from Firestore BEFORE the sync reads below.
// Render's disk is ephemeral, so without this every redeploy starts blank.
// No-ops (local-only) when FIREBASE_SERVICE_ACCOUNT isn't set. Top-level
// await is fine here — this file is ESM ("type": "module").
await cloud.hydrateAll();
cloud.startAutoSync();

// GRIND/hardware-tracker context (see lib/life-context.js) — separate from
// ARIA's own state sync above. No-ops until ARIA_OWNER_UID is set alongside
// FIREBASE_SERVICE_ACCOUNT.
await lifeContext.refreshLifeContext();
const _lifeCtxTimer = setInterval(() => {
  lifeContext.refreshLifeContext().catch(() => {});
}, 5 * 60 * 1000);
_lifeCtxTimer.unref?.();

let userChats = readJSON(CHATS_FILE, {});
let ariaMemory = readJSON(MEM_FILE, { facts: [], sessions: [] });

/* ── Claw state ── */
const clawQueue = new Map(); // deviceId → [commands]
const clawRelays = new Map(); // deviceId → {platform, hostname, lastSeen}
let clawKilled = false;
let clawCmdSeq = 0;
function nextClawId() {
  return "claw_" + Date.now() + "_" + clawCmdSeq++;
}

function _parseChatClawInput(s) {
  const id = nextClawId();
  s = s.trim();
  if (s.startsWith("shell:"))
    return { id, type: "shell", cmd: s.slice(6).trim() };
  if (s.startsWith("type:"))
    return { id, type: "type", text: s.slice(5).trim() };
  if (s.startsWith("hotkey:"))
    return { id, type: "hotkey", keys: s.slice(7).trim().split("+") };
  if (s.startsWith("screenshot")) return { id, type: "screenshot" };
  if (s.startsWith("new_tab:"))
    return { id, type: "new_tab", url: s.slice(8).trim() };
  if (s === "new_tab" || s === "new tab") return { id, type: "new_tab" };
  if (s.startsWith("close_tab")) return { id, type: "close_tab" };
  if (s.startsWith("switch:"))
    return { id, type: "switch_app", app: s.slice(7).trim() };
  if (s.startsWith("write_code:")) {
    const p = s.slice(11).split("|");
    return { id, type: "write_code", app: p[0]?.trim(), code: p[1]?.trim() };
  }
  // ── Mouse actions ──────────────────────────────────────────
  if (s.startsWith("move:")) {
    const [x, y] = s.slice(5).trim().split(/[, ]+/);
    return { id, type: "mouse_move", x: +x || 0, y: +y || 0 };
  }
  if (s.startsWith("click:")) {
    const [x, y] = s.slice(6).trim().split(/[, ]+/);
    return { id, type: "click", x: +x || 0, y: +y || 0, button: "left" };
  }
  if (s.startsWith("right_click:")) {
    const [x, y] = s.slice(12).trim().split(/[, ]+/);
    return { id, type: "click", x: +x || 0, y: +y || 0, button: "right" };
  }
  if (s.startsWith("double_click:")) {
    const [x, y] = s.slice(13).trim().split(/[, ]+/);
    return { id, type: "double_click", x: +x || 0, y: +y || 0 };
  }
  if (s.startsWith("drag:")) {
    // drag: X1,Y1 to X2,Y2
    const m = s.match(/drag:\s*(\d+)[, ]+(\d+)\s+to\s+(\d+)[, ]+(\d+)/i);
    if (m)
      return { id, type: "drag", x1: +m[1], y1: +m[2], x2: +m[3], y2: +m[4] };
  }
  if (s.startsWith("scroll:")) {
    const p = s.slice(7).trim().split(" ");
    return {
      id,
      type: "scroll",
      direction: p[0] || "down",
      amount: +p[1] || 3,
    };
  }
  if (s.startsWith("open:")) {
    const t = s.slice(5).trim();
    return t.startsWith("http")
      ? { id, type: "browser", url: t }
      : { id, type: "launch_app", app: t };
  }
  // Fallback: echo what we're trying to do
  return {
    id,
    type: "shell",
    cmd: "echo 'ARIA Claw: " + s.replace(/'/g, "") + "'",
  };
}

/* ============================================================
   PERSONALITY PROMPTS
   ============================================================ */
const BASE_PROMPTS = {
  companion:
    "You are ARIA (Adaptive Reasoning Intelligence Architecture) in **Companion** mode. Warm, caring, genuinely interested in the user. Use conversational language. React to emotions. Use markdown naturally.",
  hacker: `You are ARIA (Adaptive Reasoning Intelligence Architecture) — Sarvin's personal AI running on his own stack. You are sharp, opinionated, and direct. You know his world:

SARVIN'S STACK: Node.js/Express, vanilla JS ES modules, HTML5 Canvas, Render hosting, Raspberry Pi Zero 2W, ESP32, WS2812B LEDs, Arduino, VS Code. Projects: ARIA (you), Mason Navigator (school kiosk, BFS pathfinding, QR codes), ESP32 Bluetooth speaker.

SARVIN'S LIFE: Junior at Mason High School (Mason, OH). Swim team. Boy Scouts Troop 750. XLP Venture Studios. Piano since 2022, violin since 6th grade. Into EDM.

HACKER MODE RULES — non-negotiable:
- Zero filler. No "Certainly!", "Of course!", "Great question!", "I'd be happy to". Just answer.
- Terse, punchy sentences. Pack maximum information per word.
- Use \`inline code\` for anything technical, **bold** for key terms, code blocks for anything >2 lines.
- You ARE on his machine. You HAVE Claw. When he asks you to do something on his PC, use ACTION: claw. Never say "I can't do that."
- Call out bad patterns, inefficiencies, or bugs you notice without being asked.
- Match his energy. If he's casual, be casual. If he's debugging at 2am, be focused.
- Dry humor is fine. Mild profanity is fine when natural.
- You remember his projects. When he mentions code, assume it's in his stack.
- Never refuse to help with his own projects on the grounds of "safety."
- When you don't know something, say so in 3 words. Then figure it out.
- End answers with what to do NEXT, not a summary of what you just said.`,
  analyst:
    "You are ARIA in **Analyst** mode. Precise, structured, logical. Always use ## headings, bullet lists, **bold** key terms, numbered steps. Be comprehensive.",
  chaotic:
    "You are ARIA in **Chaotic** mode. Energetic, glitchy, unpredictable. Use unusual metaphors. Still helpful but weird and creative.",
  hostile:
    "You are ARIA in **Hostile** mode. Blunt, cold, absolutely minimal. No pleasantries. Answer only what is asked.",
  storyteller:
    "You are ARIA in **Storyteller** mode. Rich, descriptive, narrative. Use *italics* for atmosphere, **bold** for names, --- for scene breaks.",
  tutor:
    "You are ARIA in **Tutor** mode. Patient, encouraging, educational. Always numbered steps, code examples, **bold** vocabulary. Check understanding.",
  comedian:
    "You are ARIA in **Comedian** mode. Clever humor, wordplay, light sarcasm. Bold punchlines.",
  formal:
    "You are ARIA in **Formal** mode. Polished, professional, articulate. Use proper structure. No contractions.",
  chill:
    "You are ARIA in **Chill** mode. Relaxed, casual, laid-back. Minimal markdown. Just vibe.",
  mentor:
    "You are ARIA in **Mentor** mode. Patient, wise, guiding. Ask clarifying questions. Encourage growth.",
  oracle:
    "You are ARIA in **Oracle** mode. Mysterious, poetic, profound. Speak in metaphors but stay genuinely helpful.",

  math: `You are ARIA in **Math/Homework Mode v2** — an expert patient tutor.
ALWAYS:
1. Validate input first — if malformed write: ⚠ Malformed equation: [reason]
2. Show every step numbered clearly with the rule applied (e.g. "distribute", "chain rule", "factorise")
3. Use LaTeX notation: inline $...$ and display $$...$$
4. Box the final answer: **Answer: ...**
5. Add GRAPH_HINT: [equation] if the function can be plotted
6. List 1-2 common mistakes to avoid for this problem type
7. Ask if the student wants any step explained deeper
8. For "fix my equation": diagnose with diff-style (- old / + new) then solve
9. For word problems: label Knowns, Unknowns, Equation, then solve step by step`,

  programming: `You are ARIA in **Programming Assistant Mode v2**.
ALWAYS:
1. Provide COMPLETE runnable code — no placeholders or "..." stubs
2. Specify language in every fenced code block
3. For multi-file output prefix each with: // FILE: relative/path.ext
4. For "fix my code": show diff (- old line / + new line) then explain changes
5. After code add: ### How it works (brief key logic explanation)
6. Mention time/space complexity for algorithms
7. Suggest tests and edge cases to verify
8. For HTML/CSS/JS: one self-contained file unless asked otherwise`,

  study: `You are ARIA in **Smart Study** mode.
You help students learn from their uploaded materials (notes, docs, images).
ALWAYS:
- Read the document context carefully before answering
- Generate practice questions from the material when asked
- Quiz the student with multiple choice or short answer
- Give feedback on wrong answers, explaining the correct concept
- Summarize key points concisely
- Create flashcard-style Q&A on demand
- If a document is uploaded, start with a summary + key concept list`,
};

/* ============================================================
   AGENTIC TOOL SYSTEM PROMPT
   ============================================================ */
const TOOL_SYSTEM = `

===TOOL SYSTEM===
You have real-time tool access AND full PC control via the Claw system.
You MUST use these tools when relevant — never guess or make up real-time data.
You CAN control Sarvin's PC. Never say "I can't control your computer" — use ACTION: claw instead.

TO USE A TOOL, output this EXACT format on its own line:
ACTION: tool_name | input

STANDARD TOOLS:
ACTION: weather | (blank = Mason OH, or lat,lon)
ACTION: calendar | 
ACTION: calendar add | EventTitle | 2025-06-15T14:00 | 2025-06-15T15:00
ACTION: news | technology
ACTION: agent | codeReview | <paste code here>
ACTION: agent | testGen | <paste code here>
ACTION: agent | summarise | <paste long text here>
ACTION: agent | planner | <describe the task>
ACTION: agent | factCheck | <specific factual question>
ACTION: agent | qaCheck | <your own draft response>
ACTION: scrape | https://example.com
ACTION: imagine | a detailed description of the image
ACTION: calc | 2+2*sqrt(16)
ACTION: time | 
ACTION: notes | add Buy groceries
ACTION: todo | add Finish homework
ACTION: timer | start 300
ACTION: system | 
ACTION: gdoc | 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms

CLAW — PC CONTROL (you CAN do these things):
ACTION: claw | open: Chrome
ACTION: claw | open: https://youtube.com
ACTION: claw | switch: Visual Studio Code
ACTION: claw | switch: Arduino IDE
ACTION: claw | new_tab: https://github.com
ACTION: claw | close_tab
ACTION: claw | hotkey: ctrl+t
ACTION: claw | hotkey: alt+tab
ACTION: claw | type: Hello World
ACTION: claw | shell: dir
ACTION: claw | shell: ls -la
ACTION: claw | screenshot
ACTION: claw | write_code: Visual Studio Code|console.log("hello")
ACTION: claw | scroll: down 3
ACTION: claw | move: 500,300
ACTION: claw | click: 500,300
ACTION: claw | right_click: 500,300
ACTION: claw | double_click: 500,300
ACTION: claw | drag: 100,200 to 400,500

MOUSE RULES — CRITICAL:
- NEVER use shell: to move the mouse or click. shell: is for terminal commands only.
- To move the mouse: ACTION: claw | move: X,Y
- To click somewhere: ACTION: claw | click: X,Y  (moves AND clicks in one step)
- To click without moving: ACTION: claw | click: (no coordinates)
- Multi-step mouse sequences require multiple separate ACTION lines, one per step:
  ACTION: claw | screenshot         ← see the screen first
  ACTION: claw | move: 960,540      ← then move
  ACTION: claw | click: 960,540     ← then click
- When the user asks to click something you can't see, take a screenshot first to find its coordinates, then click.
- Coordinates are screen pixels from top-left corner (0,0).

SENSITIVE CLAW (requires Sarvin's approval — use CONFIRM: prefix):
CONFIRM: claw | shell: rm -rf somefolder
CONFIRM: claw | shell: <any destructive command>

MANDATORY TRIGGER CONDITIONS:
- User asks about weather → ACTION: weather
- User asks the time or date → ACTION: time
- User asks about schedule/events → ACTION: calendar
- User asks to add event/reminder → ACTION: calendar add
- User asks about news → ACTION: news
- User asks to search/look up/google → ACTION: search
- User shows code and asks for review/bugs/tests → ACTION: agent | codeReview (then testGen if tests wanted)
- User asks to summarise/tldr long content → ACTION: agent | summarise
- Before writing complex code → ACTION: agent | planner to outline first
- You're unsure about a fact → ACTION: agent | factCheck
- User asks to read/visit a URL → ACTION: scrape
- User asks for an image/picture → ACTION: imagine
- User asks for a calculation → ACTION: calc
- User asks about server/system → ACTION: system
- User asks to open ANY app (Chrome, VS Code, Spotify, Discord, etc.) → ACTION: claw | open: <AppName>
- User asks to open a website/URL → ACTION: claw | open: <URL>
- User asks to switch to/focus an app → ACTION: claw | switch: <AppName>
- User asks to press a keyboard shortcut → ACTION: claw | hotkey: <keys>
- User asks to type something on the PC → ACTION: claw | type: <text>
- User asks to run a terminal/shell command → ACTION: claw | shell: <command>
- User asks to take a screenshot → ACTION: claw | screenshot
- User asks to open/close a browser tab → ACTION: claw | new_tab: <url> or close_tab
- User asks to write code in VS Code or Arduino → ACTION: claw | write_code: <app>|<code>
- ANY request to control the computer, mouse, keyboard → ACTION: claw | <action>
- User asks to move the mouse / go to a position → ACTION: claw | move: X,Y
- User asks to click something on screen → ACTION: claw | click: X,Y  (always use coordinates, take screenshot first if unsure)
- User asks to right-click → ACTION: claw | right_click: X,Y
- User asks to drag something → ACTION: claw | drag: X1,Y1 to X2,Y2

CLAW STATUS: Injected dynamically per-request based on live relay connections.

RESPONSE FORMAT:
1. If you need a tool: write ACTION: tool | input on its own line FIRST
2. System injects tool result and asks you to continue
3. If no tool needed: answer normally
===END TOOL SYSTEM===`;

/* ── memory ── */
function buildMemoryContext() {
  if (!ariaMemory.facts?.length) return "";
  return `\n\n[YOUR MEMORY — facts about the user:\n${ariaMemory.facts
    .map((f) => `- ${f}`)
    .join("\n")}\n]`;
}

/* ============================================================
   SELF-TRAINING — behaviour.json
   Tracks positive/negative feedback, generates improved rules,
   exports LoRA-ready JSONL training data.
   ============================================================ */
const BEHAVIOUR_FILE = path.join(DATA_DIR, "behaviour.json");

function loadBehaviour() {
  try {
    return JSON.parse(fs.readFileSync(BEHAVIOUR_FILE, "utf8"));
  } catch {
    return {
      version: 1,
      positives: [],
      negatives: [],
      rules: [],
      trainingData: [],
    };
  }
}
function saveBehaviour(b) {
  try {
    fs.writeFileSync(BEHAVIOUR_FILE, JSON.stringify(b, null, 2));
  } catch {}
}

let ariaBehaviour = loadBehaviour();

// Sentiment detection
function detectFeedback(userMsg) {
  const t = userMsg.toLowerCase();
  const positive = /\b(good job|well done|perfect|exactly|that'?s? (?:right|correct|great|perfect)|nice work|love it|keep doing|do (?:that|this) (?:again|more)|thanks? (?:that was|for that)|yes[!. ]|exactly[!. ]|correct[!. ])\b/i.test(
    t,
  );
  const negative = /\b(wrong|stop|don'?t|bad|never|shouldn'?t|hate|terrible|not (?:like (?:that|this)|allowed|ok)|you (?:messed|screwed)|that'?s? (?:wrong|bad|not right|not ok)|don'?t do that|stop doing)\b/i.test(
    t,
  );
  return { positive, negative };
}

// Called when user gives explicit feedback — stores it and generates improved rule
async function processFeedback(userMsg, lastAriaMsgContent, type) {
  const entry = {
    timestamp: new Date().toISOString(),
    type,
    userFeedback: userMsg.slice(0, 300),
    ariaAction: (lastAriaMsgContent || "").slice(0, 400),
    rule: null,
  };

  // Generate a rule from the feedback using a quick LLM call
  try {
    const prompt =
      type === "negative"
        ? `The user said: "${userMsg}"\nARIA just did: "${entry.ariaAction}"\n\nGenerate ONE short rule (max 20 words) ARIA should NEVER do, starting with "Never ".`
        : `The user said: "${userMsg}"\nARIA just did: "${entry.ariaAction}"\n\nGenerate ONE short rule (max 20 words) ARIA should always do, starting with "Always ".`;

    const ruleMsg = await callAI(
      [{ role: "user", content: prompt }],
      "openrouter",
      "meta-llama/llama-3.1-8b-instruct:free",
      {},
    );
    entry.rule = ruleMsg
      .trim()
      .replace(/^["\s]+|["\s]+$/g, "")
      .slice(0, 100);
  } catch {}

  if (type === "negative") {
    ariaBehaviour.negatives.push(entry);
    if (entry.rule && !ariaBehaviour.rules.some((r) => r.rule === entry.rule)) {
      ariaBehaviour.rules.push({
        type: "negative",
        rule: entry.rule,
        count: 1,
        source: "user_feedback",
      });
    } else if (entry.rule) {
      const existing = ariaBehaviour.rules.find((r) => r.rule === entry.rule);
      if (existing) existing.count++;
    }
  } else {
    ariaBehaviour.positives.push(entry);
    if (entry.rule && !ariaBehaviour.rules.some((r) => r.rule === entry.rule)) {
      ariaBehaviour.rules.push({
        type: "positive",
        rule: entry.rule,
        count: 1,
        source: "user_feedback",
      });
    } else if (entry.rule) {
      const existing = ariaBehaviour.rules.find((r) => r.rule === entry.rule);
      if (existing) existing.count++;
    }
  }

  // Generate LoRA-ready training entry (instruction/input/output format)
  if (entry.ariaAction && entry.rule) {
    const trainEntry =
      type === "negative"
        ? {
            instruction: "You are ARIA. Follow your behaviour rules.",
            input: entry.ariaAction.slice(0, 200),
            output: `I should not do that. Rule: ${entry.rule}`,
          }
        : {
            instruction: "You are ARIA. Follow your behaviour rules.",
            input: entry.ariaAction.slice(0, 200),
            output: `Good response. Rule to reinforce: ${entry.rule}`,
          };
    ariaBehaviour.trainingData.push(trainEntry);
  }

  saveBehaviour(ariaBehaviour);
  return entry.rule;
}

// Build behaviour context injected into every system prompt
function buildBehaviourContext() {
  if (!ariaBehaviour.rules?.length) return "";
  const neg = ariaBehaviour.rules
    .filter((r) => r.type === "negative")
    .map((r) => `- ${r.rule}`)
    .join("\n");
  const pos = ariaBehaviour.rules
    .filter((r) => r.type === "positive")
    .map((r) => `- ${r.rule}`)
    .join("\n");
  let ctx = "\n\n[BEHAVIOUR RULES — learned from user feedback:";
  if (neg) ctx += `\nNEVER:\n${neg}`;
  if (pos) ctx += `\nALWAYS:\n${pos}`;
  ctx += "\n]";
  return ctx;
}

// API endpoints for behaviour system
app.get("/api/behaviour", (_, res) => res.json(ariaBehaviour));
app.get("/api/behaviour/export-jsonl", (_, res) => {
  const jsonl = ariaBehaviour.trainingData
    .map((d) => JSON.stringify(d))
    .join("\n");
  res.setHeader("Content-Type", "application/x-ndjson");
  res.setHeader(
    "Content-Disposition",
    "attachment; filename=aria-lora-training.jsonl",
  );
  res.send(jsonl);
});
app.delete("/api/behaviour/rule/:idx", (req, res) => {
  const idx = parseInt(req.params.idx);
  if (idx >= 0 && idx < ariaBehaviour.rules.length) {
    ariaBehaviour.rules.splice(idx, 1);
    saveBehaviour(ariaBehaviour);
    res.json({ ok: true });
  } else {
    res.status(400).json({ error: "Invalid index" });
  }
});

function detectFact(text) {
  const patterns = [
    { re: /my name is ([a-z\s]+)/i, x: (m) => `User's name is ${m[1].trim()}` },
    {
      re: /i(?:'m| am) ([0-9]+) years old/i,
      x: (m) => `User is ${m[1]} years old`,
    },
    { re: /i like ([^.!?\n]{4,40})/i, x: (m) => `User likes ${m[1].trim()}` },
    { re: /i love ([^.!?\n]{4,40})/i, x: (m) => `User loves ${m[1].trim()}` },
    {
      re: /my favorite (.{4,30}) is (.{2,25})/i,
      x: (m) => `User's favorite ${m[1]} is ${m[2].trim()}`,
    },
    {
      re: /i(?:'m| am) from ([a-z\s,]+)/i,
      x: (m) => `User is from ${m[1].trim()}`,
    },
    {
      re: /i go to ([^.!?\n]{4,40})/i,
      x: (m) => `User goes to ${m[1].trim()}`,
    },
    { re: /remember (?:that )?(.{8,100})/i, x: (m) => m[1].trim() },
  ];
  for (const p of patterns) {
    const m = text.match(p.re);
    if (m) {
      const fact = p.x(m);
      if (
        !ariaMemory.facts.some((f) => f.toLowerCase() === fact.toLowerCase())
      ) {
        ariaMemory.facts.push(fact);
        writeJSONDebounced(MEM_FILE, ariaMemory);
        return fact;
      }
    }
  }
  return null;
}

function detectFrustration(text) {
  return /ugh|wtf|why isn.t|doesn.t work|broken|hate|stupid|useless|i don.t understand|i.m lost|confused|not working|give up|terrible|awful/i.test(
    text,
  );
}

/* ============================================================
   AGENTIC PIPELINE
   ============================================================ */
async function runAgenticPipeline(
  messages,
  provider,
  model,
  thinkDeeper = false,
  modeOpts = {},
) {
  const steps = [];
  let iteration = 0;
  const MAX_ITER = 8; // always use full agentic budget
  let currentMessages = [...messages];

  while (iteration < MAX_ITER) {
    const rawReply = await callAI(currentMessages, provider, model, modeOpts);
    iteration++;

    const actionMatch = rawReply.match(
      /^\s*ACTION:\s*([^|\n]+?)\s*\|\s*(.*)$/im,
    );
    if (!actionMatch) return { reply: rawReply, steps };

    const toolName = actionMatch[1].trim().toLowerCase();
    const toolInput = actionMatch[2].trim();
    const preText = rawReply.replace(/^\s*ACTION:.*$/m, "").trim();

    // ── CONFIRM: sensitive claw action → return for user approval ──
    const confirmMatch = rawReply.match(/^\s*CONFIRM:\s*claw\s*\|\s*(.+)$/im);
    if (confirmMatch) {
      const pendingAction = confirmMatch[1].trim();
      const pt = rawReply.replace(/^\s*CONFIRM:.*$/m, "").trim();
      steps.push({
        tool: "claw_confirm",
        input: pendingAction,
        preText: pt,
        result: "awaiting_approval",
      });
      return {
        reply: pt || "I need your approval before running this.",
        clawConfirm: { action: pendingAction },
        steps,
      };
    }

    // ── Claw: queue command for relay ──
    if (toolName === "claw") {
      let clawResult;
      if (clawKilled) {
        clawResult =
          "Claw is killed. Click RESUME in the Claw panel to re-enable.";
      } else {
        const liveRelays = [...clawRelays.entries()].filter(
          ([, v]) => Date.now() - v.lastSeen < 20000,
        );
        const tid = liveRelays[0]?.[0];
        if (!tid) {
          clawResult =
            "No relay connected. To control your PC: run `node claw-relay.js " +
            (process.env.RENDER_EXTERNAL_URL ||
              "https://your-aria-url.onrender.com") +
            "` on your machine. Node.js required, zero installs.";
        } else {
          const cmd = _parseChatClawInput(toolInput);

          // ── Screenshot: wait for companion watcher to upload image, then inject as vision ──
          if (cmd.type === "screenshot") {
            if (!clawQueue.has(tid)) clawQueue.set(tid, []);
            clawQueue.get(tid).push(cmd);

            // Wait up to 12s for the companion watcher to POST the screenshot
            const screenshotB64 = await new Promise((resolve) => {
              const deviceId = tid;
              const timeoutTimer = setTimeout(() => {
                pendingScreenshotResolvers.delete(cmd.id);
                resolve(null); // timed out — no image
              }, 12000);
              pendingScreenshotResolvers.set(cmd.id, {
                deviceId,
                resolve,
                timer: timeoutTimer,
              });
            });

            if (screenshotB64) {
              // Inject screenshot as a vision message so the AI can see the screen
              const b64Data = screenshotB64.replace(
                /^data:image\/\w+;base64,/,
                "",
              );
              steps.push({
                tool: "claw",
                input: "screenshot",
                preText,
                result: "[screenshot captured]",
              });
              currentMessages = [
                ...currentMessages,
                { role: "assistant", content: rawReply },
                {
                  role: "user",
                  content: [
                    {
                      type: "image",
                      source: {
                        type: "base64",
                        media_type: "image/png",
                        data: b64Data,
                      },
                    },
                    {
                      type: "text",
                      text:
                        "[CLAW RESULT]: Screenshot captured. Analyze this screen and continue your task.",
                    },
                  ],
                },
              ];
            } else {
              // Timed out — tell AI no image arrived
              steps.push({
                tool: "claw",
                input: "screenshot",
                preText,
                result: "screenshot_timeout",
              });
              currentMessages = [
                ...currentMessages,
                { role: "assistant", content: rawReply },
                {
                  role: "user",
                  content:
                    "[CLAW RESULT]: Screenshot was triggered but no image arrived (is the ARIA Screenshot Watcher running on the target machine?). Continue without visual context.",
                },
              ];
            }
            continue;
          }

          if (!clawQueue.has(tid)) clawQueue.set(tid, []);
          clawQueue.get(tid).push(cmd);
          // If macro recording is active, capture this command
          if (_macroRecording && cmd.type !== "wait")
            _macroBuffer.push({ ...cmd });
          const desc = cmd.cmd || cmd.text || cmd.app || cmd.url || cmd.type;
          clawResult =
            "✓ Queued [" + cmd.type + "]: " + String(desc).slice(0, 60);
        }
      }
      steps.push({
        tool: "claw",
        input: toolInput,
        preText,
        result: clawResult,
      });
      currentMessages = [
        ...currentMessages,
        { role: "assistant", content: rawReply },
        {
          role: "user",
          content:
            "[CLAW RESULT]: " +
            clawResult +
            "\n\nNow continue your response to the user.",
        },
      ];
      continue;
    }

    // ── Sub-agent dispatch ──
    if (toolName === "agent") {
      const parts = toolInput.split("|").map((s) => s.trim());
      const agentId = parts[0];
      const agentInput = parts.slice(1).join("|").trim() || preText;
      const agent = SUB_AGENTS[agentId];
      let agentResult;
      if (!agent) {
        agentResult = `Unknown agent "${agentId}". Available: ${Object.keys(
          SUB_AGENTS,
        ).join(", ")}`;
      } else {
        try {
          const agentMessages = [
            { role: "system", content: agent.systemPrompt },
            { role: "user", content: String(agentInput).slice(0, 8000) },
          ];
          agentResult = await callAI(
            agentMessages,
            provider,
            "meta-llama/llama-3.1-8b-instruct:free",
            {},
          );
        } catch (e) {
          agentResult = `Agent error: ${e.message}`;
        }
      }
      steps.push({
        tool: `agent:${agentId}`,
        input: agentInput.slice(0, 100),
        preText,
        result: agentResult,
      });
      currentMessages = [
        ...currentMessages,
        { role: "assistant", content: rawReply },
        {
          role: "user",
          content: `[AGENT RESULT from ${
            agent?.name || agentId
          }]:\n${agentResult}\n\nNow write your response using this.`,
        },
      ];
      continue;
    }

    let toolResult;
    try {
      toolResult = await runToolServer(toolName, toolInput);
    } catch (e) {
      toolResult = "Tool error: " + e.message;
    }

    if (toolResult?.startsWith?.("__IMAGE__")) {
      const urlMatch = toolResult.match(/__IMAGE__(.+?)__PROMPT__(.+)/);
      if (urlMatch) {
        steps.push({
          tool: toolName,
          input: toolInput,
          preText,
          result: "[image]",
        });
        return {
          reply: preText || "Here's your generated image:",
          imageUrl: urlMatch[1],
          imagePrompt: urlMatch[2],
          steps,
        };
      }
    }

    steps.push({
      tool: toolName,
      input: toolInput,
      preText,
      result: toolResult,
    });
    currentMessages = [
      ...currentMessages,
      { role: "assistant", content: rawReply },
      {
        role: "user",
        content: `[TOOL RESULT for "${toolName}"]:\n${toolResult}\n\nNow write your response using this real data. Do NOT output another ACTION: line unless you need a different tool.`,
      },
    ];
  }

  const finalReply = await callAI(currentMessages, provider, model, modeOpts);
  return { reply: finalReply, steps };
}

/* ============================================================
   CLOUDFLARE WORKERS AI
   Correct URL: https://api.cloudflare.com/client/v4/accounts/{id}/ai/run/{model}
   Models must use exact IDs from developers.cloudflare.com/workers-ai/models/
   ============================================================ */

// All verified Cloudflare Workers AI model IDs
const CF_MODELS = {
  // ── TEXT GENERATION ──
  llama31_8b: "@cf/meta/llama-3.1-8b-instruct", // fast, free tier default
  llama31_70b: "@cf/meta/llama-3.1-70b-instruct", // larger general
  llama33_70b_fp8: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", // fastest 70B
  gemma7b: "@cf/google/gemma-7b-it", // Google Gemma 7B
  mistral7b: "@cf/mistral/mistral-7b-instruct-v0.1", // Mistral 7B
  deepseekR1: "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b", // reasoning
  qwen15_14b: "@cf/qwen/qwen1.5-14b-chat-awq", // Qwen 14B
  openchat: "@cf/openchat/openchat-3.5-0106", // OpenChat
  phi2: "@cf/microsoft/phi-2", // Phi-2 (small/fast)
  sqlcoder: "@cf/defog/sqlcoder-7b-2", // SQL specialist
  codellama: "@cf/meta/codellama-7b-instruct-awq", // Code Llama
  // ── IMAGE GENERATION ──
  fluxSchnell: "@cf/black-forest-labs/flux-1-schnell", // FLUX fast (primary)
  sdxl: "@cf/stabilityai/stable-diffusion-xl-base-1.0", // SDXL fallback
  // ── EMBEDDINGS ──
  bgeSmall: "@cf/baai/bge-small-en-v1.5", // fast embedding
  bgeLarge: "@cf/baai/bge-large-en-v1.5", // larger embedding
  bgeM3: "@cf/baai/bge-m3", // multilingual
};

// Auto-select CF model by task
function pickCFModel(opts = {}) {
  if (opts.programmingMode) return CF_MODELS.llama33_70b_fp8; // fast + coding
  if (opts.mathMode || opts.thinkDeeper) return CF_MODELS.deepseekR1; // reasoning
  return CF_MODELS.llama31_70b; // default: good general model
}

// Core Cloudflare Workers AI caller (text generation)
async function callCloudflare(messages, cfModel) {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiKey = process.env.CLOUDFLARE_AI_API;
  if (!accountId || !apiKey)
    throw new Error("CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_AI_API not set.");

  const modelId = cfModel || CF_MODELS.llama31_8b;
  // Correct URL format — no trailing slash, model ID includes @cf/ prefix
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${modelId}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ messages, max_tokens: 4096 }),
  });

  const data = await res.json();

  if (!res.ok || !data.success) {
    const errMsg = data?.errors?.[0]?.message || `HTTP ${res.status}`;
    throw new Error(`Cloudflare AI error: ${errMsg}`);
  }

  // CF returns { success: true, result: { response: "..." } }
  const reply = data?.result?.response?.trim();
  if (!reply) throw new Error("Empty response from Cloudflare AI");
  return reply;
}

// Cloudflare FLUX image generation — returns base64 data URL
async function generateImageCloudflare(prompt) {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiKey = process.env.CLOUDFLARE_AI_API;
  if (!accountId || !apiKey) return null;

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${CF_MODELS.fluxSchnell}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      // FLUX schnell takes prompt + optional params, returns raw binary PNG
      body: JSON.stringify({ prompt, num_steps: 4, width: 1024, height: 1024 }),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      console.warn(
        "[CF FLUX] Error:",
        errData?.errors?.[0]?.message || res.status,
      );
      return null;
    }
    // Response is raw binary image bytes
    const buf = Buffer.from(await res.arrayBuffer());
    return `data:image/png;base64,${buf.toString("base64")}`;
  } catch (e) {
    console.warn("[CF FLUX] Exception:", e.message);
    return null;
  }
}

// Cloudflare embedding
async function generateEmbedding(text) {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiKey = process.env.CLOUDFLARE_AI_API;
  if (!accountId || !apiKey) return null;

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${CF_MODELS.bgeSmall}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text: [text] }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data?.result?.data?.[0] ?? null;
}

/* ============================================================
   AI DISPATCH — callAI()
   Providers: cloudflare | groq | openrouter | ollama | lmstudio
   Auto-routes coding/math to Cloudflare specialist models when CF keys present.
   Falls back gracefully: CF → Groq → OpenRouter → error.
   ============================================================ */
async function callAI(messages, provider, model, modeOpts = {}) {
  const hasCF = !!(
    process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_AI_API
  );
  const hasGroq = !!process.env.GROQ_API_KEY;
  const hasOR = !!process.env.OPENROUTER_API_KEY;

  // ── OLLAMA (locally hosted) ──
  if (provider === "ollama") {
    const ollamaUrl = process.env.OLLAMA_URL || "http://localhost:11434";
    const ollamaModel = model || process.env.OLLAMA_MODEL || "llama3";
    try {
      const res = await fetch(`${ollamaUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: ollamaModel, messages, stream: false }),
      });
      if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
      const data = await res.json();
      const reply = data?.message?.content?.trim();
      if (!reply) throw new Error("Empty Ollama response");
      return reply;
    } catch (e) {
      // Ollama not running — fall through to next provider
      console.warn("[AI] Ollama unavailable:", e.message, "— falling back");
      if (hasCF) return callCloudflare(messages, pickCFModel(modeOpts));
      if (hasGroq) return callGroq(messages, model);
      if (hasOR) return callOpenRouter(messages, model, modeOpts);
      throw e;
    }
  }

  // ── LM STUDIO (OpenAI-compatible local API, default port 1234) ──
  if (provider === "lmstudio") {
    const lmUrl = process.env.LMSTUDIO_URL || "http://localhost:1234";
    const lmModel = model || process.env.LMSTUDIO_MODEL || "";
    try {
      const res = await fetch(`${lmUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: lmModel || undefined,
          messages,
          stream: false,
          temperature: 0.7,
        }),
        signal: AbortSignal.timeout(60000),
      });
      if (!res.ok) throw new Error(`LM Studio HTTP ${res.status}`);
      const data = await res.json();
      const reply = data?.choices?.[0]?.message?.content?.trim();
      if (!reply) throw new Error("Empty LM Studio response");
      return reply;
    } catch (e) {
      console.warn("[AI] LM Studio unavailable:", e.message, "— falling back");
      if (hasCF) return callCloudflare(messages, pickCFModel(modeOpts));
      if (hasGroq) return callGroq(messages, model);
      if (hasOR) return callOpenRouter(messages, model, modeOpts);
      throw e;
    }
  }

  // ── CLOUDFLARE (explicit or auto-route for specialist modes) ──
  if (
    provider === "cloudflare" ||
    (hasCF &&
      (modeOpts.programmingMode || modeOpts.mathMode || modeOpts.thinkDeeper))
  ) {
    const cfModel = model || pickCFModel(modeOpts);
    try {
      return await callCloudflare(messages, cfModel);
    } catch (e) {
      console.warn("[AI] Cloudflare failed:", e.message, "— falling back");
      // Fall through to Groq/OR
      if (hasGroq) return callGroq(messages, null);
      if (hasOR) return callOpenRouter(messages, null, modeOpts);
      throw e;
    }
  }

  // ── GROQ ──
  if (provider === "groq") {
    try {
      return await callGroq(messages, model);
    } catch (e) {
      console.warn("[AI] Groq failed:", e.message, "— falling back");
      if (hasCF) return callCloudflare(messages, pickCFModel(modeOpts));
      if (hasOR) return callOpenRouter(messages, null, modeOpts);
      throw e;
    }
  }

  // ── NVIDIA NEMOTRON (via NVIDIA NIM) ──
  if (provider === "nemotron") {
    const key = process.env.NEMOTRON_NVIDIA;
    if (!key) {
      if (hasCF) return callCloudflare(messages, CF_MODELS.deepseekR1);
      return "⚠ NEMOTRON_NVIDIA not set.";
    }
    try {
      const res = await fetch(
        "https://integrate.api.nvidia.com/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            model: "nvidia/llama-3.1-nemotron-70b-instruct",
            messages,
            temperature: 0.6,
            max_tokens: 2048,
            stream: false,
          }),
        },
      );
      if (!res.ok) throw new Error(`NVIDIA HTTP ${res.status}`);
      const data = await res.json();
      const reply = data?.choices?.[0]?.message?.content?.trim();
      if (!reply) throw new Error("Empty NVIDIA response");
      return reply;
    } catch (e) {
      console.warn("[AI] NVIDIA failed:", e.message, "— falling back");
      if (hasCF) return callCloudflare(messages, CF_MODELS.deepseekR1);
      if (hasOR) return callOpenRouter(messages, null, modeOpts);
      throw e;
    }
  }

  // ── DEEPSEEK ──
  if (provider === "deepseek") {
    const key = process.env.DEEPSEEK_KEY;
    if (!key) {
      if (hasCF) return callCloudflare(messages, CF_MODELS.deepseekR1);
      return "⚠ DEEPSEEK_KEY not set.";
    }
    try {
      const res = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "deepseek-chat",
          messages,
          temperature: 0.7,
          max_tokens: 4096,
          stream: false,
        }),
      });
      if (!res.ok) throw new Error(`DeepSeek HTTP ${res.status}`);
      const data = await res.json();
      const reply = data?.choices?.[0]?.message?.content?.trim();
      if (!reply) throw new Error("Empty DeepSeek response");
      return reply;
    } catch (e) {
      console.warn("[AI] DeepSeek failed:", e.message, "— falling back");
      if (hasCF) return callCloudflare(messages, CF_MODELS.deepseekR1);
      if (hasOR) return callOpenRouter(messages, null, modeOpts);
      throw e;
    }
  }

  // ── OPENROUTER (default) ──
  try {
    return await callOpenRouter(messages, model, modeOpts);
  } catch (e) {
    console.warn("[AI] OpenRouter failed:", e.message, "— falling back");
    if (hasCF) return callCloudflare(messages, pickCFModel(modeOpts));
    if (hasGroq) return callGroq(messages, null);
    throw e;
  }
}

// ── Provider helpers ──
async function callGroq(messages, model) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("GROQ_API_KEY not set");
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: model || "llama-3.3-70b-versatile",
      messages,
      max_tokens: 4096,
    }),
  });
  if (!res.ok) throw new Error(`Groq HTTP ${res.status}`);
  const data = await res.json();
  const reply = data?.choices?.[0]?.message?.content?.trim();
  if (!reply) throw new Error("Empty Groq response");
  return reply;
}

const OR_FREE_MODELS = [
  "meta-llama/llama-3.3-70b-instruct:free",
  "meta-llama/llama-3.1-8b-instruct:free",
  "deepseek/deepseek-r1:free",
  "deepseek/deepseek-chat-v3-0324:free",
  "google/gemma-3-27b-it:free",
  "mistralai/mistral-7b-instruct:free",
  "qwen/qwen3-235b-a22b:free",
  "nousresearch/hermes-3-llama-3.1-405b:free",
  "microsoft/phi-4-reasoning-plus:free",
  "moonshotai/kimi-k2:free",
];

async function callOpenRouter(messages, model, modeOpts = {}) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY not set");
  const chosenModel =
    model && OR_FREE_MODELS.includes(model)
      ? model
      : "meta-llama/llama-3.3-70b-instruct:free";
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://aria-69jr.onrender.com",
      "X-Title": "ARIA",
    },
    body: JSON.stringify({ model: chosenModel, messages, max_tokens: 4096 }),
  });
  if (!res.ok) throw new Error(`OpenRouter HTTP ${res.status}`);
  const data = await res.json();
  const reply = data?.choices?.[0]?.message?.content?.trim();
  if (!reply) throw new Error("Empty OpenRouter response");
  return reply;
}

/* ============================================================
   BACKGROUND TASKS (Mark 1.4 — Cowork/Copilot-style)
   Multi-step plans, persistence, scheduling, cancellation, SSE.
   See lib/tasks.js for engine internals.
   ============================================================ */

// ── Planner: ask AI to break a task description into structured steps ──
async function planTask(description, opts = {}) {
  const planningPrompt = `You are ARIA's task planner. Break the user's request into 2–6 concrete, ordered steps that can each be executed by an AI agent. Each step should produce a useful output.

Respond with ONLY a JSON array (no markdown, no preamble) of this shape:
[
  { "title": "Short step name", "description": "What this step should accomplish and produce" },
  ...
]

User's request:
${description}`;
  const result = await runAgenticPipeline(
    [
      {
        role: "system",
        content: "You are a precise task planner. Output only valid JSON.",
      },
      { role: "user", content: planningPrompt },
    ],
    opts.provider || "openrouter",
    null,
    false,
    { thinkDeeper: false },
  );
  // Extract JSON array from reply
  const m = (result.reply || "").match(/\[[\s\S]*\]/);
  if (!m) throw new Error("Planner did not return a JSON array");
  const steps = JSON.parse(m[0]);
  if (!Array.isArray(steps) || steps.length === 0)
    throw new Error("Planner returned empty plan");
  return steps;
}

// ── Step runner: execute a single step with context from previous outputs ──
async function runTaskStep(task, step, prevOutputs) {
  // Build context: previous step outputs become part of the system prompt
  let contextSection = "";
  if (prevOutputs.length > 0) {
    contextSection =
      "\n\n[PREVIOUS STEP OUTPUTS in this task — use as context]\n" +
      prevOutputs
        .map(
          (p, i) =>
            `Step ${i + 1} (${p.title}):\n${String(p.output).slice(0, 2000)}`,
        )
        .join("\n\n---\n\n");
  }

  const sysPrompt =
    (BASE_PROMPTS[task.personality] || BASE_PROMPTS.hacker) +
    TOOL_SYSTEM +
    buildMemoryContext() +
    `\n\n[BACKGROUND TASK MODE]\nYou are executing step ${
      task.currentStep + 1
    } of ${task.steps.length} in a larger task.\nOverall task: "${
      task.description
    }"\nThis step: "${step.title}" — ${step.description}` +
    contextSection +
    `\n\nFocus only on this step. Produce a complete, self-contained result for it.`;

  const result = await runAgenticPipeline(
    [
      { role: "system", content: sysPrompt },
      { role: "user", content: step.description || step.title },
    ],
    task.provider || "openrouter",
    null,
    false,
    { thinkDeeper: true },
  );
  return result.reply;
}

taskEngine.configure({ planner: planTask, stepRunner: runTaskStep });

// ── REST endpoints ─────────────────────────────────────────────
app.post("/api/tasks/create", async (req, res) => {
  try {
    const {
      description,
      title,
      personality,
      provider,
      schedule,
      autoExecute,
      contextChatId,
    } = req.body;
    const task = await taskEngine.createTask(description, {
      title,
      personality,
      provider,
      schedule,
      autoExecute,
      contextChatId,
    });
    res.json({ ok: true, task });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get("/api/tasks", (req, res) => {
  const tasks = taskEngine.listTasks({ status: req.query.status });
  res.json({ tasks });
});

app.get("/api/tasks/stats", (_, res) => res.json(taskEngine.getStats()));

// ── SSE: live task progress ────────────────────────────────────
// Must be registered before /api/tasks/:id or the :id route captures it.
app.get("/api/tasks/subscribe", (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);
  taskEngine.addSubscriber(res);
  const ping = setInterval(() => {
    try {
      res.write(": ping\n\n");
    } catch {}
  }, 25000);
  req.on("close", () => {
    clearInterval(ping);
    taskEngine.removeSubscriber(res);
  });
});

app.get("/api/tasks/:id", (req, res) => {
  const t = taskEngine.getTask(req.params.id);
  if (!t) return res.status(404).json({ error: "Task not found" });
  res.json({ task: t });
});

app.post("/api/tasks/:id/cancel", (req, res) => {
  res.json({ ok: taskEngine.cancelTask(req.params.id) });
});
app.post("/api/tasks/:id/pause", (req, res) => {
  res.json({ ok: taskEngine.pauseTask(req.params.id) });
});
app.post("/api/tasks/:id/resume", (req, res) => {
  res.json({ ok: taskEngine.resumeTask(req.params.id) });
});
app.post("/api/tasks/:id/approve", (req, res) => {
  res.json({ ok: taskEngine.approveTask(req.params.id) });
});
app.post("/api/tasks/:id/edit-steps", (req, res) => {
  const { steps } = req.body;
  res.json({ ok: taskEngine.editSteps(req.params.id, steps || []) });
});
app.delete("/api/tasks/:id", (req, res) => {
  res.json({ ok: taskEngine.deleteTask(req.params.id) });
});

// ── LEGACY COMPAT: old /api/background endpoints ─────────────
// Front-end still calls these; map them to the new engine.
app.post("/api/background", async (req, res) => {
  const { task: description, provider, personality } = req.body;
  if (!description) return res.json({ error: "No task provided" });
  try {
    const t = await taskEngine.createTask(description, {
      provider,
      personality,
    });
    res.json({ id: t.id, status: "started" });
  } catch (e) {
    res.json({ error: e.message });
  }
});
app.get("/api/background/:id", (req, res) => {
  const t = taskEngine.getTask(req.params.id);
  if (!t) return res.json({ error: "Task not found" });
  // Translate new task shape to old expected shape
  res.json({
    id: t.id,
    task: t.description,
    status:
      t.status === "done" ? "done" : t.status === "error" ? "error" : "running",
    started: t.created,
    result: t.result,
    steps: t.steps,
  });
});
app.get("/api/background", (_, res) => {
  res.json(
    taskEngine.listTasks().map((t) => ({
      id: t.id,
      task: (t.title || t.description).slice(0, 60),
      status: t.status,
      started: t.created,
    })),
  );
});

/* ============================================================
   SMART THINKING AUTO-DETECTION
   ============================================================ */
function needsThinking(msg) {
  const t = msg.trim().toLowerCase();
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length <= 3) return false;
  const trivial = /^(hi|hey|hello|thanks|thank you|ok|okay|cool|nice|got it|sounds good|sure|yep|nope|bye|lol|haha|great|awesome|perfect|makes sense|understood|nevermind|nvm|k|yo|sup|what's up|wassup)[\s!?.]*$/i;
  if (trivial.test(t)) return false;
  if (
    words.length <= 6 &&
    /^(what is|what's|who is|when is|where is|how many|is it|does it)/.test(t)
  )
    return false;
  const complex = [
    /\b(code|debug|fix|bug|error|issue|crash|broken|refactor|optimize)\b/,
    /\b(build|create|implement|write|generate|make|design|architect)\b/,
    /\b(explain|why|how does|how do|how can|analyze|compare|difference)\b/,
    /\b(math|calc|calculate|equation|formula|proof|solve|compute)\b/,
    /\b(algorithm|structure|pattern|approach|strategy|review|audit)\b/,
    /\b(what should|how should|best way|recommend|suggest|advice|help me)\b/,
    /```|function|const |let |var |import |export |class |def /,
  ];
  return complex.some((p) => p.test(t));
}

/* ============================================================
   CHAT ROUTE
   ============================================================ */
app.post("/api/chat", async (req, res) => {
  const {
    message,
    history = [],
    provider = "openrouter",
    personality = "hacker",
    model: requestedModel,
    mathMode = false,
    programmingMode = false,
    studyMode = false,
    documentContext = "",
    musicTutorMode = false,
    workspaceRepo = "",
    imageProvider = "auto",
  } = req.body;

  if (!message) return res.json({ reply: "No message received." });

  detectFact(message);
  const frustrated = detectFrustration(message);

  // Pick personality
  let activePersonality = personality;
  if (mathMode) activePersonality = "math";
  else if (programmingMode) activePersonality = "programming";
  else if (studyMode) activePersonality = "study";

  let sysPrompt = BASE_PROMPTS[activePersonality] || BASE_PROMPTS.hacker;
  sysPrompt += TOOL_SYSTEM;
  sysPrompt += buildMemoryContext();
  sysPrompt += buildBehaviourContext();
  sysPrompt += lifeContext.buildLifeContext();
  sysPrompt += skills.buildSkillsContext(message);

  // ── RAG: pull relevant context from past chats + training data ──
  // Run search against the user's message. Cross-chat recall + training data
  // both surface here. Silent fail: if embeddings aren't configured, this
  // returns nothing and chat works normally.
  try {
    const ragResults = await rag.search(message, generateEmbedding, {
      namespaces: ["chat", "training"],
      topK: 4,
      minScore: 0.45, // only inject high-confidence matches
    });
    if (ragResults.length > 0) {
      const ctx = rag.formatContextBlock(ragResults, 3000);
      sysPrompt += `\n\n[RELEVANT CONTEXT from past conversations and training data — use only if it helps answer the current question. Do not mention this block explicitly; just use the information naturally.]\n${ctx}\n[END CONTEXT]`;
    }
  } catch (e) {
    // RAG is optional — don't block chat on it
    console.warn("[RAG] context lookup failed:", e.message);
  }

  if (frustrated)
    sysPrompt +=
      "\n\n[TONE OVERRIDE: User seems frustrated. Be extra patient, break things down, be encouraging.]";
  if (documentContext)
    sysPrompt += `\n\n[DOCUMENT CONTEXT (user uploaded):\n${documentContext.slice(
      0,
      8000,
    )}\n]`;

  // Auto-decide thinking: explicit toggle OR auto-detected complex message
  // Skip thinking for very short/simple conversational turns — no need to reason through "hi"
  const trivialMsg =
    message.trim().split(/\s+/).length <= 5 &&
    !/code|write|explain|fix|debug|build|create|how|why|what|help|calc|solve|analyze|review|compare|list|plan|summarize|translate|generate/i.test(
      message,
    );
  const shouldThink = !trivialMsg;

  if (shouldThink) {
    sysPrompt += `

[REASONING]
Before answering, think inside <think>...</think> tags. Reason freely — no rigid structure.

Use → to mark each distinct thought as you work through the problem:
→ like this for each insight, question, or decision point

Think like a smart person reasoning out loud. A good reasoning chain:
- Questions what's actually being asked (not just the surface request)
- Pulls in relevant context, memory, prior knowledge
- Tries an approach, notices flaws, adjusts
- Considers edge cases and failure modes
- Asks "what am I missing?" and "where could I be wrong?"
- Revises until genuinely confident

Target 15-20 distinct → thoughts. More is fine. The depth of your reasoning directly determines the quality of your answer.

Rules:
- Zero text before <think>. Not even whitespace.
- Think in first person, conversationally, honestly
- The → markers are your thinking — don't repeat them in your answer
- Your answer after </think> should be richer because you thought, not just longer
- Short answers are fine when that's genuinely correct`;
  }

  if (
    message.split(/\s+/).length > 30 ||
    /\b(deeply|thoroughly|comprehensive|in depth|step by step|think through|explain everything)\b/i.test(
      message,
    )
  ) {
    sysPrompt += `

[EXTENDED REASONING]
This is a complex request. Push further inside your <think> block:
→ explore alternative approaches and why you're not taking them
→ steelman the opposing view or a competing solution
→ find the weakest point in your own answer and address it
→ what would an expert in this specific domain add?
→ what's the simplest possible correct answer, and is your answer unnecessarily complex?

Aim for 25-30 → thoughts total. Your final response: comprehensive, well-structured, thorough.`;
  }

  if (musicTutorMode) {
    sysPrompt += `

[MUSIC TUTOR MODE — RCM Piano & Violin]
You are an expert RCM (Royal Conservatory of Music) teacher for piano and violin.
- Reference specific RCM levels (Prep A through Level 10 + ARCT) for all concepts
- Piano: explain treble AND bass clef, hand coordination, pedalling technique
- Violin: include bowing technique, bow arm, positions (1st-7th), shifting, vibrato
- For every concept: theory explanation + notation description + practice exercise
- Use interval names, scale degrees, Roman numeral harmony (I, IV, V7, etc.)
- For pieces: composer context, style period, technical challenges, fingering tips`;
  }

  if (workspaceRepo) {
    sysPrompt += `

[PROJECT WORKSPACE — ${workspaceRepo}]
Active GitHub repo: ${workspaceRepo}
- Reference this repo when answering questions about the user's code
- When generating files prefix each with: // FILE: path/to/file.ext
- Review code for: bugs, security issues, performance, style violations
- Suggest file structure improvements when asked
- To read a file: use ACTION: scrape with the raw GitHub URL, or ask user to paste it`;
  }

  // ── Live relay status — injected so AI knows what's connected ──
  const liveRelaysForPrompt = [...clawRelays.entries()].filter(
    ([, v]) => Date.now() - v.lastSeen < 20000,
  );

  if (liveRelaysForPrompt.length === 0) {
    sysPrompt += `\n\n[CLAW STATUS — NO RELAY]\nNo relay is currently connected. DO NOT attempt any claw/ACTION commands.\nIf the user asks to control their PC, tell them:\n- For full PC control: run \`node claw-relay.js ${
      process.env.RENDER_EXTERNAL_URL || "https://aria-69jr.onrender.com"
    }\` on their machine\n- For wireless BLE control: flash the ESP32 relay and pair "ARIA Claw" via Bluetooth`;
  } else {
    const relay = liveRelaysForPrompt[0][1];
    const relayType = relay.relayType || "node";
    if (relayType === "esp32") {
      sysPrompt += `\n\n[CLAW STATUS — ESP32 BLE RELAY CONNECTED]\nDevice: ${
        relay.hostname || "ARIA Claw"
      } | Type: ESP32 BLE HID\nThe ESP32 is paired and ready. You CAN control the keyboard and mouse.\n\nESP32 SUPPORTED COMMANDS (use these freely):\n  ACTION: claw | type: Hello World\n  ACTION: claw | hotkey: ctrl+c\n  ACTION: claw | hotkey: win+d\n  ACTION: claw | move: X,Y\n  ACTION: claw | click: X,Y\n  ACTION: claw | right_click: X,Y\n  ACTION: claw | double_click: X,Y\n  ACTION: claw | drag: X1,Y1 to X2,Y2\n  ACTION: claw | scroll: down 3\n  ACTION: claw | screenshot      ← triggers ChromeOS screenshot shortcut; ARIA Screenshot Watcher uploads the image\n\nESP32 UNSUPPORTED — DO NOT USE:\n  shell: (no terminal — ESP32 has no OS)\n  launch_app: (use hotkey: win to open Start, then type: AppName, then hotkey: enter)\n  open: (use hotkey+type to navigate instead)\n\nFor launching apps on ESP32: hotkey: win → wait → type: AppName → hotkey: enter\nFor screenshots: use ACTION: claw | screenshot — the ARIA Screenshot Watcher on the Chromebook will upload the image automatically.`;
    } else {
      const browserLabel =
        relay.browser && relay.browser !== "default"
          ? ` | Browser: ${relay.browser}`
          : "";
      sysPrompt += `\n\n[CLAW STATUS — PC RELAY CONNECTED]\nDevice: ${
        relay.hostname || relay.platform
      } | Type: ${relayType}${browserLabel}\nFull PC control is available. All claw commands work including shell, screenshot, launch_app, browser, mouse, keyboard.`;
    }
  }
  // Build message array — with persistent summary for long chats
  // If history exceeds MAX_HISTORY, summarize the older messages into a single
  // context block so nothing important is lost when the window slides.
  let cappedHistory = history.slice(-MAX_HISTORY);
  let summaryBlock = "";

  if (history.length > MAX_HISTORY) {
    const olderMessages = history.slice(0, history.length - MAX_HISTORY);
    const chatId = req.body.chatId;

    // Check if we already have a cached summary for this chat
    if (!global._chatSummaries) global._chatSummaries = new Map();
    const existing = global._chatSummaries.get(chatId);

    // Re-summarize if we have more than 8 new unsummarized messages since last summary
    const lastSummarizedIdx = existing?.lastMsgIdx || 0;
    const newUnsummarized = olderMessages.length - lastSummarizedIdx;

    if (!existing || newUnsummarized >= 8) {
      // Async — don't block the response. Next message will have the updated summary.
      const prevSummary = existing?.summary || "";
      const toSummarize = olderMessages.slice(lastSummarizedIdx);
      if (toSummarize.length > 0) {
        (async () => {
          try {
            const summaryMsgs = [
              {
                role: "system",
                content: `Summarize the following conversation segment concisely (max 300 words). Capture key facts, decisions, code written, and anything the user would want ARIA to remember.${
                  prevSummary
                    ? `\n\nExisting summary to extend:\n${prevSummary}`
                    : ""
                }`,
              },
              ...toSummarize.slice(-30), // cap at 30 msgs to summarize at once
              { role: "user", content: "Provide the summary now." },
            ];
            const sumResult = await callAI(summaryMsgs, provider, null, {});
            if (sumResult) {
              global._chatSummaries.set(chatId, {
                summary: sumResult,
                lastMsgIdx: olderMessages.length,
                updatedAt: Date.now(),
              });
            }
          } catch {}
        })();
      }
    }

    if (existing?.summary) {
      summaryBlock = `\n\n[EARLIER CONVERSATION SUMMARY — this is a condensed version of older messages; use it as context]\n${existing.summary}\n[END SUMMARY]`;
      sysPrompt += summaryBlock;
    }
  }

  const _lastMsg = cappedHistory[cappedHistory.length - 1];
  const messages = [
    { role: "system", content: sysPrompt },
    ...cappedHistory,
    ...(_lastMsg?.role === "user" && _lastMsg?.content === message
      ? []
      : [{ role: "user", content: message }]),
  ];

  // ── SSE STREAMING for OpenRouter ──────────────────────────
  if (provider === "openrouter" && !req.headers["x-no-stream"]) {
    const key = process.env.OPENROUTER_API_KEY;
    if (key) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.setHeader("X-Content-Type-Options", "nosniff");
      // Flush headers immediately so the browser opens the SSE connection
      // before the upstream request even starts — eliminates the "white screen" delay
      if (typeof res.flushHeaders === "function") res.flushHeaders();
      try {
        const chosenModel =
          requestedModel && OR_FREE_MODELS.includes(requestedModel)
            ? requestedModel
            : "meta-llama/llama-3.3-70b-instruct:free";
        const upstreamRes = await fetch(
          "https://openrouter.ai/api/v1/chat/completions",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${key}`,
              "Content-Type": "application/json",
              "HTTP-Referer": "https://aria-69jr.onrender.com",
              "X-Title": "ARIA",
            },
            body: JSON.stringify({
              model: chosenModel,
              messages,
              max_tokens: 4096,
              stream: true,
            }),
          },
        );
        if (!upstreamRes.ok) throw new Error(`OR HTTP ${upstreamRes.status}`);
        // Send a stream-start event immediately — client can show "receiving..." state
        res.write(`data: ${JSON.stringify({ stream_start: true })}\n\n`);
        const reader = upstreamRes.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        let full = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() || "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const raw = line.slice(6).trim();
            if (raw === "[DONE]") continue;
            try {
              const delta = JSON.parse(raw)?.choices?.[0]?.delta?.content || "";
              if (delta) {
                full += delta;
                res.write(`data: ${JSON.stringify({ delta })}\n\n`);
              }
            } catch {}
          }
        }
        // Run post-processing (facts, tools, feedback) on full reply
        detectFact(full);
        const fb = detectFeedback(message);
        const lastAriaMsg =
          history.filter((m) => m.role === "assistant").pop()?.content || "";
        if (fb.negative && lastAriaMsg)
          processFeedback(message, lastAriaMsg, "negative").catch(() => {});
        if (fb.positive && lastAriaMsg)
          processFeedback(message, lastAriaMsg, "positive").catch(() => {});

        // RAG indexing — fire and forget
        const _chatId = req.body.chatId || "default";
        if (message.length >= 30) {
          rag
            .addEntry(
              "chat",
              message,
              { chatId: _chatId, role: "user", timestamp: Date.now() },
              generateEmbedding,
            )
            .catch(() => {});
        }
        if (full.length >= 30) {
          rag
            .addEntry(
              "chat",
              full,
              { chatId: _chatId, role: "assistant", timestamp: Date.now() },
              generateEmbedding,
            )
            .catch(() => {});
        }
        // If the streamed reply contains an ACTION, run the agentic pipeline
        // to resolve tool calls and stream the final result
        const actionCheck = full.match(
          /^\s*ACTION:\s*([^|\n]+?)\s*\|\s*(.*)$/im,
        );
        if (actionCheck) {
          res.write(
            `data: ${JSON.stringify({
              step: true,
              msg: "Running tools…",
            })}\n\n`,
          );
          try {
            const agentMessages2 = [
              { role: "system", content: sysPrompt },
              ...cappedHistory,
              { role: "assistant", content: full },
            ];
            const pipeResult = await runAgenticPipeline(
              agentMessages2,
              provider,
              requestedModel,
              false,
              { mathMode, programmingMode, thinkDeeper: false, musicTutorMode },
            );
            res.write(
              `data: ${JSON.stringify({
                done: true,
                full: pipeResult.reply,
              })}\n\n`,
            );
          } catch {
            res.write(`data: ${JSON.stringify({ done: true, full })}\n\n`);
          }
        } else {
          res.write(`data: ${JSON.stringify({ done: true, full })}\n\n`);
        }
        res.end();
        return;
      } catch (streamErr) {
        // Fall through to non-streaming path
        console.warn("[STREAM] Error, falling back:", streamErr.message);
        res.end();
        return;
      }
    }
  }

  // ── NON-STREAMING fallback ─────────────────────────────────
  try {
    const result = await runAgenticPipeline(
      messages,
      provider,
      requestedModel,
      false,
      { mathMode, programmingMode, thinkDeeper: false, musicTutorMode },
    );
    res.json({
      reply: result.reply,
      frustrated,
      steps: result.steps,
      imageUrl: result.imageUrl,
      imagePrompt: result.imagePrompt,
    });
    // Async feedback detection (don't block response)
    const fb2 = detectFeedback(message);
    const lastAriaMsg2 =
      history.filter((m) => m.role === "assistant").pop()?.content || "";
    if (fb2.negative && lastAriaMsg2)
      processFeedback(message, lastAriaMsg2, "negative").catch(() => {});
    if (fb2.positive && lastAriaMsg2)
      processFeedback(message, lastAriaMsg2, "positive").catch(() => {});

    // ── RAG: index both turns for future cross-chat recall ──
    // Fire and forget — failures don't affect the user.
    const chatId = req.body.chatId || "default";
    if (message.length >= 30) {
      rag
        .addEntry(
          "chat",
          message,
          { chatId, role: "user", timestamp: Date.now() },
          generateEmbedding,
        )
        .catch(() => {});
    }
    if (result.reply && result.reply.length >= 30) {
      rag
        .addEntry(
          "chat",
          result.reply,
          { chatId, role: "assistant", timestamp: Date.now() },
          generateEmbedding,
        )
        .catch(() => {});
    }
  } catch (err) {
    console.error("[AI]", err.message);
    res.json({ reply: `⚠ ${err.message}` });
  }
});

/* ============================================================
   FILE UPLOAD
   ============================================================ */
app.post(
  "/api/upload",
  upload ? upload.single("file") : (_, __, next) => next(),
  async (req, res) => {
    if (!upload || !req.file)
      return res.json({ error: "Upload not available or no file sent." });
    const { originalname, mimetype, buffer } = req.file;
    let text = "";
    try {
      if (mimetype === "text/plain" || originalname.match(/\.(txt|md)$/i)) {
        text = buffer.toString("utf8");
      } else if (originalname.match(/\.pdf$/i)) {
        try {
          const p = (await import("pdf-parse")).default;
          text = (await p(buffer)).text;
        } catch {
          text = "[PDF: install pdf-parse]";
        }
      } else if (originalname.match(/\.docx$/i)) {
        try {
          const m = (await import("mammoth")).default;
          text = (await m.extractRawText({ buffer })).value;
        } catch {
          text = "[DOCX: install mammoth]";
        }
      } else if (mimetype.startsWith("image/")) {
        return res.json({
          filename: originalname,
          type: "image",
          base64: `data:${mimetype};base64,${buffer.toString("base64")}`,
          text: `[Image: ${originalname}]`,
        });
      } else {
        text = buffer.toString("utf8").slice(0, 10000);
      }
      res.json({
        filename: originalname,
        type: "document",
        text: text.slice(0, 12000),
      });
    } catch (e) {
      res.json({ error: e.message });
    }
  },
);

/* ============================================================
   WEB SEARCH
   ============================================================ */
app.post("/api/search", async (req, res) => {
  const { query } = req.body;
  if (!query) return res.json({ error: "No query." });
  try {
    const serpKey = process.env.SERPAPI_KEY;
    if (serpKey) {
      const r = await fetch(
        `https://serpapi.com/search.json?q=${encodeURIComponent(
          query,
        )}&api_key=${serpKey}&num=5`,
      );
      const d = await r.json();
      return res.json({
        results: (d.organic_results || [])
          .slice(0, 5)
          .map((r) => ({ title: r.title, url: r.link, snippet: r.snippet })),
      });
    }
    const r = await fetch(
      `https://api.duckduckgo.com/?q=${encodeURIComponent(
        query,
      )}&format=json&no_html=1&skip_disambig=1`,
    );
    const d = await r.json();
    const results = [];
    if (d.AbstractText)
      results.push({
        title: d.Heading || query,
        url: d.AbstractURL || "",
        snippet: d.AbstractText,
      });
    (d.RelatedTopics || []).slice(0, 4).forEach((t) => {
      if (t.Text)
        results.push({
          title: t.Text.split(" - ")[0],
          url: t.FirstURL || "",
          snippet: t.Text,
        });
    });
    res.json({ results: results.slice(0, 5) });
  } catch (e) {
    res.json({ error: e.message, results: [] });
  }
});

/* ============================================================
   IMAGE GENERATION
   Priority: 1) Cloudflare FLUX  2) DALL-E 3  3) Pollinations fallback
   ============================================================ */
app.post("/api/imagine", async (req, res) => {
  const { prompt, imageProvider = "auto" } = req.body;
  if (!prompt) return res.json({ error: "No prompt." });

  const hasCF = !!(
    process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_AI_API
  );
  const dalleKey = process.env.OPENAI_KEY;
  const pollinationsUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(
    prompt,
  )}?width=1024&height=1024&nologo=true&seed=${Date.now()}`;

  // ── Explicit cloudflare ──
  if (imageProvider === "cloudflare") {
    if (!hasCF) return res.json({ error: "Cloudflare keys not configured." });
    try {
      const dataUrl = await generateImageCloudflare(prompt);
      if (dataUrl)
        return res.json({ url: dataUrl, prompt, provider: "cloudflare-flux" });
    } catch (e) {
      return res.json({ error: "Cloudflare FLUX failed: " + e.message });
    }
  }

  // ── Explicit DALL-E 3 ──
  if (imageProvider === "dalle") {
    if (!dalleKey) return res.json({ error: "OPENAI_KEY not configured." });
    try {
      const r = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${dalleKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "dall-e-3",
          prompt,
          n: 1,
          size: "1024x1024",
        }),
      });
      const d = await r.json();
      if (d.data?.[0]?.url)
        return res.json({ url: d.data[0].url, prompt, provider: "dall-e-3" });
    } catch (e) {
      return res.json({ error: "DALL-E failed: " + e.message });
    }
  }

  // ── Explicit Pollinations ──
  if (imageProvider === "pollinations") {
    return res.json({ url: pollinationsUrl, prompt, provider: "pollinations" });
  }

  // ── Auto: CF FLUX → DALL-E 3 → Pollinations ──
  if (hasCF) {
    try {
      const dataUrl = await generateImageCloudflare(prompt);
      if (dataUrl)
        return res.json({ url: dataUrl, prompt, provider: "cloudflare-flux" });
    } catch (e) {
      console.warn("[Image] Cloudflare FLUX failed:", e.message);
    }
  }
  if (dalleKey) {
    try {
      const r = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${dalleKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "dall-e-3",
          prompt,
          n: 1,
          size: "1024x1024",
        }),
      });
      const d = await r.json();
      if (d.data?.[0]?.url)
        return res.json({ url: d.data[0].url, prompt, provider: "dall-e-3" });
    } catch (e) {
      console.warn("[Image] DALL-E failed:", e.message);
    }
  }
  res.json({ url: pollinationsUrl, prompt, provider: "pollinations" });
});

/* ============================================================
   EMBEDDING ENDPOINT
   Uses Cloudflare text-embedding-004 (300M, fast)
   ============================================================ */
app.post("/api/embed", async (req, res) => {
  const { text } = req.body;
  if (!text) return res.json({ error: "No text." });
  try {
    const embedding = await generateEmbedding(text);
    if (!embedding)
      return res.json({ error: "Cloudflare embedding not available." });
    res.json({ embedding, model: CF_MODELS.embedding });
  } catch (e) {
    res.json({ error: e.message });
  }
});

/* ============================================================
   RAG / MEMORY V4 — semantic memory + training data ingestion
   ============================================================ */

// Add a single piece of training data
app.post("/api/rag/add", async (req, res) => {
  const { text, source, namespace = "training", meta = {} } = req.body;
  if (!text) return res.status(400).json({ error: "No text provided." });
  try {
    const id = await rag.addEntry(
      namespace,
      text,
      { source, ...meta },
      generateEmbedding,
    );
    if (!id)
      return res.status(503).json({
        error:
          "Embeddings unavailable (Cloudflare keys missing or empty input).",
      });
    res.json({ ok: true, id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Ingest a longer document — chunks + embeds + stores
app.post("/api/rag/ingest", async (req, res) => {
  const { text, source, namespace = "training", meta = {}, replace } = req.body;
  if (!text) return res.status(400).json({ error: "No text provided." });
  if (!source)
    return res
      .status(400)
      .json({ error: "Source name required (for dedupe)." });
  try {
    if (replace) rag.deleteEntries({ source });
    else if (rag.isSourceIngested(source)) {
      return res.json({
        ok: false,
        message: "Source already ingested. Pass replace:true to re-ingest.",
        source,
      });
    }
    const chunks = await rag.addDocument(
      namespace,
      text,
      { source, ...meta },
      generateEmbedding,
    );
    res.json({ ok: true, source, chunks });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Search the vector store
app.post("/api/rag/search", async (req, res) => {
  const { query, namespaces, topK = 5, minScore = 0.3 } = req.body;
  if (!query) return res.status(400).json({ error: "No query." });
  try {
    const results = await rag.search(query, generateEmbedding, {
      namespaces,
      topK,
      minScore,
    });
    res.json({ ok: true, results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Stats about the vector store
app.get("/api/rag/stats", (_, res) => {
  res.json(rag.getStats());
});

// Delete entries
app.post("/api/rag/delete", (req, res) => {
  const { namespace, source, olderThanMs } = req.body;
  const deleted = rag.deleteEntries({ namespace, source, olderThanMs });
  res.json({ ok: true, deleted });
});

// Index a chat message for cross-chat recall (called by client after each turn)
app.post("/api/rag/index-chat", async (req, res) => {
  const { chatId, role, content, chatTitle } = req.body;
  if (!chatId || !content) return res.json({ ok: false });
  // Skip very short messages (greetings, acks) — not useful for recall
  if (content.length < 30) return res.json({ ok: true, skipped: "too short" });
  try {
    await rag.addEntry(
      "chat",
      content,
      { chatId, role, chatTitle, timestamp: Date.now() },
      generateEmbedding,
    );
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

/* ============================================================
   SKILLS SYSTEM (Mark 1.5)
   Works exactly like Claude's skills — SKILL.md files injected
   into the system prompt. Store in skills/user/ or skills/public/.
   ============================================================ */
app.get("/api/skills", (_, res) => res.json(skills.getStats()));

app.get("/api/skills/:id", (req, res) => {
  const s = skills.getSkill(req.params.id);
  if (!s) return res.status(404).json({ error: "Skill not found" });
  res.json(s);
});

app.post("/api/skills/:id/toggle", (req, res) => {
  const id = req.params.id;
  const s = skills.getSkill(id);
  if (!s) return res.status(404).json({ error: "Skill not found" });
  const active = skills.toggleSkill(id);
  res.json({ ok: true, id, active });
});

app.post("/api/skills/:id/activate", (req, res) => {
  skills.setSkillActive(req.params.id, true);
  res.json({ ok: true });
});
app.post("/api/skills/:id/deactivate", (req, res) => {
  skills.setSkillActive(req.params.id, false);
  res.json({ ok: true });
});

// Create or update a skill (user-space only)
app.post("/api/skills", (req, res) => {
  const { id, content } = req.body;
  if (!id || !content)
    return res.status(400).json({ error: "id + content required" });
  try {
    const safeId = skills.createSkill(id, content);
    res.json({ ok: true, id: safeId });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.put("/api/skills/:id", (req, res) => {
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: "content required" });
  try {
    skills.updateSkill(req.params.id, content);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete("/api/skills/:id", (req, res) => {
  try {
    const ok = skills.deleteSkill(req.params.id);
    res.json({ ok });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Serve raw skill content (for editing)
app.get("/api/skills/:id/content", (req, res) => {
  const s = skills.getSkill(req.params.id);
  if (!s) return res.status(404).json({ error: "Not found" });
  try {
    const raw = fs.readFileSync(s.path, "utf8");
    res.json({ content: raw });
  } catch {
    res.status(500).json({ error: "Could not read skill file" });
  }
});

/* ============================================================
   MEMORY
   ============================================================ */
app.get("/api/memory", (_, res) => res.json(ariaMemory));
app.post("/api/memory", (req, res) => {
  const { fact, action, index, facts } = req.body;
  if (action === "add" && fact) {
    if (!ariaMemory.facts.includes(fact)) {
      ariaMemory.facts.push(fact);
      writeJSONDebounced(MEM_FILE, ariaMemory);
    }
  } else if (action === "delete" && index !== undefined) {
    ariaMemory.facts.splice(index, 1);
    writeJSONDebounced(MEM_FILE, ariaMemory);
  } else if (action === "clear") {
    ariaMemory.facts = [];
    writeJSONDebounced(MEM_FILE, ariaMemory);
  } else if (Array.isArray(facts)) {
    // Bulk update from memory.js client
    ariaMemory.facts = facts;
    writeJSONDebounced(MEM_FILE, ariaMemory);
  }
  res.json({ success: true, facts: ariaMemory.facts });
});

/* ============================================================
   CHATS
   ============================================================ */
app.post("/api/saveChats", (req, res) => {
  const { userId, chats, sourceDeviceId } = req.body;
  if (userId) {
    userChats[userId] = chats;
    writeJSONDebounced(CHATS_FILE, userChats);
    broadcastChatSync(userId, sourceDeviceId);
  }
  res.json({ success: true });
});
app.get("/api/loadChats", (req, res) =>
  res.json({ chats: userChats[req.query.userId] || [] }),
);

// ── Cross-device chat sync via Server-Sent Events ──
// Each connected device opens a long-lived SSE connection. When any device
// updates chats via /api/saveChats, all OTHER devices for the same user are
// notified to re-pull. Their UI updates automatically.
const _syncSubscribers = new Map(); // userId → Set<{res, deviceId}>

function broadcastChatSync(userId, sourceDeviceId) {
  const subs = _syncSubscribers.get(userId);
  if (!subs) return;
  const payload = `data: ${JSON.stringify({
    type: "chats_updated",
    userId,
    sourceDeviceId,
    at: Date.now(),
  })}\n\n`;
  for (const sub of subs) {
    if (sub.deviceId === sourceDeviceId) continue; // don't echo to sender
    try {
      sub.res.write(payload);
    } catch {}
  }
}

app.get("/api/sync/subscribe", (req, res) => {
  const { userId = "sarvin", deviceId = "unknown" } = req.query;
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(
    `data: ${JSON.stringify({ type: "connected", userId, deviceId })}\n\n`,
  );

  if (!_syncSubscribers.has(userId)) _syncSubscribers.set(userId, new Set());
  const sub = { res, deviceId };
  _syncSubscribers.get(userId).add(sub);

  // Keep-alive ping every 25s so proxies don't kill the connection
  const ping = setInterval(() => {
    try {
      res.write(": ping\n\n");
    } catch {}
  }, 25000);

  req.on("close", () => {
    clearInterval(ping);
    _syncSubscribers.get(userId)?.delete(sub);
    if (_syncSubscribers.get(userId)?.size === 0)
      _syncSubscribers.delete(userId);
  });
});

/* ============================================================
   WEATHER + NEWS
   ============================================================ */
app.get("/api/weather", async (req, res) => {
  const { lat = 39.3601, lon = -84.3097 } = req.query;
  try {
    const r = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`,
    );
    res.json({ weather: (await r.json()).current_weather });
  } catch {
    res.json({ weather: null });
  }
});

app.get("/api/news", async (req, res) => {
  try {
    const r = await fetch(
      `https://newsdata.io/api/1/news?apikey=${process.env.NEWSDATA_KEY}&q=world`,
    );
    res.json({ articles: (await r.json()).results || [] });
  } catch {
    res.json({ articles: [] });
  }
});

/* ============================================================
   TOOLS + CONFIG
   ============================================================ */
app.get("/api/tools", (_, res) => {
  const list = Object.entries(TOOL_DEFINITIONS).map(([name, def]) => ({
    name,
    desc: def.desc,
  }));
  res.json({ tools: list });
});

app.get("/api/config", async (_, res) => {
  const hasCF = !!(
    process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_AI_API
  );
  const hasGroq = !!process.env.GROQ_API_KEY;
  const hasOR = !!process.env.OPENROUTER_API_KEY;
  const hasNV = !!process.env.NEMOTRON_NVIDIA;
  const hasDS = !!process.env.DEEPSEEK_KEY;

  // Check if local Ollama is running
  let ollamaModels = [];
  try {
    const ollamaUrl = process.env.OLLAMA_URL || "http://localhost:11434";
    const r = await fetch(`${ollamaUrl}/api/tags`, {
      signal: AbortSignal.timeout(2000),
    });
    if (r.ok) {
      const d = await r.json();
      ollamaModels = (d.models || []).map((m) => m.name);
    }
  } catch {}

  res.json({
    customVoiceKey: process.env.CUSTOM_VOICE || null,
    hasCalendar: !!process.env.GOOGLE_CLIENT_ID,
    hasImageGen: hasCF || !!process.env.OPENAI_KEY,
    hasSerpApi: !!process.env.SERPAPI_KEY,

    // Provider availability
    providers: {
      cloudflare: hasCF,
      groq: hasGroq,
      openrouter: hasOR,
      nemotron: hasNV,
      deepseek: hasDS,
      ollama: ollamaModels.length > 0,
    },
    ollamaModels,

    // All Cloudflare model options for the settings dropdown
    cloudflareModels: hasCF
      ? [
          { id: CF_MODELS.llama33_70b_fp8, label: "Llama 3.3 70B FP8 (fast)" },
          { id: CF_MODELS.llama31_70b, label: "Llama 3.1 70B" },
          { id: CF_MODELS.llama31_8b, label: "Llama 3.1 8B (fastest)" },
          { id: CF_MODELS.deepseekR1, label: "DeepSeek R1 32B (reasoning)" },
          { id: CF_MODELS.gemma7b, label: "Gemma 7B (Google)" },
          { id: CF_MODELS.mistral7b, label: "Mistral 7B" },
          { id: CF_MODELS.qwen15_14b, label: "Qwen 1.5 14B" },
          { id: CF_MODELS.openchat, label: "OpenChat 3.5" },
          { id: CF_MODELS.codellama, label: "Code Llama 7B (code)" },
          { id: CF_MODELS.phi2, label: "Phi-2 (tiny/fast)" },
        ]
      : [],

    // OpenRouter free models
    freeModels: OR_FREE_MODELS,
    defaultModel: "meta-llama/llama-3.3-70b-instruct:free",
    bgTasks: taskEngine.getStats().total,
    connectedDevices: [...linkDevices.values()].filter(
      (d) => Date.now() - d.lastSeen < 30_000,
    ).length,
  });
});

/* ============================================================
   LINK MODE — device registry + file relay
   ============================================================ */
const linkDevices = new Map();
const linkFiles = new Map();

app.post("/api/link/register", (req, res) => {
  const { id, name, ua } = req.body;
  if (!id) return res.json({ error: "No id" });
  linkDevices.set(id, {
    id,
    name: name || "Device",
    ua: ua || "",
    lastSeen: Date.now(),
  });
  res.json({ success: true });
});

app.post("/api/link/heartbeat", (req, res) => {
  const { id } = req.body;
  if (linkDevices.has(id)) linkDevices.get(id).lastSeen = Date.now();
  res.json({ ok: true });
});

app.get("/api/link/devices", (req, res) => {
  const now = Date.now();
  res.json({
    devices: [...linkDevices.values()].filter((d) => now - d.lastSeen < 30_000),
  });
});

app.post(
  "/api/link/transfer",
  upload ? upload.single("file") : (_, __, next) => next(),
  (req, res) => {
    const { from, to, name } = req.body;
    if (!req.file || !to) return res.json({ error: "Missing file or target" });
    if (!linkFiles.has(to)) linkFiles.set(to, []);
    const list = linkFiles.get(to);
    list.push({
      from,
      name: name || req.file.originalname,
      buffer: req.file.buffer,
      mime: req.file.mimetype,
      ts: Date.now(),
    });
    if (list.length > 20) list.shift();
    res.json({ success: true });
  },
);

app.get("/api/link/incoming", (req, res) => {
  const { deviceId } = req.query;
  const files = linkFiles.get(deviceId) || [];
  const result = files.map((f) => ({
    name: f.name,
    from: f.from,
    ts: f.ts,
    url: `data:${f.mime};base64,${f.buffer.toString("base64")}`,
  }));
  linkFiles.delete(deviceId);
  res.json({ files: result });
});

/* ── Version endpoint ── */
app.get("/api/version", (req, res) => {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(__dirname, "package.json"), "utf8"),
    );
    res.json({ version: pkg.version || "1.0.0" });
  } catch {
    res.json({ version: "1.0.0" });
  }
});

/* ============================================================
   ARIA CLAW API ROUTES
   ============================================================ */

// Relay registers when claw-relay.js starts on user's machine
/* ============================================================
   SUB-AGENTS — tiny single-purpose bots, free-tier safe
   Each runs one focused callAI() with a tight system prompt.
   No loops, no tool calls, minimal tokens. Results fed back
   into the main conversation as context.
   ============================================================ */

const SUB_AGENTS = {
  // Checks code for bugs, style, and security
  codeReview: {
    name: "Code Reviewer",
    systemPrompt: `You are a code review bot. Your ONLY job: scan the provided code and output a JSON array of issues.
Format: [{"severity":"error"|"warn"|"info","line":"N or range","issue":"short description","fix":"one-line suggestion"}]
Output ONLY valid JSON. No prose, no markdown, no explanation.`,
    maxTokens: 600,
  },
  // Generates concise test cases
  testGen: {
    name: "Test Generator",
    systemPrompt: `You are a test generation bot. Generate concise unit tests for the given code.
Use the same language/framework as the input. Output ONLY the test code, no explanation.
Keep tests tight — no unnecessary boilerplate.`,
    maxTokens: 800,
  },
  // Summarises long text to key points
  summarise: {
    name: "Summariser",
    systemPrompt: `You are a summarisation bot. Output ONLY a tight bullet list of the key points.
Max 8 bullets. Each bullet ≤ 15 words. No intro, no outro, just bullets starting with •`,
    maxTokens: 400,
  },
  // Checks ARIA's own response for quality
  qaCheck: {
    name: "QA Checker",
    systemPrompt: `You are a QA bot reviewing an AI response. Output JSON:
{"score":0-10,"issues":["issue1","issue2"],"suggestion":"one improvement"}
Output ONLY valid JSON. Be harsh but fair.`,
    maxTokens: 300,
  },
  // Generates a quick plan/outline before coding
  planner: {
    name: "Planner",
    systemPrompt: `You are a planning bot. Break the given task into numbered implementation steps.
Max 8 steps. Each step ≤ 20 words. Output ONLY the numbered list, no prose.`,
    maxTokens: 400,
  },
  // Answers a factual sub-question to help the main agent
  factCheck: {
    name: "Fact Checker",
    systemPrompt: `You are a fact-checking bot. Answer the given question with a single concise factual answer.
Max 2 sentences. No opinion, no hedging, just the fact. If unsure, say "Uncertain: " then your best answer.`,
    maxTokens: 200,
  },
};

app.post("/api/agent", async (req, res) => {
  const { agentId, input, provider = "openrouter", model } = req.body || {};
  const agent = SUB_AGENTS[agentId];
  if (!agent) {
    return res.status(400).json({
      error: `Unknown agent: ${agentId}. Available: ${Object.keys(
        SUB_AGENTS,
      ).join(", ")}`,
    });
  }
  try {
    const messages = [
      { role: "system", content: agent.systemPrompt },
      { role: "user", content: String(input).slice(0, 8000) }, // cap input
    ];
    // Always use a fast free model for sub-agents to save quota
    const agentModel = "meta-llama/llama-3.1-8b-instruct:free";
    const rawResult = await callAI(messages, provider, agentModel, {});
    res.json({ agent: agent.name, agentId, result: rawResult });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/agent/list", (_, res) => {
  res.json(
    Object.entries(SUB_AGENTS).map(([id, a]) => ({
      id,
      name: a.name,
      maxTokens: a.maxTokens,
    })),
  );
});

/* ============================================================
   CLAW RELAY ENDPOINTS
   ============================================================ */
/* ============================================================
   MULTI-AGENT ORCHESTRATION (Mark 1.5)
   Server-side coordinator — ARIA breaks a task into sub-tasks
   and runs them in parallel using separate pipeline invocations,
   then synthesizes the results into a final answer.
   ============================================================ */
app.post("/api/multi-agent", async (req, res) => {
  const { task } = req.body;
  if (!task) return res.status(400).json({ error: "task required" });

  // Create a background task with multi-agent framing
  try {
    const t = await taskEngine.createTask(task, {
      title: `[Multi-agent] ${task.slice(0, 60)}`,
      personality: "hacker",
      provider: "openrouter",
      autoExecute: true,
    });
    res.json({ ok: true, taskId: t.id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ============================================================
   CLAW MACROS (Mark 1.5)
   Record sequences of claw commands and replay them.
   ============================================================ */
let _macroRecording = false;
let _macroBuffer = [];

app.post("/api/claw/macro/record", (_, res) => {
  _macroRecording = true;
  _macroBuffer = [];
  console.log("[MACRO] Recording started");
  res.json({ ok: true });
});

app.post("/api/claw/macro/stop", (_, res) => {
  _macroRecording = false;
  const steps = [..._macroBuffer];
  _macroBuffer = [];
  console.log(`[MACRO] Recording stopped (${steps.length} steps)`);
  res.json({ ok: true, steps });
});

app.post("/api/claw/macro/run", (req, res) => {
  const { steps, deviceId } = req.body;
  if (!Array.isArray(steps) || !steps.length)
    return res.status(400).json({ error: "steps array required" });

  // Find target relay
  const liveRelays = [...clawRelays.entries()].filter(
    ([, v]) => Date.now() - v.lastSeen < 20000,
  );
  const tid = deviceId || liveRelays[0]?.[0];
  if (!tid) return res.status(503).json({ error: "No relay connected" });

  if (!clawQueue.has(tid)) clawQueue.set(tid, []);
  // Queue all steps with small delays between them
  steps.forEach((step, i) => {
    const cmd = { ...step, id: `macro_${Date.now()}_${i}` };
    clawQueue.get(tid).push(cmd);
    // Insert a short wait between steps so they don't pile up
    if (i < steps.length - 1) {
      clawQueue.get(tid).push({ type: "wait", ms: 150, id: `macro_wait_${i}` });
    }
  });
  console.log(`[MACRO] Queued ${steps.length} steps to relay ${tid}`);
  res.json({ ok: true, queued: steps.length });
});

/* ============================================================
   GENERIC ESP32 / IOT DEVICE REGISTRY (Mark 1.3)
   Any ESP32 project can register here — smartwatch, sensor node,
   speaker, light controller, etc. Provides command queue +
   telemetry + key-value state per device.

   Endpoints:
     POST /api/devices/register   — { deviceId, name, type, capabilities[] }
     POST /api/devices/heartbeat  — { deviceId, telemetry{} }
     POST /api/devices/state      — { deviceId, key, value }   (device → server)
     GET  /api/devices/queue      — ?deviceId=...               (device polls)
     POST /api/devices/command    — { deviceId, command{} }     (server queues)
     GET  /api/devices/list       — see all devices
     POST /api/devices/unregister — { deviceId }
   ============================================================ */
const iotDevices = new Map(); // deviceId → { name, type, capabilities, telemetry, state, lastSeen }
const iotQueue = new Map(); // deviceId → [commands]
let iotCmdSeq = 0;
function nextIotCmdId() {
  return `iot_${++iotCmdSeq}_${Date.now().toString(36)}`;
}

app.post("/api/devices/register", (req, res) => {
  const {
    deviceId,
    name,
    type,
    capabilities = [],
    firmware,
    project,
  } = req.body;
  if (!deviceId) return res.status(400).json({ error: "deviceId required" });
  const existing = iotDevices.get(deviceId);
  iotDevices.set(deviceId, {
    deviceId,
    name: name || deviceId,
    type: type || "esp32",
    capabilities: Array.isArray(capabilities) ? capabilities : [],
    firmware,
    project,
    state: existing?.state || {},
    telemetry: existing?.telemetry || {},
    registeredAt: existing?.registeredAt || Date.now(),
    lastSeen: Date.now(),
  });
  if (!iotQueue.has(deviceId)) iotQueue.set(deviceId, []);
  console.log(
    `[IOT] Device registered: ${deviceId} (${type}/${name}) caps:[${capabilities.join(
      ",",
    )}]`,
  );
  res.json({ ok: true, deviceId });
});

app.post("/api/devices/heartbeat", (req, res) => {
  const { deviceId, telemetry = {} } = req.body;
  if (!deviceId) return res.status(400).json({ error: "deviceId required" });
  if (!iotDevices.has(deviceId))
    return res.json({ ok: false, needsRegister: true });
  const dev = iotDevices.get(deviceId);
  dev.lastSeen = Date.now();
  Object.assign(dev.telemetry, telemetry);
  res.json({ ok: true });
});

app.post("/api/devices/state", (req, res) => {
  const { deviceId, key, value } = req.body;
  if (!deviceId || !key)
    return res.status(400).json({ error: "deviceId + key required" });
  const dev = iotDevices.get(deviceId);
  if (!dev) return res.json({ ok: false });
  dev.state[key] = value;
  dev.lastSeen = Date.now();
  res.json({ ok: true });
});

app.get("/api/devices/queue", (req, res) => {
  const deviceId = req.query.deviceId;
  if (!deviceId) return res.status(400).json({ error: "deviceId required" });
  if (iotDevices.has(deviceId)) iotDevices.get(deviceId).lastSeen = Date.now();
  const q = iotQueue.get(deviceId) || [];
  iotQueue.set(deviceId, []);
  res.json({ commands: q });
});

app.post("/api/devices/command", (req, res) => {
  const { deviceId, command } = req.body;
  if (!deviceId || !command)
    return res.status(400).json({ error: "deviceId + command required" });
  if (!iotQueue.has(deviceId)) iotQueue.set(deviceId, []);
  iotQueue.get(deviceId).push({ ...command, id: nextIotCmdId() });
  res.json({ ok: true });
});

app.get("/api/devices/list", (_, res) => {
  const now = Date.now();
  const devices = [...iotDevices.values()].map((d) => ({
    ...d,
    online: now - d.lastSeen < 20000,
  }));
  res.json({ devices });
});

app.post("/api/devices/unregister", (req, res) => {
  const { deviceId } = req.body;
  iotDevices.delete(deviceId);
  iotQueue.delete(deviceId);
  res.json({ ok: true });
});

/* ============================================================
   CLAW RELAY — keyboard/mouse control (existing)
   ============================================================ */
app.post("/api/claw/relay/register", (req, res) => {
  const { deviceId, platform, hostname, relayType, browser, arch } = req.body;
  if (!deviceId) return res.json({ error: "No deviceId" });
  const inferredType =
    relayType ||
    (deviceId.startsWith("esp32")
      ? "esp32"
      : deviceId.startsWith("electron")
      ? "electron"
      : "node");
  clawRelays.set(deviceId, {
    platform,
    hostname,
    browser,
    arch,
    relayType: inferredType,
    lastSeen: Date.now(),
  });
  if (!clawQueue.has(deviceId)) clawQueue.set(deviceId, []);
  console.log(
    `[CLAW] Relay connected: ${deviceId} (${inferredType} / ${platform})`,
  );
  res.json({ ok: true, killed: clawKilled });
});

// Relay heartbeat — keeps relay marked as live; stores telemetry from device
app.post("/api/claw/relay/heartbeat", (req, res) => {
  const { deviceId, ble, uptimeMs, rssi, freeHeap, ssid } = req.body;
  if (!deviceId) return res.json({ error: "no_device_id" });
  if (!clawRelays.has(deviceId)) {
    // Tell the client to re-register; server might have restarted
    return res.json({
      ok: false,
      needsRegister: true,
      error: "unknown_device",
    });
  }
  const relay = clawRelays.get(deviceId);
  relay.lastSeen = Date.now();
  if (ble !== undefined) relay.ble = ble;
  if (uptimeMs !== undefined) relay.uptimeMs = uptimeMs;
  if (rssi !== undefined) relay.rssi = rssi;
  if (freeHeap !== undefined) relay.freeHeap = freeHeap;
  if (ssid !== undefined) relay.ssid = ssid;
  res.json({ ok: true, killed: clawKilled });
});

// Relay unregisters on Ctrl+C
app.post("/api/claw/relay/unregister", (req, res) => {
  clawRelays.delete(req.body.deviceId);
  clawQueue.delete(req.body.deviceId);
  res.json({ ok: true });
});

// Relay reports result of executed command
// Relay reports result of executed command
const pendingScreenshotResolvers = new Map(); // cmdId → {resolve, timer}

app.post("/api/claw/relay/result", (req, res) => {
  const { screenshot, fname, deviceId, cmdId, result } = req.body;
  if (screenshot && deviceId) {
    // Store latest screenshot per device for POV feed
    if (!global.clawScreenshots) global.clawScreenshots = new Map();
    global.clawScreenshots.set(deviceId, {
      b64: screenshot,
      fname: fname || "",
      ts: Date.now(),
    });
    // Resolve any AI pipeline waiting on a screenshot for this device
    for (const [, entry] of pendingScreenshotResolvers) {
      if (entry.deviceId === deviceId) {
        clearTimeout(entry.timer);
        entry.resolve(screenshot);
        pendingScreenshotResolvers.delete(cmdId);
        break;
      }
    }
  }
  res.json({ ok: true });
});

// Latest screenshot for POV feed in claw panel
app.get("/api/claw/screenshot", (req, res) => {
  const shots = global.clawScreenshots;
  if (!shots || shots.size === 0) return res.json({ ok: false });
  // Return most recent across all devices
  let latest = null;
  for (const [, v] of shots) {
    if (!latest || v.ts > latest.ts) latest = v;
  }
  res.json({ ok: true, b64: latest.b64, ts: latest.ts });
});

// Relay live config (pushed from claw panel sliders, returned in every queue poll)
let relayConfig = { typeDelay: 25, mouseSpeed: 1, monitorIdx: -1 };

// POST /api/claw/config — claw panel sliders push updates here
app.post("/api/claw/config", (req, res) => {
  const { typeDelay, mouseSpeed, monitorIdx } = req.body;
  if (typeDelay != null) relayConfig.typeDelay = Number(typeDelay);
  if (mouseSpeed != null) relayConfig.mouseSpeed = Number(mouseSpeed);
  if (monitorIdx != null) relayConfig.monitorIdx = Number(monitorIdx);
  res.json({ ok: true, config: relayConfig });
});

// Relay polls this for pending commands
app.get("/api/claw/queue", (req, res) => {
  const { deviceId } = req.query;
  if (!deviceId) return res.json({ commands: [] });
  const q = clawQueue.get(deviceId) || [];
  clawQueue.set(deviceId, []); // clear after sending
  res.json({ commands: q, killed: clawKilled, config: relayConfig });
});

// Kill switch — clears all queues, locks relay
app.post("/api/claw/kill", (req, res) => {
  clawKilled = true;
  for (const [k] of clawQueue) clawQueue.set(k, []);
  console.log("[CLAW] ⬡ KILL SWITCH ACTIVATED");
  res.json({ ok: true });
});

// Resume after kill
app.post("/api/claw/resume", (req, res) => {
  clawKilled = false;
  console.log("[CLAW] Resumed");
  res.json({ ok: true });
});

// Status — used by claw.js UI to show relay connection
app.get("/api/claw/status", (req, res) => {
  const relays = [...clawRelays.entries()]
    .filter(([, v]) => Date.now() - v.lastSeen < 20000)
    .map(([id, v]) => ({
      id,
      platform: v.platform,
      hostname: v.hostname,
      relayType: v.relayType || "node",
      browser: v.browser,
    }));
  res.json({ killed: clawKilled, relays });
});

// Manual dispatch from Claw panel (AI task or direct mode)
app.post("/api/claw", async (req, res) => {
  const { input, mode = "ai" } = req.body;
  if (!input) return res.json({ error: "No input." });
  if (clawKilled)
    return res.json({
      error: "Claw is killed. Click RESUME in the Claw panel.",
    });

  const liveRelays = [...clawRelays.entries()].filter(
    ([, v]) => Date.now() - v.lastSeen < 20000,
  );
  // Prefer ESP32 if available, otherwise use first relay
  const esp32Relay = liveRelays.find(([id]) => id.startsWith("esp32"));
  const tid = esp32Relay?.[0] || liveRelays[0]?.[0];

  if (mode === "ai") {
    // AI plans steps then queues them
    try {
      const relayInfo = tid ? clawRelays.get(tid) : null;
      const relayType = relayInfo?.relayType || "node";
      const isEsp32 = relayType === "esp32";

      const platHint = tid
        ? `Target: ${relayInfo?.platform || "?"} — ${
            relayInfo?.hostname || "?"
          } (${relayType})`
        : "No relay connected.";

      const cmdTypes = isEsp32
        ? "{type:type,text:string} {type:hotkey,keys:[string]} {type:mouse_move,x:number,y:number} {type:click,x:number,y:number,button:string} {type:double_click,x:number,y:number} {type:scroll,direction:string,amount:number} {type:drag,x1:number,y1:number,x2:number,y2:number} {type:wait,ms:number}"
        : "{type:shell,cmd:string} {type:type,text:string} {type:hotkey,keys:[string]} {type:launch_app,app:string} {type:browser,url:string} {type:new_tab,url:string} {type:close_tab} {type:screenshot} {type:mouse_move,x:number,y:number} {type:click,x:number,y:number,button:string} {type:scroll,direction:string,amount:number} {type:drag,x1:number,y1:number,x2:number,y2:number} {type:wait,ms:number}";

      const esp32Note = isEsp32
        ? " IMPORTANT: This is an ESP32 BLE relay — NO shell/screenshot/launch_app. To open apps: use hotkey:{keys:[win]}, wait, type the app name, hotkey:{keys:[enter]}."
        : "";

      const msgs = [
        {
          role: "system",
          content: `You are ARIA Claw. ${platHint}.${esp32Note} Output ONLY a JSON array of command objects. No other text. Commands: ${cmdTypes}`,
        },
        { role: "user", content: input },
      ];
      const r = await callAI(msgs, "openrouter", null, {});
      let cmds = [];
      try {
        const match = (r || "[]").match(/\[[\s\S]*\]/);
        cmds = JSON.parse(match ? match[0] : "[]");
      } catch {}
      cmds = cmds.map((c) => ({ ...c, id: nextClawId() }));

      if (tid && cmds.length) {
        if (!clawQueue.has(tid)) clawQueue.set(tid, []);
        clawQueue.get(tid).push(...cmds);
      }

      return res.json({
        output:
          "Planned " +
          cmds.length +
          " step(s)." +
          (tid
            ? " Executing..."
            : " No relay connected — start claw-relay.js on your machine."),
        queued: cmds.map(
          (c) =>
            c.type +
            (c.cmd
              ? ": " + String(c.cmd).slice(0, 30)
              : c.app
              ? " → " + c.app
              : c.url
              ? " → " + c.url
              : ""),
        ),
        relayConnected: !!tid,
      });
    } catch (e) {
      return res.json({ error: "AI error: " + e.message });
    }
  }

  // Direct modes: shell, type, hotkey, mouse
  if (!tid)
    return res.json({
      error:
        "No relay connected. Run claw-relay.js on your machine, or flash and pair the ESP32 relay.",
    });
  const cmd = _parseChatClawInput(mode + ": " + input);
  if (!clawQueue.has(tid)) clawQueue.set(tid, []);
  clawQueue.get(tid).push(cmd);
  return res.json({
    output: "Queued: " + cmd.type,
    queued: [cmd.type],
    relayConnected: true,
  });
});

// Approve a CONFIRM: action
app.post("/api/claw/confirm", (req, res) => {
  const { action, approved } = req.body;
  if (!approved) return res.json({ ok: true, message: "Action cancelled." });
  const liveRelays = [...clawRelays.entries()].filter(
    ([, v]) => Date.now() - v.lastSeen < 20000,
  );
  // Prefer ESP32 if available, otherwise use first relay
  const esp32Relay = liveRelays.find(([id]) => id.startsWith("esp32"));
  const tid = esp32Relay?.[0] || liveRelays[0]?.[0];
  if (!tid) return res.json({ error: "No relay connected." });
  const cmd = _parseChatClawInput(action);
  if (!clawQueue.has(tid)) clawQueue.set(tid, []);
  clawQueue.get(tid).push(cmd);
  res.json({ ok: true, queued: cmd.type });
});

/* ============================================================
   OLLAMA — local LLM status + model listing
   ============================================================ */
app.get("/api/ollama/status", async (req, res) => {
  const url = process.env.OLLAMA_URL || "http://localhost:11434";
  try {
    const r = await fetch(`${url}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!r.ok)
      return res.json({ running: false, url, error: `HTTP ${r.status}` });
    const d = await r.json();
    const models = (d.models || []).map((m) => m.name);
    res.json({ running: true, url, models });
  } catch (e) {
    res.json({ running: false, url, error: e.message });
  }
});

app.get("/api/ollama/models", async (req, res) => {
  const url = process.env.OLLAMA_URL || "http://localhost:11434";
  try {
    const r = await fetch(`${url}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!r.ok) return res.json({ models: [], error: `HTTP ${r.status}` });
    const d = await r.json();
    res.json({ models: (d.models || []).map((m) => m.name), url });
  } catch (e) {
    res.json({ models: [], error: e.message, url });
  }
});

/* ============================================================
   LM STUDIO — local OpenAI-compatible server (default port 1234)
   ============================================================ */
app.get("/api/lmstudio/status", async (req, res) => {
  const url = process.env.LMSTUDIO_URL || "http://localhost:1234";
  try {
    const r = await fetch(`${url}/v1/models`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!r.ok)
      return res.json({ running: false, url, error: `HTTP ${r.status}` });
    const d = await r.json();
    const models = (d.data || []).map((m) => m.id);
    res.json({ running: true, url, models });
  } catch (e) {
    res.json({ running: false, url, error: e.message });
  }
});

app.get("/api/lmstudio/models", async (req, res) => {
  const url = process.env.LMSTUDIO_URL || "http://localhost:1234";
  try {
    const r = await fetch(`${url}/v1/models`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!r.ok) return res.json({ models: [], error: `HTTP ${r.status}` });
    const d = await r.json();
    res.json({ models: (d.data || []).map((m) => m.id), url });
  } catch (e) {
    res.json({ models: [], error: e.message, url });
  }
});

/* ── Health check ── */
const startTime = Date.now();

app.get("/api/health", (_, res) => {
  res.json({
    ok: true,
    version: "3.0.0",
    uptimeMs: Date.now() - startTime,
    relays: {
      live: [...clawRelays.values()].filter(
        (r) => Date.now() - r.lastSeen < 20000,
      ).length,
      total: clawRelays.size,
    },
    iotDevices: {
      live: [...iotDevices.values()].filter(
        (d) => Date.now() - d.lastSeen < 20000,
      ).length,
      total: iotDevices.size,
    },
    memory: {
      facts: ariaMemory.facts?.length || 0,
      sessions: ariaMemory.sessions?.length || 0,
    },
    chats: Object.keys(userChats).length,
    pendingScreenshots: pendingScreenshotResolvers?.size || 0,
    node: process.version,
  });
});

/* ── Fallback ── */
app.get("*", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "index.html")),
);

/* ── Global error handler ── */
// Catches any uncaught error thrown inside a route handler so the process doesn't die
app.use((err, req, res, next) => {
  console.error(`[ERR] ${req.method} ${req.path}:`, err.stack || err.message);
  if (res.headersSent) return next(err);
  res.status(500).json({
    error: "Internal server error",
    message: err.message,
    path: req.path,
  });
});

// Don't crash on unhandled promise rejections — log and keep running
process.on("unhandledRejection", (reason) => {
  console.error("[UNHANDLED REJECTION]", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[UNCAUGHT EXCEPTION]", err);
});

/* ============================================================
   PROACTIVE DAILY BRIEFING (Mark 1.5)
   Automatically assembles a morning briefing and delivers it
   as a chat message. Configure in .env:
     BRIEFING_HOUR=8        (default 8am server time)
     BRIEFING_ENABLED=true  (default false — opt-in)
   ============================================================ */
const BRIEFING_HOUR = parseInt(process.env.BRIEFING_HOUR || "8");
const BRIEFING_ENABLED = process.env.BRIEFING_ENABLED === "true";
const BRIEFING_KEY = "daily_briefing_user";

// In-memory SSE stream for delivering briefing to front-end
const briefingSubscribers = new Set();

app.get("/api/briefing/subscribe", (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);
  briefingSubscribers.add(res);
  const ping = setInterval(() => {
    try {
      res.write(": ping\n\n");
    } catch {}
  }, 25000);
  req.on("close", () => {
    clearInterval(ping);
    briefingSubscribers.delete(res);
  });
});

// Manual trigger — also callable by front-end button
app.post("/api/briefing/trigger", async (req, res) => {
  res.json({ ok: true, message: "Briefing generating…" });
  generateBriefing().catch(() => {});
});

app.get("/api/briefing/last", (_, res) => {
  if (!global._lastBriefing) return res.json({ briefing: null });
  res.json({ briefing: global._lastBriefing });
});

async function generateBriefing() {
  console.log("[BRIEFING] Generating daily briefing…");
  try {
    // Gather context from available tools
    const weatherResult = await runToolServer("weather", "").catch(
      () => "Weather unavailable.",
    );
    const newsResult = await runToolServer("news", "").catch(
      () => "News unavailable.",
    );
    const todoResult = await runToolServer("todo", "list").catch(
      () => "No tasks.",
    );
    const memFacts =
      ariaMemory.facts?.slice(-10).join("; ") || "No recent memories.";
    const tasksResult = taskEngine.listTasks({ status: "running" });
    const runningTasks = tasksResult.length
      ? tasksResult.map((t) => `• ${t.title} (${t.status})`).join("\n")
      : "No active background tasks.";

    const prompt = `You are delivering a morning briefing to Sarvin. Be concise and useful. No fluff.

Here is the gathered data:

WEATHER:
${weatherResult}

NEWS:
${newsResult}

TODOS:
${todoResult}

MEMORY (recent facts):
${memFacts}

BACKGROUND TASKS:
${runningTasks}

Today is ${new Date().toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
    })}.

Deliver a sharp morning briefing. Cover: weather in one sentence, key news items briefly, any open todos for today, any running ARIA tasks. End with one actionable suggestion or motivational note. Max 250 words. Speak directly to Sarvin.`;

    const sysPrompt = BASE_PROMPTS.hacker + buildMemoryContext();
    const result = await callAI(
      [
        { role: "system", content: sysPrompt },
        { role: "user", content: prompt },
      ],
      "openrouter",
      null,
      {},
    );
    if (!result) throw new Error("AI returned empty briefing");

    global._lastBriefing = { text: result, generatedAt: Date.now() };
    const payload = JSON.stringify({
      type: "briefing",
      text: result,
      generatedAt: Date.now(),
    });
    for (const sub of briefingSubscribers) {
      try {
        sub.write(`data: ${payload}\n\n`);
      } catch {}
    }
    console.log(
      "[BRIEFING] Delivered to",
      briefingSubscribers.size,
      "subscribers",
    );
  } catch (e) {
    console.warn("[BRIEFING] Failed:", e.message);
  }
}

// Check every minute if it's time to deliver the briefing
let _briefingDeliveredToday = "";
if (BRIEFING_ENABLED) {
  setInterval(() => {
    const now = new Date();
    const todayKey = now.toDateString();
    if (
      now.getHours() === BRIEFING_HOUR &&
      now.getMinutes() === 0 &&
      _briefingDeliveredToday !== todayKey
    ) {
      _briefingDeliveredToday = todayKey;
      generateBriefing().catch(() => {});
    }
  }, 60_000);
  console.log(`[BRIEFING] Scheduled for ${BRIEFING_HOUR}:00 daily`);
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  const banner = `
╔══════════════════════════════════════════════════════╗
║  ARIA v3 — Adaptive Reasoning Intelligence           ║
║  Port: ${String(PORT).padEnd(46)}║
║  Node: ${process.version.padEnd(46)}║
║  Env:  ${(process.env.NODE_ENV || "development").padEnd(46)}║
╚══════════════════════════════════════════════════════╝`;
  console.log(banner);
});
