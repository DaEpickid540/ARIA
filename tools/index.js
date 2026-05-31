// tools/index.js — UNIFIED TOOL SYSTEM
// All tools in one place, used by server.js via runToolServer()
import os from "os";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* ============================================================
   PERSISTENCE HELPERS — notes + todos survive restarts
   ============================================================ */
const DATA_DIR = path.join(__dirname, "..", "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const NOTES_FILE = path.join(DATA_DIR, "notes.json");
const TODOS_FILE = path.join(DATA_DIR, "todos.json");

function loadJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}
function saveJSON(file, data) {
  try { fs.writeFileSync(file, JSON.stringify(data, null, 2)); } catch {}
}


/* ============================================================
   CALC — safe math evaluator with strict input validation
   ============================================================ */
async function runCalc(input) {
  if (!input?.trim()) return "Usage: /calc <expression>";
  const expr = input.trim();

  // Strict allowlist: only allow numbers, operators, parens, dots, commas, spaces,
  // and these specific function/constant names.
  const ALLOWED_KEYWORDS = /\b(sqrt|abs|floor|ceil|round|log|ln|sin|cos|tan|asin|acos|atan|exp|min|max|pow|pi|e)\b/g;
  const stripped = expr.replace(ALLOWED_KEYWORDS, "");
  if (!/^[0-9+\-*/().,\s^%]*$/.test(stripped)) {
    return "Could not evaluate: expression contains disallowed characters.";
  }

  try {
    const safe = expr
      .replace(/\^/g, "**")
      .replace(/\bsqrt\b/g, "Math.sqrt")
      .replace(/\babs\b/g, "Math.abs")
      .replace(/\bfloor\b/g, "Math.floor")
      .replace(/\bceil\b/g, "Math.ceil")
      .replace(/\bround\b/g, "Math.round")
      .replace(/\bln\b/g, "Math.log")
      .replace(/\blog\b/g, "Math.log10")
      .replace(/\bsin\b/g, "Math.sin")
      .replace(/\bcos\b/g, "Math.cos")
      .replace(/\btan\b/g, "Math.tan")
      .replace(/\basin\b/g, "Math.asin")
      .replace(/\bacos\b/g, "Math.acos")
      .replace(/\batan\b/g, "Math.atan")
      .replace(/\bexp\b/g, "Math.exp")
      .replace(/\bmin\b/g, "Math.min")
      .replace(/\bmax\b/g, "Math.max")
      .replace(/\bpow\b/g, "Math.pow")
      .replace(/\bpi\b/gi, "Math.PI")
      .replace(/\be\b/g, "Math.E");
    const result = Function(`"use strict";return(${safe})`)();
    if (typeof result !== "number" || !isFinite(result))
      return "Result is not a finite number.";
    return `= ${Number.isInteger(result) ? result : result.toFixed(8).replace(/\.?0+$/, "")}`;
  } catch (e) {
    return `Could not evaluate: ${e.message}`;
  }
}

/* ============================================================
   TIME
   ============================================================ */
async function runTime() {
  return `Current time: ${new Date().toLocaleString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZoneName: "short" })}`;
}

/* ============================================================
   WEATHER — Open-Meteo, default Mason OH
   ============================================================ */
const WMO = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Foggy",
  48: "Rime fog",
  51: "Light drizzle",
  53: "Drizzle",
  55: "Heavy drizzle",
  61: "Light rain",
  63: "Rain",
  65: "Heavy rain",
  71: "Light snow",
  73: "Snow",
  75: "Heavy snow",
  80: "Light showers",
  81: "Showers",
  82: "Heavy showers",
  95: "Thunderstorm",
  96: "Thunderstorm w/ hail",
  99: "Heavy thunderstorm",
};

async function runWeather(input = "") {
  let lat = 39.3601,
    lon = -84.3097,
    label = "Mason, OH";
  const trimmed = input.trim();
  if (trimmed) {
    const parts = trimmed.split(",");
    if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      lat = parseFloat(parts[0]);
      lon = parseFloat(parts[1]);
      label = trimmed;
    }
  }
  try {
    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&timezone=auto`,
    );
    const data = await res.json();
    const w = data.current_weather;
    if (!w) return "Weather unavailable.";
    const f = ((w.temperature * 9) / 5 + 32).toFixed(1);
    return `**Weather for ${label}:** ${WMO[w.weathercode] || "Unknown"}\n🌡 ${w.temperature}°C (${f}°F) | 💨 ${w.windspeed} km/h`;
  } catch (e) {
    return `Weather error: ${e.message}`;
  }
}

/* ============================================================
   NOTES — file-backed (persists across restarts)
   ============================================================ */
async function runNotes(input = "") {
  let notes = loadJSON(NOTES_FILE, []);
  const parts = input.trim().split(" ");
  const cmd = parts[0]?.toLowerCase();
  const text = parts.slice(1).join(" ").trim();
  switch (cmd) {
    case "add":
      if (!text) return "Usage: /notes add <text>";
      notes.push({ text, created: new Date().toLocaleTimeString() });
      saveJSON(NOTES_FILE, notes);
      return `✓ Note #${notes.length}: "${text}"`;
    case "list":
      return notes.length
        ? notes.map((n, i) => `${i + 1}. ${n.text} [${n.created}]`).join("\n")
        : "No notes.";
    case "delete": {
      const i = parseInt(text) - 1;
      if (isNaN(i) || !notes[i]) return "Not found.";
      const [deleted] = notes.splice(i, 1);
      saveJSON(NOTES_FILE, notes);
      return `✓ Deleted: "${deleted.text}"`;
    }
    case "clear":
      saveJSON(NOTES_FILE, []);
      return "✓ Notes cleared.";
    default:
      return "/notes add|list|delete <n>|clear";
  }
}

/* ============================================================
   TODO — file-backed (persists across restarts)
   ============================================================ */
async function runTodo(input = "") {
  let todos = loadJSON(TODOS_FILE, []);
  const parts = input.trim().split(" ");
  const cmd = parts[0]?.toLowerCase();
  const text = parts.slice(1).join(" ").trim();
  switch (cmd) {
    case "add":
      if (!text) return "Usage: /todo add <text>";
      todos.push({ text, done: false });
      saveJSON(TODOS_FILE, todos);
      return `✓ Task #${todos.length}: "${text}"`;
    case "list":
      return todos.length
        ? todos
            .map((t, i) => `${i + 1}. [${t.done ? "✓" : " "}] ${t.text}`)
            .join("\n")
        : "No tasks.";
    case "done": {
      const i = parseInt(text) - 1;
      if (!todos[i]) return "Not found.";
      todos[i].done = true;
      saveJSON(TODOS_FILE, todos);
      return `✓ Done: "${todos[i].text}"`;
    }
    case "undone": {
      const i = parseInt(text) - 1;
      if (!todos[i]) return "Not found.";
      todos[i].done = false;
      saveJSON(TODOS_FILE, todos);
      return `↩ Undone: "${todos[i].text}"`;
    }
    case "delete": {
      const i = parseInt(text) - 1;
      if (!todos[i]) return "Not found.";
      const [deleted] = todos.splice(i, 1);
      saveJSON(TODOS_FILE, todos);
      return `✓ Deleted: "${deleted.text}"`;
    }
    case "clear":
      saveJSON(TODOS_FILE, []);
      return "✓ Tasks cleared.";
    default:
      return "/todo add|list|done <n>|undone <n>|delete <n>|clear";
  }
}

/* ============================================================
   TIMER
   ============================================================ */
const activeTimers = new Map();
let timerCounter = 1;
async function runTimer(input = "") {
  const parts = input.trim().split(" ");
  const cmd = parts[0]?.toLowerCase();
  if (cmd === "start") {
    const secs = parseInt(parts[1]);
    if (isNaN(secs) || secs <= 0) return "Usage: /timer start <seconds>";
    if (secs > 3600) return "Max 3600s.";
    const id = timerCounter++;
    const timeout = setTimeout(() => {
      activeTimers.delete(id);
      console.log(`[TIMER #${id}] Done!`);
    }, secs * 1000);
    activeTimers.set(id, { secs, ends: Date.now() + secs * 1000, timeout });
    return `✓ Timer #${id} for ${secs}s`;
  }
  if (cmd === "list") {
    if (!activeTimers.size) return "No active timers.";
    return [...activeTimers.entries()]
      .map(
        ([id, t]) =>
          `#${id}: ${Math.max(0, Math.ceil((t.ends - Date.now()) / 1000))}s left`,
      )
      .join("\n");
  }
  if (cmd === "cancel") {
    const id = parseInt(parts[1]);
    const t = activeTimers.get(id);
    if (!t) return `Timer #${id} not found.`;
    clearTimeout(t.timeout);
    activeTimers.delete(id);
    return `✓ Cancelled #${id}`;
  }
  return "/timer start <s>|list|cancel <id>";
}

/* ============================================================
   SEARCH — returns URLs
   ============================================================ */
async function runSearch(query = "") {
  if (!query.trim()) return "Usage: /search <query>";
  const enc = encodeURIComponent(query.trim());
  return `Search: "${query}"\n🦆 https://duckduckgo.com/?q=${enc}\n🔍 https://www.google.com/search?q=${enc}`;
}

/* ============================================================
   NEWS — newsdata.io
   ============================================================ */
async function runNews(topic = "technology") {
  const key = process.env.NEWSDATA_KEY;
  if (!key) return "NEWSDATA_KEY not set.";
  try {
    const res = await fetch(
      `https://newsdata.io/api/1/news?apikey=${key}&q=${encodeURIComponent(topic || "technology")}&language=en`,
    );
    const data = await res.json();
    if (!data.results?.length) return `No news for "${topic}".`;
    return data.results
      .slice(0, 5)
      .map((a, i) => `${i + 1}. **${a.title}**\n   ${a.link}`)
      .join("\n\n");
  } catch (e) {
    return `News error: ${e.message}`;
  }
}

/* ============================================================
   SYSTEM INFO
   ============================================================ */
async function runSystem() {
  const cpus = os.cpus();
  const total = (os.totalmem() / 1024 ** 3).toFixed(1);
  const free = (os.freemem() / 1024 ** 3).toFixed(1);
  return `**Server Info:**\nOS: ${os.type()} ${os.release()}\nCPU: ${cpus[0]?.model || "?"} × ${cpus.length}\nRAM: ${free}/${total} GB free\nUptime: ${(os.uptime() / 3600).toFixed(1)}h\nHost: ${os.hostname()}`;
}

/* ============================================================
   FILES — sandboxed
   ============================================================ */
async function runFiles() {
  return "File system access is sandboxed on Render.";
}

/* ============================================================
   WEB SCRAPE — fetch + strip HTML
   ============================================================ */
async function runScrape(url = "") {
  if (!url.trim()) return "Usage: /scrape <url>";
  try {
    const resp = await fetch(url.trim(), {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) return `HTTP ${resp.status}`;
    const html = await resp.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim()
      .slice(0, 4000);
    const title =
      html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() || url;
    return `**${title}**\n\n${text}…\n\n*Source: ${url}*`;
  } catch (e) {
    return `Scrape error: ${e.message}`;
  }
}

/* ============================================================
   GOOGLE CALENDAR
   ============================================================ */
async function getCalendarToken() {
  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  const d = await resp.json();
  return d.access_token;
}

async function runCalendarGet() {
  if (!process.env.GOOGLE_CLIENT_ID)
    return "Google Calendar not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN in Render.";
  try {
    const token = await getCalendarToken();
    const now = new Date().toISOString(),
      future = new Date(Date.now() + 7 * 86400000).toISOString();
    const resp = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${now}&timeMax=${future}&singleEvents=true&orderBy=startTime&maxResults=10`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const data = await resp.json();
    if (!data.items?.length) return "No upcoming events.";
    return (
      "**Upcoming events:**\n" +
      data.items
        .map((e) => {
          const d = new Date(e.start?.dateTime || e.start?.date).toLocaleString(
            "en-US",
            {
              weekday: "short",
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            },
          );
          return `📅 **${e.summary || "Untitled"}** — ${d}${e.location ? ` @ ${e.location}` : ""}`;
        })
        .join("\n")
    );
  } catch (e) {
    return `Calendar error: ${e.message}`;
  }
}

async function runCalendarAdd(input = "") {
  if (!process.env.GOOGLE_CLIENT_ID) return "Google Calendar not configured.";
  // Parse: "Title | 2025-01-15T14:00 | 2025-01-15T15:00"
  const parts = input.split("|").map((s) => s.trim());
  if (parts.length < 2)
    return "Usage: /calendar add Title | YYYY-MM-DDTHH:MM | YYYY-MM-DDTHH:MM";
  try {
    const token = await getCalendarToken();
    const event = {
      summary: parts[0],
      start: {
        dateTime: new Date(parts[1]).toISOString(),
        timeZone: "America/New_York",
      },
      end: {
        dateTime: new Date(parts[2] || parts[1]).toISOString(),
        timeZone: "America/New_York",
      },
    };
    const resp = await fetch(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(event),
      },
    );
    const data = await resp.json();
    return data.id
      ? `✓ Event created: **${data.summary}**`
      : `Error: ${JSON.stringify(data.error)}`;
  } catch (e) {
    return `Calendar add error: ${e.message}`;
  }
}

/* ============================================================
   IMAGE GENERATION
   ============================================================ */
async function runImagine(prompt = "") {
  if (!prompt.trim()) return "Usage: /imagine <prompt>";
  const dalleKey = process.env.OPENAI_KEY;
  if (dalleKey) {
    try {
      const resp = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${dalleKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "dall-e-3",
          prompt,
          n: 1,
          size: "1024x1024",
        }),
      });
      const data = await resp.json();
      if (data.data?.[0]?.url)
        return `__IMAGE__${data.data[0].url}__PROMPT__${prompt}`;
    } catch {}
  }
  // Pollinations fallback
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true&seed=${Date.now()}`;
  return `__IMAGE__${url}__PROMPT__${prompt}`;
}

/* ============================================================
   GOOGLE DOCS / DRIVE (read)
   ============================================================ */
async function runGoogleDocs(docId = "") {
  if (!process.env.GOOGLE_CLIENT_ID) return "Google not configured.";
  if (!docId.trim()) return "Usage: /gdoc <document-id>";
  try {
    const token = await getCalendarToken();
    const resp = await fetch(
      `https://docs.googleapis.com/v1/documents/${docId.trim()}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const data = await resp.json();
    if (!data.body) return `Error: ${JSON.stringify(data.error || data)}`;
    // Extract text
    const text = (data.body.content || [])
      .flatMap((s) =>
        (s.paragraph?.elements || []).map((e) => e.textRun?.content || ""),
      )
      .join("")
      .slice(0, 8000);
    return `**Doc: ${data.title}**\n\n${text}`;
  } catch (e) {
    return `Docs error: ${e.message}`;
  }
}

/* ============================================================
   CONVERT — common unit conversions
   ============================================================ */
async function runConvert(input = "") {
  if (!input?.trim()) {
    return "Usage: /convert 100 km to mi\nSupports: km/mi, m/ft, cm/in, kg/lb, g/oz, c/f, l/gal";
  }
  const m = input.match(/^([-\d.]+)\s*(\w+)\s*(?:to|in|->)\s*(\w+)$/i);
  if (!m) return 'Usage: /convert 100 km to mi  (e.g. "5 ft to cm")';
  const [, valStr, fromUnit, toUnit] = m;
  const val = parseFloat(valStr);
  const from = fromUnit.toLowerCase();
  const to = toUnit.toLowerCase();

  // All conversions go through a base unit per category
  const CONVERSIONS = {
    // length → meters
    length: { km: 1000, m: 1, cm: 0.01, mm: 0.001, mi: 1609.344, yd: 0.9144, ft: 0.3048, in: 0.0254 },
    // mass → grams
    mass: { kg: 1000, g: 1, mg: 0.001, lb: 453.592, oz: 28.3495 },
    // volume → liters
    volume: { l: 1, ml: 0.001, gal: 3.78541, qt: 0.946353, pt: 0.473176, cup: 0.236588, floz: 0.0295735, "fl oz": 0.0295735 },
    // temperature is special-cased below
  };

  // Temperature: special handling (not a linear factor)
  const tempUnits = ["c", "f", "k", "celsius", "fahrenheit", "kelvin"];
  const tempMap = { celsius: "c", fahrenheit: "f", kelvin: "k" };
  const fromT = tempMap[from] || from;
  const toT = tempMap[to] || to;
  if (tempUnits.includes(from) && tempUnits.includes(to)) {
    let celsius;
    if (fromT === "c") celsius = val;
    else if (fromT === "f") celsius = (val - 32) * (5 / 9);
    else if (fromT === "k") celsius = val - 273.15;
    let result;
    if (toT === "c") result = celsius;
    else if (toT === "f") result = celsius * (9 / 5) + 32;
    else if (toT === "k") result = celsius + 273.15;
    return `${val}°${fromT.toUpperCase()} = ${result.toFixed(2)}°${toT.toUpperCase()}`;
  }

  for (const [, units] of Object.entries(CONVERSIONS)) {
    if (units[from] != null && units[to] != null) {
      const result = (val * units[from]) / units[to];
      const rounded = Number.isInteger(result) ? result : parseFloat(result.toFixed(6));
      return `${val} ${from} = ${rounded} ${to}`;
    }
  }
  return `Couldn't convert ${from} → ${to}. Supported categories: length, mass, volume, temperature.`;
}

/* ============================================================
   EXPORTS — single runToolServer entry point
   ============================================================ */
export const TOOL_DEFINITIONS = {
  calc: { desc: "Calculator — /calc 2+sqrt(144)", fn: runCalc },
  convert: { desc: "Unit conversion — /convert 100 km to mi", fn: runConvert },
  time: { desc: "Current server time — /time", fn: runTime },
  weather: { desc: "Weather — /weather [lat,lon]", fn: runWeather },
  notes: { desc: "Notes — /notes add|list|delete|clear", fn: runNotes },
  todo: { desc: "Tasks — /todo add|list|done|delete", fn: runTodo },
  timer: { desc: "Timers — /timer start|list|cancel", fn: runTimer },
  search: { desc: "Search links — /search <query>", fn: runSearch },
  news: { desc: "Headlines — /news [topic]", fn: runNews },
  system: { desc: "Server info — /system", fn: runSystem },
  files: { desc: "File system (sandboxed) — /files", fn: runFiles },
  scrape: { desc: "Scrape a URL — /scrape <url>", fn: runScrape },
  calendar: { desc: "View calendar — /calendar", fn: runCalendarGet },
  "calendar add": {
    desc: "Add event — /calendar add Title | date | date",
    fn: runCalendarAdd,
  },
  imagine: { desc: "Generate image — /imagine <prompt>", fn: runImagine },
  gdoc: { desc: "Read Google Doc — /gdoc <doc-id>", fn: runGoogleDocs },
};

export async function runToolServer(toolName, input) {
  const key = toolName.toLowerCase().trim();
  const entry = TOOL_DEFINITIONS[key];
  if (!entry)
    return `Unknown tool: ${toolName}. Available: ${Object.keys(TOOL_DEFINITIONS).join(", ")}`;
  try {
    return await entry.fn(input);
  } catch (e) {
    return `Tool error (${toolName}): ${e.message}`;
  }
}
