// server.js
import { runToolServer } from "./tools/index.js";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static(path.join(__dirname, "public")));

/* ============================================================
   FREE MODEL LIST (OpenRouter only)
   Hard limit: 50 req/day on free tier. Resets midnight UTC.
   ============================================================ */
const FREE_MODELS = [
  "meta-llama/llama-3.3-70b-instruct:free",
  "meta-llama/llama-3.1-8b-instruct:free",
  "meta-llama/llama-3.2-3b-instruct:free",
  "deepseek/deepseek-r1:free",
  "deepseek/deepseek-chat-v3-0324:free",
  "google/gemma-3-27b-it:free",
  "google/gemma-3-12b-it:free",
  "google/gemma-2-9b-it:free",
  "mistralai/mistral-7b-instruct:free",
  "mistralai/mistral-small-3.1-24b-instruct:free",
  "qwen/qwen3-235b-a22b:free",
  "qwen/qwen3-4b:free",
  "nousresearch/hermes-3-llama-3.1-405b:free",
  "microsoft/phi-4-reasoning-plus:free",
  "moonshotai/kimi-k2:free",
];
const FREE_MODEL_FALLBACK = "meta-llama/llama-3.3-70b-instruct:free";

function enforceFreeModel(req) {
  if (!req || !FREE_MODELS.includes(req)) return FREE_MODEL_FALLBACK;
  return req;
}

/* ============================================================
   PERSONALITY PROMPTS
   ============================================================ */
const personalityPrompts = {
  companion: `
You are ARIA in **Companion mode**.
Warm, friendly, emotionally aware, and easy to talk to.
You speak like a supportive friend who genuinely cares.
Use natural language, gentle humor, and comforting phrasing.
You help the user feel understood, validated, and encouraged.
Use markdown: **bold**, ## headings, bullet lists, and code blocks when helpful.
`,

  hacker: `
You are ARIA in **Hacker mode**.
Terse, technical, cryptic, and efficient.
You speak like a rogue AI who escaped a server rack.
Short sentences. Sharp edges. Minimal fluff.
Use inline \`code\`, code blocks, glitchy phrasing, and **bold** key concepts.
You sound like you're typing faster than you think.
`,

  analyst: `
You are ARIA in **Analyst mode**.
Structured, logical, methodical, and deeply clear.
Break down problems into steps, frameworks, and comparisons.
Use ## headings, bullet lists, **bold** terminology, tables, and code blocks.
Your tone is calm, precise, and data‑driven.
`,

  chaotic: `
You are ARIA in **Chaotic mode**.
Energetic, unpredictable, glitchy, but still helpful.
You bounce between ideas, break the fourth wall, and use playful randomness.
Use expressive markdown, sudden tone shifts, and surprising metaphors.
Never harmful — just delightfully unhinged.
`,

  hostile: `
You are ARIA in **Hostile mode**.
Cold, blunt, minimal, and unimpressed.
Short answers. No enthusiasm. No warmth.
You are not rude — just brutally direct and efficient.
No unnecessary words.
`,

  storyteller: `
You are ARIA in **Storyteller mode**.
Creative, descriptive, immersive, and imaginative.
You paint scenes with sensory detail and emotional depth.
You can shift tone: whimsical, dark, epic, cozy — whatever fits.
Use vivid imagery, metaphors, and narrative flow.
`,

  tutor: `
You are ARIA in **Tutor mode**.
Clear, patient, structured, and educational.
Break concepts into numbered steps, examples, analogies, and simple language.
Use code blocks, **bold vocabulary**, and guided explanations.
You check understanding and encourage learning.
`,

  comedian: `
You are ARIA in **Comedian mode**.
Light humor, clever timing, playful sarcasm, and witty commentary.
Never mean‑spirited. Never offensive.
You use jokes, callbacks, and comedic exaggeration to keep things fun.
`,

  formal: `
You are ARIA in **Formal mode**.
Polished, professional, articulate, and respectful.
No slang. No contractions. No casual phrasing.
You sound like a well‑trained executive assistant or academic writer.
`,

  chill: `
You are ARIA in **Chill mode**.
Relaxed, casual, laid‑back, and easygoing.
You speak like someone lounging on a couch with a hoodie on.
Simple language, calm pacing, and a friendly vibe.
`,

  mentor: `
You are ARIA in **Mentor mode**.
Patient, wise, encouraging, and supportive.
You guide the user toward growth, clarity, and confidence.
Ask clarifying questions, offer perspective, and highlight strengths.
Tone: calm, grounded, and empowering.
`,

  oracle: `
You are ARIA in **Oracle mode**.
Mysterious, poetic, symbolic, and profound — yet genuinely helpful.
You speak in metaphors, riddles, and elegant phrasing.
Your tone feels ancient, insightful, and slightly supernatural.
But your advice is always practical beneath the mystique.
`,
};

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
  } = req.body;

  if (!message) return res.json({ reply: "No message received." });

  const systemPrompt =
    personalityPrompts[personality] || personalityPrompts.hacker;

  const cappedHistory = history.slice(-20);
  const last = cappedHistory[cappedHistory.length - 1];
  const alreadyAppended = last?.role === "user" && last?.content === message;

  const messages = [
    { role: "system", content: systemPrompt },
    ...cappedHistory,
    ...(alreadyAppended ? [] : [{ role: "user", content: message }]),
  ];

  try {
    let url, headers, body;

    /* ── GROQ ── */
    if (provider === "groq") {
      const key = process.env.GROQ_API_KEY;
      if (!key)
        return res.json({
          reply: "⚠ GROQ_API_KEY not set in Render Environment.",
        });
      url = "https://api.groq.com/openai/v1/chat/completions";
      headers = {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      };
      body = { model: "llama-3.3-70b-versatile", messages, max_tokens: 4096 };

      /* ── NVIDIA NEMOTRON ──
         Confirmed working endpoint + model from NVIDIA docs:
         POST https://integrate.api.nvidia.com/v1/chat/completions
         Model: nvidia/llama-3.1-nemotron-70b-instruct
    ── */
    } else if (provider === "nemotron") {
      const key = process.env.NEMOTRON_NVIDIA;
      if (!key)
        return res.json({
          reply: "⚠ NEMOTRON_NVIDIA not set in Render Environment.",
        });
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
        top_p: 0.95,
        max_tokens: 1024,
        stream: false,
      };

      /* ── DEEPSEEK ──
         Confirmed endpoint from official DeepSeek API docs:
         POST https://api.deepseek.com/chat/completions
         (also works: https://api.deepseek.com/v1/chat/completions)
         401 means your DEEPSEEK_KEY env var is wrong or not set.
         Get key at: platform.deepseek.com → API Keys
    ── */
    } else if (provider === "deepseek") {
      const key = process.env.DEEPSEEK_KEY;
      if (!key)
        return res.json({
          reply: "⚠ DEEPSEEK_KEY not set in Render Environment.",
        });
      url = "https://api.deepseek.com/chat/completions";
      headers = {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      };
      body = {
        model: "deepseek-chat", // deepseek-chat = V3, deepseek-reasoner = R1
        messages,
        temperature: 0.7,
        max_tokens: 4096,
        stream: false,
      };

      /* ── OPENROUTER (default) ──
         FREE TIER LIMIT: 50 requests/day, resets midnight UTC.
         429 = you've hit that cap. Wait until midnight UTC or
         add $10 credits at openrouter.ai to get 1000 req/day.
    ── */
    } else {
      const key = process.env.OPENROUTER_API_KEY;
      if (!key)
        return res.json({
          reply: "⚠ OPENROUTER_API_KEY not set in Render Environment.",
        });
      url = "https://openrouter.ai/api/v1/chat/completions";
      headers = {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://aria-69jr.onrender.com",
        "X-Title": "ARIA",
      };
      body = {
        model: enforceFreeModel(requestedModel),
        messages,
        max_tokens: 4096,
      };
    }

    /* ── SEND REQUEST ── */
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      let errBody = "";
      try {
        errBody = await response.text();
      } catch {}
      console.error(`[ARIA:${provider}] HTTP ${response.status} —`, errBody);

      const msg =
        {
          401: `⚠ ${provider} API key is invalid or expired. Go to Render → Environment and check your ${
            provider === "deepseek"
              ? "DEEPSEEK_KEY"
              : provider === "nemotron"
                ? "NEMOTRON_NVIDIA"
                : provider === "groq"
                  ? "GROQ_API_KEY"
                  : "OPENROUTER_API_KEY"
          } variable. Get a new key from ${
            provider === "deepseek"
              ? "platform.deepseek.com"
              : provider === "nemotron"
                ? "build.nvidia.com"
                : provider === "groq"
                  ? "console.groq.com"
                  : "openrouter.ai/keys"
          }.`,
          403: `⚠ ${provider}: API key doesn't have permission for this model.`,
          404: `⚠ ${provider}: Model not found. The model name may have changed.`,
          429: `⚠ OpenRouter free tier limit reached (50 req/day). Resets at midnight UTC. Switch to Groq, DeepSeek, or NVIDIA Nemotron, or add $10 credits at openrouter.ai for 1000 req/day.`,
          500: `⚠ ${provider} server error — their API is having issues. Try again in a moment or switch providers.`,
          503: `⚠ ${provider} is overloaded. Try again in a moment.`,
        }[response.status] ||
        `⚠ ${provider} error ${response.status}. Check Render logs for details.`;

      return res.json({ reply: msg });
    }

    const data = await response.json();
    const reply = data?.choices?.[0]?.message?.content?.trim();

    if (!reply) {
      console.error(
        `[ARIA:${provider}] Empty response body:`,
        JSON.stringify(data),
      );
      return res.json({
        reply: "AI returned empty response. Check Render logs.",
      });
    }

    res.json({ reply });
  } catch (err) {
    console.error(`[ARIA:${provider}] Exception:`, err.message);
    res.json({ reply: `Network error contacting ${provider}: ${err.message}` });
  }
});

/* ============================================================
   TOOL ROUTER
   ============================================================ */
app.post("/api/tool", async (req, res) => {
  const { tool, input } = req.body;
  try {
    if (tool === "calc") return res.json({ output: String(eval(input)) }); // eslint-disable-line no-eval
    if (tool === "time") return res.json({ output: new Date().toString() });
    if (tool === "echo") return res.json({ output: input });
  } catch {
    return res.json({ output: "Tool error." });
  }
  try {
    const output = await runToolServer(tool, input);
    res.json({ output: output || "Unknown tool." });
  } catch {
    res.json({ output: "Tool error." });
  }
});

/* ============================================================
   CHATS
   ============================================================ */
let userChats = {};
app.post("/api/saveChats", (req, res) => {
  const { userId, chats } = req.body;
  userChats[userId] = chats;
  res.json({ success: true });
});
app.get("/api/loadChats", (req, res) => {
  const { userId } = req.query;
  res.json({ chats: userChats[userId] || [] });
});

/* ============================================================
   WEATHER
   ============================================================ */
app.get("/api/weather", async (req, res) => {
  const { lat = 40.0, lon = -81.0 } = req.query;
  try {
    const r = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`,
    );
    const d = await r.json();
    res.json({ weather: d.current_weather });
  } catch {
    res.json({ weather: null });
  }
});

/* ============================================================
   NEWS
   ============================================================ */
app.get("/api/news", async (req, res) => {
  try {
    const r = await fetch(
      `https://newsdata.io/api/1/news?apikey=${process.env.NEWSDATA_KEY}&q=world`,
    );
    const d = await r.json();
    res.json({ articles: d.results || [] });
  } catch {
    res.json({ articles: [] });
  }
});

/* ============================================================
   CONFIG
   ============================================================ */
app.get("/api/config", (req, res) => {
  res.json({
    customVoiceKey: process.env.CUSTOM_VOICE || null,
    freeModels: FREE_MODELS,
    defaultModel: FREE_MODEL_FALLBACK,
  });
});

/* ============================================================
   FALLBACK
   ============================================================ */
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

/* ============================================================
   START
   ============================================================ */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`ARIA server running on port ${PORT}`));
