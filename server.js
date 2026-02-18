// server.js
import { runToolServer } from "./tools/index.js";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";

// Node 18+ has fetch built-in — no import needed

const app = express();
app.use(express.json());

// Resolve __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve static files
app.use(express.static(path.join(__dirname, "public")));

/* ============================================================
   CHAT ROUTE — OpenRouter (default) + Groq (optional)
   ============================================================ */
app.post("/api/chat", async (req, res) => {
  const {
    message,
    provider = "openrouter",
    personality = "companion",
  } = req.body;

  const personalityPrompts = {
    companion:
      "You are ARIA in Companion mode. Warm, friendly, supportive, conversational.",
    hacker: "You are ARIA in Hacker mode. Terse, technical, cryptic.",
    analyst: "You are ARIA in Analyst mode. Precise, structured, logical.",
    chaotic: "You are ARIA in Chaotic mode. Energetic, glitchy, unpredictable.",
    hostile: "You are ARIA in Hostile mode. Blunt, cold, minimal, not abusive.",
    storyteller:
      "You are ARIA in Storyteller mode. Creative, descriptive, imaginative.",
    tutor: "You are ARIA in Tutor mode. Clear, patient, educational.",
    comedian: "You are ARIA in Comedian mode. Light humor, clever, playful.",
    formal: "You are ARIA in Formal mode. Polished, articulate, professional.",
    chill: "You are ARIA in Chill mode. Relaxed, casual, laid-back.",
  };

  const systemPrompt =
    personalityPrompts[personality] || personalityPrompts.hacker;

  try {
    let url = "";
    let headers = {};
    let body = {};

    if (provider === "groq") {
      // GROQ
      url = "https://api.groq.com/openai/v1/chat/completions";
      headers = {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json",
      };
      body = {
        model: "llama3-8b-8192",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: message },
        ],
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
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: message },
        ],
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
   TOOL ROUTER
   ============================================================ */
app.post("/api/tool", async (req, res) => {
  const { tool, input } = req.body;
  const output = await runToolServer(tool, input);
  res.json({ output });
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
   TOOL ROUTE
   ============================================================ */
app.post("/api/tool", (req, res) => {
  const { tool, input } = req.body;

  try {
    if (tool === "calc") {
      return res.json({ output: eval(input) });
    }
    if (tool === "time") {
      return res.json({ output: new Date().toString() });
    }
    if (tool === "echo") {
      return res.json({ output: input });
    }

    res.json({ output: "Unknown tool." });
  } catch (err) {
    res.json({ output: "Tool error." });
  }
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

app.get("/api/weather", async (req, res) => {
  const { lat = 40.0, lon = -81.0 } = req.query;

  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`;
    const response = await fetch(url);
    const data = await response.json();

    res.json({ weather: data.current_weather });
  } catch (err) {
    res.json({ weather: null });
  }
});

app.get("/api/news", async (req, res) => {
  try {
    const url = `https://newsdata.io/api/1/news?apikey=${process.env.NEWSDATA_KEY}&q=world`;
    const response = await fetch(url);
    const data = await response.json();

    res.json({ articles: data.results || [] });
  } catch (err) {
    res.json({ articles: [] });
  }
});
