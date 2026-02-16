const express = require("express");
const path = require("path");
const fs = require("fs");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const memoryFile = path.join(__dirname, "memory.json");

function loadMemory() {
  if (!fs.existsSync(memoryFile)) return {};
  try {
    return JSON.parse(fs.readFileSync(memoryFile, "utf-8"));
  } catch {
    return {};
  }
}

function saveMemory(data) {
  fs.writeFileSync(memoryFile, JSON.stringify(data, null, 2));
}

app.get("/api/loadChats", (req, res) => {
  const userId = req.query.userId || "default";
  const data = loadMemory();
  res.json({ chats: data[userId] || [] });
});

app.post("/api/saveChats", (req, res) => {
  const { userId = "default", chats } = req.body;
  const data = loadMemory();
  data[userId] = chats || [];
  saveMemory(data);
  res.json({ success: true });
});

app.post("/api/chat", async (req, res) => {
  const { message } = req.body;

  try {
    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "openai/gpt-3.5-turbo",
          messages: [
            {
              role: "system",
              content:
                "You are ARIA, a helpful, friendly, conversational AI assistant.",
            },
            { role: "user", content: message },
          ],
        }),
      },
    );

    const data = await response.json();
    const reply =
      data?.choices?.[0]?.message?.content || "I couldn't generate a response.";

    res.json({ reply });
  } catch (err) {
    console.error("OpenRouter error:", err);
    res.json({ reply: "Error contacting AI provider." });
  }
});

app.use((req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("ARIA running on port", PORT);
});
