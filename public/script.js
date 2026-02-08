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

// timestamp formatter
function formatTimestamp(ts) {
  const d = new Date(ts);
  return d.toLocaleString();
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

  [...chats].reverse().forEach((chat) => {
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
    const wrapper = document.createElement("div");
    wrapper.className = "msg " + (m.role === "assistant" ? "aria" : "user");

    const name = m.role === "assistant" ? "ARIA" : "You";
    const time = m.timestamp ? formatTimestamp(m.timestamp) : "";

    const text = document.createElement("div");
    text.className = "msgText";
    text.textContent = `${name}: ${m.content}`;

    const ts = document.createElement("div");
    ts.className = "msgTimestamp";
    ts.textContent = time;

    wrapper.appendChild(text);
    wrapper.appendChild(ts);
    msgBox.appendChild(wrapper);
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

  chat.messages.push({
    role: "user",
    content: text,
    timestamp: Date.now(),
  });
  saveChats();
  renderChatList();
  renderMessages();

  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: text }),
  });

  const data = await res.json();

  chat.messages.push({
    role: "assistant",
    content: data.reply,
    timestamp: Date.now(),
  });
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

const micBtn = document.createElement("button");
micBtn.id = "micBtn";
micBtn.textContent = "🎤";
document.getElementById("inputBar").appendChild(micBtn);

let recognition;

try {
  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.lang = "en-US";
} catch (e) {
  console.log("Speech recognition not supported");
}

micBtn.addEventListener("click", () => {
  if (!recognition) return;
  recognition.start();
});

recognition.addEventListener("result", (e) => {
  const text = e.results[0][0].transcript;
  document.getElementById("userInput").value = text;
});

// ---------------- VOICE OUTPUT (TEXT‑TO‑SPEECH) ----------------

// speak() = ARIA's voice

// ---------------- ARIA VOICE SELECTION ----------------

let ariaVoice = null;

function loadVoices() {
  const voices = speechSynthesis.getVoices();

  // pick a good default female / US voice
  ariaVoice =
    voices.find((v) => v.name.includes("Female")) ||
    voices.find((v) => v.name.includes("Samantha")) ||
    voices.find((v) => v.name.includes("Google")) ||
    voices.find((v) => v.lang === "en-US") ||
    voices[0];
}

speechSynthesis.onvoiceschanged = loadVoices;
loadVoices();

ariaVoice = speechSynthesis
  .getVoices()
  .find((v) => v.name === "Google US English");

// speak with selected voice + interruption
function speak(text) {
  speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.voice = ariaVoice;
  utter.rate = 1;
  utter.pitch = 1;
  utter.volume = 1;
  speechSynthesis.speak(utter);
}

// toggle button for auto‑speak mode
const voiceToggle = document.createElement("button");
voiceToggle.id = "voiceToggle";
voiceToggle.textContent = "🔈";
voiceToggle.style.marginLeft = "10px";
voiceToggle.style.padding = "12px";
voiceToggle.style.background = "#111";
voiceToggle.style.border = "1px solid #333";
voiceToggle.style.borderRadius = "6px";
voiceToggle.style.color = "#e63946";
voiceToggle.style.cursor = "pointer";
voiceToggle.style.fontSize = "18px";

document.getElementById("inputBar").appendChild(voiceToggle);

let autoSpeak = false;

voiceToggle.addEventListener("click", () => {
  autoSpeak = !autoSpeak;
  voiceToggle.style.borderColor = autoSpeak ? "#e63946" : "#333";
  voiceToggle.style.boxShadow = autoSpeak ? "0 0 10px #e63946" : "none";
});

// patch ARIA's reply handler to speak automatically
const originalSend = document.getElementById("sendBtn").onclick;

document.getElementById("sendBtn").onclick = async () => {
  await originalSend();

  const chat = chats.find((c) => c.id === currentChatId);
  if (!chat) return;

  const last = chat.messages[chat.messages.length - 1];
  if (last && last.role === "assistant" && autoSpeak) {
    speak(last.content);
  }
};

// ---------------- SIDEBAR SETTINGS PANEL ----------------

const voiceSelect = document.getElementById("voiceSelect");
const voiceRate = document.getElementById("voiceRate");
const voicePitch = document.getElementById("voicePitch");

function populateVoiceList() {
  const voices = speechSynthesis.getVoices();
  voiceSelect.innerHTML = "";

  voices.forEach((v, i) => {
    const opt = document.createElement("option");
    opt.value = i;
    opt.textContent = `${v.name} (${v.lang})`;
    voiceSelect.appendChild(opt);
  });

  const defaultIndex = voices.indexOf(ariaVoice);
  if (defaultIndex >= 0) voiceSelect.value = defaultIndex;
}

speechSynthesis.onvoiceschanged = populateVoiceList;
populateVoiceList();

voiceSelect.onchange = () => {
  const voices = speechSynthesis.getVoices();
  ariaVoice = voices[voiceSelect.value];
};

voiceRate.oninput = () => {
  window.ariaRate = parseFloat(voiceRate.value);
};

voicePitch.oninput = () => {
  window.ariaPitch = parseFloat(voicePitch.value);
};

// patch speak() to use rate/pitch
const oldSpeak = speak;
speak = function (text) {
  speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.voice = ariaVoice;
  utter.rate = window.ariaRate || 1;
  utter.pitch = window.ariaPitch || 1;
  utter.volume = 1;
  speechSynthesis.speak(utter);
};

// ---------------- FULL CALL MODE ENGINE ----------------

let callMode = false;
let listening = false;
let continuousRecognition;
let silenceTimer = null;

// create waveform bars
const wave = document.getElementById("voiceWave");
for (let i = 0; i < 6; i++) {
  const bar = document.createElement("span");
  wave.appendChild(bar);
}

const callBtn = document.getElementById("callModeBtn");

// setup continuous recognition
try {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  continuousRecognition = new SR();
  continuousRecognition.continuous = true;
  continuousRecognition.interimResults = true;
  continuousRecognition.lang = "en-US";
} catch (e) {
  console.log("Speech recognition not supported");
}

// speak with interruption
function speak(text) {
  speechSynthesis.cancel(); // interrupt current speech
  const utter = new SpeechSynthesisUtterance(text);
  utter.rate = 1;
  utter.pitch = 1;
  utter.volume = 1;
  speechSynthesis.speak(utter);
}

// toggle call mode
callBtn.addEventListener("click", () => {
  callMode = !callMode;
  callBtn.classList.toggle("active", callMode);
  document.getElementById("callIndicator").classList.toggle("active", callMode);

  if (callMode) {
    wave.classList.add("active");
    continuousRecognition.start();
  } else {
    wave.classList.remove("active");
    continuousRecognition.stop();
    speechSynthesis.cancel();
  }
});

// waveform animation
function animateWave(level) {
  const bars = wave.querySelectorAll("span");
  bars.forEach((bar, i) => {
    const h = Math.max(4, level - i * 3);
    bar.style.height = h + "px";
  });
}

// silence detection
function resetSilenceTimer() {
  clearTimeout(silenceTimer);
  silenceTimer = setTimeout(() => {
    listening = false;
    animateWave(4);
  }, 1200);
}

// recognition events
continuousRecognition.addEventListener("result", async (e) => {
  if (!callMode) return;

  const result = e.results[e.results.length - 1];
  const text = result[0].transcript.trim();

  // animate waveform based on speech confidence
  const level = Math.floor(result[0].confidence * 40) + 10;
  animateWave(level);

  listening = true;
  resetSilenceTimer();

  if (!result.isFinal) return;

  // stop ARIA if she's talking
  speechSynthesis.cancel();

  // push user message
  const chat = chats.find((c) => c.id === currentChatId);
  chat.messages.push({
    role: "user",
    content: text,
    timestamp: Date.now(),
  });
  saveChats();
  renderMessages();

  // send to backend
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: text }),
  });

  const data = await res.json();

  // push ARIA reply
  chat.messages.push({
    role: "assistant",
    content: data.reply,
    timestamp: Date.now(),
  });
  saveChats();
  renderMessages();

  // speak ARIA reply
  speak(data.reply);
});

// restart recognition if it stops
continuousRecognition.addEventListener("end", () => {
  if (callMode) continuousRecognition.start();
});

const voiceOffBtn = document.getElementById("voiceOffBtn");

voiceOffBtn.addEventListener("click", () => {
  speechSynthesis.cancel();
  if (recognition) recognition.stop();
  if (continuousRecognition) continuousRecognition.stop();

  callMode = false;
  callBtn.classList.remove("active");
  wave.classList.remove("active");
});
