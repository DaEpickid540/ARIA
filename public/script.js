const input = document.getElementById("user-input");
const sendBtn = document.getElementById("send-btn");
const messages = document.getElementById("messages");

function addMessage(sender, text) {
  const div = document.createElement("div");
  div.textContent = `${sender}: ${text}`;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
}

async function sendMessage() {
  const text = input.value.trim();
  if (!text) return;

  addMessage("You", text);
  input.value = "";

  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: text }),
  });

  const data = await res.json();
  addMessage("ARIA", data.reply);
}

sendBtn.onclick = sendMessage;
input.onkeydown = (e) => {
  if (e.key === "Enter") sendMessage();
};

let chats = [];
let currentChatId = null;

function createNewChat() {
  const id = Date.now();
  chats.push({ id, messages: [] });
  currentChatId = id;
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
}

document.getElementById("newChatBtn").onclick = createNewChat;

document.getElementById("sendBtn").onclick = async () => {
  const input = document.getElementById("userInput");
  const text = input.value.trim();
  if (!text) return;

  const chat = chats.find((c) => c.id === currentChatId);
  chat.messages.push({ role: "user", content: text });
  renderMessages();

  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: text }),
  });

  const data = await res.json();
  chat.messages.push({ role: "assistant", content: data.reply });
  renderMessages();

  input.value = "";
};

// Start with one chat
createNewChat();
