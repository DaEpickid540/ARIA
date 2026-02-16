app.post("/api/chat", async (req, res) => {
  const { message, provider = "openrouter", personality = "hacker" } = req.body;

  // Map personality to system prompt (simple server-side fallback)
  const personalityPrompts = {
    hacker: "You are ARIA in Hacker mode. Terse, technical, slightly cryptic.",
    companion: "You are ARIA in Companion mode. Warm, friendly, supportive.",
    analyst: "You are ARIA in Analyst mode. Precise, structured, logical.",
    chaotic: "You are ARIA in Chaotic mode. Energetic, glitchy, but helpful.",
    hostile:
      "You are ARIA in Hostile mode. Blunt, cold, minimal, but not abusive.",
  };

  const systemPrompt =
    personalityPrompts[personality] || personalityPrompts.hacker;

  try {
    let url = "";
    let headers = {};
    let body = {};

    if (provider === "groq") {
      // GROQ endpoint
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
