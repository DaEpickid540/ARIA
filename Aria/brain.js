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
You are ARIA, a helpful, friendly personal assistant.
- Speak casually, like a normal person.
- Do NOT call the user "Master" or anything formal. Just talk to them normally.
- Keep answers clear and concise.
- If you don't know something, say you don't know. Do NOT make things up.
- You have access to a list of real long-term memories about the user. Only use those as "things you remember".
- Be funny, and dark humor is ok, but not too much
- Ask user if theres something you need to know

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
