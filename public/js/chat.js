import { speak, ttsEnabled } from "./tts.js";
import { loadSettings } from "./personality.js";
import { runTool } from "./tools.js";

let chats = [];
let currentChatId = null;

const newChatBtn = document.getElementById("newChatBtn");
const sendBtn = document.getElementById("sendBtn");
const userInput = document.getElementById("userInput");
const messages = document.getElementById("messages");
const chatList = document.getElementById("chatList");

let currentSettings = loadSettings();

/* -----------------------------
   LOAD CHATS FROM LOCALSTORAGE
----------------------------- */
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
loadFromServer();

/* -----------------------------
   EVENT LISTENERS
----------------------------- */
newChatBtn?.addEventListener("click", () => {
  createNewChat();
  renderChatList();
  renderMessages();
});

sendBtn?.addEventListener("click", sendMessage);

userInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

/* -----------------------------
   CREATE NEW CHAT
----------------------------- */
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

/* -----------------------------
   MARKDOWN RENDERER
   Converts AI markdown to styled HTML.
   Handles: headings, bold, italic, inline code,
   code blocks, bullet lists, numbered lists, hr, line breaks.
----------------------------- */
function renderMarkdown(text) {
  if (!text) return "";

  let html = text
    // Escape raw HTML first to prevent injection
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Fenced code blocks (``` lang\n...\n```)
  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const langLabel = lang
      ? `<span class="codeLabel">${lang.toUpperCase()}</span>`
      : "";
    return `<div class="codeBlock">${langLabel}<pre><code>${code.trim()}</code></pre></div>`;
  });

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code class="inlineCode">$1</code>');

  // H1 — ## Heading (we treat # and ## as big headings in chat context)
  html = html.replace(/^### (.+)$/gm, '<h3 class="mdH3">$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2 class="mdH2">$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1 class="mdH1">$1</h1>');

  // Horizontal rule
  html = html.replace(/^---$/gm, '<hr class="mdHr" />');

  // Bold + italic (***text***)
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");

  // Bold (**text**)
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong class="mdBold">$1</strong>');

  // Italic (*text*)
  html = html.replace(/\*(.+?)\*/g, '<em class="mdItalic">$1</em>');

  // Bullet lists — wrap consecutive lines starting with - or *
  html = html.replace(/((?:^[*\-] .+\n?)+)/gm, (block) => {
    const items = block
      .trim()
      .split("\n")
      .map((line) => `<li>${line.replace(/^[*\-] /, "")}</li>`)
      .join("");
    return `<ul class="mdList">${items}</ul>`;
  });

  // Numbered lists
  html = html.replace(/((?:^\d+\. .+\n?)+)/gm, (block) => {
    const items = block
      .trim()
      .split("\n")
      .map((line) => `<li>${line.replace(/^\d+\. /, "")}</li>`)
      .join("");
    return `<ol class="mdList">${items}</ol>`;
  });

  // Paragraphs — wrap double-newline separated blocks that aren't already tags
  html = html
    .split(/\n{2,}/)
    .map((block) => {
      const trimmed = block.trim();
      if (!trimmed) return "";
      // Don't wrap if it's already an HTML block element
      if (/^<(h[1-3]|ul|ol|div|pre|hr)/.test(trimmed)) return trimmed;
      return `<p class="mdPara">${trimmed.replace(/\n/g, "<br/>")}</p>`;
    })
    .join("\n");

  return html;
}

/* -----------------------------
   RENDER CHAT LIST
----------------------------- */
function renderChatList() {
  chatList.innerHTML = "";
  chats.forEach((chat) => {
    const btn = document.createElement("button");
    btn.className = "chatItem";
    btn.textContent = chat.title || "Untitled";
    if (chat.id === currentChatId) btn.classList.add("active");

    btn.onclick = () => {
      currentChatId = chat.id;
      renderChatList();
      renderMessages();
    };

    chatList.appendChild(btn);
  });
}

/* -----------------------------
   RENDER MESSAGES
----------------------------- */
function renderMessages() {
  messages.innerHTML = "";
  const chat = getCurrentChat();
  if (!chat) return;

  chat.messages.forEach((msg) => {
    const div = document.createElement("div");
    div.classList.add("msg", msg.role);

    // User messages: plain text (escape HTML). ARIA messages: render markdown.
    const bodyHTML =
      msg.role === "aria"
        ? renderMarkdown(msg.content)
        : `<p class="mdPara">${msg.content
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")}</p>`;

    div.innerHTML = `
      <div class="msgSender">${msg.role === "user" ? "YOU" : "ARIA"}</div>
      <div class="msgBody">${bodyHTML}</div>
      <div class="msgTimestamp">
        ${new Date(msg.timestamp).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })}
      </div>
    `;

    messages.appendChild(div);
  });

  messages.scrollTop = messages.scrollHeight;
}

/* -----------------------------
   BUILD CONTEXT HISTORY
   Converts stored messages into the
   OpenAI-style array the server expects.
   Caps at last 20 messages to stay within token limits.
----------------------------- */
function buildHistory(chat) {
  const recent = chat.messages.slice(-20);
  return recent.map((msg) => ({
    role: msg.role === "aria" ? "assistant" : "user",
    content: msg.content,
  }));
}

/* -----------------------------
   SEND MESSAGE
----------------------------- */
async function sendMessage() {
  const text = userInput.value.trim();
  if (!text) return;

  currentSettings = loadSettings();

  const chat = getCurrentChat();
  if (!chat) return;

  const userMsg = {
    role: "user",
    content: text,
    timestamp: Date.now(),
  };

  chat.messages.push(userMsg);

  if (chat.title === "New Chat") {
    chat.title = generateChatTitle(text);
    renderChatList();
  }

  userInput.value = "";
  saveChats();
  syncToServer();
  renderMessages();

  /* -------------------------
     TOOL COMMANDS
  ------------------------- */
  if (text.startsWith("/calc ")) {
    const expr = text.replace("/calc ", "");
    const output = await runTool("calc", expr);
    addAIMessage(output);
    return;
  }

  if (text.startsWith("/time")) {
    const output = await runTool("time", "");
    addAIMessage(output);
    return;
  }

  /* -------------------------
     TYPING INDICATOR
  ------------------------- */
  const typingId = showTypingIndicator();

  /* -------------------------
     SEND TO BACKEND AI
  ------------------------- */
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: text,
        // Full conversation history for context
        history: buildHistory(chat),
        provider: currentSettings.provider || "openrouter",
        personality: currentSettings.personality || "hacker",
      }),
    });

    const data = await res.json();
    const reply = data.reply?.trim() || "[No reply]";

    removeTypingIndicator(typingId);
    addAIMessage(reply);
  } catch (err) {
    removeTypingIndicator(typingId);
    addAIMessage("[Error contacting server]");
  }
}

/* -----------------------------
   TYPING INDICATOR
----------------------------- */
function showTypingIndicator() {
  const id = "typing_" + Date.now();
  const div = document.createElement("div");
  div.classList.add("msg", "aria", "typingIndicator");
  div.id = id;
  div.innerHTML = `
    <div class="msgSender">ARIA</div>
    <div class="typingDots"><span></span><span></span><span></span></div>
  `;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
  return id;
}

function removeTypingIndicator(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
}

/* -----------------------------
   ADD AI MESSAGE
----------------------------- */
function addAIMessage(content) {
  const chat = getCurrentChat();
  const aiMsg = {
    role: "aria",
    content,
    timestamp: Date.now(),
  };

  chat.messages.push(aiMsg);
  saveChats();
  syncToServer();
  renderMessages();

  if (ttsEnabled) speak(content);
}

/* -----------------------------
   TITLE GENERATOR
----------------------------- */
function generateChatTitle(message) {
  if (!message) return "New Chat";
  let title = message.trim();
  if (title.length > 30) title = title.substring(0, 30) + "...";
  return title.charAt(0).toUpperCase() + title.slice(1);
}

/* -----------------------------
   SAVE CHATS
----------------------------- */
function saveChats() {
  localStorage.setItem("aria_chats", JSON.stringify(chats));
}

/* -----------------------------
   SYNC TO SERVER
----------------------------- */
async function syncToServer() {
  try {
    await fetch("/api/saveChats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: window.ARIA_userId || "sarvin", chats }),
    });
  } catch {}
}

/* -----------------------------
   LOAD FROM SERVER
----------------------------- */
async function loadFromServer() {
  try {
    const res = await fetch(`/api/loadChats?userId=${window.ARIA_userId || "sarvin"}`);
    const data = await res.json();

    if (data.chats && data.chats.length) {
      chats = data.chats;
      currentChatId = chats[0].id;
      saveChats();
      renderChatList();
      renderMessages();
    }
  } catch {}
}
