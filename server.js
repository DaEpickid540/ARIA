import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import askAria from "./ARIA/brain.js";

const app = express();
app.use(express.json());

// Serve the public folder
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(path.join(__dirname, "public")));

// Chat endpoint
app.post("/api/chat", async (req, res) => {
  const userMessage = req.body.message;
  const reply = await askAria(userMessage);
  res.json({ reply });
});

// Start server
const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`ARIA running on port ${PORT}`);
});
