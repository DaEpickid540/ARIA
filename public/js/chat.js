import { speak, ttsEnabled } from "./tts.js";
import { loadSettings } from "./personality.js";
import { runTool } from "./tools.js";

/* ── STATE ── */
let chats = [];
let currentChatId = null;
let currentSettings = loadSettings();
let isGenerating = false;
let documentContext = "";
let mathMode = false;
let programmingMode = false;
let studyMode = false;
let thinkingMode = false;
let pendingFiles = [];
let thinkDeeper = false;
let musicTutorMode = false;
let previewActive = false;
let workspaceRepoUrl = "";

const newChatBtn = document.getElementById("newChatBtn");
const sendBtn = document.getElementById("sendBtn");
const userInput = document.getElementById("userInput");
const messages = document.getElementById("messages");
const chatList = document.getElementById("chatList");
const layout = document.getElementById("layout");

/* ── LOAD ── */
try {
  const saved = localStorage.getItem("aria_chats");
  if (saved) {
    chats = JSON.parse(saved);
    if (chats.length) currentChatId = chats[0].id;
  }
} catch {
  chats = [];
}
if (!currentChatId) createNewChat();
renderChatList();
renderMessages();
loadFromServer();

// ── Expose current chat ID for cross-module access (chatExport etc.) ──
// Updated whenever the active chat changes
Object.defineProperty(window, "ARIA_currentChatId", {
  get: () => currentChatId,
  configurable: true,
});

/* ============================================================
   HALO EFFECTS
   ============================================================ */
const halo = document.getElementById("ariaHalo");
let haloTimer = null;

function triggerHalo(type, durationMs = 0) {
  const s = loadSettings();
  if (s.haloEffects === false) return;
  const intensity = s.haloIntensity ?? 0.5;
  if (!halo) return;
  halo.className = "";
  void halo.offsetWidth;
  halo.classList.add(type);
  halo.style.setProperty("--halo-intensity", intensity);
  if (durationMs > 0) {
    clearTimeout(haloTimer);
    haloTimer = setTimeout(() => {
      if (halo) halo.className = "";
    }, durationMs);
  }
}
function clearHalo() {
  if (halo) halo.className = "";
  clearTimeout(haloTimer);
}
window.ARIA_triggerHalo = triggerHalo;
window.ARIA_clearHalo = clearHalo;

// Wire halo intensity slider
document.getElementById("haloIntensity")?.addEventListener("input", (e) => {
  const s = loadSettings();
  s.haloIntensity = parseFloat(e.target.value);
  import("./personality.js").then((m) => m.saveSettings?.(s));
  triggerHalo("pulse", 800);
});
document
  .getElementById("toggle_haloEffects")
  ?.addEventListener("click", (e) => {
    const btn = e.currentTarget;
    const on = btn.textContent.trim() === "ON";
    btn.textContent = on ? "OFF" : "ON";
    btn.classList.toggle("active", !on);
    const s = loadSettings();
    s.haloEffects = !on;
    import("./personality.js").then((m) => m.saveSettings?.(s));
    if (!on) triggerHalo("pulse", 700);
  });

/* ============================================================
   CODE PANEL — side by side with chat
   ============================================================ */
const codePanelEl = document.getElementById("codePanel");
const codePanelCode = document.getElementById("codePanelCode");
const codePanelLang = document.getElementById("codePanelLang");
const codePanelCopy = document.getElementById("codePanelCopyBtn");
const codePanelDl = document.getElementById("codePanelDownloadBtn");
const codePanelClose = document.getElementById("codePanelCloseBtn");

let currentCodeContent = "";
let currentCodeLang = "";

function openCodePanel(code, lang) {
  currentCodeContent = code;
  currentCodeLang = lang || "code";
  previewActive = false;
  if (codePanelCode) codePanelCode.textContent = code;
  if (codePanelLang) codePanelLang.textContent = (lang || "CODE").toUpperCase();

  const pre = document.getElementById("codePanelContent");
  const frame = document.getElementById("codePanelPreviewFrame");
  const prevBtn = document.getElementById("codePanelPreviewBtn");
  if (pre) pre.style.display = "";
  if (frame) {
    frame.style.display = "none";
    frame.srcdoc = "";
  }
  if (prevBtn) {
    const isHTML = ["html", "htm", "svg"].includes((lang || "").toLowerCase());
    prevBtn.style.display = isHTML ? "" : "none";
    prevBtn.textContent = "🖥 Preview";
  }
  codePanelEl?.classList.add("open");
  layout?.classList.add("code-split");
  window.ARIA_collapseSidebar?.();
}
function closeCodePanel() {
  codePanelEl?.classList.remove("open");
  layout?.classList.remove("code-split");
  window.ARIA_expandSidebar?.();
}

codePanelCopy?.addEventListener("click", () => {
  navigator.clipboard?.writeText(currentCodeContent);
  if (codePanelCopy) {
    codePanelCopy.textContent = "✓ Copied!";
    setTimeout(() => (codePanelCopy.textContent = "⎘ Copy"), 1500);
  }
});
codePanelDl?.addEventListener("click", () => {
  const extMap = {
    javascript: "js",
    typescript: "ts",
    python: "py",
    html: "html",
    css: "css",
    json: "json",
    bash: "sh",
    shell: "sh",
    java: "java",
    cpp: "cpp",
    c: "c",
    rust: "rs",
  };
  const ext = extMap[currentCodeLang] || currentCodeLang || "txt";
  downloadText(currentCodeContent, `aria-code.${ext}`);
});
codePanelClose?.addEventListener("click", closeCodePanel);

document
  .getElementById("codePanelPreviewBtn")
  ?.addEventListener("click", () => {
    const pre = document.getElementById("codePanelContent");
    const frame = document.getElementById("codePanelPreviewFrame");
    const btn = document.getElementById("codePanelPreviewBtn");
    if (!frame) return;
    previewActive = !previewActive;
    if (previewActive) {
      frame.srcdoc = currentCodeContent;
      frame.style.display = "flex";
      if (pre) pre.style.display = "none";
      if (btn) btn.textContent = "< Code";
    } else {
      frame.style.display = "none";
      if (pre) pre.style.display = "";
      if (btn) btn.textContent = "🖥 Preview";
    }
  });

window.ARIA_openCodePanel = openCodePanel;
window.ARIA_closeCodePanel = closeCodePanel;

function downloadText(content, filename) {
  const blob = new Blob([content], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
window.ARIA_downloadCode = downloadText;

/* ============================================================
   TOOLS DROPDOWN (sidebar)
   Each tool uses the SAME chat box — no separate messages
   ============================================================ */
const toolsDropBtn = document.getElementById("toolsDropdownBtn");
const toolsDropMenu = document.getElementById("toolsDropdown");

toolsDropBtn?.addEventListener("click", (e) => {
  e.stopPropagation();
  const open = toolsDropMenu?.style.display !== "none";
  if (toolsDropMenu) toolsDropMenu.style.display = open ? "none" : "block";
  toolsDropBtn.classList.toggle("active", !open);
  triggerHalo("pulse", 600);
});
document.addEventListener("click", () => {
  if (toolsDropMenu) toolsDropMenu.style.display = "none";
  toolsDropBtn?.classList.remove("active");
});

// Tool dropdown item actions — trigger the hidden buttons
function toolAction(id) {
  document.getElementById(id)?.click();
  if (toolsDropMenu) toolsDropMenu.style.display = "none";
  toolsDropBtn?.classList.remove("active");
}
document
  .getElementById("tool_math")
  ?.addEventListener("click", () => toolAction("mathModeBtn"));
document
  .getElementById("tool_code")
  ?.addEventListener("click", () => toolAction("codeAssistBtn"));
document
  .getElementById("tool_study")
  ?.addEventListener("click", () => toolAction("studyModeBtn"));
document
  .getElementById("tool_think")
  ?.addEventListener("click", () => toolAction("thinkingBtn"));
document.getElementById("tool_commands")?.addEventListener("click", () => {
  toolAction("commandsBtn");
});

// Web search — prompt user in the textarea
document.getElementById("tool_search")?.addEventListener("click", () => {
  if (toolsDropMenu) toolsDropMenu.style.display = "none";
  promptToolInput(
    "🔍 Web Search — type your query in the box and press Send to search:",
  );
});

// Image generation — prompt user
document.getElementById("tool_imagine")?.addEventListener("click", () => {
  if (toolsDropMenu) toolsDropMenu.style.display = "none";
  promptToolInput(
    "🎨 Image Generation — describe the image you want and press Send:",
  );
});

// Calendar
document
  .getElementById("tool_calendar")
  ?.addEventListener("click", async () => {
    if (toolsDropMenu) toolsDropMenu.style.display = "none";
    await fetchAndShowCalendar();
  });

// Background task
document.getElementById("tool_bg")?.addEventListener("click", () => {
  if (toolsDropMenu) toolsDropMenu.style.display = "none";
  promptToolInput(
    "⚙ Background Task — describe what you want ARIA to do in the background:",
  );
});

function promptToolInput(hint) {
  setInputHint(hint);
  userInput?.focus();
}

function setInputHint(text) {
  if (!userInput) return;
  userInput.placeholder = text;
  setTimeout(() => {
    userInput.placeholder = "Message ARIA...";
  }, 8000);
}

/* ── MODE TOGGLE BUTTONS (hidden, triggered from dropdown) ── */
function wireMode(btnId, flagSetter, onMsg, offMsg) {
  document.getElementById(btnId)?.addEventListener("click", () => {
    flagSetter();
    renderChatList(); // update active indicator
    const isOn = flagSetter.isOn();
    addSystemMessage(isOn ? onMsg : offMsg);
    triggerHalo("pulse", 700);
  });
}

// Mode toggle logic — mutual exclusion for main modes
function toggleMath() {
  mathMode = !mathMode;
  if (mathMode) {
    programmingMode = false;
    studyMode = false;
  }
}
toggleMath.isOn = () => mathMode;
function toggleCode() {
  programmingMode = !programmingMode;
  if (programmingMode) {
    mathMode = false;
    studyMode = false;
  }
}
toggleCode.isOn = () => programmingMode;
function toggleStudy() {
  studyMode = !studyMode;
  if (studyMode) {
    mathMode = false;
    programmingMode = false;
  }
}
toggleStudy.isOn = () => studyMode;
function toggleThink() {
  thinkingMode = !thinkingMode;
}
toggleThink.isOn = () => thinkingMode;

wireMode(
  "mathModeBtn",
  toggleMath,
  "📐 **Math mode ON** — step-by-step working for every problem.",
  "Math mode off.",
);
wireMode(
  "codeAssistBtn",
  toggleCode,
  "💻 **Programming mode ON** — full runnable code with comments.",
  "Programming mode off.",
);
wireMode(
  "studyModeBtn",
  toggleStudy,
  "📚 **Study mode ON** — upload notes and I'll quiz you.",
  "Study mode off.",
);
wireMode(
  "thinkingBtn",
  toggleThink,
  "🧠 **Thinking mode ON** — ARIA will show her reasoning.",
  "Thinking mode off.",
);

// ── Think Deeper ──
document.getElementById("tool_deepthink")?.addEventListener("click", () => {
  thinkDeeper = !thinkDeeper;
  if (toolsDropMenu) toolsDropMenu.style.display = "none";
  toolsDropBtn?.classList.remove("active");
  showChatNotification(thinkDeeper ? "🔬 Think Deeper ON" : "Think Deeper off");
  triggerHalo("pulse", 800);
});

// ── Music Tutor ──
document.getElementById("tool_music")?.addEventListener("click", () => {
  musicTutorMode = !musicTutorMode;
  if (toolsDropMenu) toolsDropMenu.style.display = "none";
  toolsDropBtn?.classList.remove("active");
  showChatNotification(
    musicTutorMode ? "🎵 Music Tutor ON" : "Music Tutor off",
  );
  if (musicTutorMode) showMusicPanel();
  else hideMusicPanel();
  triggerHalo("pulse", 800);
});

// ── Workspace / Repo ──
document.getElementById("tool_workspace")?.addEventListener("click", () => {
  if (toolsDropMenu) toolsDropMenu.style.display = "none";
  const url = prompt(
    "Enter GitHub repo URL (e.g. https://github.com/user/repo):",
  );
  if (url?.trim()) {
    workspaceRepoUrl = url.trim();
    showChatNotification(
      "🗂 Workspace: " + workspaceRepoUrl.split("/").slice(-1)[0],
    );
    addSystemMessage(
      "🗂 **Workspace mode** — repo loaded: `" +
        workspaceRepoUrl +
        "`. Ask me to read files, suggest improvements, or generate new ones.",
    );
  }
});

/* ── WEB SEARCH button (hidden — triggered by slash cmd or AI) ── */
document.getElementById("webSearchBtn")?.addEventListener("click", async () => {
  const q = userInput?.value.trim();
  if (!q) return;
  await doWebSearch(q);
});

async function doWebSearch(q) {
  const chat = getCurrentChat();
  if (!chat) return;
  // Add user query + searching status in ONE message thread
  chat.messages.push({
    role: "user",
    content: `🔍 Search: ${q}`,
    timestamp: Date.now(),
  });
  saveChats();
  renderMessages();
  // Show typing
  const tid = showTypingIndicator();
  try {
    const res = await fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: q }),
    });
    const data = await res.json();
    removeTypingIndicator(tid);
    if (data.error) {
      addAIMessage(`Search error: ${data.error}`);
      return;
    }
    const txt = (data.results || [])
      .map((r, i) => `**${i + 1}. [${r.title}](${r.url})**\n${r.snippet || ""}`)
      .join("\n\n");
    addAIMessage(`**Search results for "${q}":**\n\n${txt}`);
  } catch (e) {
    removeTypingIndicator(tid);
    addAIMessage(`Search error: ${e.message}`);
  }
}

/* ── IMAGE GEN button (hidden) ── */
document.getElementById("imagineBtn")?.addEventListener("click", async () => {
  const prompt = userInput?.value.trim();
  if (!prompt) return;
  await doImagine(prompt);
});

async function doImagine(prompt) {
  const chat = getCurrentChat();
  if (!chat) return;
  chat.messages.push({
    role: "user",
    content: `🎨 Generate image: ${prompt}`,
    timestamp: Date.now(),
  });
  saveChats();
  renderMessages();
  const tid = showTypingIndicator();
  try {
    const res = await fetch("/api/imagine", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });
    const data = await res.json();
    removeTypingIndicator(tid);
    if (data.error) {
      addAIMessage(`Image error: ${data.error}`);
      return;
    }
    // Add image + download link in SAME conversation
    const chat2 = getCurrentChat();
    if (chat2) {
      chat2.messages.push({
        role: "aria",
        type: "image",
        imageUrl: data.url,
        content: `Generated: ${prompt}`,
        prompt,
        timestamp: Date.now(),
      });
      saveChats();
      renderMessages();
    }
  } catch (e) {
    removeTypingIndicator(tid);
    addAIMessage(`Image error: ${e.message}`);
  }
}

/* ── CALENDAR ── */
document
  .getElementById("calendarBtn")
  ?.addEventListener("click", fetchAndShowCalendar);

async function fetchAndShowCalendar() {
  const chat = getCurrentChat();
  if (!chat) return;
  const tid = showTypingIndicator();
  try {
    const res = await fetch("/api/calendar/events");
    const data = await res.json();
    removeTypingIndicator(tid);
    if (data.error) {
      addAIMessage(`Calendar: ${data.error}`);
      return;
    }
    if (!data.events?.length) {
      addAIMessage("No upcoming events in the next 7 days.");
      return;
    }
    addAIMessage(
      "**📅 Upcoming events:**\n\n" +
        data.events
          .map((e) => {
            const d = new Date(e.start).toLocaleString("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            });
            return `📅 **${e.title}** — ${d}${e.location ? ` @ ${e.location}` : ""}`;
          })
          .join("\n"),
    );
  } catch (e) {
    removeTypingIndicator(tid);
    addAIMessage(`Calendar error: ${e.message}`);
  }
}

/* ── BG TASK ── */
document.getElementById("bgTaskBtn")?.addEventListener("click", async () => {
  const task = userInput?.value.trim();
  if (!task) return;
  await doBgTask(task);
});

async function doBgTask(task) {
  const chat = getCurrentChat();
  if (!chat) return;
  chat.messages.push({
    role: "user",
    content: `⚙ Background task: ${task}`,
    timestamp: Date.now(),
  });
  userInput.value = "";
  userInput.style.height = "auto";
  saveChats();
  renderMessages();
  try {
    const cs = loadSettings();
    const res = await fetch("/api/background", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        task,
        provider: cs.provider || "openrouter",
        personality: cs.personality || "hacker",
      }),
    });
    const data = await res.json();
    if (data.error) {
      addAIMessage(`BG error: ${data.error}`);
      return;
    }
    addAIMessage(
      `⚙ Task \`${data.id}\` started — running in background. I'll show the result here when done.`,
    );
    const poll = setInterval(async () => {
      try {
        const r = await fetch(`/api/background/${data.id}`);
        const d = await r.json();
        if (d.status === "done") {
          clearInterval(poll);
          addAIMessage(`✅ **Task complete:**\n\n${d.result}`);
        } else if (d.status === "error") {
          clearInterval(poll);
          addAIMessage(`❌ Task failed: ${d.result}`);
        }
      } catch {}
    }, 3000);
  } catch (e) {
    addAIMessage(`BG error: ${e.message}`);
  }
}

/* ── COMMANDS MODAL ── */
document
  .getElementById("commandsBtn")
  ?.addEventListener("click", openCommandsModal);
document
  .getElementById("tool_commands")
  ?.addEventListener("click", openCommandsModal);
document.getElementById("commandsCloseBtn")?.addEventListener("click", () => {
  document.getElementById("commandsModal").style.display = "none";
});

async function openCommandsModal() {
  const modal = document.getElementById("commandsModal");
  const list = document.getElementById("commandsList");
  if (!modal || !list) return;
  const cmds = [
    { name: "/calc <expr>", desc: "Calculator — e.g. /calc sqrt(144)" },
    { name: "/time", desc: "Current server time" },
    { name: "/weather [lat,lon]", desc: "Weather (default: Mason OH)" },
    { name: "/notes add|list|delete", desc: "Session notes" },
    { name: "/todo add|list|done|delete", desc: "Task list" },
    { name: "/timer start|list|cancel", desc: "Countdown timers" },
    { name: "/search <query>", desc: "Web search" },
    { name: "/news [topic]", desc: "Latest headlines" },
    { name: "/system", desc: "Server info" },
    { name: "/scrape <url>", desc: "Extract text from webpage" },
    { name: "/imagine <desc>", desc: "Generate an image" },
    { name: "/calendar", desc: "View Google Calendar events" },
    { name: "/gdoc <doc-id>", desc: "Read a Google Doc" },
    { name: "/help", desc: "Show this list in chat" },
    { name: "∑ Math Mode", desc: "Step-by-step homework solver" },
    { name: "💻 Code Mode", desc: "Full runnable code with comments" },
    { name: "📚 Study Mode", desc: "Quiz from uploaded documents" },
    { name: "🧠 Thinking Mode", desc: "ARIA shows reasoning before answering" },
    { name: "🔍 Web Search", desc: "Type query → ARIA searches the web" },
    { name: "🎨 Generate Image", desc: "Type description → image generated" },
    { name: "📅 Calendar", desc: "Show upcoming events" },
    { name: "⚙ Background Task", desc: "Long tasks run in background" },
  ];
  list.innerHTML = cmds
    .map(
      (c) => `
    <div class="commandItem">
      <span class="commandName">${c.name}</span>
      <span class="commandDesc">${c.desc}</span>
    </div>`,
    )
    .join("");
  modal.style.display = "flex";
  triggerHalo("pulse", 600);
}

/* ── BG TASKS MODAL ── */
document
  .getElementById("bgTasksListBtn")
  ?.addEventListener("click", async () => {
    const modal = document.getElementById("bgTasksModal");
    const list = document.getElementById("bgTasksList");
    if (!modal || !list) return;
    try {
      const tasks = await (await fetch("/api/background")).json();
      list.innerHTML = !tasks.length
        ? "<div style='color:var(--text-muted);font-size:11px;padding:12px'>No background tasks yet.</div>"
        : tasks
            .map(
              (t) =>
                `<div class="bgTaskItem ${t.status}"><div style="color:var(--text-blaze);font-size:11px">${t.task}</div><div style="color:var(--text-muted);font-size:10px;margin-top:3px">${t.status.toUpperCase()} — ${new Date(t.started).toLocaleTimeString()}</div></div>`,
            )
            .join("");
    } catch {
      list.innerHTML =
        "<div style='color:#ff4444;padding:12px'>Error loading tasks.</div>";
    }
    modal.style.display = "flex";
  });
document.getElementById("bgTasksCloseBtn")?.addEventListener("click", () => {
  document.getElementById("bgTasksModal").style.display = "none";
});

/* ============================================================
   FILE UPLOAD — attach inside textarea
   ============================================================ */
document
  .getElementById("fileUploadBtn")
  ?.addEventListener("change", async (e) => {
    for (const file of Array.from(e.target.files || [])) {
      const fd = new FormData();
      fd.append("file", file);
      try {
        const res = await fetch("/api/upload", { method: "POST", body: fd });
        const data = await res.json();
        if (data.error) {
          addSystemMessage(`Upload failed: ${data.error}`);
          continue;
        }
        if (data.type === "image") {
          pendingFiles.push({
            type: "image",
            name: file.name,
            base64: data.base64,
            text: data.text,
          });
          documentContext += `\n[Image: ${file.name}]`;
        } else {
          pendingFiles.push({
            type: "document",
            name: file.name,
            text: data.text,
          });
          documentContext += `\n[Doc: ${file.name}]\n${data.text.slice(0, 2000)}`;
        }
        renderAttachPreviews();
      } catch (err) {
        addSystemMessage(`Upload error: ${err.message}`);
      }
    }
    e.target.value = "";
  });

function renderAttachPreviews() {
  const row = document.getElementById("attachPreviewRow");
  if (!row) return;
  if (!pendingFiles.length) {
    row.style.display = "none";
    row.innerHTML = "";
    return;
  }
  row.style.display = "flex";
  row.innerHTML = pendingFiles
    .map(
      (f, i) => `
    <div class="attachThumb" title="${f.name}">
      ${f.type === "image" ? `<img src="${f.base64}" alt="${f.name}">` : `<span>${f.name.slice(0, 8)}</span>`}
      <span class="attachRemove" onclick="window.ARIA_removeAttach(${i})">✕</span>
    </div>`,
    )
    .join("");
}
window.ARIA_removeAttach = (i) => {
  pendingFiles.splice(i, 1);
  if (!pendingFiles.length) documentContext = "";
  renderAttachPreviews();
};

/* ============================================================
   CHAT MANAGEMENT
   ============================================================ */
function createNewChat() {
  const id = "chat_" + Date.now();
  chats.unshift({ id, title: "New Chat", messages: [], createdAt: Date.now() });
  currentChatId = id;
  documentContext = "";
  pendingFiles = [];
  saveChats();
  syncToServer();
}
function getCurrentChat() {
  return chats.find((c) => c.id === currentChatId) || null;
}

export function deleteChat(chatId) {
  chats = chats.filter((c) => c.id !== chatId);
  if (currentChatId === chatId) {
    currentChatId = chats.length ? chats[0].id : null;
    if (!currentChatId) createNewChat();
  }
  saveChats();
  syncToServer();
  renderChatList();
  renderMessages();
}
export function clearAllChats() {
  chats = [];
  createNewChat();
  renderChatList();
  renderMessages();
}
export function renameChat(chatId) {
  const chat = chats.find((c) => c.id === chatId);
  if (!chat) return;
  const t = prompt("Rename:", chat.title);
  if (!t?.trim()) return;
  chat.title = t.trim().slice(0, 40);
  saveChats();
  syncToServer();
  renderChatList();
}
export function deleteMessage(chatId, idx) {
  const chat = chats.find((c) => c.id === chatId);
  if (!chat?.messages[idx]) return;
  chat.messages.splice(idx, 1);
  saveChats();
  renderMessages();
}
export function copyMessage(content) {
  navigator.clipboard?.writeText(content);
}
export function regenerateMessage(chatId, idx) {
  const chat = chats.find((c) => c.id === chatId);
  if (!chat) return;
  const um = [...chat.messages]
    .slice(0, idx)
    .reverse()
    .find((m) => m.role === "user");
  if (!um) return;
  chat.messages = chat.messages.slice(0, idx);
  saveChats();
  renderMessages();
  sendMessageContent(um.content, chat);
}

window.ARIA_deleteChat = deleteChat;
window.ARIA_clearAllChats = clearAllChats;
window.ARIA_renameChat = renameChat;
window.ARIA_deleteMessage = deleteMessage;
window.ARIA_copyMessage = copyMessage;
window.ARIA_regenerateMsg = regenerateMessage;
window.ARIA_renderChatList = renderChatList;
window.ARIA_loadFromServer = loadFromServer;

newChatBtn?.addEventListener("click", () => {
  createNewChat();
  renderChatList();
  renderMessages();
  closeCodePanel();
  window.ARIA_closeSidebar?.();
});
sendBtn?.addEventListener("click", sendMessage);
userInput?.addEventListener("keydown", (e) => {
  currentSettings = loadSettings();
  if (
    e.key === "Enter" &&
    !e.shiftKey &&
    currentSettings.sendOnEnter !== false
  ) {
    e.preventDefault();
    sendMessage();
  }
});
userInput?.addEventListener("input", () => {
  userInput.style.height = "auto";
  userInput.style.height = Math.min(userInput.scrollHeight, 120) + "px";
});

/* ── DRAG & DROP into textarea (files and image URLs) ── */
const _dndWrap = document.getElementById("textareaWrap");
if (_dndWrap) {
  _dndWrap.addEventListener("dragover", (e) => {
    e.preventDefault();
    _dndWrap.classList.add("drag-over");
  });
  _dndWrap.addEventListener("dragleave", () =>
    _dndWrap.classList.remove("drag-over"),
  );
  _dndWrap.addEventListener("drop", async (e) => {
    e.preventDefault();
    _dndWrap.classList.remove("drag-over");
    const files = Array.from(e.dataTransfer.files || []);
    const imgUrl =
      e.dataTransfer.getData("text/uri-list") ||
      e.dataTransfer.getData("text/plain");
    for (const file of files) {
      const fd = new FormData();
      fd.append("file", file);
      try {
        const res = await fetch("/api/upload", { method: "POST", body: fd });
        const data = await res.json();
        if (data.type === "image") {
          pendingFiles.push({
            type: "image",
            name: file.name,
            base64: data.base64,
            text: data.text,
          });
          documentContext += "\n[Image: " + file.name + "]";
        } else if (data.text) {
          pendingFiles.push({
            type: "document",
            name: file.name,
            text: data.text,
          });
          documentContext += "\n[Doc: " + file.name + "]";
        }
        renderAttachPreviews();
      } catch {}
    }
    if (!files.length && imgUrl && imgUrl.startsWith("http")) {
      if (userInput) userInput.value += (userInput.value ? " " : "") + imgUrl;
    }
  });
}

/* ============================================================
   RENDER CHAT LIST
   ============================================================ */
function renderChatList() {
  if (!chatList) return;
  chatList.innerHTML = "";
  chats.forEach((chat) => {
    const row = document.createElement("div");
    row.className = "chatRow" + (chat.id === currentChatId ? " active" : "");
    const btn = document.createElement("button");
    btn.className = "chatItem" + (chat.id === currentChatId ? " active" : "");
    btn.textContent = chat.title || "Untitled";
    btn.title = chat.title;
    btn.onclick = () => {
      currentChatId = chat.id;
      renderChatList();
      renderMessages();
      window.ARIA_closeSidebar?.();
    };
    const rBtn = document.createElement("button");
    rBtn.className = "chatActionBtn chatRenameBtn";
    rBtn.title = "Rename";
    rBtn.textContent = "✎";
    rBtn.onclick = (e) => {
      e.stopPropagation();
      renameChat(chat.id);
    };
    const dBtn = document.createElement("button");
    dBtn.className = "chatActionBtn chatDeleteBtn";
    dBtn.title = "Delete";
    dBtn.textContent = "✕";
    dBtn.onclick = (e) => {
      e.stopPropagation();
      if (confirm(`Delete "${chat.title}"?`)) deleteChat(chat.id);
    };
    row.appendChild(btn);
    row.appendChild(rBtn);
    row.appendChild(dBtn);
    chatList.appendChild(row);
  });
}

/* ============================================================
   RENDER MESSAGES
   ============================================================ */
function renderMessages() {
  if (!messages) return;
  messages.innerHTML = "";
  const chat = getCurrentChat();
  if (!chat) return;

  chat.messages.forEach((msg, idx) => {
    const div = document.createElement("div");
    div.classList.add("msg", msg.role);

    let bodyHTML;
    if (msg.type === "image" && msg.imageUrl) {
      bodyHTML = `<div class="msgImageWrap">
        <img src="${msg.imageUrl}" alt="Generated" class="msgImage" onclick="window.open('${msg.imageUrl}','_blank')">
        <div class="imgActions">
          <a href="${msg.imageUrl}" download="aria-image.png" class="fileDownloadBtn">⬇ Download Image</a>
        </div>
      </div>`;
    } else if (msg.role === "user") {
      const thumbs = (msg.attachments || [])
        .map((a) =>
          a.type === "image"
            ? `<div class="msgAttachThumb"><img src="${a.base64}" alt="${a.name}"></div>`
            : `<div class="msgAttachThumb docThumb">${a.name.slice(0, 10)}</div>`,
        )
        .join("");
      bodyHTML = `${thumbs ? `<div class="msgAttachments">${thumbs}</div>` : ""}
        <p class="userPara">${escapeHtml(msg.content).replace(/\n/g, "<br>")}</p>`;
    } else {
      bodyHTML = renderMarkdown(msg.content);
      // Append download links for any code blocks
      const codeMatches = [
        ...msg.content.matchAll(/```(\w*)\n?([\s\S]*?)```/g),
      ];
      if (codeMatches.length) {
        const extMap = {
          javascript: "js",
          typescript: "ts",
          python: "py",
          html: "html",
          css: "css",
          json: "json",
          bash: "sh",
          shell: "sh",
        };
        const dlLinks = codeMatches
          .map((m, i) => {
            const lang = m[1] || "txt";
            const ext = extMap[lang] || lang || "txt";
            const enc = encodeURIComponent(m[2].trim());
            return `<button class="fileDownloadBtn" onclick="window.ARIA_downloadCode(decodeURIComponent('${enc}'),'aria-code-${i + 1}.${ext}')">⬇ Download .${ext}</button>`;
          })
          .join(" ");
        bodyHTML += `<div class="codeDownloadRow">${dlLinks}</div>`;
      }
    }

    const time = new Date(msg.timestamp).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    const isAria = msg.role === "aria";
    div.innerHTML = `
      <div class="msgHeader">
        <div class="msgSender">${msg.role === "user" ? "YOU" : "ARIA"}</div>
        <div class="msgMeta">
          <span class="msgTimestamp">${time}</span>
          <button class="msgActionBtn msgCopyBtn" title="Copy" onclick="window.ARIA_copyMessage(${JSON.stringify(msg.content)})">⎘</button>
          ${isAria ? `<button class="msgActionBtn msgRegenBtn" title="Regenerate" onclick="window.ARIA_regenerateMsg('${chat.id}',${idx})">↺</button>` : ""}
          <button class="msgActionBtn msgDeleteBtn" title="Delete" onclick="window.ARIA_deleteMessage('${chat.id}',${idx})">✕</button>
        </div>
      </div>
      <div class="msgBody">${bodyHTML}</div>`;
    messages.appendChild(div);
  });

  // Wire code panel buttons
  messages.querySelectorAll(".codePanelBtn").forEach((btn) => {
    btn.addEventListener("click", () =>
      openCodePanel(decodeURIComponent(btn.dataset.code), btn.dataset.lang),
    );
  });

  if (isGenerating) {
    const stop = document.createElement("div");
    stop.id = "stopGenBtn";
    stop.innerHTML = `<button onclick="window.ARIA_stopGeneration?.()">⏹ Stop generating</button>`;
    messages.appendChild(stop);
  }

  messages.scrollTop = messages.scrollHeight;
}

/* ── CHAT NOTIFICATION ── */
let _notifT = null;
function showChatNotification(text, ms = 3000) {
  const el = document.getElementById("chatNotification");
  if (!el) return;
  el.textContent = text.replace(/\*\*/g, "");
  el.classList.add("visible");
  clearTimeout(_notifT);
  _notifT = setTimeout(() => el.classList.remove("visible"), ms);
}
window.ARIA_showNotification = showChatNotification;

/* ── INSERT MATH / SYMBOL into textarea ── */
window.insertMath = function (sym) {
  const inp = document.getElementById("userInput");
  if (!inp) return;
  const s = inp.selectionStart ?? inp.value.length;
  const e = inp.selectionEnd ?? s;
  inp.value = inp.value.slice(0, s) + sym + inp.value.slice(e);
  inp.selectionStart = inp.selectionEnd = s + sym.length;
  inp.focus();
  inp.dispatchEvent(new Event("input"));
};

/* ── MATH KEYBOARD PANEL (right-side, full calc layout) ── */
function showMathPanel() {
  let p = document.getElementById("mathPanel");
  if (!p) {
    p = document.createElement("div");
    p.id = "mathPanel";
    p.innerHTML = buildMathPanelHTML();
    document.body.appendChild(p);
  }
  requestAnimationFrame(() => {
    p.classList.add("open");
    document.body.classList.add("mathPanelOpen");
  });
}
function hideMathPanel() {
  const p = document.getElementById("mathPanel");
  if (p) p.classList.remove("open");
  document.body.classList.remove("mathPanelOpen");
}
window.ARIA_hideMathPanel = hideMathPanel;

function buildMathPanelHTML() {
  const INS = {
    sin: "sin()",
    cos: "cos()",
    tan: "tan()",
    csc: "csc()",
    sec: "sec()",
    cot: "cot()",
    "sin⁻¹": "sin⁻¹()",
    "cos⁻¹": "cos⁻¹()",
    "tan⁻¹": "tan⁻¹()",
    sinh: "sinh()",
    cosh: "cosh()",
    tanh: "tanh()",
    log: "log()",
    ln: "ln()",
    "log₂": "log₂()",
    logₙ: "logₙ()",
    "( )": "()",
    "√()": "√()",
    "a/b": "a/b",
    "a/bc": "(a+b)/c",
    GRAPH: "GRAPH: y = ",
    TABLE: "TABLE: x | y\n",
    WINDOW: "WINDOW: x[-10,10] y[-10,10]",
    "|x|": "|x|",
    "x²": "x²",
    "x³": "x³",
    xⁿ: "x^n",
  };
  const secs = [
    {
      l: "NUMBERS",
      k: [
        "7",
        "8",
        "9",
        "÷",
        "4",
        "5",
        "6",
        "×",
        "1",
        "2",
        "3",
        "-",
        "0",
        ".",
        "( )",
        "+",
      ],
    },
    {
      l: "POWERS / √",
      k: [
        "x²",
        "x³",
        "xⁿ",
        "√()",
        "∛",
        "∜",
        "e^",
        "10^",
        "log",
        "ln",
        "log₂",
        "logₙ",
      ],
    },
    {
      l: "ALGEBRA",
      k: [
        "x",
        "y",
        "z",
        "n",
        "a",
        "b",
        "=",
        "≠",
        "≈",
        "<",
        ">",
        "≤",
        "≥",
        "±",
        "|x|",
        "∞",
      ],
    },
    {
      l: "FRACTIONS",
      k: [
        "a/b",
        "a/bc",
        "1/x",
        "²/₃",
        "⁻¹",
        "→",
        "←",
        "∝",
        "∴",
        "∵",
        "⌊⌋",
        "⌈⌉",
      ],
    },
    {
      l: "TRIG",
      k: [
        "sin",
        "cos",
        "tan",
        "csc",
        "sec",
        "cot",
        "sin⁻¹",
        "cos⁻¹",
        "tan⁻¹",
        "sinh",
        "cosh",
        "tanh",
      ],
    },
    {
      l: "CALCULUS",
      k: [
        "d/dx",
        "∫",
        "∬",
        "∭",
        "∂",
        "dy/dx",
        "δ/δx",
        "Σ",
        "Π",
        "lim",
        "∇",
        "∮",
      ],
    },
    {
      l: "GREEK",
      k: [
        "α",
        "β",
        "γ",
        "δ",
        "ε",
        "θ",
        "λ",
        "μ",
        "π",
        "σ",
        "τ",
        "φ",
        "χ",
        "ψ",
        "ω",
        "Ω",
        "Δ",
        "Γ",
        "Λ",
        "Ξ",
        "Σ",
        "Φ",
        "Ψ",
      ],
    },
    {
      l: "SETS / LOGIC",
      k: [
        "∈",
        "∉",
        "⊆",
        "⊂",
        "⊃",
        "∪",
        "∩",
        "∅",
        "∀",
        "∃",
        "¬",
        "∧",
        "∨",
        "⊕",
        "⇒",
        "⟺",
      ],
    },
    {
      l: "STATS",
      k: ["x̄", "σ", "μ", "r", "r²", "P(", "C(", "n!", "Q₁", "Q₃", "IQR", "z="],
    },
    {
      l: "MATRIX",
      k: [
        "[  ]",
        "det(",
        "tr(",
        "⁻¹",
        "ᵀ",
        "·",
        "⊗",
        "dim",
        "rref",
        "rank",
        "‖v‖",
        "∑ᵢ",
      ],
    },
    {
      l: "TI-30 / GRAPH",
      k: [
        "y=",
        "GRAPH",
        "TABLE",
        "WINDOW",
        "ZOOM",
        "TRACE",
        "nCr",
        "nPr",
        "STAT",
        "LinReg",
        "STO→",
        "ANS",
      ],
    },
  ];

  const body = secs
    .map((sec) => {
      const keys = sec.k
        .map((k) => {
          const ins = (INS[k] !== undefined ? INS[k] : k)
            .replace(/\\/g, "\\\\")
            .replace(/'/g, "\\'");
          return `<button class="mathKey" onclick="window.insertMath('${ins}')">${k}</button>`;
        })
        .join("");
      return `<div class="mathSection"><div class="mathSectionLabel">${sec.l}</div><div class="mathKeyGrid">${keys}</div></div>`;
    })
    .join("");

  return `
    <div id="mathPanelHeader">
      <span>∑ MATH KEYBOARD</span>
      <div style="display:flex;gap:6px;align-items:center">
        <button onclick="window.insertMath('\\n')" title="New line">⏎</button>
        <button onclick="window.insertMath('  ')" title="Space">␣</button>
        <button onclick="window.ARIA_hideMathPanel()" title="Close">✕</button>
      </div>
    </div>
    <div id="mathPanelBody">${body}</div>`;
}

/* ── MUSIC TUTOR PANEL (right-side) ── */
function showMusicPanel() {
  let p = document.getElementById("musicPanel");
  if (!p) {
    p = document.createElement("div");
    p.id = "musicPanel";
    p.innerHTML = buildMusicPanelHTML();
    document.body.appendChild(p);
  }
  requestAnimationFrame(() => p.classList.add("open"));
}
function hideMusicPanel() {
  const p = document.getElementById("musicPanel");
  if (p) p.classList.remove("open");
}

function buildMusicPanelHTML() {
  const mk = (sym, label) =>
    `<button class="mathKey" onclick="window.insertMath('${sym}')">${label || sym}</button>`;
  return `
    <div id="musicPanelHeader">
      <span>🎵 MUSIC KEYBOARD</span>
      <button onclick="document.getElementById('musicPanel').classList.remove('open')">✕</button>
    </div>
    <div id="musicPanelBody">
      <div class="mathSection"><div class="mathSectionLabel">CLEF / NOTATION</div>
        <div class="mathKeyGrid">
          ${mk("𝄞", "Treble 𝄞")}${mk("𝄢", "Bass 𝄢")}${mk("𝄡", "Staff")}${mk("𝄀", "Bar |")}
          ${mk("♩", "♩ Quarter")}${mk("♪", "♪ 8th")}${mk("♫", "♫ Beam")}${mk("𝅗𝅥", "Half")}
          ${mk("𝅝", "Whole")}${mk("𝄽", "Rest")}${mk("𝄾", "8th Rest")}${mk("𝄿", "16th Rest")}
        </div>
      </div>
      <div class="mathSection"><div class="mathSectionLabel">ACCIDENTALS</div>
        <div class="mathKeyGrid">
          ${mk("♭", "♭ Flat")}${mk("♯", "♯ Sharp")}${mk("♮", "♮ Natural")}${mk("𝄪", "𝄪 Dbl#")}
          ${mk("𝄫", "𝄫 Dbl♭")}${mk("½♭", "Half♭")}${mk("½♯", "Half♯")}${mk("¾♯", "3/4♯")}
        </div>
      </div>
      <div class="mathSection"><div class="mathSectionLabel">NOTES (C-B)</div>
        <div class="mathKeyGrid">
          ${["C", "D", "E", "F", "G", "A", "B"].map((n) => mk(n)).join("")}
          ${["C#", "Db", "D#", "Eb", "F#", "Gb", "G#", "Ab", "A#", "Bb"].map((n) => mk(n)).join("")}
        </div>
      </div>
      <div class="mathSection"><div class="mathSectionLabel">INTERVALS (RCM)</div>
        <div class="mathKeyGrid">
          ${["Unison", "min 2nd", "Maj 2nd", "min 3rd", "Maj 3rd", "P4", "Aug 4th", "Dim 5th", "P5", "min 6th", "Maj 6th", "min 7th", "Maj 7th", "Octave"].map((n) => mk(n + " ")).join("")}
        </div>
      </div>
      <div class="mathSection"><div class="mathSectionLabel">DYNAMICS</div>
        <div class="mathKeyGrid">
          ${["ppp", "pp", "p", "mp", "mf", "f", "ff", "fff", "sf", "sfz", "fz", "fp", "cresc.", "dim.", "decresc.", "subito f"].map((n) => mk(n + " ")).join("")}
        </div>
      </div>
      <div class="mathSection"><div class="mathSectionLabel">TEMPO / EXPRESSION</div>
        <div class="mathKeyGrid">
          ${["Allegro", "Andante", "Adagio", "Presto", "Largo", "Moderato", "Vivace", "rit.", "accel.", "a tempo", "poco a poco", "con fuoco", "legato", "staccato", "tenuto", "marcato"].map((n) => mk(n + " ")).join("")}
        </div>
      </div>
      <div class="mathSection"><div class="mathSectionLabel">TIME / KEY SIGNATURES</div>
        <div class="mathKeyGrid">
          ${["4/4", "3/4", "2/4", "6/8", "9/8", "12/8", "2/2", "3/8", "5/4", "7/8"].map((n) => mk(n + " ")).join("")}
          ${["C major", "G major", "D major", "A major", "E major", "B major", "F major", "Bb major", "Eb major", "Ab major", "Db major", "Gb major", "A minor", "E minor", "B minor", "D minor", "G minor", "C minor", "F minor", "Bb minor"].map((n) => mk(n + " ")).join("")}
        </div>
      </div>
      <div class="mathSection"><div class="mathSectionLabel">RCM LEVELS (PIANO)</div>
        <div class="mathKeyGrid">
          ${["Prep A", "Prep B", "Level 1", "Level 2", "Level 3", "Level 4", "Level 5", "Level 6", "Level 7", "Level 8", "Level 9", "Level 10", "ARCT"].map((n) => mk("RCM " + n + " ")).join("")}
        </div>
      </div>
      <div class="mathSection"><div class="mathSectionLabel">VIOLIN (RCM)</div>
        <div class="mathKeyGrid">
          ${["Open string", "1st pos", "2nd pos", "3rd pos", "Shift", "Vibrato", "Détaché", "Martelé", "Spiccato", "Sautillé", "Col legno", "Sul ponticello", "Sul tasto", "Pizzicato", "Arco", "Harmonics"].map((n) => mk(n + " ")).join("")}
        </div>
      </div>
    </div>`;
}

/* ── Auto show/hide math panel when math mode toggles ── */
document.getElementById("mathModeBtn")?.addEventListener(
  "click",
  () => {
    setTimeout(() => {
      if (mathMode) showMathPanel();
      else hideMathPanel();
    }, 50);
  },
  true,
);

/* ── Tool dropdown extras ── */
document.getElementById("tool_link")?.addEventListener("click", () => {
  if (toolsDropMenu) toolsDropMenu.style.display = "none";
  toolsDropBtn?.classList.remove("active");
  import("./linkMode.js").then((m) => m.openLinkMode?.());
});
document.getElementById("tool_bluetooth")?.addEventListener("click", () => {
  if (toolsDropMenu) toolsDropMenu.style.display = "none";
  import("./linkMode.js").then((m) => m.scanBluetooth?.());
});
document.getElementById("tool_hometools")?.addEventListener("click", () => {
  if (toolsDropMenu) toolsDropMenu.style.display = "none";
  import("./linkMode.js").then((m) => m.showHomeToolsInSidebar?.());
});

function addSystemMessage(content) {
  const chat = getCurrentChat();
  if (!chat) return;
  chat.messages.push({ role: "aria", content, timestamp: Date.now() });
  saveChats();
  renderMessages();
}

function addAIMessage(content) {
  const chat = getCurrentChat();
  if (!chat) return;
  chat.messages.push({ role: "aria", content, timestamp: Date.now() });
  saveChats();
  syncToServer();
  renderMessages();
  if (ttsEnabled) speak(content);
}

/* ============================================================
   SEND MESSAGE
   ============================================================ */
async function sendMessage() {
  const text = userInput?.value.trim();
  if (!text || isGenerating) return;
  currentSettings = loadSettings();
  const chat = getCurrentChat();
  if (!chat) return;

  const attachments = [...pendingFiles];
  pendingFiles = [];
  renderAttachPreviews();

  chat.messages.push({
    role: "user",
    content: text,
    timestamp: Date.now(),
    attachments: attachments.length ? attachments : undefined,
  });
  if (chat.title === "New Chat") {
    chat.title = text.slice(0, 35) + (text.length > 35 ? "…" : "");
    renderChatList();
  }
  userInput.value = "";
  userInput.style.height = "auto";
  saveChats();
  syncToServer();
  renderMessages();

  // Slash commands
  const cmds = [
    [/^\/calc (.+)/i, (m) => runTool("calc", m[1])],
    [/^\/time/i, (_) => runTool("time", "")],
    [/^\/weather(.*)/i, (m) => runTool("weather", m[1].trim())],
    [/^\/notes (.+)/i, (m) => runTool("notes", m[1])],
    [/^\/todo (.+)/i, (m) => runTool("todo", m[1])],
    [/^\/timer (.+)/i, (m) => runTool("timer", m[1])],
    [
      /^\/search (.+)/i,
      (m) => {
        doWebSearch(m[1]);
        return null;
      },
    ],
    [
      /^\/imagine (.+)/i,
      (m) => {
        doImagine(m[1]);
        return null;
      },
    ],
    [/^\/news(.*)/i, (m) => runTool("news", m[1].trim())],
    [/^\/system/i, (_) => runTool("system", "")],
    [/^\/help/i, (_) => Promise.resolve(HELP_TEXT)],
  ];
  for (const [re, fn] of cmds) {
    const match = text.match(re);
    if (match) {
      const r = await fn(match);
      if (r) addAIMessage(r);
      return;
    }
  }

  await sendMessageContent(text, chat, attachments);
}

const HELP_TEXT = `**ARIA Commands**
/calc /time /weather /notes /todo /timer /search /news /system /imagine /help

Open **🔧 Tools** in the sidebar for mode toggles and tool shortcuts.`;

async function sendMessageContent(text, chat, attachments = []) {
  isGenerating = true;
  setSendState(true);
  triggerHalo("thinking");
  const tid = showTypingIndicator();
  let abort = new AbortController();
  window.ARIA_stopGeneration = () => {
    abort.abort();
    isGenerating = false;
    setSendState(false);
    clearHalo();
    removeTypingIndicator(tid);
    renderMessages();
  };

  try {
    const docCtx =
      attachments.map((a) => a.text || "").join("\n") || documentContext;
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: abort.signal,
      body: JSON.stringify({
        message: text,
        history: chat.messages.slice(-20).map((m) => ({
          role: m.role === "aria" ? "assistant" : "user",
          content: m.content,
        })),
        provider: currentSettings.provider || "openrouter",
        // Send the right model ID for the chosen provider
        model: (() => {
          const p = currentSettings.provider;
          if (p === "openrouter") return currentSettings.orModel || undefined;
          if (p === "cloudflare")
            return currentSettings.cfAutoModel !== false
              ? undefined
              : currentSettings.cfModel || undefined;
          if (p === "ollama") return currentSettings.ollamaModel || undefined;
          return undefined; // groq, nemotron, deepseek use their fixed models
        })(),
        imageProvider: currentSettings.imageProvider || "auto",
        personality: currentSettings.personality || "hacker",
        mathMode,
        programmingMode,
        studyMode,
        thinkingMode,
        thinkDeeper,
        musicTutorMode,
        workspaceRepo: workspaceRepoUrl || undefined,
        documentContext: docCtx,
      }),
    });
    const data = await res.json();
    removeTypingIndicator(tid);
    clearHalo();

    if (data.imageUrl) {
      const chat2 = getCurrentChat();
      if (chat2) {
        chat2.messages.push({
          role: "aria",
          type: "image",
          imageUrl: data.imageUrl,
          content: `Generated: ${data.imagePrompt || text}`,
          timestamp: Date.now(),
        });
        saveChats();
        renderMessages();
      }
      if (data.reply) addAIMessage(data.reply);
    } else {
      addAIMessage(data.reply?.trim() || "[No reply]");
    }
  } catch (err) {
    removeTypingIndicator(tid);
    clearHalo();
    if (err.name !== "AbortError") addAIMessage("[Error contacting server]");
  } finally {
    isGenerating = false;
    setSendState(false);
  }
}

function setSendState(on) {
  if (sendBtn) {
    sendBtn.disabled = on;
    sendBtn.textContent = on ? "…" : "Send";
    sendBtn.style.opacity = on ? "0.5" : "1";
  }
  if (userInput) userInput.disabled = on;
}
function showTypingIndicator() {
  const id = "typing_" + Date.now();
  const div = document.createElement("div");
  div.classList.add("msg", "aria", "typingIndicator");
  div.id = id;
  div.innerHTML = `<div class="msgSender">ARIA</div><div class="typingDots"><span></span><span></span><span></span></div>`;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
  return id;
}
function removeTypingIndicator(id) {
  document.getElementById(id)?.remove();
}

/* ============================================================
   MARKDOWN
   ============================================================ */
function escapeHtml(t) {
  return String(t)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderMarkdown(text) {
  if (!text) return "";

  // Think blocks first (before escaping)
  text = text.replace(/<think>([\s\S]*?)<\/think>/gi, (_, inner) => {
    const escaped = escapeHtml(inner.trim());
    const b64 = btoa(unescape(encodeURIComponent(escaped)));
    return `__THINK__${b64}__THINK__`;
  });

  let h = escapeHtml(text);

  // Restore think blocks as collapsible
  h = h.replace(/__THINK__([A-Za-z0-9+/=]+)__THINK__/g, (_, b64) => {
    const c = decodeURIComponent(escape(atob(b64)));
    return `<details class="thinkBlock"><summary>🧠 ARIA is thinking…</summary><div class="thinkContent">${c}</div></details>`;
  });

  // Code blocks — with Panel + Copy + Download
  h = h.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const clean = code.trim();
    const enc = encodeURIComponent(clean);
    const extMap = {
      javascript: "js",
      typescript: "ts",
      python: "py",
      html: "html",
      css: "css",
      json: "json",
      bash: "sh",
      shell: "sh",
    };
    const ext = extMap[lang] || lang || "txt";
    return `<div class="codeBlock">
      ${lang ? `<span class="codeLabel">${lang.toUpperCase()}</span>` : ""}
      <div class="codeActions">
        <button class="codePanelBtn codeActionBtn" data-code="${enc}" data-lang="${lang}">⤢ Panel</button>
        <button class="codeActionBtn" onclick="navigator.clipboard?.writeText(decodeURIComponent('${enc}'));this.textContent='✓';setTimeout(()=>this.textContent='⎘',1300)">⎘ Copy</button>
        <button class="codeActionBtn" onclick="window.ARIA_downloadCode(decodeURIComponent('${enc}'),'aria-code.${ext}')">⬇ .${ext}</button>
      </div>
      <pre><code>${escapeHtml(clean)}</code></pre>
    </div>`;
  });

  h = h.replace(/`([^`]+)`/g, '<code class="inlineCode">$1</code>');
  h = h.replace(/^### (.+)$/gm, '<h3 class="mdH3">$1</h3>');
  h = h.replace(/^## (.+)$/gm, '<h2 class="mdH2">$1</h2>');
  h = h.replace(/^# (.+)$/gm, '<h1 class="mdH1">$1</h1>');
  h = h.replace(/^---$/gm, '<hr class="mdHr"/>');
  h = h.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
  h = h.replace(/\*\*(.+?)\*\*/g, '<strong class="mdBold">$1</strong>');
  h = h.replace(/\*(.+?)\*/g, '<em class="mdItalic">$1</em>');
  h = h.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    (_, alt, src) =>
      `<div class="msgImageWrap"><img src="${src}" alt="${alt}" class="msgImage"><div class="imgActions"><a href="${src}" download class="fileDownloadBtn">⬇ Download</a></div></div>`,
  );
  h = h.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener" class="mdLink">$1</a>',
  );
  h = h.replace(
    /((?:^[*\-] .+\n?)+)/gm,
    (b) =>
      `<ul class="mdList">${b
        .trim()
        .split("\n")
        .map((l) => `<li>${l.replace(/^[*\-] /, "")}</li>`)
        .join("")}</ul>`,
  );
  h = h.replace(
    /((?:^\d+\. .+\n?)+)/gm,
    (b) =>
      `<ol class="mdList">${b
        .trim()
        .split("\n")
        .map((l) => `<li>${l.replace(/^\d+\. /, "")}</li>`)
        .join("")}</ol>`,
  );
  h = h
    .split(/\n{2,}/)
    .map((b) => {
      const t = b.trim();
      if (!t || /^<(h[1-3]|ul|ol|div|details|pre|hr)/.test(t)) return t;
      return `<p class="mdPara">${t.replace(/\n/g, "<br/>")}</p>`;
    })
    .join("\n");
  return h;
}

/* ── PERSISTENCE ── */
function saveChats() {
  localStorage.setItem("aria_chats", JSON.stringify(chats));
}
async function syncToServer() {
  try {
    await fetch("/api/saveChats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: window.ARIA_userId || "sarvin", chats }),
    });
  } catch {}
}
/* ── VERSION DISPLAY ── */
async function loadVersionFromGitHub() {
  try {
    const res = await fetch(
      "https://api.github.com/repos/DaEpickid540/ARIA/commits?per_page=1",
    );
    if (!res.ok) return;
    const data = await res.json();
    const sha = data[0]?.sha?.slice(0, 7) || "";
    // Count commits for version number
    const countRes = await fetch(
      "https://api.github.com/repos/DaEpickid540/ARIA/commits?per_page=100",
    );
    const commits = countRes.ok ? await countRes.json() : [];
    const major = 1;
    const minor = Math.floor(commits.length / 10);
    const patch = commits.length % 10;
    const verStr = `Mark ${major}.${minor}.${patch}`;
    const verEl = document.getElementById("ariaVersionLabel");
    if (verEl) verEl.textContent = verStr;
    localStorage.setItem("aria_version", verStr);
  } catch {
    const cached = localStorage.getItem("aria_version");
    const verEl = document.getElementById("ariaVersionLabel");
    if (verEl && cached) verEl.textContent = cached;
  }
}
loadVersionFromGitHub();
setInterval(loadVersionFromGitHub, 300_000); // refresh every 5 min

/* ── PiP MINI CHAT ── */
(function initPipChat() {
  const pipEl = document.getElementById("pipChat");
  const pipMsgs = document.getElementById("pipChatMessages");
  const pipInput = document.getElementById("pipChatInputField");
  const pipSend = document.getElementById("pipChatSend");
  const pipExpand = document.getElementById("pipChatExpand");
  const pipClose = document.getElementById("pipChatClose");
  const pipToggle = document.getElementById("pipToggleBtn");
  if (!pipEl) return;

  let pipOpen = false;

  pipToggle?.addEventListener("click", () => {
    pipOpen = !pipOpen;
    pipEl.style.display = pipOpen ? "flex" : "none";
  });
  pipClose?.addEventListener("click", () => {
    pipOpen = false;
    pipEl.style.display = "none";
  });
  pipExpand?.addEventListener("click", () => {
    pipOpen = false;
    pipEl.style.display = "none";
    document.getElementById("layout").style.display = "flex";
  });

  async function pipSend2() {
    const text = pipInput?.value.trim();
    if (!text) return;
    addPipMsg("You", text);
    if (pipInput) pipInput.value = "";
    try {
      const s = loadSettings();
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          provider: s.provider || "openrouter",
          personality: s.personality || "hacker",
          history: [],
        }),
      });
      const d = await res.json();
      addPipMsg("ARIA", d.reply || "…");
    } catch {
      addPipMsg("ARIA", "Connection error.");
    }
  }

  function addPipMsg(sender, text) {
    if (!pipMsgs) return;
    const d = document.createElement("div");
    d.className = "pipMsg " + (sender === "You" ? "pipMsgUser" : "pipMsgAria");
    d.innerHTML = `<b>${sender}:</b> ${String(text).replace(/</g, "&lt;").slice(0, 300)}`;
    pipMsgs.appendChild(d);
    pipMsgs.scrollTop = pipMsgs.scrollHeight;
  }

  pipSend?.addEventListener("click", pipSend2);
  pipInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") pipSend2();
  });

  // Drag
  const header = document.getElementById("pipChatHeader");
  let ox = 0,
    oy = 0,
    mx = 0,
    my = 0;
  header?.addEventListener("mousedown", (e) => {
    mx = e.clientX;
    my = e.clientY;
    const move = (e2) => {
      ox = e2.clientX - mx;
      oy = e2.clientY - my;
      mx = e2.clientX;
      my = e2.clientY;
      pipEl.style.left = pipEl.offsetLeft + ox + "px";
      pipEl.style.top = pipEl.offsetTop + oy + "px";
      pipEl.style.right = "auto";
      pipEl.style.bottom = "auto";
    };
    document.addEventListener("mousemove", move);
    document.addEventListener(
      "mouseup",
      () => document.removeEventListener("mousemove", move),
      { once: true },
    );
  });
})();

async function loadFromServer() {
  try {
    const uid = window.ARIA_userId || "sarvin";
    const res = await fetch(`/api/loadChats?userId=${uid}`);
    const data = await res.json();
    if (data.chats?.length > chats.length) {
      const localIds = new Set(chats.map((c) => c.id));
      chats = [...data.chats.filter((c) => !localIds.has(c.id)), ...chats].sort(
        (a, b) => b.id.localeCompare(a.id),
      );
      currentChatId = chats[0].id;
      saveChats();
      renderChatList();
      renderMessages();
    }
  } catch {}
}
