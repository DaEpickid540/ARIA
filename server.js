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

    const actionMatch = rawReply.match(
      /^\s*ACTION:\s*([^|\n]+?)\s*\|\s*(.*)$/im,
    );
    if (!actionMatch) return { reply: rawReply, steps };

    const toolName = actionMatch[1].trim().toLowerCase();
    const toolInput = actionMatch[2].trim();
    const preText = rawReply.replace(/^\s*ACTION:.*$/m, "").trim();

    let toolResult;
    try {
      toolResult = await runToolServer(toolName, toolInput);
    } catch (e) {
      toolResult = `Tool error: ${e.message}`;
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
   CLOUDFLARE AI — model registry
   Replaces Nvidia Nemotron and DeepSeek.
   Auto-selected by task type; also callable as provider "cloudflare".
   ============================================================ */
const CF_MODELS = {
  // General reasoning / conversation
  general: "@cf/google/gemma-4-26b-it",
  // Code, programming, debugging
  coding: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", // best coding model available on CF
  // Fast image generation
  imageGen: "@cf/black-forest-labs/flux-1-schnell", // FLUX fast
  // Embeddings
  embedding: "@cf/google/text-embedding-004",
  // Math / reasoning heavy
  reasoning: "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b",
};

// Pick the right Cloudflare model based on active mode/task
function pickCFModel(opts = {}) {
  if (opts.programmingMode || opts.isCode) return CF_MODELS.coding;
  if (opts.mathMode || opts.thinkDeeper) return CF_MODELS.reasoning;
  return CF_MODELS.general;
}

// Call Cloudflare Workers AI  (chat completions compatible)
async function callCloudflare(messages, cfModel) {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiKey = process.env.CLOUDFLARE_AI_API;
  if (!accountId || !apiKey)
    throw new Error("CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_AI_API not set.");

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${cfModel}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ messages, max_tokens: 4096 }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`Cloudflare AI HTTP ${res.status}: ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  // Cloudflare returns { result: { response: "..." } }
  const reply =
    data?.result?.response?.trim() ??
    data?.choices?.[0]?.message?.content?.trim();
  if (!reply) throw new Error("Empty response from Cloudflare AI");
  return reply;
}

// Generate image with Cloudflare FLUX
async function generateImageCloudflare(prompt) {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiKey = process.env.CLOUDFLARE_AI_API;
  if (!accountId || !apiKey) return null;

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${CF_MODELS.imageGen}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ prompt, num_steps: 4, width: 1024, height: 1024 }),
  });
  if (!res.ok) return null;
  // Returns raw image bytes (PNG)
  const buf = Buffer.from(await res.arrayBuffer());
  const b64 = buf.toString("base64");
  return `data:image/png;base64,${b64}`;
}

// Generate embeddings with Cloudflare
async function generateEmbedding(text) {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiKey = process.env.CLOUDFLARE_AI_API;
  if (!accountId || !apiKey) return null;

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${CF_MODELS.embedding}`;
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

/* ── MAIN AI DISPATCH ──
   Provider priority:
   1. "cloudflare" → always use CF with auto model selection
   2. "groq"       → Groq Llama (fast, free)
   3. "openrouter" → OpenRouter free models (default fallback)
   Auto-routing: if CF keys exist, coding/math tasks go to CF even when
   provider = "openrouter", keeping OR as the fallback for general use.
*/
async function callAI(messages, provider, model, modeOpts = {}) {
  const hasCF = !!(
    process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_AI_API
  );

  // ── Cloudflare provider or auto-route for specialist modes ──
  if (
    provider === "cloudflare" ||
    (hasCF &&
      (modeOpts.programmingMode || modeOpts.mathMode || modeOpts.thinkDeeper))
  ) {
    const cfModel = model || pickCFModel(modeOpts);
    return callCloudflare(messages, cfModel);
  }

  // ── Groq ──
  if (provider === "groq") {
    const key = process.env.GROQ_API_KEY;
    if (!key) {
      if (hasCF) return callCloudflare(messages, CF_MODELS.general); // fallback to CF
      return "⚠ GROQ_API_KEY not set.";
    }
    const url = "https://api.groq.com/openai/v1/chat/completions";
    const headers = {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    };
    const body = {
      model: "llama-3.3-70b-versatile",
      messages,
      max_tokens: 4096,
    };
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      if (hasCF) return callCloudflare(messages, CF_MODELS.general);
      throw new Error(`Groq HTTP ${res.status}`);
    }
    const data = await res.json();
    const reply = data?.choices?.[0]?.message?.content?.trim();
    if (!reply) throw new Error("Empty Groq response");
    return reply;
  }

  // ── OpenRouter (default) with CF fallback for specialist modes ──
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    if (hasCF) return callCloudflare(messages, pickCFModel(modeOpts));
    return "⚠ OPENROUTER_API_KEY not set.";
  }

  const FREE_MODELS = [
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
  const chosenModel =
    model && FREE_MODELS.includes(model)
      ? model
      : "meta-llama/llama-3.3-70b-instruct:free";

  const url = "https://openrouter.ai/api/v1/chat/completions";
  const headers = {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    "HTTP-Referer": "https://aria-69jr.onrender.com",
    "X-Title": "ARIA",
  };
  const body = { model: chosenModel, messages, max_tokens: 4096 };

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    // Auto-fallback to Cloudflare if OR fails
    if (hasCF) {
      console.warn(
        `[AI] OpenRouter HTTP ${response.status} — falling back to Cloudflare`,
      );
      return callCloudflare(messages, pickCFModel(modeOpts));
    }
    const hints = {
      401: "API key invalid.",
      429: "Rate limit hit — switch providers.",
      500: "Server error.",
    };
    throw new Error(hints[response.status] || `HTTP ${response.status}`);
  }
  const data = await response.json();
  const reply = data?.choices?.[0]?.message?.content?.trim();
  if (!reply) throw new Error("Empty response from AI");
  return reply;
}

/* ============================================================
   BACKGROUND TASKS
   ============================================================ */
const bgTasks = new Map();
let bgTaskCounter = 1;

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
  const { prompt } = req.body;
  if (!prompt) return res.json({ error: "No prompt." });

  // 1 — Cloudflare FLUX.1-schnell (fast, free with your key)
  if (process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_AI_API) {
    try {
      const dataUrl = await generateImageCloudflare(prompt);
      if (dataUrl)
        return res.json({ url: dataUrl, prompt, provider: "cloudflare-flux" });
    } catch (e) {
      console.warn("[Image] Cloudflare FLUX failed:", e.message);
    }
  }

  // 2 — DALL-E 3 (if OPENAI_KEY set)
  const dalleKey = process.env.OPENAI_KEY;
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

  // 3 — Pollinations.ai (always-free, no key needed)
  res.json({
    url: `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true&seed=${Date.now()}`,
    prompt,
    provider: "pollinations",
  });
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

app.get("/api/config", (_, res) => {
  const hasCF = !!(
    process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_AI_API
  );
  res.json({
    customVoiceKey: process.env.CUSTOM_VOICE || null,
    hasCalendar: !!process.env.GOOGLE_CLIENT_ID,
    hasImageGen: hasCF || !!process.env.OPENAI_KEY,
    hasSerpApi: !!process.env.SERPAPI_KEY,
    hasCloudflare: hasCF,

    // Cloudflare model names for display
    cloudflareModels: hasCF
      ? {
          general: CF_MODELS.general,
          coding: CF_MODELS.coding,
          reasoning: CF_MODELS.reasoning,
          imageGen: CF_MODELS.imageGen,
          embedding: CF_MODELS.embedding,
        }
      : null,

    // OpenRouter free models (still available as manual override)
    freeModels: [
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
    ],
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

/* ── Fallback ── */
app.get("*", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "index.html")),
);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`ARIA v3 on port ${PORT}`));
