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

    // apply bubble classes
    div.className = "msg " + (m.role === "assistant" ? "aria" : "user");

    // display names
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

  // user message
  chat.messages.push({ role: "user", content: text });
  saveChats();
  renderMessages();

  // send to backend
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: text }),
  });

  const data = await res.json();

  // assistant message
  chat.messages.push({ role: "assistant", content: data.reply });
  saveChats();
  renderMessages();

  input.value = "";
};

document.getElementById("userInput").onkeydown = (e) => {
  if (e.key === "Enter") document.getElementById("sendBtn").click();
};

// start with one chat if none exist
if (chats.length === 0) {
  createNewChat();
} else {
  renderChatList();
  renderMessages();
}
