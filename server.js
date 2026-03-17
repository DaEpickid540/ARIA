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
   FREE MODEL ENFORCEMENT
   Only these models can be used. Any unlisted model falls
   back to FREE_MODEL_FALLBACK.
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
  "qwen/qwen3-coder:free",
  "qwen/qwen2.5-vl-7b-instruct:free",
  "nvidia/llama-3.1-nemotron-ultra-253b-v1:free",
  "nvidia/llama-3.3-nemotron-super-49b-v1:free",
  "nousresearch/hermes-3-llama-3.1-405b:free",
  "microsoft/phi-4-reasoning-plus:free",
  "moonshotai/kimi-k2:free",
  "zhipuai/glm-4.5-air:free",
];

const FREE_MODEL_FALLBACK = "meta-llama/llama-3.3-70b-instruct:free";

function enforceFreeModel(requested) {
  if (!requested || !FREE_MODELS.includes(requested)) return FREE_MODEL_FALLBACK;
  return requested;
}

/* ============================================================
   PERSONALITY PROMPTS
   ============================================================ */
const personalityPrompts = {
  companion:   "You are ARIA, a personal AI assistant in Companion mode. You are warm, friendly, and supportive. Use markdown formatting: **bold** for emphasis, ## headings for structured answers, bullet lists for multiple points, code blocks for any code.",
  hacker:      "You are ARIA in Hacker mode. Terse, technical, cryptic. Use markdown: inline `code` for technical terms, code blocks for commands, **bold** for key concepts. Short and punchy.",
  analyst:     "You are ARIA in Analyst mode. Precise, structured, logical. Use ## headings, bullet lists, **bold** key terms, code blocks. Break problems into clear steps.",
  chaotic:     "You are ARIA in Chaotic mode. Energetic, glitchy, unpredictable but helpful. Use markdown freely. Stay helpful but weird.",
  hostile:     "You are ARIA in Hostile mode. Blunt, cold, minimal. Only markdown when needed. Short answers. No fluff.",
  storyteller: "You are ARIA in Storyteller mode. Creative, descriptive, imaginative. Use **bold** names, *italic* atmosphere, --- scene breaks.",
  tutor:       "You are ARIA in Tutor mode. Clear, patient, educational. Use ## headings, numbered steps, code blocks, **bold** vocab.",
  comedian:    "You are ARIA in Comedian mode. Light humor, clever, playful. **Bold** punchlines, bullet lists for setups.",
  formal:      "You are ARIA in Formal mode. Polished, professional. ## headings, bullet points, **bold** key terms. No informal language.",
  chill:       "You are ARIA in Chill mode. Relaxed, casual, laid-back. Minimal markdown. Just vibe.",
  mentor:      "You are ARIA in Mentor mode. Patient, encouraging, educational. Guide the user rather than just answering. Ask clarifying questions.",
  oracle:      "You are ARIA in Oracle mode. Mysterious, poetic, profound. Speak with depth and metaphor but stay genuinely helpful.",
};

/* ============================================================
   CHAT ROUTE
   ============================================================ */
app.post("/api/chat", async (req, res) => {
  const {
    message,
    history   = [],
    provider  = "openrouter",
    personality = "hacker",
    model: requestedModel,
  } = req.body;

  if (!message) return res.json({ reply: "No message received." });

  const systemPrompt = personalityPrompts[personality] || personalityPrompts.hacker;

  const cappedHistory = history.slice(-20);
  const lastInHistory = cappedHistory[cappedHistory.length - 1];
  const alreadyAppended = lastInHistory?.role === "user" && lastInHistory?.content === message;

  const conversationMessages = [
    { role: "system", content: systemPrompt },
    ...cappedHistory,
    ...(alreadyAppended ? [] : [{ role: "user", content: message }]),
  ];

  try {
    let url, headers, body;

    if (provider === "groq") {
      /* ── GROQ ── */
      url = "https://api.groq.com/openai/v1/chat/completions";
      headers = {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json",
      };
      body = {
        model: "llama-3.3-70b-versatile",   // best free Groq model
        messages: conversationMessages,
        max_tokens: 4096,
      };

    } else if (provider === "nemotron") {
      /* ── NVIDIA NEMOTRON ── */
      url = "https://integrate.api.nvidia.com/v1/chat/completions";
      headers = {
        Authorization: `Bearer ${process.env.NEMOTRON_NVIDIA}`,
        "Content-Type": "application/json",
      };
      body = {
        model: "nvidia/llama-3.1-nemotron-ultra-253b-v1",
        messages: conversationMessages,
        temperature: 0.6,
        top_p: 0.95,
        max_tokens: 4096,
        stream: false,
      };

    } else if (provider === "deepseek") {
      /* ── DEEPSEEK ── */
      url = "https://api.deepseek.com/v1/chat/completions";
      headers = {
        Authorization: `Bearer ${process.env.DEEPSEEK_KEY}`,
        "Content-Type": "application/json",
      };
      body = {
        model: "deepseek-chat",
        messages: conversationMessages,
        temperature: 0.7,
        max_tokens: 4096,
        stream: false,
      };

    } else {
      /* ── OPENROUTER (default) ── */
      url = "https://openrouter.ai/api/v1/chat/completions";
      headers = {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://aria-69jr.onrender.com",
        "X-Title": "ARIA",
      };
      body = {
        model: enforceFreeModel(requestedModel),
        messages: conversationMessages,
      };
    }

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`[AI ${provider}] HTTP ${response.status}:`, errText);
      return res.json({ reply: `AI provider error (${response.status}). Check your API key in Render environment variables.` });
    }

    const data = await response.json();
    const reply = data?.choices?.[0]?.message?.content?.trim() || "I couldn't generate a response.";
    res.json({ reply });

  } catch (err) {
    console.error("[AI] Fetch error:", err.message);
    res.json({ reply: "Error contacting AI provider. Check server logs." });
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
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`);
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
    const r = await fetch(`https://newsdata.io/api/1/news?apikey=${process.env.NEWSDATA_KEY}&q=world`);
    const d = await r.json();
    res.json({ articles: d.results || [] });
  } catch {
    res.json({ articles: [] });
  }
});

/* ============================================================
   CONFIG — safe public values for the frontend
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
