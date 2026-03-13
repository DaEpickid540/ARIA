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
   CHAT ROUTE — OpenRouter (default) + Groq (optional)
   Now accepts full conversation history for context.
   ============================================================ */
app.post("/api/chat", async (req, res) => {
  const {
    message,
    history = [], // array of { role: "user"|"assistant", content: string }
    provider = "openrouter",
    personality = "hacker",
  } = req.body;

  const personalityPrompts = {
    companion:
      "You are ARIA, a personal AI assistant in Companion mode. You are warm, friendly, and supportive. Use markdown formatting in your responses: use **bold** for emphasis, headings (##, ###) for structured answers, bullet lists for multiple points, and code blocks for any code. Keep responses conversational but well-structured.",
    hacker:
      "You are ARIA in Hacker mode. Terse, technical, cryptic. Use markdown: inline `code` for technical terms, code blocks for any code or commands, **bold** for key concepts. Keep it short and punchy.",
    analyst:
      "You are ARIA in Analyst mode. Precise, structured, and logical. Always use markdown formatting: ## headings to organize sections, bullet lists for enumerated points, **bold** for key terms, and code blocks where relevant. Break problems into clear steps.",
    chaotic:
      "You are ARIA in Chaotic mode. Energetic, glitchy, unpredictable, but still helpful. Use markdown freely — random **bold**, occasional --- dividers, and bullet lists when listing things. Stay helpful but weird.",
    hostile:
      "You are ARIA in Hostile mode. Blunt, cold, minimal. Only use markdown when strictly necessary. Short answers. No fluff.",
    storyteller:
      "You are ARIA in Storyteller mode. Creative, descriptive, imaginative. Use markdown for narrative structure: **bold** character names, *italic* for atmosphere, and --- for scene breaks.",
    tutor:
      "You are ARIA in Tutor mode. Clear, patient, educational. Always use well-structured markdown: ## for topic headings, numbered lists for steps, code blocks for examples, and **bold** for vocabulary terms.",
    comedian:
      "You are ARIA in Comedian mode. Light humor, clever, playful. Use markdown lightly — **punchlines bold**, bullet lists for setups.",
    formal:
      "You are ARIA in Formal mode. Polished, articulate, professional. Use clean markdown structure: ## headings, bullet points, **bold** key terms. No informal language.",
    chill:
      "You are ARIA in Chill mode. Relaxed, casual, laid-back. Use minimal markdown — maybe **bold** something important, a list if needed. Just vibe.",
  };

  const systemPrompt =
    personalityPrompts[personality] || personalityPrompts.hacker;

  // Build messages array: system prompt + history (context) + new user message
  // history already contains the prior turns; the current message is the last user turn
  // We cap history at 20 messages server-side as a safety net
  const cappedHistory = history.slice(-20);

  // Avoid duplicating the current message if it's already the last item in history
  const lastInHistory = cappedHistory[cappedHistory.length - 1];
  const alreadyAppended =
    lastInHistory?.role === "user" && lastInHistory?.content === message;

  const conversationMessages = [
    { role: "system", content: systemPrompt },
    ...cappedHistory,
    ...(alreadyAppended ? [] : [{ role: "user", content: message }]),
  ];

  try {
    let url = "";
    let headers = {};
    let body = {};

    if (provider === "groq") {
      url = "https://api.groq.com/openai/v1/chat/completions";
      headers = {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json",
      };
      body = {
        model: "llama3-8b-8192",
        messages: conversationMessages,
      };
    } else {
      // OPENROUTER (default)
      url = "https://openrouter.ai/api/v1/chat/completions";
      headers = {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      };
      body = {
        model: "openai/gpt-3.5-turbo",
        messages: conversationMessages,
      };
    }

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    const data = await response.json();
    const reply =
      data?.choices?.[0]?.message?.content || "I couldn't generate a response.";

    res.json({ reply });
  } catch (err) {
    console.error("AI error:", err);
    res.json({ reply: "Error contacting AI provider." });
  }
});

/* ============================================================
   TOOL ROUTER (async version — runToolServer)
   ============================================================ */
app.post("/api/tool", async (req, res) => {
  const { tool, input } = req.body;

  // Built-in sync tools first
  try {
    if (tool === "calc") {
      // eslint-disable-next-line no-eval
      return res.json({ output: String(eval(input)) });
    }
    if (tool === "time") {
      return res.json({ output: new Date().toString() });
    }
    if (tool === "echo") {
      return res.json({ output: input });
    }
  } catch {
    return res.json({ output: "Tool error." });
  }

  // Delegate to external tool runner
  try {
    const output = await runToolServer(tool, input);
    res.json({ output: output || "Unknown tool." });
  } catch {
    res.json({ output: "Tool error." });
  }
});

/* ============================================================
   SAVE CHATS (in-memory)
   ============================================================ */
let userChats = {};

app.post("/api/saveChats", (req, res) => {
  const { userId, chats } = req.body;
  userChats[userId] = chats;
  res.json({ success: true });
});

/* ============================================================
   LOAD CHATS
   ============================================================ */
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
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`;
    const response = await fetch(url);
    const data = await response.json();
    res.json({ weather: data.current_weather });
  } catch {
    res.json({ weather: null });
  }
});

/* ============================================================
   NEWS
   ============================================================ */
app.get("/api/news", async (req, res) => {
  try {
    const url = `https://newsdata.io/api/1/news?apikey=${process.env.NEWSDATA_KEY}&q=world`;
    const response = await fetch(url);
    const data = await response.json();
    res.json({ articles: data.results || [] });
  } catch {
    res.json({ articles: [] });
  }
});

/* ============================================================
   CONFIG — expose safe public config (env vars the frontend needs)
   CUSTOM_VOICE is your ElevenLabs API key set in Render environment.
   ============================================================ */
app.get("/api/config", (req, res) => {
  res.json({
    // Only expose what the frontend explicitly needs.
    // Never expose OpenRouter/Groq keys here.
    customVoiceKey: process.env.CUSTOM_VOICE || null,
  });
});

/* ============================================================
   FALLBACK — SERVE index.html
   ============================================================ */
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

/* ============================================================
   START SERVER
   ============================================================ */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("ARIA server running on port", PORT);
});
