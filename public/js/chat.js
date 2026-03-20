import { speak, ttsEnabled } from "./tts.js";
import { loadSettings } from "./personality.js";
import { runTool } from "./tools.js";

let chats = [];
let currentChatId = null;
let currentSettings = loadSettings();

const newChatBtn = document.getElementById("newChatBtn");
const sendBtn = document.getElementById("sendBtn");
const userInput = document.getElementById("userInput");
const messages = document.getElementById("messages");
const chatList = document.getElementById("chatList");

/* =====================================================
   LOAD CHATS — server first, localStorage fallback
   ===================================================== */
const saved = localStorage.getItem("aria_chats");
if (saved) {
  try {
    chats = JSON.parse(saved);
    if (chats.length > 0) currentChatId = chats[0].id;
  } catch {
    chats = [];
  }
}

if (!currentChatId) createNewChat();

renderChatList();
renderMessages();
loadFromServer(); // may update if server has newer data

/* =====================================================
   EVENT LISTENERS
   ===================================================== */
newChatBtn?.addEventListener("click", () => {
  createNewChat();
  renderChatList();
  renderMessages();
  window.ARIA_closeSidebar?.(); // close sidebar on mobile after new chat
});

sendBtn?.addEventListener("click", sendMessage);
userInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

/* =====================================================
   CREATE NEW CHAT
   ===================================================== */
function createNewChat() {
  const id = "chat_" + Date.now();
  const chat = { id, title: "New Chat", messages: [] };
  chats.unshift(chat);
  currentChatId = id;
  saveChats();
  syncToServer();
}

function getCurrentChat() {
  return chats.find((c) => c.id === currentChatId) || null;
}

/* =====================================================
   DELETE CHAT — syncs to server + all devices
   ===================================================== */
function deleteChat(chatId) {
  chats = chats.filter((c) => c.id !== chatId);

  // If deleted the current chat, switch to first available
  if (currentChatId === chatId) {
    if (chats.length === 0) createNewChat();
    else currentChatId = chats[0].id;
  }

  saveChats();
  syncToServer(); // push deletion to server → all devices update on next load
  renderChatList();
  renderMessages();

  // Notify homepage recent chats to refresh if it's open
  window.ARIA_refreshRecentChats?.();
}

/* Expose globally so homepage recentChats can call it */
window.ARIA_deleteChat = deleteChat;

/* =====================================================
   RENAME CHAT — inline prompt
   ===================================================== */
function renameChat(chatId) {
  const chat = chats.find((c) => c.id === chatId);
  if (!chat) return;

  const newTitle = prompt("Rename chat:", chat.title);
  if (!newTitle || !newTitle.trim()) return;

  chat.title = newTitle.trim().substring(0, 40);
  saveChats();
  syncToServer();
  renderChatList();

  window.ARIA_refreshRecentChats?.();
}

window.ARIA_renameChat = renameChat;

/* =====================================================
   RENDER CHAT LIST — with delete + rename buttons
   ===================================================== */
function renderChatList() {
  chatList.innerHTML = "";

  chats.forEach((chat) => {
    // Wrapper row
    const row = document.createElement("div");
    row.className = "chatRow" + (chat.id === currentChatId ? " active" : "");

    // Main chat button
    const btn = document.createElement("button");
    btn.className = "chatItem" + (chat.id === currentChatId ? " active" : "");
    btn.textContent = chat.title || "Untitled";
    btn.title = chat.title;
    btn.onclick = () => {
      currentChatId = chat.id;
      renderChatList();
      renderMessages();
      window.ARIA_closeSidebar?.(); // close on mobile
    };

    // Rename button
    const renameBtn = document.createElement("button");
    renameBtn.className = "chatActionBtn chatRenameBtn";
    renameBtn.title = "Rename";
    renameBtn.innerHTML = "✎";
    renameBtn.onclick = (e) => {
      e.stopPropagation();
      renameChat(chat.id);
    };

    // Delete button
    const delBtn = document.createElement("button");
    delBtn.className = "chatActionBtn chatDeleteBtn";
    delBtn.title = "Delete";
    delBtn.innerHTML = "✕";
    delBtn.onclick = (e) => {
      e.stopPropagation();
      if (confirm(`Delete "${chat.title}"?`)) deleteChat(chat.id);
    };

    row.appendChild(btn);
    row.appendChild(renameBtn);
    row.appendChild(delBtn);
    chatList.appendChild(row);
  });
}

/* Expose for homepage recent chats panel */
window.ARIA_renderChatList = renderChatList;

/* =====================================================
   RENDER MESSAGES
   ===================================================== */
function renderMessages() {
  messages.innerHTML = "";
  const chat = getCurrentChat();
  if (!chat) return;

  chat.messages.forEach((msg) => {
    const div = document.createElement("div");
    div.classList.add("msg", msg.role);

    const bodyHTML =
      msg.role === "aria"
        ? renderMarkdown(msg.content)
        : `<p class="mdPara">${msg.content.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`;

    div.innerHTML = `
      <div class="msgSender">${msg.role === "user" ? "YOU" : "ARIA"}</div>
      <div class="msgBody">${bodyHTML}</div>
      <div class="msgTimestamp">${new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
    `;
    messages.appendChild(div);
  });

  messages.scrollTop = messages.scrollHeight;
}

/* =====================================================
   MARKDOWN RENDERER
   ===================================================== */
function renderMarkdown(text) {
  if (!text) return "";
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  html = html.replace(
    /```(\w*)\n?([\s\S]*?)```/g,
    (_, lang, code) =>
      `<div class="codeBlock">${lang ? `<span class="codeLabel">${lang.toUpperCase()}</span>` : ""}<pre><code>${code.trim()}</code></pre></div>`,
  );
  html = html.replace(/`([^`]+)`/g, '<code class="inlineCode">$1</code>');
  html = html.replace(/^### (.+)$/gm, '<h3 class="mdH3">$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2 class="mdH2">$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1 class="mdH1">$1</h1>');
  html = html.replace(/^---$/gm, '<hr class="mdHr" />');
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong class="mdBold">$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em class="mdItalic">$1</em>');
  html = html.replace(/((?:^[*\-] .+\n?)+)/gm, (block) => {
    const items = block
      .trim()
      .split("\n")
      .map((l) => `<li>${l.replace(/^[*\-] /, "")}</li>`)
      .join("");
    return `<ul class="mdList">${items}</ul>`;
  });
  html = html.replace(/((?:^\d+\. .+\n?)+)/gm, (block) => {
    const items = block
      .trim()
      .split("\n")
      .map((l) => `<li>${l.replace(/^\d+\. /, "")}</li>`)
      .join("");
    return `<ol class="mdList">${items}</ol>`;
  });
  html = html
    .split(/\n{2,}/)
    .map((block) => {
      const t = block.trim();
      if (!t) return "";
      if (/^<(h[1-3]|ul|ol|div|pre|hr)/.test(t)) return t;
      return `<p class="mdPara">${t.replace(/\n/g, "<br/>")}</p>`;
    })
    .join("\n");

  return html;
}

/* =====================================================
   SEND MESSAGE
   ===================================================== */
async function sendMessage() {
  const text = userInput.value.trim();
  if (!text) return;

  currentSettings = loadSettings();
  const chat = getCurrentChat();
  if (!chat) return;

  chat.messages.push({ role: "user", content: text, timestamp: Date.now() });

  if (chat.title === "New Chat") {
    chat.title = generateChatTitle(text);
    renderChatList();
  }

  userInput.value = "";
  saveChats();
  syncToServer();
  renderMessages();

  // Tool commands
  if (text.startsWith("/calc ")) {
    addAIMessage(await runTool("calc", text.replace("/calc ", "")));
    return;
  }
  if (text.startsWith("/time")) {
    addAIMessage(await runTool("time", ""));
    return;
  }

  const typingId = showTypingIndicator();

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: text,
        history: buildHistory(chat),
        provider: currentSettings.provider || "openrouter",
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

/* =====================================================
   HELPERS
   ===================================================== */
function buildHistory(chat) {
  return chat.messages.slice(-20).map((m) => ({
    role: m.role === "aria" ? "assistant" : "user",
    content: m.content,
  }));
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

function addAIMessage(content) {
  const chat = getCurrentChat();
  if (!chat) return;
  chat.messages.push({ role: "aria", content, timestamp: Date.now() });
  saveChats();
  syncToServer();
  renderMessages();
  if (ttsEnabled) speak(content);
}

function generateChatTitle(message) {
  let t = message.trim();
  if (t.length > 30) t = t.substring(0, 30) + "...";
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/* =====================================================
   PERSISTENCE — localStorage + server sync
   ===================================================== */
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

async function loadFromServer() {
  try {
    const uid = window.ARIA_userId || "sarvin";
    const res = await fetch(`/api/loadChats?userId=${uid}`);
    const data = await res.json();

    if (data.chats && data.chats.length > chats.length) {
      // Server has more chats — merge in any we don't have locally
      const localIds = new Set(chats.map((c) => c.id));
      const newChats = data.chats.filter((c) => !localIds.has(c.id));
      chats = [...newChats, ...chats].sort((a, b) => b.id.localeCompare(a.id));
      currentChatId = chats[0].id;
      saveChats();
      renderChatList();
      renderMessages();
    }
  } catch {}
}

/* Expose loadFromServer for cross-device refresh */
window.ARIA_loadFromServer = loadFromServer;
