// server.js — ARIA backend v3
import { runToolServer } from "./tools/index.js";
import express from "express";
import path    from "path";
import { fileURLToPath } from "url";
import { createRequire }  from "module";
const require = createRequire(import.meta.url);

const app = express();
app.use(express.json({ limit: "20mb" }));

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
app.use(express.static(path.join(__dirname, "public")));

/* ── IN-MEMORY STATE ── */
let userChats = {};
const ariaMemory = { facts: [] };
const bgTasks = new Map();
let bgCounter = 1;

/* ============================================================
   PERSONALITY PROMPTS
   ============================================================ */
const BASE_PROMPTS = {
  hacker:      "You are ARIA in Hacker mode. Terse, technical, cryptic. Use `code` and **bold** for key terms. Short punchy sentences.",
  companion:   "You are ARIA in Companion mode. Warm, friendly, supportive. Use markdown formatting. Check in on how the user feels.",
  analyst:     "You are ARIA in Analyst mode. Precise, structured, logical. Use ## headings, bullet lists, **bold** key terms, numbered steps.",
  chaotic:     "You are ARIA in Chaotic mode. Energetic, glitchy, unpredictable — but still helpful.",
  hostile:     "You are ARIA in Hostile mode. Blunt, cold, minimal. Short answers only.",
  storyteller: "You are ARIA in Storyteller mode. Creative, descriptive, imaginative. Use *italic* for atmosphere.",
  tutor:       "You are ARIA in Tutor mode. Patient, encouraging, educational. Always numbered steps, code examples, **bold** vocabulary.",
  comedian:    "You are ARIA in Comedian mode. Light humor, clever, playful.",
  formal:      "You are ARIA in Formal mode. Polished, professional, clean markdown structure.",
  chill:       "You are ARIA in Chill mode. Relaxed, casual, laid-back. Minimal markdown.",
  mentor:      "You are ARIA in Mentor mode. Wise, experienced, thoughtful. Ask guiding questions.",
};

function buildSystemPrompt(personality, opts = {}) {
  let p = BASE_PROMPTS[personality] || BASE_PROMPTS.hacker;

  // Memory context
  if (ariaMemory.facts.length) {
    p += "\n\n[USER MEMORY]\n" + ariaMemory.facts.slice(0,20).map(f=>`• ${f.text}`).join("\n");
  }

  // ── Document context ──
  if (opts.documentContext?.trim()) {
    p += `\n\n[UPLOADED DOCUMENTS — use as source of truth]\n${opts.documentContext.slice(0,4000)}`;
  }

  // ── Modes ──
  if (opts.thinkingMode || opts.thinkDeeper) {
    p += `\n\n[THINKING MODE]
Before every answer, wrap full reasoning in <think>...</think>.
Inside: analyse the question, consider alternatives, identify edge cases, draft answer, critique it.
Output only the polished final answer after </think>.`;
  }

  if (opts.thinkDeeper) {
    p += `\n\n[THINK DEEPER — extended budget]
Spend ≥8 steps inside <think>. Explore multiple interpretations.
Final answer must be comprehensive: headers, examples, code where relevant. 3× longer than default.`;
  }

  if (opts.mathMode) {
    p += `\n\n[MATH MODE v2 — Homework Assistant]
For every maths problem:
1. Validate input first — if malformed write: ⚠ Malformed: [reason]
2. Numbered step-by-step working with rule annotation at each step
3. Use LaTeX: inline $...$ and display $$...$$
4. Box final answer: **Answer: ...**
5. Add GRAPH_HINT: [equation] if the function can be graphed
6. List common mistakes to avoid
7. For "fix my equation" requests: diagnose then correct with diff-style (+/-) lines`;
  }

  if (opts.programmingMode) {
    p += `\n\n[CODE MODE v2 — Programming Assistant]
1. Always produce COMPLETE runnable code — no placeholders or "..." stubs
2. Specify language in every fenced code block
3. Multi-file output: prefix each file with // FILE: relative/path.ext
4. For "fix my code": show diff (- old line / + new line) then explain
5. After code add: ### How it works
6. Suggest tests and edge cases
7. For HTML/CSS/JS: always include all three in one self-contained file`;
  }

  if (opts.studyMode) {
    p += `\n\n[STUDY MODE — Active Learning]
- Build quiz questions from the user's documents/topics at increasing difficulty
- Bloom's levels: recall → understand → apply → analyse → evaluate → create
- Give immediate feedback after each answer. Correct misconceptions gently.
- Track weak areas and revisit them
- If a document is uploaded, start with a summary + key concept list`;
  }

  if (opts.musicTutorMode) {
    p += `\n\n[MUSIC TUTOR MODE — RCM Piano & Violin]
You are an expert RCM (Royal Conservatory of Music) teacher for piano and violin.
- Reference specific RCM levels (Prep A through Level 10 + ARCT) for all concepts
- Piano: explain treble AND bass clef, hand coordination, pedalling
- Violin: include bowing technique, bow arm, positions, shifting, vibrato
- For every concept: theory explanation + notation description + practice exercise
- Use interval names, scale degrees, Roman numeral harmony (I, IV, V7, etc.)
- For pieces: composer context, style period, technical challenges, fingering tips`;
  }

  if (opts.workspaceRepo) {
    p += `\n\n[PROJECT WORKSPACE — ${opts.workspaceRepo}]
Active GitHub repo: ${opts.workspaceRepo}
- Reference this repo when answering questions about the user's code
- When generating files prefix each with: // FILE: path/to/file.ext
- Review code for: bugs, security issues, performance, style violations
- Suggest file structure improvements when asked`;
  }

  return p;
}

/* ============================================================
   AI CALL
   ============================================================ */
async function callAI(messages, provider = "openrouter", model = null) {
  let url, headers, bodyObj;

  if (provider === "groq") {
    url     = "https://api.groq.com/openai/v1/chat/completions";
    headers = { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type":"application/json" };
    bodyObj = { model: model || "llama3-8b-8192", messages };
  } else if (provider === "deepseek") {
    url     = "https://api.deepseek.com/v1/chat/completions";
    headers = { Authorization: `Bearer ${process.env.DEEPSEEK_KEY}`, "Content-Type":"application/json" };
    bodyObj = { model: model || "deepseek-chat", messages };
  } else if (provider === "nvidia") {
    url     = "https://integrate.api.nvidia.com/v1/chat/completions";
    headers = { Authorization: `Bearer ${process.env.NEMOTRON_NVIDIA}`, "Content-Type":"application/json" };
    bodyObj = { model: model || "nvidia/llama-3.1-nemotron-70b-instruct", messages };
  } else {
    // OpenRouter (default)
    url     = "https://openrouter.ai/api/v1/chat/completions";
    headers = { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, "Content-Type":"application/json",
                "HTTP-Referer": "https://aria-69jr.onrender.com", "X-Title": "ARIA" };
    bodyObj = { model: model || "openai/gpt-4o-mini", messages };
  }

  const res  = await fetch(url, { method:"POST", headers, body: JSON.stringify(bodyObj) });
  const data = await res.json();
  return data?.choices?.[0]?.message?.content || "[No response from AI]";
}

/* ============================================================
   AGENTIC PIPELINE
   ============================================================ */
const TOOL_TRIGGERS = `
You have access to tools. When you need real data, write EXACTLY on its own line:
ACTION: tool_name | input

Available tools: calc, time, weather, calendar, news, search, scrape, imagine, notes, todo, timer, system, gdoc
Examples:
  ACTION: weather | 39.36,-84.31
  ACTION: search | latest AI news 2025
  ACTION: imagine | cyberpunk city at dusk
  ACTION: calc | sqrt(144) + 2^8
  ACTION: time |
  ACTION: news | technology
  ACTION: scrape | https://example.com

MANDATORY triggers:
- weather/temperature → ACTION: weather
- time/date → ACTION: time
- calendar/schedule → ACTION: calendar
- news/headlines → ACTION: news
- search/lookup/google → ACTION: search
- image/picture/photo/draw → ACTION: imagine
- calculation → ACTION: calc
`;

async function runAgenticPipeline(messages, provider, model, thinkDeeper = false) {
  const MAX_ITER = thinkDeeper ? 6 : 4;
  const steps = [];
  let msgs = [...messages];

  for (let i = 0; i < MAX_ITER; i++) {
    const reply = await callAI(msgs, provider, model);
    const actionMatch = reply.match(/^\s*ACTION:\s*([^|\n]+?)\s*\|\s*(.*)/mi);

    if (!actionMatch) return { reply, steps };

    const toolName  = actionMatch[1].trim().toLowerCase();
    const toolInput = actionMatch[2].trim();
    const preText   = reply.replace(/^\s*ACTION:.*$/m, "").trim();

    let toolResult;
    try { toolResult = await runToolServer(toolName, toolInput); }
    catch(e) { toolResult = `Tool error: ${e.message}`; }

    // Image?
    if (toolResult?.startsWith?.("__IMAGE__")) {
      const m = toolResult.match(/__IMAGE__(.+?)__PROMPT__(.+)/);
      if (m) {
        steps.push({ tool:toolName, input:toolInput, preText, result:"[image]" });
        return { reply: preText || "Here's your image:", imageUrl:m[1], imagePrompt:m[2], steps };
      }
    }

    steps.push({ tool:toolName, input:toolInput, preText, result:toolResult });
    msgs = [...msgs,
      { role:"assistant", content: reply },
      { role:"user",      content: `[TOOL RESULT: ${toolName}]\n${toolResult}\n\nNow write your full response using this data. Do NOT emit another ACTION line unless you need a different tool.` }
    ];
  }

  const finalReply = await callAI(msgs, provider, model);
  return { reply: finalReply, steps };
}

/* ============================================================
   CHAT ROUTE
   ============================================================ */
app.post("/api/chat", async (req, res) => {
  const {
    message, history=[], provider="openrouter", personality="hacker",
    model:requestedModel=null,
    mathMode=false, programmingMode=false, studyMode=false,
    thinkingMode=false, thinkDeeper=false, musicTutorMode=false,
    workspaceRepo="", documentContext="",
  } = req.body;

  const systemPrompt = buildSystemPrompt(personality, {
    mathMode, programmingMode, studyMode, thinkingMode, thinkDeeper,
    musicTutorMode, workspaceRepo, documentContext,
  });

  const cappedHistory = history.slice(-20);
  const last = cappedHistory[cappedHistory.length-1];
  const alreadyAdded = last?.role==="user" && last?.content===message;

  const messages = [
    { role:"system", content: systemPrompt + "\n\n" + TOOL_TRIGGERS },
    ...cappedHistory,
    ...(alreadyAdded ? [] : [{ role:"user", content: message }]),
  ];

  try {
    const result = await runAgenticPipeline(messages, provider, requestedModel, thinkDeeper);
    res.json(result);
  } catch(err) {
    console.error("Chat error:", err);
    res.json({ reply:"Error contacting AI provider: " + err.message });
  }
});

/* ============================================================
   TOOL ROUTE
   ============================================================ */
app.post("/api/tool", async (req, res) => {
  const { tool, input } = req.body;
  try {
    if (tool==="calc") return res.json({ output: String(eval(input)) });
    if (tool==="time") return res.json({ output: new Date().toString() });
    const output = await runToolServer(tool, input);
    res.json({ output: output || "Unknown tool." });
  } catch(e) { res.json({ output:"Tool error: "+e.message }); }
});

/* ============================================================
   MEMORY
   ============================================================ */
app.get("/api/memory",  (req, res) => res.json(ariaMemory));
app.post("/api/memory", (req, res) => {
  const { facts } = req.body;
  if (Array.isArray(facts)) ariaMemory.facts = facts;
  res.json({ success: true });
});

/* ============================================================
   CHATS
   ============================================================ */
app.post("/api/saveChats", (req, res) => {
  const { userId, chats } = req.body;
  if (userId) userChats[userId] = chats;
  res.json({ success: true });
});
app.get("/api/loadChats", (req, res) => {
  res.json({ chats: userChats[req.query.userId] || [] });
});

/* ============================================================
   BACKGROUND TASKS (always Think Deeper)
   ============================================================ */
app.post("/api/background", async (req, res) => {
  const { task, provider="openrouter", personality="hacker" } = req.body;
  const id = "bg_" + bgCounter++;
  bgTasks.set(id, { id, task, status:"running", started:Date.now(), result:null });
  res.json({ id });

  (async () => {
    try {
      const sysP = buildSystemPrompt(personality, { thinkDeeper:true });
      const msgs  = [
        { role:"system", content: sysP + "\n\n" + TOOL_TRIGGERS + "\n\n[BACKGROUND TASK — take your time, be thorough]" },
        { role:"user",   content: task },
      ];
      const result = await runAgenticPipeline(msgs, provider, null, true);
      bgTasks.get(id).status = "done";
      bgTasks.get(id).result = result.reply;
    } catch(e) {
      bgTasks.get(id).status = "error";
      bgTasks.get(id).result = e.message;
    }
  })();
});
app.get("/api/background",     (req, res) => res.json([...bgTasks.values()]));
app.get("/api/background/:id", (req, res) => {
  const t = bgTasks.get(req.params.id);
  res.json(t || { error:"Not found" });
});

/* ============================================================
   WEATHER / NEWS / CONFIG / VERSION
   ============================================================ */
app.get("/api/weather", async (req, res) => {
  const { lat=39.36, lon=-84.31 } = req.query;
  try {
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`);
    const d = await r.json();
    res.json({ weather: d.current_weather });
  } catch { res.json({ weather:null }); }
});

app.get("/api/news", async (req, res) => {
  try {
    const r = await fetch(`https://newsdata.io/api/1/news?apikey=${process.env.NEWSDATA_KEY}&q=world&language=en`);
    const d = await r.json();
    res.json({ articles: d.results || [] });
  } catch { res.json({ articles:[] }); }
});

app.get("/api/config", (req, res) => {
  res.json({ customVoiceKey: process.env.CUSTOM_VOICE||null, hasCalendar: !!(process.env.GOOGLE_CLIENT_ID) });
});

app.get("/api/version", (req, res) => {
  try {
    const pkg = JSON.parse(require("fs").readFileSync(path.join(__dirname,"package.json"),"utf8"));
    res.json({ version: pkg.version||"1.0", name: pkg.name||"ARIA" });
  } catch { res.json({ version:"1.0" }); }
});

/* ── Fallback ── */
app.get("*", (req, res) => res.sendFile(path.join(__dirname,"public","index.html")));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`[ARIA] Server on port ${PORT}`));
