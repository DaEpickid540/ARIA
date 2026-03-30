// memory.js — Memory Engine v3: auto-making, editing, reminders, project tracking

export let ariaMemory = { facts: [], projects: [], reminders: [], clipboard: [] };

/* ── LOAD / SAVE ── */
export function loadMemory() {
  try {
    const saved = localStorage.getItem("aria_memory_v3");
    if (saved) ariaMemory = { facts:[], projects:[], reminders:[], clipboard:[], ...JSON.parse(saved) };
  } catch { ariaMemory = { facts:[], projects:[], reminders:[], clipboard:[] }; }
}

export function saveMemory() {
  localStorage.setItem("aria_memory_v3", JSON.stringify(ariaMemory));
}

loadMemory();
setInterval(checkReminders, 60_000);

/* ── FACTS ── */
export function addManualMemory(text, category = "note") {
  const fact = { id: Date.now(), text, category, createdAt: Date.now(), source: "manual" };
  ariaMemory.facts.unshift(fact);
  saveMemory();
  renderMemoryPanel();
  // Sync to server
  fetch("/api/memory", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ facts: ariaMemory.facts }) }).catch(() => {});
}

export function autoRememberFact(text, category = "auto") {
  // Dedup check
  const exists = ariaMemory.facts.some(f => f.text.toLowerCase() === text.toLowerCase());
  if (!exists) {
    ariaMemory.facts.unshift({ id: Date.now(), text, category, createdAt: Date.now(), source: "auto" });
    if (ariaMemory.facts.length > 200) ariaMemory.facts = ariaMemory.facts.slice(0, 200);
    saveMemory();
  }
}

export function deleteMemoryFact(id) {
  ariaMemory.facts = ariaMemory.facts.filter(f => f.id !== id);
  saveMemory();
  renderMemoryPanel();
}

export function editMemoryFact(id, newText) {
  const fact = ariaMemory.facts.find(f => f.id === id);
  if (fact) { fact.text = newText; fact.editedAt = Date.now(); saveMemory(); renderMemoryPanel(); }
}

export function clearAllMemory() {
  ariaMemory = { facts:[], projects:[], reminders:[], clipboard: ariaMemory.clipboard || [] };
  saveMemory();
  renderMemoryPanel();
  fetch("/api/memory", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ facts: [] }) }).catch(() => {});
}

/* ── PROJECTS ── */
export function addProject(name, description = "") {
  ariaMemory.projects.push({ id: Date.now(), name, description, files: [], createdAt: Date.now(), lastUpdated: Date.now() });
  saveMemory();
}

export function updateProject(id, updates) {
  const p = ariaMemory.projects.find(p => p.id === id);
  if (p) { Object.assign(p, updates, { lastUpdated: Date.now() }); saveMemory(); }
}

export function getProjects() { return ariaMemory.projects; }

/* ── REMINDERS ── */
export function addReminder(text, isoDate) {
  ariaMemory.reminders.push({ id: Date.now(), text, dueAt: new Date(isoDate).getTime(), fired: false });
  saveMemory();
}

function checkReminders() {
  const now = Date.now();
  ariaMemory.reminders.forEach(r => {
    if (!r.fired && r.dueAt <= now) {
      r.fired = true;
      saveMemory();
      window.ARIA_showNotification?.("⏰ Reminder: " + r.text, 6000);
      if (window.ARIA_addAIMessage) window.ARIA_addAIMessage("⏰ **Reminder:** " + r.text);
    }
  });
}

/* ── CLIPBOARD HISTORY (last 10) ── */
export function addToClipboardHistory(text) {
  if (!text?.trim()) return;
  const existing = ariaMemory.clipboard || [];
  const deduped  = existing.filter(c => c.text !== text);
  ariaMemory.clipboard = [{ text, timestamp: Date.now() }, ...deduped].slice(0, 10);
  saveMemory();
}

export function getClipboardHistory() { return ariaMemory.clipboard || []; }

// Intercept clipboard writes
const origWrite = navigator.clipboard?.writeText?.bind(navigator.clipboard);
if (origWrite) {
  navigator.clipboard.writeText = async (text) => {
    addToClipboardHistory(text);
    return origWrite(text);
  };
}

/* ── CONTEXT STRING (sent to AI) ── */
export function buildMemoryContext() {
  const lines = [];
  if (ariaMemory.facts.length) {
    lines.push("\n[ARIA MEMORY — Known facts about this user:]");
    ariaMemory.facts.slice(0, 30).forEach(f => lines.push(`• [${f.category}] ${f.text}`));
  }
  if (ariaMemory.projects.length) {
    lines.push("\n[ACTIVE PROJECTS:]");
    ariaMemory.projects.slice(0, 5).forEach(p => lines.push(`• ${p.name}: ${p.description}`));
  }
  return lines.join("\n");
}

/* ── RENDER MEMORY PANEL (in settings) ── */
export function renderMemoryPanel() {
  const container = document.getElementById("memoryFactsList");
  if (!container) return;

  const cats = ["all","note","preference","skill","project","auto","reminder"];
  const filter = document.getElementById("memFilterCat")?.value || "all";
  const search = (document.getElementById("memSearchInput")?.value || "").toLowerCase();

  const visible = ariaMemory.facts.filter(f => {
    const matchCat  = filter === "all" || f.category === filter;
    const matchText = !search || f.text.toLowerCase().includes(search);
    return matchCat && matchText;
  });

  if (!visible.length) {
    container.innerHTML = `<div class="memEmpty">No memories yet — ARIA will remember things automatically as you chat, or add them manually above.</div>`;
    return;
  }

  container.innerHTML = visible.map(f => `
    <div class="memFactItem" data-id="${f.id}">
      <div class="memFactMeta">
        <span class="memFactCat">${f.category}</span>
        <span class="memFactSrc">${f.source === "auto" ? "auto" : "manual"}</span>
        <span class="memFactDate">${new Date(f.createdAt).toLocaleDateString()}</span>
      </div>
      <div class="memFactText" id="memText_${f.id}">${escapeHtml(f.text)}</div>
      <div class="memFactActions">
        <button class="memBtn memEditBtn" onclick="window.ARIA_editMemFact(${f.id})">✎ Edit</button>
        <button class="memBtn memDelBtn"  onclick="window.ARIA_deleteMemFact(${f.id})">✕ Delete</button>
      </div>
    </div>`).join("");

  // Clipboard history section
  const clips = getClipboardHistory();
  if (clips.length) {
    container.innerHTML += `<div class="memSectionHeader">📋 Clipboard History</div>` +
      clips.map((c,i) => `
        <div class="memFactItem">
          <div class="memFactText">${escapeHtml(c.text.slice(0,120))}${c.text.length>120?"…":""}</div>
          <div class="memFactActions">
            <button class="memBtn" onclick="navigator.clipboard.writeText(${JSON.stringify(c.text)})">Copy</button>
          </div>
        </div>`).join("");
  }
}

function escapeHtml(t) {
  return String(t).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

// Expose edit/delete globally for inline onclick
window.ARIA_editMemFact = (id) => {
  const fact = ariaMemory.facts.find(f => f.id === id);
  if (!fact) return;
  const newText = prompt("Edit memory:", fact.text);
  if (newText?.trim()) editMemoryFact(id, newText.trim());
};
window.ARIA_deleteMemFact = (id) => {
  if (confirm("Delete this memory?")) deleteMemoryFact(id);
};
