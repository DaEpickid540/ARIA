import { remember, recall } from "./memory.js";
import { runTool } from "./tools.js";
import { speak, ttsEnabled } from "./tts.js";

window.addEventListener("DOMContentLoaded", () => {
  let chats = [];
  let currentChatId = null;

  const newChatBtn = document.getElementById("newChatBtn");
  const sendBtn = document.getElementById("sendBtn");
  const userInput = document.getElementById("userInput");
  const messages = document.getElementById("messages");
  const chatList = document.getElementById("chatList");

  function generateChatTitle(message) {
    if (!message) return "New Chat";
    let title = message.trim();
    if (title.length > 30) title = title.substring(0, 30) + "...";
    return title.charAt(0).toUpperCase() + title.slice(1);
  }

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

  function renderMessages() {
    messages.innerHTML = "";
    const chat = getCurrentChat();
    if (!chat) return;

    chat.messages.forEach((msg) => {
      const div = document.createElement("div");
      div.classList.add("msg", msg.role);
      div.innerHTML = `
        <div class="msgSender">${msg.role === "user" ? "You" : "ARIA"}</div>
        <div class="msgText">${msg.content}</div>
        <div class="msgTimestamp">${new Date(msg.timestamp).toLocaleTimeString(
          [],
          {
            hour: "2-digit",
            minute: "2-digit",
          },
        )}</div>
      `;
      messages.appendChild(div);
    });

    messages.scrollTop = messages.scrollHeight;
  }

  async function sendMessage() {
    const text = userInput.value.trim();
    if (!text) return;

    const chat = getCurrentChat();
    if (!chat) return;

    const userMsg = { role: "user", content: text, timestamp: Date.now() };
    chat.messages.push(userMsg);

    if (chat.title === "New Chat") {
      chat.title = generateChatTitle(text);
      renderChatList();
    }

    userInput.value = "";
    saveChats();
    syncToServer();
    renderMessages();

    // Simple tool commands
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

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });

      const data = await res.json();
      const reply = data.reply?.trim() || "[No reply]";
      addAIMessage(reply);
    } catch (err) {
      addAIMessage("[Error contacting server]");
    }
  }

  function addAIMessage(content) {
    const chat = getCurrentChat();
    const aiMsg = { role: "aria", content, timestamp: Date.now() };
    chat.messages.push(aiMsg);
    saveChats();
    syncToServer();
    renderMessages();

    if (ttsEnabled) {
      speak(content);
    }
  }

  function saveChats() {
    localStorage.setItem("aria_chats", JSON.stringify(chats));
  }

  async function syncToServer() {
    await fetch("/api/saveChats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: "sarvin", chats }),
    });
  }

  async function loadFromServer() {
    try {
      const res = await fetch("/api/loadChats?userId=sarvin");
      const data = await res.json();
      if (data.chats && data.chats.length) {
        chats = data.chats;
        currentChatId = chats[0].id;
        saveChats();
        renderChatList();
        renderMessages();
      }
    } catch {
      // ignore
    }
  }
});
