window.addEventListener("DOMContentLoaded", () => {
  const unlockBtn = document.getElementById("unlockBtn");
  const passwordInput = document.getElementById("passwordInput");
  const lockBox = document.getElementById("lockBox");
  const lockError = document.getElementById("lockError");
  const lockScreen = document.getElementById("lockScreen");
  const homepage = document.getElementById("homepageScreen");
  const layout = document.getElementById("layout");
  const enterConsoleBtn = document.getElementById("enterConsoleBtn");

  const newChatBtn = document.getElementById("newChatBtn");
  const sendBtn = document.getElementById("sendBtn");
  const userInput = document.getElementById("userInput");
  const messages = document.getElementById("messages");
  const chatList = document.getElementById("chatList");
  const loader = document.getElementById("ariaLoading");

  let chats = [];
  let currentChatId = null;

  function tryUnlock() {
    const password = passwordInput.value.trim();
    if (password === "727846") {
      lockBox.classList.add("unlocking");
      setTimeout(() => {
        lockScreen.style.display = "none";
        homepage.style.display = "flex";
      }, 300);
    } else {
      lockError.textContent = "Incorrect password";
    }
  }

  unlockBtn.onclick = tryUnlock;
  passwordInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") tryUnlock();
  });

  if (enterConsoleBtn) {
    enterConsoleBtn.onclick = () => {
      homepage.style.display = "none";
      layout.style.display = "flex";
    };
  }

  function createNewChat() {
    const id = "chat_" + Date.now();
    const chat = { id, title: "New Chat", messages: [] };
    chats.unshift(chat);
    currentChatId = id;
    saveChats();
    syncToServer();
    renderChatList();
    renderMessages();
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
    userInput.value = "";
    saveChats();
    syncToServer();
    renderMessages();

    try {
      if (loader) loader.classList.add("active");
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      const data = await res.json();
      const reply = data.reply?.trim() || "[No reply]";
      const aiMsg = { role: "aria", content: reply, timestamp: Date.now() };
      chat.messages.push(aiMsg);
      saveChats();
      syncToServer();
      renderMessages();
    } catch (err) {
      console.error("Chat error:", err);
      chat.messages.push({
        role: "aria",
        content: "[Error contacting server]",
        timestamp: Date.now(),
      });
      renderMessages();
    } finally {
      if (loader) loader.classList.remove("active");
    }
  }

  function saveChats() {
    try {
      localStorage.setItem("aria_chats", JSON.stringify(chats));
    } catch (e) {
      console.error("local save failed", e);
    }
  }

  async function syncToServer() {
    try {
      await fetch("/api/saveChats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "sarvin", chats }),
      });
    } catch (e) {
      console.error("sync failed", e);
    }
  }

  async function loadFromServer() {
    try {
      const res = await fetch("/api/loadChats?userId=sarvin");
      const data = await res.json();
      chats = data.chats || [];
      if (chats.length > 0) {
        currentChatId = chats[0].id;
      } else {
        createNewChat();
      }
      saveChats();
      renderChatList();
      renderMessages();
    } catch (e) {
      console.error("load failed", e);
    }
  }

  if (newChatBtn) newChatBtn.onclick = createNewChat;
  if (sendBtn) sendBtn.onclick = sendMessage;
  if (userInput) {
    userInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
  }

  loadFromServer();
});
