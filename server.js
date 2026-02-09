import express from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import askAria from "./brain.js";

const app = express();
app.use(express.json());

// resolve paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// serve frontend
app.use(express.static(path.join(__dirname, "public")));

// ---------------- CHAT ROUTE ----------------
app.post("/api/chat", async (req, res) => {
  const userMessage = req.body.message;
  const reply = await askAria(userMessage);
  res.json({ reply });
});

// ---------------- SIMPLE JSON DATABASE ----------------
const DB_FILE = path.join(__dirname, "chats.json");

function loadDB() {
  if (!fs.existsSync(DB_FILE)) return {};
  return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
}

function saveDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// save chats
app.post("/api/saveChats", (req, res) => {
  const { userId, chats } = req.body;
  const db = loadDB();
  db[userId] = chats;
  saveDB(db);
  res.json({ ok: true });
});

// load chats
app.get("/api/loadChats", (req, res) => {
  const userId = req.query.userId;
  const db = loadDB();
  res.json({ chats: db[userId] || [] });
});

// ---------------- START SERVER ----------------
const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`ARIA running on port ${PORT}`);
});
