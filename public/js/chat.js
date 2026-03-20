import { speak, ttsEnabled } from "./tts.js";
import { loadSettings } from "./personality.js";
import { runTool } from "./tools.js";

let chats = [];
let currentChatId = null;
let currentSettings = loadSettings();

const newChatBtn = document.getElementById("newChatBtn");
const sendBtn    = document.getElementById("sendBtn");
const userInput  = document.getElementById("userInput");
const messages   = document.getElementById("messages");
const chatList   = document.getElementById("chatList");

/* ── LOAD FROM LOCALSTORAGE ── */
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

/* ── EVENT LISTENERS ── */
newChatBtn?.addEventListener("click", () => {
  createNewChat();
  renderChatList();
  renderMessages();
  window.ARIA_closeSidebar?.();
});

sendBtn?.addEventListener("click", sendMessage);
userInput?.addEventListener("keydown", e => {
  const settings = loadSettings();
  if (e.key === "Enter" && !e.shiftKey && settings.sendOnEnter !== false) {
    e.preventDefault();
    sendMessage();
  }
});

/* ─────────────────────────────────────────────
   CHAT MANAGEMENT
───────────────────────────────────────────── */
function createNewChat() {
  const id   = "chat_" + Date.now();
  chats.unshift({ id, title: "New Chat", messages: [] });
  currentChatId = id;
  saveChats();
  syncToServer();
}

function getCurrentChat() {
  return chats.find(c => c.id === currentChatId) || null;
}

/* DELETE a single chat */
export function deleteChat(chatId) {
  chats = chats.filter(c => c.id !== chatId);
  if (currentChatId === chatId) {
    currentChatId = chats.length ? chats[0].id : null;
    if (!currentChatId) createNewChat();
  }
  saveChats();
  syncToServer();
  renderChatList();
  renderMessages();
  window.ARIA_refreshRecentChats?.();
}

/* DELETE ALL chats */
export function clearAllChats() {
  chats = [];
  createNewChat();
  renderChatList();
  renderMessages();
  window.ARIA_refreshRecentChats?.();
}

/* RENAME a chat */
export function renameChat(chatId) {
  const chat = chats.find(c => c.id === chatId);
  if (!chat) return;
  const newTitle = prompt("Rename chat:", chat.title);
  if (!newTitle?.trim()) return;
  chat.title = newTitle.trim().slice(0, 40);
  saveChats();
  syncToServer();
  renderChatList();
  window.ARIA_refreshRecentChats?.();
}

/* DELETE a single message inside a chat */
export function deleteMessage(chatId, msgIndex) {
  const chat = chats.find(c => c.id === chatId);
  if (!chat || !chat.messages[msgIndex]) return;
  chat.messages.splice(msgIndex, 1);
  saveChats();
  syncToServer();
  renderMessages();
}

/* Expose everything globally */
window.ARIA_deleteChat     = deleteChat;
window.ARIA_clearAllChats  = clearAllChats;
window.ARIA_renameChat     = renameChat;
window.ARIA_deleteMessage  = deleteMessage;
window.ARIA_renderChatList = renderChatList;
window.ARIA_loadFromServer = loadFromServer;

/* ─────────────────────────────────────────────
   RENDER CHAT LIST — with rename + delete btns
───────────────────────────────────────────── */
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
      renderChatList();
      renderMessages();
      window.ARIA_closeSidebar?.();
    };

    const renameBtn = document.createElement("button");
    renameBtn.className = "chatActionBtn chatRenameBtn";
    renameBtn.title = "Rename";
    renameBtn.textContent = "✎";
    renameBtn.onclick = e => { e.stopPropagation(); renameChat(chat.id); };

    const delBtn = document.createElement("button");
    delBtn.className = "chatActionBtn chatDeleteBtn";
    delBtn.title = "Delete chat";
    delBtn.textContent = "✕";
    delBtn.onclick = e => {
      e.stopPropagation();
      if (confirm(`Delete "${chat.title}"?`)) deleteChat(chat.id);
    };

    row.appendChild(btn);
    row.appendChild(renameBtn);
    row.appendChild(delBtn);
    chatList.appendChild(row);
  });
}

/* ─────────────────────────────────────────────
   RENDER MESSAGES — with per-message delete btn
───────────────────────────────────────────── */
function renderMessages() {
  if (!messages) return;
  messages.innerHTML = "";
  const chat = getCurrentChat();
  if (!chat) return;

  chat.messages.forEach((msg, idx) => {
    const div = document.createElement("div");
    div.classList.add("msg", msg.role);

    const bodyHTML = msg.role === "aria"
      ? renderMarkdown(msg.content)
      : `<p class="mdPara">${msg.content
          .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}</p>`;

    const time = new Date(msg.timestamp).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});

    div.innerHTML = `
      <div class="msgHeader">
        <div class="msgSender">${msg.role === "user" ? "YOU" : "ARIA"}</div>
        <div class="msgMeta">
          <span class="msgTimestamp">${time}</span>
          <button class="msgDeleteBtn" title="Delete message" onclick="window.ARIA_deleteMessage('${chat.id}', ${idx})">✕</button>
        </div>
      </div>
      <div class="msgBody">${bodyHTML}</div>
    `;
    messages.appendChild(div);
  });

  messages.scrollTop = messages.scrollHeight;
}

/* ─────────────────────────────────────────────
   MARKDOWN RENDERER
───────────────────────────────────────────── */
function renderMarkdown(text) {
  if (!text) return "";
  let h = text.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  h = h.replace(/```(\w*)\n?([\s\S]*?)```/g, (_,l,c) =>
    `<div class="codeBlock">${l?`<span class="codeLabel">${l.toUpperCase()}</span>`:""}<pre><code>${c.trim()}</code></pre></div>`);
  h = h.replace(/`([^`]+)`/g, '<code class="inlineCode">$1</code>');
  h = h.replace(/^### (.+)$/gm, '<h3 class="mdH3">$1</h3>');
  h = h.replace(/^## (.+)$/gm,  '<h2 class="mdH2">$1</h2>');
  h = h.replace(/^# (.+)$/gm,   '<h1 class="mdH1">$1</h1>');
  h = h.replace(/^---$/gm, '<hr class="mdHr"/>');
  h = h.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
  h = h.replace(/\*\*(.+?)\*\*/g, '<strong class="mdBold">$1</strong>');
  h = h.replace(/\*(.+?)\*/g,   '<em class="mdItalic">$1</em>');
  h = h.replace(/((?:^[*\-] .+\n?)+)/gm, b =>
    `<ul class="mdList">${b.trim().split("\n").map(l=>`<li>${l.replace(/^[*\-] /,"")}</li>`).join("")}</ul>`);
  h = h.replace(/((?:^\d+\. .+\n?)+)/gm, b =>
    `<ol class="mdList">${b.trim().split("\n").map(l=>`<li>${l.replace(/^\d+\. /,"")}</li>`).join("")}</ol>`);
  h = h.split(/\n{2,}/).map(b => {
    const t = b.trim();
    if (!t || /^<(h[1-3]|ul|ol|div|pre|hr)/.test(t)) return t;
    return `<p class="mdPara">${t.replace(/\n/g,"<br/>")}</p>`;
  }).join("\n");
  return h;
}

/* ─────────────────────────────────────────────
   SEND MESSAGE
───────────────────────────────────────────── */
async function sendMessage() {
  const text = userInput.value.trim();
  if (!text) return;
  currentSettings = loadSettings();
  const chat = getCurrentChat();
  if (!chat) return;

  chat.messages.push({ role:"user", content:text, timestamp:Date.now() });
  if (chat.title === "New Chat") { chat.title = text.slice(0,30) + (text.length>30?"...":""); renderChatList(); }
  userInput.value = "";
  saveChats(); syncToServer(); renderMessages();

  if (text.startsWith("/calc "))  { addAIMessage(await runTool("calc",  text.slice(6)));  return; }
  if (text.startsWith("/time"))   { addAIMessage(await runTool("time",  ""));              return; }
  if (text.startsWith("/weather")){ addAIMessage(await runTool("weather", text.slice(8))); return; }
  if (text.startsWith("/notes ")) { addAIMessage(await runTool("notes", text.slice(7)));  return; }
  if (text.startsWith("/todo "))  { addAIMessage(await runTool("todo",  text.slice(5)));  return; }
  if (text.startsWith("/timer ")) { addAIMessage(await runTool("timer", text.slice(7)));  return; }
  if (text.startsWith("/search ")){ addAIMessage(await runTool("search",text.slice(8)));  return; }
  if (text.startsWith("/news"))   { addAIMessage(await runTool("news",  text.slice(5)));  return; }
  if (text.startsWith("/system")) { addAIMessage(await runTool("system",""));             return; }

  const typingId = showTypingIndicator();
  try {
    const res = await fetch("/api/chat", {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({
        message:     text,
        history:     chat.messages.slice(-20).map(m=>({role:m.role==="aria"?"assistant":"user",content:m.content})),
        provider:    currentSettings.provider    || "openrouter",
        personality: currentSettings.personality || "hacker",
      }),
    });
    const data = await res.json();
    removeTypingIndicator(typingId);
    addAIMessage(data.reply?.trim() || "[No reply]");
  } catch {
    removeTypingIndicator(typingId);
    addAIMessage("[Error contacting server]");
  }
}

function showTypingIndicator() {
  const id = "typing_" + Date.now();
  const div = document.createElement("div");
  div.classList.add("msg","aria","typingIndicator");
  div.id = id;
  div.innerHTML = `<div class="msgSender">ARIA</div><div class="typingDots"><span></span><span></span><span></span></div>`;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
  return id;
}
function removeTypingIndicator(id) { document.getElementById(id)?.remove(); }

function addAIMessage(content) {
  const chat = getCurrentChat();
  if (!chat) return;
  chat.messages.push({ role:"aria", content, timestamp:Date.now() });
  saveChats(); syncToServer(); renderMessages();
  if (ttsEnabled) speak(content);
}

/* ─────────────────────────────────────────────
   PERSISTENCE
───────────────────────────────────────────── */
function saveChats() {
  localStorage.setItem("aria_chats", JSON.stringify(chats));
}

async function syncToServer() {
  try {
    await fetch("/api/saveChats", {
      method:"POST", headers:{"Content-Type":"application/json"},
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
      const localIds = new Set(chats.map(c=>c.id));
      const newer    = data.chats.filter(c=>!localIds.has(c.id));
      chats = [...newer, ...chats].sort((a,b)=>b.id.localeCompare(a.id));
      currentChatId = chats[0].id;
      saveChats();
      renderChatList();
      renderMessages();
    }
  } catch {}
}
