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

app.post("/api/chat", (req, res) => {
  const { message } = req.body;
  res.json({ reply: `Echo: ${message}` });
});

app.use((req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("ARIA running on port", PORT);
});
