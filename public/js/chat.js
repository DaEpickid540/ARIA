import { speak, ttsEnabled } from "./tts.js";
import { loadSettings } from "./personality.js";
import { runTool } from "./tools.js";

let chats = [];
let currentChatId = null;
let currentSettings = loadSettings();
let isGenerating = false;   // prevent double-sends

const newChatBtn = document.getElementById("newChatBtn");
const sendBtn    = document.getElementById("sendBtn");
const userInput  = document.getElementById("userInput");
const messages   = document.getElementById("messages");
const chatList   = document.getElementById("chatList");

/* ── LOAD ── */
try {
  const saved = localStorage.getItem("aria_chats");
  if (saved) {
    chats = JSON.parse(saved);
    if (chats.length) currentChatId = chats[0].id;
  }
} catch { chats = []; }

if (!currentChatId) createNewChat();
renderChatList();
renderMessages();
loadFromServer();

/* ── EVENTS ── */
newChatBtn?.addEventListener("click", () => {
  createNewChat(); renderChatList(); renderMessages();
  window.ARIA_closeSidebar?.();
});
sendBtn?.addEventListener("click", sendMessage);
userInput?.addEventListener("keydown", e => {
  currentSettings = loadSettings();
  if (e.key === "Enter" && !e.shiftKey && currentSettings.sendOnEnter !== false) {
    e.preventDefault(); sendMessage();
  }
});

/* Multiline input: auto-resize */
userInput?.addEventListener("input", () => {
  userInput.style.height = "auto";
  userInput.style.height = Math.min(userInput.scrollHeight, 120) + "px";
});

/* ── CHAT MANAGEMENT ── */
function createNewChat() {
  const id = "chat_" + Date.now();
  chats.unshift({ id, title: "New Chat", messages: [], createdAt: Date.now() });
  currentChatId = id;
  saveChats(); syncToServer();
}

function getCurrentChat() {
  return chats.find(c => c.id === currentChatId) || null;
}

export function deleteChat(chatId) {
  chats = chats.filter(c => c.id !== chatId);
  if (currentChatId === chatId) {
    currentChatId = chats.length ? chats[0].id : null;
    if (!currentChatId) createNewChat();
  }
  saveChats(); syncToServer(); renderChatList(); renderMessages();
  window.ARIA_refreshRecentChats?.();
}

export function clearAllChats() {
  chats = []; createNewChat();
  renderChatList(); renderMessages();
  window.ARIA_refreshRecentChats?.();
}

export function renameChat(chatId) {
  const chat = chats.find(c => c.id === chatId);
  if (!chat) return;
  const t = prompt("Rename chat:", chat.title);
  if (!t?.trim()) return;
  chat.title = t.trim().slice(0, 40);
  saveChats(); syncToServer(); renderChatList();
  window.ARIA_refreshRecentChats?.();
}

export function deleteMessage(chatId, idx) {
  const chat = chats.find(c => c.id === chatId);
  if (!chat?.messages[idx]) return;
  chat.messages.splice(idx, 1);
  saveChats(); syncToServer(); renderMessages();
}

export function copyMessage(content) {
  navigator.clipboard?.writeText(content).then(() => {
    window.ARIA_showToast?.("Copied to clipboard");
  }).catch(() => {
    const ta = document.createElement("textarea");
    ta.value = content; document.body.appendChild(ta);
    ta.select(); document.execCommand("copy");
    document.body.removeChild(ta);
    window.ARIA_showToast?.("Copied");
  });
}

export function regenerateMessage(chatId, idx) {
  const chat = chats.find(c => c.id === chatId);
  if (!chat) return;
  // Remove messages from idx onward and resend the last user message before it
  const userMsg = [...chat.messages].slice(0, idx).reverse().find(m => m.role === "user");
  if (!userMsg) return;
  chat.messages = chat.messages.slice(0, idx);
  saveChats(); renderMessages();
  sendMessageContent(userMsg.content, chat);
}

window.ARIA_deleteChat      = deleteChat;
window.ARIA_clearAllChats   = clearAllChats;
window.ARIA_renameChat      = renameChat;
window.ARIA_deleteMessage   = deleteMessage;
window.ARIA_copyMessage     = copyMessage;
window.ARIA_regenerateMsg   = regenerateMessage;
window.ARIA_renderChatList  = renderChatList;
window.ARIA_loadFromServer  = loadFromServer;

/* ── RENDER CHAT LIST ── */
function renderChatList() {
  if (!chatList) return;
  chatList.innerHTML = "";
  chats.forEach(chat => {
    const row = document.createElement("div");
    row.className = "chatRow" + (chat.id === currentChatId ? " active" : "");

    const btn = document.createElement("button");
    btn.className = "chatItem" + (chat.id === currentChatId ? " active" : "");
    btn.textContent = chat.title || "Untitled";
    btn.title = chat.title;
    btn.onclick = () => {
      currentChatId = chat.id;
      renderChatList(); renderMessages();
      window.ARIA_closeSidebar?.();
    };

    const renameBtn = document.createElement("button");
    renameBtn.className = "chatActionBtn chatRenameBtn";
    renameBtn.title = "Rename"; renameBtn.textContent = "✎";
    renameBtn.onclick = e => { e.stopPropagation(); renameChat(chat.id); };

    const delBtn = document.createElement("button");
    delBtn.className = "chatActionBtn chatDeleteBtn";
    delBtn.title = "Delete"; delBtn.textContent = "✕";
    delBtn.onclick = e => {
      e.stopPropagation();
      if (confirm(`Delete "${chat.title}"?`)) deleteChat(chat.id);
    };

    row.appendChild(btn); row.appendChild(renameBtn); row.appendChild(delBtn);
    chatList.appendChild(row);
  });
}

/* ── RENDER MESSAGES ── */
function renderMessages() {
  if (!messages) return;
  messages.innerHTML = "";
  const chat = getCurrentChat();
  if (!chat) return;

  chat.messages.forEach((msg, idx) => {
    const div = document.createElement("div");
    div.classList.add("msg", msg.role);

    // User messages: render as clean paragraph (preserve newlines, escape HTML)
    // ARIA messages: full markdown rendering
    const bodyHTML = msg.role === "user"
      ? `<p class="userPara">${escapeHtml(msg.content).replace(/\n/g, "<br>")}</p>`
      : renderMarkdown(msg.content);

    const time = new Date(msg.timestamp).toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"});
    const isAria = msg.role === "aria";

    div.innerHTML = `
      <div class="msgHeader">
        <div class="msgSender">${msg.role === "user" ? "YOU" : "ARIA"}</div>
        <div class="msgMeta">
          <span class="msgTimestamp">${time}</span>
          <button class="msgActionBtn msgCopyBtn" title="Copy" onclick="window.ARIA_copyMessage(${JSON.stringify(msg.content)})">⎘</button>
          ${isAria ? `<button class="msgActionBtn msgRegenBtn" title="Regenerate" onclick="window.ARIA_regenerateMsg('${chat.id}', ${idx})">↺</button>` : ""}
          <button class="msgActionBtn msgDeleteBtn" title="Delete" onclick="window.ARIA_deleteMessage('${chat.id}', ${idx})">✕</button>
        </div>
      </div>
      <div class="msgBody">${bodyHTML}</div>
    `;
    messages.appendChild(div);
  });

  // Stop generating button if active
  if (isGenerating) {
    const stopDiv = document.createElement("div");
    stopDiv.id = "stopGenBtn";
    stopDiv.innerHTML = `<button onclick="window.ARIA_stopGeneration()">⏹ Stop generating</button>`;
    messages.appendChild(stopDiv);
  }

  messages.scrollTop = messages.scrollHeight;
}

/* ── SEND MESSAGE ── */
async function sendMessage() {
  const text = userInput.value.trim();
  if (!text || isGenerating) return;
  currentSettings = loadSettings();
  const chat = getCurrentChat();
  if (!chat) return;

  chat.messages.push({ role: "user", content: text, timestamp: Date.now() });
  if (chat.title === "New Chat") {
    chat.title = text.slice(0, 35) + (text.length > 35 ? "…" : "");
    renderChatList();
  }
  userInput.value = "";
  userInput.style.height = "auto";
  saveChats(); syncToServer(); renderMessages();

  // Tool shortcuts
  const toolMap = [
    [/^\/calc (.+)/i,    m => runTool("calc",    m[1])],
    [/^\/time/i,         _  => runTool("time",    "")],
    [/^\/weather(.*)/i,  m => runTool("weather",  m[1].trim())],
    [/^\/notes (.+)/i,   m => runTool("notes",    m[1])],
    [/^\/todo (.+)/i,    m => runTool("todo",     m[1])],
    [/^\/timer (.+)/i,   m => runTool("timer",    m[1])],
    [/^\/search (.+)/i,  m => runTool("search",   m[1])],
    [/^\/news(.*)/i,     m => runTool("news",     m[1].trim())],
    [/^\/system/i,       _  => runTool("system",  "")],
    [/^\/help/i,         _  => Promise.resolve(HELP_TEXT)],
  ];

  for (const [re, fn] of toolMap) {
    const match = text.match(re);
    if (match) { addAIMessage(await fn(match)); return; }
  }

  await sendMessageContent(text, chat);
}

async function sendMessageContent(text, chat) {
  isGenerating = true;
  setSendState(true);
  const typingId = showTypingIndicator();

  // Expose stop function
  let abortController = new AbortController();
  window.ARIA_stopGeneration = () => {
    abortController.abort();
    isGenerating = false;
    setSendState(false);
    removeTypingIndicator(typingId);
    renderMessages();
  };

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: abortController.signal,
      body: JSON.stringify({
        message:     text,
        history:     chat.messages.slice(-20).map(m => ({
          role:    m.role === "aria" ? "assistant" : "user",
          content: m.content,
        })),
        provider:    currentSettings.provider    || "openrouter",
        personality: currentSettings.personality || "hacker",
      }),
    });

    const data  = await res.json();
    removeTypingIndicator(typingId);
    addAIMessage(data.reply?.trim() || "[No reply]");
  } catch (err) {
    removeTypingIndicator(typingId);
    if (err.name !== "AbortError") addAIMessage("[Error contacting server]");
  } finally {
    isGenerating = false;
    setSendState(false);
    renderMessages(); // remove stop button
  }
}

const HELP_TEXT = `**ARIA Commands**
\`/calc <expr>\` — calculator (e.g. \`/calc sqrt(144)\`)
\`/time\` — current server time
\`/weather [lat,lon]\` — weather (default: Mason OH)
\`/notes add|list|delete|clear <text>\` — notes
\`/todo add|list|done|delete|clear <text>\` — tasks
\`/timer start|list|cancel <seconds>\` — timers
\`/search <query>\` — web search links
\`/news [topic]\` — latest headlines
\`/system\` — server system info
\`/help\` — show this list`;

/* ── SEND STATE ── */
function setSendState(generating) {
  if (sendBtn) {
    sendBtn.disabled = generating;
    sendBtn.textContent = generating ? "…" : "Send";
    sendBtn.style.opacity = generating ? "0.5" : "1";
  }
  if (userInput) userInput.disabled = generating;
}

/* ── TYPING INDICATOR ── */
function showTypingIndicator() {
  const id  = "typing_" + Date.now();
  const div = document.createElement("div");
  div.classList.add("msg", "aria", "typingIndicator");
  div.id = id;
  div.innerHTML = `<div class="msgSender">ARIA</div><div class="typingDots"><span></span><span></span><span></span></div>`;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
  return id;
}
function removeTypingIndicator(id) { document.getElementById(id)?.remove(); }

/* ── ADD AI MESSAGE ── */
function addAIMessage(content) {
  const chat = getCurrentChat();
  if (!chat) return;
  chat.messages.push({ role: "aria", content, timestamp: Date.now() });
  saveChats(); syncToServer(); renderMessages();
  if (ttsEnabled) speak(content);
}

/* ── MARKDOWN RENDERER ── */
function escapeHtml(t) {
  return t.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

function renderMarkdown(text) {
  if (!text) return "";
  let h = escapeHtml(text);
  h = h.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, l, c) =>
    `<div class="codeBlock">${l ? `<span class="codeLabel">${l.toUpperCase()}</span>` : ""}<pre><code>${c.trim()}</code></pre></div>`);
  h = h.replace(/`([^`]+)`/g, '<code class="inlineCode">$1</code>');
  h = h.replace(/^### (.+)$/gm, '<h3 class="mdH3">$1</h3>');
  h = h.replace(/^## (.+)$/gm,  '<h2 class="mdH2">$1</h2>');
  h = h.replace(/^# (.+)$/gm,   '<h1 class="mdH1">$1</h1>');
  h = h.replace(/^---$/gm, '<hr class="mdHr"/>');
  h = h.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
  h = h.replace(/\*\*(.+?)\*\*/g, '<strong class="mdBold">$1</strong>');
  h = h.replace(/\*(.+?)\*/g, '<em class="mdItalic">$1</em>');
  h = h.replace(/((?:^[*\-] .+\n?)+)/gm, b =>
    `<ul class="mdList">${b.trim().split("\n").map(l => `<li>${l.replace(/^[*\-] /, "")}</li>`).join("")}</ul>`);
  h = h.replace(/((?:^\d+\. .+\n?)+)/gm, b =>
    `<ol class="mdList">${b.trim().split("\n").map(l => `<li>${l.replace(/^\d+\. /, "")}</li>`).join("")}</ol>`);
  h = h.split(/\n{2,}/).map(b => {
    const t = b.trim();
    if (!t || /^<(h[1-3]|ul|ol|div|pre|hr)/.test(t)) return t;
    return `<p class="mdPara">${t.replace(/\n/g, "<br/>")}</p>`;
  }).join("\n");
  return h;
}

/* ── PERSISTENCE ── */
function saveChats() {
  localStorage.setItem("aria_chats", JSON.stringify(chats));
}

async function syncToServer() {
  try {
    await fetch("/api/saveChats", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: window.ARIA_userId || "sarvin", chats }),
    });
  } catch {}
}

async function loadFromServer() {
  try {
    const uid = window.ARIA_userId || "sarvin";
    const res  = await fetch(`/api/loadChats?userId=${uid}`);
    const data = await res.json();
    if (data.chats?.length > chats.length) {
      const localIds = new Set(chats.map(c => c.id));
      const newer    = data.chats.filter(c => !localIds.has(c.id));
      chats = [...newer, ...chats].sort((a, b) => b.id.localeCompare(a.id));
      currentChatId = chats[0].id;
      saveChats(); renderChatList(); renderMessages();
    }
  } catch {}
}
