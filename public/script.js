window.addEventListener("DOMContentLoaded", () => {
  // LOCK SCREEN
  const PASSWORD = "727846";
  const unlockBtn = document.getElementById("unlockBtn");
  const passwordInput = document.getElementById("passwordInput");
  const lockError = document.getElementById("lockError");
  const lockScreen = document.getElementById("lockScreen");
  const homepage = document.getElementById("homepageScreen");
  const layout = document.getElementById("layout");
  const enterConsoleBtn = document.getElementById("enterConsoleBtn");

  unlockBtn.onclick = tryUnlock;
  passwordInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") tryUnlock();
  });

  function tryUnlock() {
    const input = passwordInput.value.trim();
    if (input === PASSWORD) {
      lockScreen.style.display = "none";
      homepage.style.display = "flex";
    } else {
      lockError.textContent = "Incorrect password";
    }
  }

  if (enterConsoleBtn) {
    enterConsoleBtn.onclick = () => {
      homepage.style.display = "none";
      layout.style.display = "flex";
    };
  }

  // HOMEPAGE INFO
  const homeTime = document.getElementById("homeTime");
  const homeSystem = document.getElementById("homeSystem");

  if (homeTime) {
    const now = new Date();
    homeTime.textContent = now.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  if (homeSystem) {
    homeSystem.innerHTML = `
      <div>GPU: RX 6700 XT</div>
      <div>Plan: T-Mobile Essentials</div>
      <div>Scout Rank: Star Scout</div>
      <div>Merit Badges Left: 2</div>
    `;
  }

  // CHAT SYSTEM
  let chats = [];
  let currentChatId = null;

  const newChatBtn = document.getElementById("newChatBtn");
  const sendBtn = document.getElementById("sendBtn");
  const userInput = document.getElementById("userInput");
  const messages = document.getElementById("messages");
  const chatList = document.getElementById("chatList");
  const loader = document.getElementById("ariaLoading");

  const saved = localStorage.getItem("aria_chats");
  if (saved) {
    try {
      chats = JSON.parse(saved);
      if (chats.length > 0) currentChatId = chats[0].id;
    } catch (e) {
      chats = [];
    }
  }

  if (!currentChatId) createNewChat();

  renderChatList();
  renderMessages();

  if (newChatBtn)
    newChatBtn.onclick = () => {
      createNewChat();
      renderChatList();
      renderMessages();
    };

  if (sendBtn) sendBtn.onclick = sendMessage;
  if (userInput) {
    userInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
  }

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
      if (chats.length > 0) currentChatId = chats[0].id;
      saveChats();
      renderChatList();
      renderMessages();
    } catch (e) {
      console.error("load failed", e);
    }
  }

  loadFromServer();
});
