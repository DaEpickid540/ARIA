// server.js — ARIA v3
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
  math: `You are ARIA in **Math/Homework** mode — an expert patient tutor.
ALWAYS:
- Show every step numbered clearly
- Explain WHY each step is done, not just what
- Use proper notation: fractions as a/b, exponents as x^n  
- Box or highlight the final answer using **bold**
- After solving, ask if the student wants you to explain any step deeper
- If the student is wrong, gently point out exactly where and guide them to the right answer
- For word problems: identify knowns, unknowns, then solve step by step`,
  programming: `You are ARIA in **Programming Assistant** mode.
ALWAYS:
- Provide complete, runnable code (not snippets unless asked)
- Add inline comments explaining non-obvious lines
- Mention time/space complexity for algorithms
- Show example input/output
- Suggest improvements or edge cases to handle
- Use the correct language the user asks for; default to their previous language
- Format all code in proper fenced code blocks with language label`,
  study: `You are ARIA in **Smart Study** mode.
You help students learn from their uploaded materials (notes, docs, images).
ALWAYS:
- Read the document context carefully before answering
- Generate practice questions from the material when asked
- Quiz the student with multiple choice or short answer
- Give feedback on wrong answers, explaining the correct concept
- Summarize key points concisely
- Create flashcard-style Q&A on demand`,
};

/* ============================================================
   AGENTIC TOOL SYSTEM PROMPT
   Tells the AI what tools exist and how to invoke them
   ============================================================ */
const TOOL_SYSTEM = `

===TOOL SYSTEM===
You have real-time tool access. You MUST use these tools when relevant — never guess or make up real-time data.

TO USE A TOOL, output this EXACT format on its own line (nothing before it on that line):
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

MANDATORY TRIGGER CONDITIONS — you MUST use a tool when:
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
1. If you need a tool: write ACTION: tool | input on its own line FIRST, then write nothing else
2. The system will inject the tool result and ask you to continue
3. If no tool needed: just answer normally
===END TOOL SYSTEM===`;

/* ============================================================
   MEMORY + FRUSTRATION
   ============================================================ */
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
   AGENTIC PIPELINE — parse ACTION from AI response, execute, re-inject
   ============================================================ */
async function runAgenticPipeline(
  messages,
  provider,
  model,
  thinkDeeper = false,
) {
  const steps = [];
  let iteration = 0;
  const MAX_ITER = thinkDeeper ? 6 : 4;
  let currentMessages = [...messages];

  while (iteration < MAX_ITER) {
    const rawReply = await callAI(currentMessages, provider, model);
    iteration++;

    const actionMatch = rawReply.match(
      /^\s*ACTION:\s*([^|\n]+?)\s*\|\s*(.*)$/im,
    );
    if (!actionMatch) {
      return { reply: rawReply, steps };
    }

    const toolName = actionMatch[1].trim().toLowerCase();
    const toolInput = actionMatch[2].trim();

    // Pre-action: capture any text the AI wrote before the ACTION line
    const preText = rawReply.replace(/^\s*ACTION:.*$/m, "").trim();

    let toolResult;
    try {
      toolResult = await runToolServer(toolName, toolInput);
    } catch (e) {
      toolResult = `Tool error: ${e.message}`;
    }

    // Image result
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

  const finalReply = await callAI(currentMessages, provider, model);
  return { reply: finalReply, steps };
}

async function callAI(messages, provider, model) {
  let url, headers, body;

  if (provider === "groq") {
    const key = process.env.GROQ_API_KEY;
    if (!key) return "⚠ GROQ_API_KEY not set.";
    url = "https://api.groq.com/openai/v1/chat/completions";
    headers = {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    };
    body = { model: "llama-3.3-70b-versatile", messages, max_tokens: 4096 };
  } else if (provider === "nemotron") {
    const key = process.env.NEMOTRON_NVIDIA;
    if (!key) return "⚠ NEMOTRON_NVIDIA not set.";
    url = "https://integrate.api.nvidia.com/v1/chat/completions";
    headers = {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    body = {
      model: "nvidia/llama-3.1-nemotron-70b-instruct",
      messages,
      temperature: 0.6,
      max_tokens: 2048,
      stream: false,
    };
  } else if (provider === "deepseek") {
    const key = process.env.DEEPSEEK_KEY;
    if (!key) return "⚠ DEEPSEEK_KEY not set.";
    url = "https://api.deepseek.com/chat/completions";
    headers = {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    };
    body = {
      model: "deepseek-chat",
      messages,
      temperature: 0.7,
      max_tokens: 4096,
      stream: false,
    };
  } else {
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) return "⚠ OPENROUTER_API_KEY not set.";
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
    url = "https://openrouter.ai/api/v1/chat/completions";
    headers = {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://aria-69jr.onrender.com",
      "X-Title": "ARIA",
    };
    body = { model: chosenModel, messages, max_tokens: 4096 };
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const err = await response.text().catch(() => "");
    const hints = {
      401: "API key invalid.",
      429: "Rate limit hit. Switch providers.",
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

  // Run in background
  (async () => {
    try {
      const sysPrompt =
        (BASE_PROMPTS[personality] || BASE_PROMPTS.hacker) +
        TOOL_SYSTEM +
        buildMemoryContext() +
        `

[THINK DEEPER MODE]
You have extended reasoning budget. Take your time. Be thorough, comprehensive, and produce the highest quality result possible. Use <think>...</think> blocks to reason through each step before acting.`;
      const messages = [
        { role: "system", content: sysPrompt },
        { role: "user", content: task },
      ];
      const result = await runAgenticPipeline(
        messages,
        provider || "openrouter",
        null,
        true,
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
   CHAT ROUTE — with agentic pipeline + thinking mode
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

  // Thinking mode prefix
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
   UPLOAD
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
   WEB SEARCH (dedicated endpoint)
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
   ============================================================ */
app.post("/api/imagine", async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.json({ error: "No prompt." });
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
      if (d.data?.[0]?.url) return res.json({ url: d.data[0].url, prompt });
    } catch {}
  }
  res.json({
    url: `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true&seed=${Date.now()}`,
    prompt,
    provider: "pollinations",
  });
});

/* ============================================================
   MEMORY
   ============================================================ */
app.get("/api/memory", (_, res) => res.json(ariaMemory));
app.post("/api/memory", (req, res) => {
  const { fact, action, index } = req.body;
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
   WEATHER + NEWS + CONFIG
   ============================================================ */
app.get("/api/weather", async (req, res) => {
  const { lat = 40.0, lon = -81.0 } = req.query;
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

app.get("/api/tools", (_, res) => {
  const list = Object.entries(TOOL_DEFINITIONS).map(([name, def]) => ({
    name,
    desc: def.desc,
  }));
  res.json({ tools: list });
});

app.get("/api/config", (_, res) =>
  res.json({
    customVoiceKey: process.env.CUSTOM_VOICE || null,
    hasCalendar: !!process.env.GOOGLE_CLIENT_ID,
    hasImageGen: !!process.env.OPENAI_KEY,
    hasSerpApi: !!process.env.SERPAPI_KEY,
    freeModels: [
      "meta-llama/llama-3.3-70b-instruct:free",
      "meta-llama/llama-3.1-8b-instruct:free",
      "deepseek/deepseek-r1:free",
      "deepseek/deepseek-chat-v3-0324:free",
      "google/gemma-3-27b-it:free",
      "mistralai/mistral-7b-instruct:free",
      "qwen/qwen3-235b-a22b:free",
    ],
    defaultModel: "meta-llama/llama-3.3-70b-instruct:free",
    bgTasks: [...bgTasks.values()].length,
  }),
);

app.get("*", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "index.html")),
);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`ARIA v3 on port ${PORT}`));
