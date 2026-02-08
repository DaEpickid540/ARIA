// ---------------- PASSWORD LOCK ----------------

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

// main state (declare ONCE)
let chats = [];
let currentChatId = null;

// load saved chats
const saved = localStorage.getItem("aria_chats");
if (saved) {
  chats = JSON.parse(saved);
  currentChatId = chats[0]?.id || null;
}

// save helper
function saveChats() {
  localStorage.setItem("aria_chats", JSON.stringify(chats));
}

// generate a title from first user message
function generateTitle(text) {
  const cleaned = text.trim();
  if (cleaned.length <= 30) return cleaned;
  return cleaned.slice(0, 30) + "...";
}

// rename a chat
function renameChat(id) {
  const chat = chats.find((c) => c.id === id);
  if (!chat) return;

  const newName = prompt("Rename chat:", chat.title);
  if (!newName || !newName.trim()) return;

  chat.title = newName.trim();
  saveChats();
  renderChatList();
}

function createNewChat() {
  const id = Date.now();
  chats.push({ id, title: "New Chat", messages: [] });
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

    const title = document.createElement("span");
    title.textContent = chat.title;
    title.style.flex = "1";
    title.onclick = () => {
      currentChatId = chat.id;
      renderMessages();
    };

    const renameBtn = document.createElement("button");
    renameBtn.textContent = "✎";
    renameBtn.style.marginLeft = "10px";
    renameBtn.style.cursor = "pointer";
    renameBtn.style.background = "transparent";
    renameBtn.style.border = "none";
    renameBtn.style.color = "#e63946";
    renameBtn.style.fontSize = "16px";

    renameBtn.onclick = (e) => {
      e.stopPropagation();
      renameChat(chat.id);
    };

    div.appendChild(title);
    div.appendChild(renameBtn);
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

    div.className = "msg " + (m.role === "assistant" ? "aria" : "user");

    const name = m.role === "assistant" ? "ARIA" : "You";
    div.textContent = name + ": " + m.content;

    msgBox.appendChild(div);
  });

  msgBox.scrollTop = msgBox.scrollHeight;
}

document.getElementById("newChatBtn").onclick = createNewChat;

document.getElementById("sendBtn").onclick = async () => {
  const input = document.getElementById("userInput");
  const text = input.value.trim();
  if (!text) return;

  const chat = chats.find((c) => c.id === currentChatId);

  if (chat.title === "New Chat") {
    chat.title = generateTitle(text);
  }

  chat.messages.push({ role: "user", content: text });
  saveChats();
  renderChatList();
  renderMessages();

  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: text }),
  });

  const data = await res.json();

  chat.messages.push({ role: "assistant", content: data.reply });
  saveChats();
  renderMessages();

  input.value = "";
};

document.getElementById("userInput").onkeydown = (e) => {
  if (e.key === "Enter") document.getElementById("sendBtn").click();
};

if (chats.length === 0) {
  createNewChat();
} else {
  renderChatList();
  renderMessages();
}
