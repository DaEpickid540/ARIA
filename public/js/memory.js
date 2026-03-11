// memory.js — full persistent memory system

const MEMORY_KEY = "aria_long_memory";

/* ============================================================
   MEMORY STORE STRUCTURE
   {
     facts: [{ id, text, category, timestamp, pinned }],
     userProfile: { name, preferences, notes },
     sessionNotes: []
   }
   ============================================================ */

let memoryStore = {
  facts: [],
  userProfile: { name: "", preferences: [], notes: "" },
  sessionNotes: [],
};

/* ============================================================
   LOAD / SAVE
   ============================================================ */
export function loadMemory() {
  try {
    const raw = localStorage.getItem(MEMORY_KEY);
    if (raw) memoryStore = { ...memoryStore, ...JSON.parse(raw) };
  } catch {
    memoryStore = {
      facts: [],
      userProfile: { name: "", preferences: [], notes: "" },
      sessionNotes: [],
    };
  }
}

export function saveMemory() {
  localStorage.setItem(MEMORY_KEY, JSON.stringify(memoryStore));
}

/* ============================================================
   FACT MANAGEMENT
   ============================================================ */
export function rememberFact(text, category = "general", pinned = false) {
  const id = "mem_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);
  const fact = {
    id,
    text: text.trim(),
    category,
    timestamp: Date.now(),
    pinned,
  };
  memoryStore.facts.push(fact);
  saveMemory();
  renderMemoryPanel();
  return fact;
}

export function forgetFact(id) {
  memoryStore.facts = memoryStore.facts.filter((f) => f.id !== id);
  saveMemory();
  renderMemoryPanel();
}

export function pinFact(id, pinned = true) {
  const fact = memoryStore.facts.find((f) => f.id === id);
  if (fact) {
    fact.pinned = pinned;
    saveMemory();
    renderMemoryPanel();
  }
}

export function getAllFacts() {
  return [...memoryStore.facts].sort(
    (a, b) =>
      (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.timestamp - a.timestamp,
  );
}

export function getFactsAsContext() {
  if (!memoryStore.facts.length) return "";
  const lines = memoryStore.facts.map((f) => `- ${f.text}`).join("\n");
  return `\n\n[MEMORY — things you know about the user:\n${lines}\n]`;
}

/* ============================================================
   USER PROFILE
   ============================================================ */
export function setUserName(name) {
  memoryStore.userProfile.name = name;
  saveMemory();
}

export function getUserName() {
  return memoryStore.userProfile.name || "";
}

/* ============================================================
   AUTO-DETECT FACTS FROM MESSAGES
   Call this on every user message.
   ============================================================ */
export function autoDetectFacts(text) {
  const patterns = [
    {
      re: /my name is ([a-z\s]+)/i,
      category: "identity",
      extract: (m) => `User's name is ${m[1].trim()}`,
    },
    {
      re: /i(?:'m| am) ([a-z\s]+) years old/i,
      category: "identity",
      extract: (m) => `User is ${m[1]} years old`,
    },
    {
      re: /i(?:'m| am) a ([a-z\s]+)/i,
      category: "identity",
      extract: (m) => `User is a ${m[1].trim()}`,
    },
    {
      re: /i like ([a-z\s,]+)/i,
      category: "preference",
      extract: (m) => `User likes ${m[1].trim()}`,
    },
    {
      re: /i love ([a-z\s,]+)/i,
      category: "preference",
      extract: (m) => `User loves ${m[1].trim()}`,
    },
    {
      re: /i hate ([a-z\s,]+)/i,
      category: "preference",
      extract: (m) => `User hates ${m[1].trim()}`,
    },
    {
      re: /i prefer ([a-z\s,]+)/i,
      category: "preference",
      extract: (m) => `User prefers ${m[1].trim()}`,
    },
    {
      re: /my favorite ([a-z\s]+) is ([a-z\s]+)/i,
      category: "preference",
      extract: (m) => `User's favorite ${m[1]} is ${m[2].trim()}`,
    },
    {
      re: /i(?:'m| am) from ([a-z\s,]+)/i,
      category: "location",
      extract: (m) => `User is from ${m[1].trim()}`,
    },
    {
      re: /i live in ([a-z\s,]+)/i,
      category: "location",
      extract: (m) => `User lives in ${m[1].trim()}`,
    },
    {
      re: /i work (?:at|for|as) ([a-z\s,]+)/i,
      category: "work",
      extract: (m) => `User works ${m[0].replace(/^i work /i, "").trim()}`,
    },
    {
      re: /i(?:'m| am) studying ([a-z\s,]+)/i,
      category: "education",
      extract: (m) => `User studies ${m[1].trim()}`,
    },
    {
      re: /remember (?:that )?(.+)/i,
      category: "note",
      extract: (m) => m[1].trim(),
    },
  ];

  for (const p of patterns) {
    const match = text.match(p.re);
    if (match) {
      const factText = p.extract(match);
      // Avoid duplicates
      const exists = memoryStore.facts.some(
        (f) => f.text.toLowerCase() === factText.toLowerCase(),
      );
      if (!exists) {
        rememberFact(factText, p.category);
        return factText;
      }
    }
  }
  return null;
}

/* ============================================================
   RENDER MEMORY PANEL (in settings sidebar)
   ============================================================ */
export function renderMemoryPanel() {
  const container = document.getElementById("memoryFactsList");
  if (!container) return;

  const facts = getAllFacts();

  if (!facts.length) {
    container.innerHTML = `<div class="memEmpty">No memories stored yet. ARIA will learn as you chat.</div>`;
    return;
  }

  container.innerHTML = facts
    .map(
      (f) => `
    <div class="memFact ${f.pinned ? "pinned" : ""}" data-id="${f.id}">
      <span class="memCategory">${f.category}</span>
      <span class="memText">${f.text}</span>
      <div class="memActions">
        <button class="memPin" onclick="window.ARIA_pinFact('${f.id}', ${!f.pinned})" title="${f.pinned ? "Unpin" : "Pin"}">
          ${f.pinned ? "📌" : "📍"}
        </button>
        <button class="memDelete" onclick="window.ARIA_forgetFact('${f.id}')" title="Forget">✕</button>
      </div>
    </div>
  `,
    )
    .join("");
}

/* Expose for inline HTML handlers */
window.ARIA_forgetFact = forgetFact;
window.ARIA_pinFact = pinFact;

/* ============================================================
   MANUAL MEMORY ADD (from settings panel)
   ============================================================ */
export function addManualMemory(text, category = "note") {
  if (!text.trim()) return;
  rememberFact(text.trim(), category);
}

/* ============================================================
   CLEAR ALL MEMORY
   ============================================================ */
export function clearAllMemory() {
  memoryStore.facts = [];
  memoryStore.sessionNotes = [];
  saveMemory();
  renderMemoryPanel();
}

// Init on load
loadMemory();
