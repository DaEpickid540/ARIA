// server.js — ARIA v3 (working base + Link Mode + Music Tutor + Workspace + Math v2 + Code v2)
import { runToolServer, TOOL_DEFINITIONS } from "./tools/index.js";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use(express.static(path.join(__dirname, "public")));

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

function readJSON(f, fb) {
  try {
    return JSON.parse(fs.readFileSync(f, "utf8"));
  } catch {
    return fb;
  }
}
function writeJSON(f, d) {
  try {
    fs.writeFileSync(f, JSON.stringify(d, null, 2));
  } catch {}
}

let userChats = readJSON(CHATS_FILE, {});
let ariaMemory = readJSON(MEM_FILE, { facts: [], sessions: [] });

/* ============================================================
   PERSONALITY PROMPTS
   ============================================================ */
const BASE_PROMPTS = {
  companion:
    "You are ARIA (Adaptive Reasoning Intelligence Architecture) in **Companion** mode. Warm, caring, genuinely interested in the user. Use conversational language. React to emotions. Use markdown naturally.",
  hacker:
    "You are ARIA in **Hacker** mode. Terse, technical, cryptic. Use `inline code`, code blocks, **bold** key terms. Short, punchy sentences. No fluff.",
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
You have real-time tool access. You MUST use these tools when relevant — never guess or make up real-time data.

TO USE A TOOL, output this EXACT format on its own line:
ACTION: tool_name | input

TOOL REFERENCE:
ACTION: weather | (blank = Mason OH, or lat,lon)
ACTION: calendar | 
ACTION: calendar add | EventTitle | 2025-06-15T14:00 | 2025-06-15T15:00
ACTION: news | technology
ACTION: search | your search query here
ACTION: scrape | https://example.com
ACTION: imagine | a detailed description of the image
ACTION: calc | 2+2*sqrt(16)
ACTION: time | 
ACTION: notes | add Buy groceries
ACTION: todo | add Finish homework
ACTION: timer | start 300
ACTION: system | 
ACTION: gdoc | 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms

MANDATORY TRIGGER CONDITIONS:
- User asks about weather, temperature, forecast → ACTION: weather
- User asks what time or date it is → ACTION: time
- User asks about their schedule, events, appointments → ACTION: calendar
- User asks to add an event or reminder → ACTION: calendar add
- User asks about news, current events → ACTION: news
- User says "search for", "look up", "google", "find info about" → ACTION: search
- User asks you to read/visit/analyze a URL → ACTION: scrape
- User asks for an image, picture, drawing, photo → ACTION: imagine
- User asks for a calculation → ACTION: calc
- User asks what the server is running on → ACTION: system
- User asks to open an app, browser, Chrome, Firefox, VS Code, etc → ACTION: claw | open: <AppName or URL>
- User asks to type something into the computer → ACTION: claw | type: <text>
- User asks to press a keyboard shortcut → ACTION: claw | hotkey: <e.g. ctrl+t>
- User asks to run a terminal/shell command → ACTION: claw | shell: <command>
- User asks to open/close a browser tab → ACTION: claw | new_tab: <url>  or  ACTION: claw | close_tab
- User asks to write/edit code in VS Code or Arduino IDE → ACTION: claw | write_code: <AppName>|<code>
- User asks to take a screenshot → ACTION: claw | screenshot
- User asks to switch windows or apps → ACTION: claw | switch: <AppName>
- Any general computer control task → ACTION: claw | <plain english>

CLAW RULES:
- Claw requires claw-relay.js running on Sarvin's machine (Claw panel shows status)
- Safe actions (open app, type, shortcut, switch window): ACTION: directly, no confirmation
- SENSITIVE (delete files, install software, modify settings, kill processes): use CONFIRM: prefix
  Example: CONFIRM: claw | shell: rm -rf folder
- NEVER autonomously: delete files, access passwords, modify system settings without CONFIRM:

RESPONSE FORMAT:
1. If you need a tool: write ACTION: tool | input on its own line FIRST
2. System injects tool result and asks you to continue
3. If no tool needed: answer normally
===END TOOL SYSTEM===`;

/* ── memory ── */
function buildMemoryContext() {
  if (!ariaMemory.facts?.length) return "";
  return `\n\n[YOUR MEMORY — facts about the user:\n${ariaMemory.facts.map((f) => `- ${f}`).join("\n")}\n]`;
}

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
        writeJSON(MEM_FILE, ariaMemory);
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
  const MAX_ITER = thinkDeeper ? 6 : 4;
  let currentMessages = [...messages];

  while (iteration < MAX_ITER) {
    const rawReply = await callAI(currentMessages, provider, model, modeOpts);
    iteration++;

    // ── CONFIRM: needs user approval ──
    const confirmMatch = rawReply.match(/^\s*CONFIRM:\s*claw\s*\|\s*(.+)$/im);
    if (confirmMatch) {
      const pa = confirmMatch[1].trim();
      const pt = rawReply.replace(/^\s*CONFIRM:.*$/m, "").trim();
      steps.push({
        tool: "claw_confirm",
        input: pa,
        preText: pt,
        result: "awaiting_approval",
      });
      return {
        reply: pt || "I need your approval before running this.",
        clawConfirm: { action: pa },
        steps,
      };
    }

    const actionMatch = rawReply.match(
      /^\s*ACTION:\s*([^|\n]+?)\s*\|\s*(.*)$/im,
    );
    if (!actionMatch) return { reply: rawReply, steps };

    const toolName = actionMatch[1].trim().toLowerCase();
    const toolInput = actionMatch[2].trim();
    const preText = rawReply.replace(/^\s*ACTION:.*$/m, "").trim();

    // ── Claw action ──
    if (toolName === "claw") {
      let cr;
      if (clawKilled) {
        cr = "Claw is killed. Click RESUME in the Claw panel.";
      } else {
        const liveRelays = [...clawRelays.entries()].filter(
          ([, v]) => Date.now() - v.lastSeen < 20000,
        );
        const tid = liveRelays[0]?.[0];
        if (!tid) {
          cr = "No relay connected. Run: node claw-relay.js <your-aria-url>";
        } else {
          const cmd = _parseChatClawInput(toolInput);
          if (!clawQueue.has(tid)) clawQueue.set(tid, []);
          clawQueue.get(tid).push(cmd);
          const desc = cmd.cmd || cmd.text || cmd.app || cmd.url || cmd.type;
          cr = "Queued [" + cmd.type + "]: " + String(desc).slice(0, 60);
        }
      }
      steps.push({ tool: "claw", input: toolInput, preText, result: cr });
      currentMessages = [
        ...currentMessages,
        { role: "assistant", content: rawReply },
        {
          role: "user",
          content:
            "[CLAW RESULT]: " +
            cr +
            "\n\nNow continue your response to the user.",
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
   Providers: cloudflare | groq | openrouter | ollama
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
   BACKGROUND TASKS
   ============================================================ */
const bgTasks = new Map();
let bgTaskCounter = 1;

/* ── Claw ── */
const clawQueue = new Map();
const clawRelays = new Map();
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
  if (s.startsWith("close_tab")) return { id, type: "close_tab" };
  if (s.startsWith("switch:"))
    return { id, type: "switch_app", app: s.slice(7).trim() };
  if (s.startsWith("write_code:")) {
    const p = s.slice(11).split("|");
    return { id, type: "write_code", app: p[0]?.trim(), code: p[1]?.trim() };
  }
  if (s.startsWith("click:")) {
    const [x, y] = s.slice(6).trim().split(",");
    return { id, type: "click", x: +x || 0, y: +y || 0 };
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
      : { id, type: "switch_app", app: t };
  }
  return { id, type: "shell", cmd: "echo 'Claw: " + s.replace(/'/g, "") + "'" };
}

app.post("/api/background", async (req, res) => {
  const { task, provider, personality } = req.body;
  if (!task) return res.json({ error: "No task provided" });
  const id = "bg_" + bgTaskCounter++;
  bgTasks.set(id, {
    id,
    task,
    status: "running",
    started: Date.now(),
    result: null,
  });
  res.json({ id, status: "started" });

  (async () => {
    try {
      const sysPrompt =
        (BASE_PROMPTS[personality] || BASE_PROMPTS.hacker) +
        TOOL_SYSTEM +
        buildMemoryContext() +
        `

[THINK DEEPER MODE]
You have extended reasoning budget. Take your time. Be thorough.
Use <think>...</think> blocks to reason through each step before acting.`;
      const messages = [
        { role: "system", content: sysPrompt },
        { role: "user", content: task },
      ];
      const result = await runAgenticPipeline(
        messages,
        provider || "openrouter",
        null,
        true,
        { thinkDeeper: true },
      );
      bgTasks.get(id).status = "done";
      bgTasks.get(id).result = result.reply;
      bgTasks.get(id).steps = result.steps;
    } catch (e) {
      bgTasks.get(id).status = "error";
      bgTasks.get(id).result = e.message;
    }
  })();
});

app.get("/api/background/:id", (req, res) => {
  const task = bgTasks.get(req.params.id);
  if (!task) return res.json({ error: "Task not found" });
  res.json(task);
});

app.get("/api/background", (req, res) => {
  res.json(
    [...bgTasks.values()].map((t) => ({
      id: t.id,
      task: t.task.slice(0, 60),
      status: t.status,
      started: t.started,
    })),
  );
});

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
    thinkingMode = false,
    thinkDeeper = false,
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

  if (frustrated)
    sysPrompt +=
      "\n\n[TONE OVERRIDE: User seems frustrated. Be extra patient, break things down, be encouraging.]";
  if (documentContext)
    sysPrompt += `\n\n[DOCUMENT CONTEXT (user uploaded):\n${documentContext.slice(0, 8000)}\n]`;

  if (thinkingMode || thinkDeeper) {
    sysPrompt += `

[THINKING MODE ENABLED]
Before every response, wrap your reasoning in <think> tags:
<think>
Step 1: What is the user actually asking?
Step 2: What do I know about this?
Step 3: What's the best approach?
Step 4: Draft my answer...
</think>
Then write your actual response after the closing </think> tag.`;
  }

  if (thinkDeeper) {
    sysPrompt += `

[THINK DEEPER MODE]
You have extra reasoning budget. For EVERY question:
- Spend at least 6-8 steps in your <think> block
- Consider alternative interpretations of the question
- Identify potential edge cases and failure modes
- Research your own knowledge thoroughly before answering
- Draft, critique, and revise your answer inside the think block
- Only output the final polished answer after </think>
- Your final answer should be comprehensive, well-structured, and at least 3x longer than you'd normally write
- Use headers, examples, and code snippets where helpful`;
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

  const cappedHistory = history.slice(-20);
  const last = cappedHistory[cappedHistory.length - 1];
  const messages = [
    { role: "system", content: sysPrompt },
    ...cappedHistory,
    ...(last?.role === "user" && last?.content === message
      ? []
      : [{ role: "user", content: message }]),
  ];

  try {
    const result = await runAgenticPipeline(
      messages,
      provider,
      requestedModel,
      thinkDeeper,
      { mathMode, programmingMode, thinkDeeper, musicTutorMode },
    );
    res.json({
      reply: result.reply,
      frustrated,
      steps: result.steps,
      imageUrl: result.imageUrl,
      imagePrompt: result.imagePrompt,
    });
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
        `https://serpapi.com/search.json?q=${encodeURIComponent(query)}&api_key=${serpKey}&num=5`,
      );
      const d = await r.json();
      return res.json({
        results: (d.organic_results || [])
          .slice(0, 5)
          .map((r) => ({ title: r.title, url: r.link, snippet: r.snippet })),
      });
    }
    const r = await fetch(
      `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`,
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
  const pollinationsUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true&seed=${Date.now()}`;

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
   MEMORY
   ============================================================ */
app.get("/api/memory", (_, res) => res.json(ariaMemory));
app.post("/api/memory", (req, res) => {
  const { fact, action, index, facts } = req.body;
  if (action === "add" && fact) {
    if (!ariaMemory.facts.includes(fact)) {
      ariaMemory.facts.push(fact);
      writeJSON(MEM_FILE, ariaMemory);
    }
  } else if (action === "delete" && index !== undefined) {
    ariaMemory.facts.splice(index, 1);
    writeJSON(MEM_FILE, ariaMemory);
  } else if (action === "clear") {
    ariaMemory.facts = [];
    writeJSON(MEM_FILE, ariaMemory);
  } else if (Array.isArray(facts)) {
    // Bulk update from memory.js client
    ariaMemory.facts = facts;
    writeJSON(MEM_FILE, ariaMemory);
  }
  res.json({ success: true, facts: ariaMemory.facts });
});

/* ============================================================
   CHATS
   ============================================================ */
app.post("/api/saveChats", (req, res) => {
  const { userId, chats } = req.body;
  if (userId) {
    userChats[userId] = chats;
    writeJSON(CHATS_FILE, userChats);
  }
  res.json({ success: true });
});
app.get("/api/loadChats", (req, res) =>
  res.json({ chats: userChats[req.query.userId] || [] }),
);

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
    bgTasks: [...bgTasks.values()].length,
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
app.post("/api/claw/relay/register", (req, res) => {
  const { deviceId, platform, hostname } = req.body;
  if (!deviceId) return res.json({ error: "No deviceId" });
  clawRelays.set(deviceId, { platform, hostname, lastSeen: Date.now() });
  if (!clawQueue.has(deviceId)) clawQueue.set(deviceId, []);
  console.log("[CLAW] Relay connected: " + deviceId);
  res.json({ ok: true, killed: clawKilled });
});
app.post("/api/claw/relay/heartbeat", (req, res) => {
  const { deviceId } = req.body;
  if (clawRelays.has(deviceId)) clawRelays.get(deviceId).lastSeen = Date.now();
  res.json({ ok: true, killed: clawKilled });
});
app.post("/api/claw/relay/unregister", (req, res) => {
  clawRelays.delete(req.body.deviceId);
  clawQueue.delete(req.body.deviceId);
  res.json({ ok: true });
});
app.post("/api/claw/relay/result", (req, res) => {
  const { cmdId, result } = req.body;
  if (cmdId) {
    /* store for visualizer */
  }
  res.json({ ok: true });
});
app.get("/api/claw/queue", (req, res) => {
  const { deviceId } = req.query;
  if (!deviceId) return res.json({ commands: [] });
  const q = clawQueue.get(deviceId) || [];
  clawQueue.set(deviceId, []);
  res.json({ commands: q, killed: clawKilled });
});
app.post("/api/claw/kill", (req, res) => {
  clawKilled = true;
  for (const [k] of clawQueue) clawQueue.set(k, []);
  console.log("[CLAW] KILL SWITCH ACTIVATED");
  res.json({ ok: true });
});
app.post("/api/claw/resume", (req, res) => {
  clawKilled = false;
  console.log("[CLAW] Resumed");
  res.json({ ok: true });
});
app.get("/api/claw/status", (req, res) => {
  const relays = [...clawRelays.entries()]
    .filter(([, v]) => Date.now() - v.lastSeen < 20000)
    .map(([id, v]) => ({ id, platform: v.platform, hostname: v.hostname }));
  res.json({ killed: clawKilled, relays });
});
app.post("/api/claw", async (req, res) => {
  const { input, mode = "ai" } = req.body;
  if (!input) return res.json({ error: "No input." });
  if (clawKilled) return res.json({ error: "Claw is killed. Click RESUME." });
  const liveRelays = [...clawRelays.entries()].filter(
    ([, v]) => Date.now() - v.lastSeen < 20000,
  );
  const tid = liveRelays[0]?.[0];
  if (mode === "ai") {
    try {
      const platHint = tid
        ? "Target: " + (clawRelays.get(tid)?.platform || "?")
        : "No relay.";
      const msgs = [
        {
          role: "system",
          content:
            "You are ARIA Claw. " +
            platHint +
            ". Output ONLY a JSON array of command objects. Commands: {type:shell,cmd:string} {type:type,text:string} {type:hotkey,keys:[string]} {type:switch_app,app:string} {type:browser,url:string} {type:new_tab,url:string} {type:close_tab} {type:screenshot} {type:write_code,app:string,code:string} {type:click,x:number,y:number} {type:scroll,direction:string,amount:number} {type:wait,ms:number}",
        },
        { role: "user", content: input },
      ];
      const r = await callAI(msgs, "openrouter", null, {});
      let cmds = [];
      try {
        cmds = JSON.parse((r.reply || "[]").match(/\[[\s\S]*\]/)?.[0] || "[]");
      } catch {}
      cmds = cmds.map((c) => ({ ...c, id: nextClawId() }));
      if (tid && cmds.length) {
        if (!clawQueue.has(tid)) clawQueue.set(tid, []);
        clawQueue.get(tid).push(...cmds);
      }
      return res.json({
        output: "Queued " + cmds.length + " command(s).",
        queued: cmds.map(
          (c) =>
            c.type +
            (c.cmd
              ? ": " + String(c.cmd).slice(0, 30)
              : c.app
                ? " -> " + c.app
                : ""),
        ),
        relayConnected: !!tid,
      });
    } catch (e) {
      return res.json({ error: "AI error: " + e.message });
    }
  }
  if (!tid) return res.json({ error: "No relay connected." });
  const cmd = _parseChatClawInput(mode + ": " + input);
  if (!clawQueue.has(tid)) clawQueue.set(tid, []);
  clawQueue.get(tid).push(cmd);
  return res.json({
    output: "Queued: " + cmd.type,
    queued: [cmd.type],
    relayConnected: true,
  });
});
app.post("/api/claw/confirm", (req, res) => {
  const { action, approved } = req.body;
  if (!approved) return res.json({ ok: true, message: "Cancelled." });
  const liveRelays = [...clawRelays.entries()].filter(
    ([, v]) => Date.now() - v.lastSeen < 20000,
  );
  const tid = liveRelays[0]?.[0];
  if (!tid) return res.json({ error: "No relay." });
  const cmd = _parseChatClawInput(action);
  if (!clawQueue.has(tid)) clawQueue.set(tid, []);
  clawQueue.get(tid).push(cmd);
  res.json({ ok: true, queued: cmd.type });
});

/* ── Fallback ── */
app.get("*", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "index.html")),
);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`ARIA v3 on port ${PORT}`));
