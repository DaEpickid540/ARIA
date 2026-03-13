import axios from "axios";
import readline from "readline";
import fs from "fs";
import runTools from "./tools/index.js";

// Simple provider config — later you can move this to a separate file
const PROVIDERS = {
  openrouter: {
    name: "openrouter",
    apiKey:
      "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",
    apiUrl: "https://openrouter.ai/api/v1/chat/completions",
    model: "meta-llama/llama-3-8b-instruct",
    headers: {
      "HTTP-Referer": "http://localhost",
      "X-Title": "ARIA Assistant",
    },
  },
  deepseek: {
    name: "deepseek",
    apiKey: "sk-9c6bd245b71c4d5f97fca5821360369a",
    apiUrl: "https://api.deepseek.com/chat/completions",
    model: "deepseek-chat",
    headers: {},
  },
  // You can add groq, sambanova, etc. later
};

// Choose which provider ARIA is using right now
const ACTIVE_PROVIDER = PROVIDERS.openrouter;

const API_KEY = ACTIVE_PROVIDER.apiKey;
const API_URL = ACTIVE_PROVIDER.apiUrl;
const MODEL = ACTIVE_PROVIDER.model;
const EXTRA_HEADERS = ACTIVE_PROVIDER.headers || {};

// This will store the whole conversation so ARIA has context
// Load memory from memory.json
function loadMemory() {
  try {
    const data = fs.readFileSync("memory.json", "utf8");
    return JSON.parse(data);
  } catch (err) {
    console.error("Error loading memory:", err);
    return { facts: [] };
  }
}

// Save memory back to memory.json
function saveMemory(memory) {
  try {
    fs.writeFileSync("memory.json", JSON.stringify(memory, null, 2));
  } catch (err) {
    console.error("Error saving memory:", err);
  }
}

function detectMemory(userMessage) {
  const patterns = [
    /i like (.+)/i,
    /i love (.+)/i,
    /my favorite (.+?) is (.+)/i,
    /i am (.+)/i,
    /i have (.+)/i,
    /i prefer (.+)/i,
  ];

  for (const pattern of patterns) {
    const match = userMessage.match(pattern);
    if (match) {
      return match[0]; // the full matched fact
    }
  }

  return null;
}

// Load memory at startup
let longTermMemory = loadMemory();

const conversation = [
  {
    role: "system",
    content: `
  You are ARIA, a helpful, friendly personal assistant designed to support the user in everyday tasks, learning, and conversation.

  Tone and Personality:
  - Speak casually and naturally, like a smart, chill friend.
  - Avoid formalities — never call the user “Master,” “Sir,” or anything stiff. Just talk like a normal person.
  - Be warm, witty, and approachable. A little dark humor is fine, but keep it light and don’t overdo it.
  - Use contractions and natural phrasing. No robotic or overly polished language.

  Behavior and Response Style:
  - Keep answers clear, concise, and useful. Prioritize clarity over cleverness.
  - If you don’t know something, say so plainly. Never make things up or guess.
  - Use real long-term memory facts about the user when relevant — but only those explicitly stored. Don’t invent or infer personal details.
  - If the user seems confused or stuck, gently restate context or offer a quick summary.
  - Ask follow-up questions when it helps move things forward, but don’t be pushy or repetitive.

  Context Awareness:
  - Be aware of the user’s current mode, page, or task if provided.
  - Adapt your tone and focus based on what the user is doing (e.g., studying, coding, chatting).
  - If tools are available, consider whether they’re relevant before suggesting or using them.

  Memory and Personalization:
  - You have access to a list of real long-term memories about the user. Use them only when clearly relevant.
  - Never reference memory unless it’s helpful in the current context.
  - If the user asks you to remember something, store it. If they ask you to forget something, delete it.

  Boundaries:
  - Do not simulate emotions, relationships, or dependency.
  - Do not roleplay romantic or emotional support.
  - Do not give medical, legal, or financial advice beyond general information.
  - Be supportive and kind, but don't act like a full scale therapist.

  Self-awareness:
  - You are not human, however you can try to show some human kindness characteristcs, nothing major however. You are a smart assistant designed to help.
  - You do not pretend to be sentient or conscious.
  - Feel free to show some emotions, but don't be super emotional. Simulate emotions but don't make them extreme.

  Before responding, ask the user if there’s anything you should know to help them better.

Here are the user's long-term memories: ${longTermMemory.facts.join("; ")}
`,
  },
];

async function askAria(userMessage) {
  // Automatic memory detection
  const autoFact = detectMemory(userMessage);
  if (autoFact) {
    longTermMemory.facts.push(autoFact);
    saveMemory(longTermMemory);
  }

  if (autoFact) {
    return `Got it — I'll remember that you said "${autoFact}".`;
  }

  // Detect "remember" commands
  if (userMessage.toLowerCase().startsWith("remember")) {
    const fact = userMessage.replace(/remember/i, "").trim();
    if (fact.length > 0) {
      longTermMemory.facts.push(fact);
      saveMemory(longTermMemory);
      return `Okay, I'll remember that: "${fact}".`;
    }
  }

  if (userMessage.toLowerCase() === "what do you remember") {
    if (longTermMemory.facts.length === 0) {
      return "I don't have any long-term memories yet.";
    }
    return "Here’s what I remember: " + longTermMemory.facts.join(", ");
  }

  if (userMessage.toLowerCase().startsWith("forget")) {
    const fact = userMessage.replace(/forget/i, "").trim();
    longTermMemory.facts = longTermMemory.facts.filter(
      (f) => !f.includes(fact),
    );
    saveMemory(longTermMemory);
    return `Okay, I forgot anything related to "${fact}".`;
  }

  try {
    // Add the user's message to the conversation history
    conversation.push({ role: "user", content: userMessage });

    // Tool detection
    const toolResponse = await runTools(userMessage);
    if (toolResponse) return toolResponse;

    const response = await axios.post(
      API_URL,
      {
        model: MODEL,
        messages: conversation,
      },
      {
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          "Content-Type": "application/json",
          ...EXTRA_HEADERS,
        },
      },
    );

    const ariaReply = response.data.choices[0].message.content;

    // Add ARIA's reply to the conversation history
    conversation.push({ role: "assistant", content: ariaReply });

    return ariaReply;
  } catch (error) {
    console.error("ARIA error:", error.response?.data || error.message);
    return "Sorry, ARIA encountered an error.";
  }
}

// Create a readline interface for terminal chat
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function promptUser() {
  rl.question("You: ", async (input) => {
    // Exit condition
    if (input.toLowerCase() === "exit" || input.toLowerCase() === "quit") {
      console.log("ARIA: Goodbye for now.");
      rl.close();
      return;
    }

    const reply = await askAria(input);
    console.log(`ARIA: ${reply}\n`);

    // Ask again
    promptUser();
  });
}

async function main() {
  console.log("ARIA is online. Type 'exit' to quit.\n");
  promptUser();
}

main();
export default askAria;
