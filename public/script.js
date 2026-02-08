// ---------------- PASSWORD LOCK ----------------
let chats = [];
let currentChatId = null;

// Load saved chats
const saved = localStorage.getItem("aria_chats");
if (saved) {
  chats = JSON.parse(saved);
  currentChatId = chats[0]?.id || null;
}

const PASSWORD = "727846";

document.getElementById("unlockBtn").onclick = () => {
  const input = document.getElementById("passwordInput").value;

  if (input === PASSWORD) {
    document.getElementById("lockScreen").style.display = "none";
  } else {
    document.getElementById("lockError").textContent = "Incorrect password";
  }
};

// ---------------- CHAT SYSTEM ----------------

let chats = [];
let currentChatId = null;

function createNewChat() {
  const id = Date.now();
  chats.push({ id, messages: [] });
  currentChatId = id;
  saveChats();
  renderChatList();
  renderMessages();
}

function renderChatList() {
  const list = document.getElementById("chatList");
  list.innerHTML = "";

  chats.forEach((chat) => {
    const div = document.createElement("div");
    div.className = "chatItem";
    div.textContent = "Chat " + chat.id;
    div.onclick = () => {
      currentChatId = chat.id;
      renderMessages();
    };
    list.appendChild(div);
  });
}

function renderMessages() {
  const chat = chats.find((c) => c.id === currentChatId);
  const msgBox = document.getElementById("messages");
  msgBox.innerHTML = "";

  if (!chat) return;

  chat.messages.forEach((m) => {
    const div = document.createElement("div");
    div.textContent = m.role + ": " + m.content;
    msgBox.appendChild(div);
  });

  msgBox.scrollTop = msgBox.scrollHeight;
}

function saveChats() {
  localStorage.setItem("aria_chats", JSON.stringify(chats));
}

document.getElementById("newChatBtn").onclick = createNewChat;

document.getElementById("sendBtn").onclick = async () => {
  const input = document.getElementById("userInput");
  const text = input.value.trim();
  if (!text) return;

  const chat = chats.find((c) => c.id === currentChatId);
  chat.messages.push({ role: "You", content: text });
  saveChats();
  renderMessages();

  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: text }),
  });

  const data = await res.json();
  chat.messages.push({ role: "ARIA", content: data.reply });
  saveChats();
  renderMessages();

  input.value = "";
};

document.getElementById("userInput").onkeydown = (e) => {
  if (e.key === "Enter") document.getElementById("sendBtn").click();
};

// Start with one chat
createNewChat();
