import axios from "axios";

export default async function webSearchTool(message) {
  const query = message.replace(/search|google|look up/gi, "").trim();
  if (!query) return "What should I search for?";

  const key = process.env.OPENROUTER_KEY;
  if (!key) return "Search requires an API key.";

  const prompt = `Search the web and summarize results for: ${query}`;

  const res = await axios.post(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      model: "deepseek/deepseek-chat",
      messages: [{ role: "user", content: prompt }],
    },
    { headers: { Authorization: `Bearer ${key}` } },
  );

  return res.data.choices[0].message.content;
}
