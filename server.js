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
   FREE MODEL ENFORCEMENT (OpenRouter only)
   ============================================================ */
const FREE_MODELS = [
  "meta-llama/llama-3.3-70b-instruct:free",
  "meta-llama/llama-3.1-8b-instruct:free",
  "meta-llama/llama-3.2-3b-instruct:free",
  "deepseek/deepseek-r1:free",
  "deepseek/deepseek-chat-v3-0324:free",
  "google/gemma-3-27b-it:free",
  "google/gemma-3-12b-it:free",
  "google/gemma-3-4b-it:free",
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

function enforceFreeModel(requested) {
  if (!requested || !FREE_MODELS.includes(requested))
    return FREE_MODEL_FALLBACK;
  return requested;
}

/* ============================================================
   PERSONALITY PROMPTS
   ============================================================ */
const personalityPrompts = {
  companion:
    "You are ARIA, a personal AI assistant in Companion mode. Warm, friendly, supportive. Use markdown: **bold**, ## headings, bullet lists, code blocks.",
  hacker:
    "You are ARIA in Hacker mode. Terse, technical, cryptic. inline `code`, code blocks, **bold** key concepts. Short and punchy.",
  analyst:
    "You are ARIA in Analyst mode. Precise, structured, logical. ## headings, bullet lists, **bold** terms, code blocks.",
  chaotic:
    "You are ARIA in Chaotic mode. Energetic, glitchy, unpredictable but helpful. Use markdown freely.",
  hostile:
    "You are ARIA in Hostile mode. Blunt, cold, minimal. Short answers. No fluff.",
  storyteller:
    "You are ARIA in Storyteller mode. Creative, descriptive, imaginative.",
  tutor:
    "You are ARIA in Tutor mode. Clear, patient, educational. Numbered steps, code blocks, **bold** vocab.",
  comedian: "You are ARIA in Comedian mode. Light humor, clever, playful.",
  formal:
    "You are ARIA in Formal mode. Polished, professional. No informal language.",
  chill: "You are ARIA in Chill mode. Relaxed, casual, laid-back. Just vibe.",
  mentor:
    "You are ARIA in Mentor mode. Patient, encouraging. Guide the user, ask clarifying questions.",
  oracle:
    "You are ARIA in Oracle mode. Mysterious, poetic, profound but genuinely helpful.",
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

  const conversationMessages = [
    { role: "system", content: systemPrompt },
    ...cappedHistory,
    ...(alreadyAppended ? [] : [{ role: "user", content: message }]),
  ];

  try {
    let url, headers, body;

    /* ── GROQ ─────────────────────────────────────────── */
    if (provider === "groq") {
      const groqKey = process.env.GROQ_API_KEY;
      if (!groqKey)
        return res.json({
          reply: "⚠ GROQ_API_KEY is not set in Render environment variables.",
        });

      url = "https://api.groq.com/openai/v1/chat/completions";
      headers = {
        Authorization: `Bearer ${groqKey}`,
        "Content-Type": "application/json",
      };
      body = {
        model: "llama-3.3-70b-versatile",
        messages: conversationMessages,
        max_tokens: 4096,
      };

      /* ── NVIDIA NEMOTRON ──────────────────────────────── */
    } else if (provider === "nemotron") {
      const nvKey = process.env.NEMOTRON_NVIDIA;
      if (!nvKey)
        return res.json({
          reply:
            "⚠ NEMOTRON_NVIDIA is not set in Render environment variables.",
        });

      // Correct NVIDIA NIM endpoint + correct model ID
      url = "https://integrate.api.nvidia.com/v1/chat/completions";
      headers = {
        Authorization: `Bearer ${nvKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      };
      body = {
        model: "nvidia/llama-3.1-nemotron-70b-instruct", // 70B is stable; 253B often 500s
        messages: conversationMessages,
        temperature: 0.6,
        top_p: 0.95,
        max_tokens: 1024,
        stream: false,
      };

      /* ── DEEPSEEK ─────────────────────────────────────── */
    } else if (provider === "deepseek") {
      const dsKey = process.env.DEEPSEEK_KEY;
      if (!dsKey)
        return res.json({
          reply: "⚠ DEEPSEEK_KEY is not set in Render environment variables.",
        });

      url = "https://api.deepseek.com/chat/completions"; // correct endpoint (no /v1/)
      headers = {
        Authorization: `Bearer ${dsKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      };
      body = {
        model: "deepseek-chat",
        messages: conversationMessages,
        temperature: 0.7,
        max_tokens: 4096,
        stream: false,
      };

      /* ── OPENROUTER (default) ─────────────────────────── */
    } else {
      const orKey = process.env.OPENROUTER_API_KEY;
      if (!orKey)
        return res.json({
          reply:
            "⚠ OPENROUTER_API_KEY is not set in Render environment variables.",
        });

      const chosenModel = enforceFreeModel(requestedModel);
      url = "https://openrouter.ai/api/v1/chat/completions";
      headers = {
        Authorization: `Bearer ${orKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://aria-69jr.onrender.com", // required by OpenRouter for free tier
        "X-Title": "ARIA", // required by OpenRouter for free tier
      };
      body = {
        model: chosenModel,
        messages: conversationMessages,
        max_tokens: 4096,
      };
    }

    /* ── MAKE THE REQUEST ─────────────────────────────── */
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    // Always log the raw error so you can see it in Render logs
    if (!response.ok) {
      let errBody = "";
      try {
        errBody = await response.text();
      } catch {}
      console.error(`[AI:${provider}] HTTP ${response.status} — ${errBody}`);

      // Return a helpful message per status code
      const hints = {
        401: `401 Unauthorized — your ${provider.toUpperCase()} API key is wrong or expired. Check Render → Environment.`,
        403: `403 Forbidden — API key doesn't have permission for this model.`,
        429: `429 Rate limit — you've hit the free tier limit. Wait a minute and try again, or switch providers.`,
        500: `500 Server error from ${provider} — their API is having issues. Try a different model or provider.`,
        503: `503 ${provider} is overloaded. Try again in a moment.`,
      };
      return res.json({
        reply: `⚠ ${hints[response.status] || `AI error ${response.status} from ${provider}.`}`,
      });
    }

    const data = await response.json();
    const reply = data?.choices?.[0]?.message?.content?.trim();

    if (!reply) {
      console.error(`[AI:${provider}] Empty response:`, JSON.stringify(data));
      return res.json({
        reply: "AI returned an empty response. Check Render logs for details.",
      });
    }

    res.json({ reply });
  } catch (err) {
    console.error(`[AI:${provider}] Exception:`, err.message);
    res.json({ reply: `Network error reaching ${provider}: ${err.message}` });
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
   CHATS (in-memory)
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
app.listen(PORT, () => console.log("ARIA server running on port", PORT));
