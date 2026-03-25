import { speak, ttsEnabled } from "./tts.js";
import { loadSettings } from "./personality.js";
import { runTool } from "./tools.js";

/* ── STATE ── */
let chats           = [];
let currentChatId   = null;
let currentSettings = loadSettings();
let isGenerating    = false;
let documentContext = "";
let documentName    = "";
let mathMode        = false;
let programmingMode = false;
let studyMode       = false;
let thinkingMode    = false;
let pendingFiles    = [];   // files queued for next send

const newChatBtn = document.getElementById("newChatBtn");
const sendBtn    = document.getElementById("sendBtn");
const userInput  = document.getElementById("userInput");
const messages   = document.getElementById("messages");
const chatList   = document.getElementById("chatList");

/* ── LOAD ── */
try {
  const saved = localStorage.getItem("aria_chats");
  if (saved) { chats = JSON.parse(saved); if (chats.length) currentChatId = chats[0].id; }
} catch { chats = []; }
if (!currentChatId) createNewChat();
renderChatList(); renderMessages(); loadFromServer();

/* ============================================================
   CODE PANEL — splits chat left / code right
   ============================================================ */
const codePanelEl      = document.getElementById("codePanel");
const codePanelCode    = document.getElementById("codePanelCode");
const codePanelLang    = document.getElementById("codePanelLang");
const codePanelCopy    = document.getElementById("codePanelCopyBtn");
const codePanelDl      = document.getElementById("codePanelDownloadBtn");
const codePanelPreview = document.getElementById("codePanelPreviewBtn");
const codePanelClose   = document.getElementById("codePanelCloseBtn");
const codePanelFrame   = document.getElementById("codePanelPreviewFrame");
const layout           = document.getElementById("layout");
const sidebar          = document.getElementById("sidebar");

let currentCodeContent = "";
let currentCodeLang    = "";
let previewMode        = false;

function openCodePanel(code, lang) {
  currentCodeContent = code;
  currentCodeLang    = lang || "code";
  previewMode        = false;

  if (codePanelCode)    codePanelCode.textContent = code;
  if (codePanelLang)    codePanelLang.textContent = (lang || "CODE").toUpperCase();
  if (codePanelFrame)   { codePanelFrame.style.display = "none"; codePanelFrame.srcdoc = ""; }
  if (codePanelEl) {
    // Show the pre, hide iframe
    const pre = document.getElementById("codePanelContent");
    if (pre) pre.style.display = "";
    codePanelEl.classList.add("open");
  }

  // Split layout: close sidebar, compress chat
  layout?.classList.add("code-split");
  sidebar?.classList.remove("open");
  window.ARIA_closeSidebar?.();

  // Apply ARIA theme to panel (it inherits CSS vars automatically)
  // If HTML preview mode, we'll switch when preview is clicked
}

function closeCodePanel() {
  codePanelEl?.classList.remove("open");
  layout?.classList.remove("code-split");
  previewMode = false;
}

// Wire panel buttons
codePanelCopy?.addEventListener("click", () => {
  navigator.clipboard?.writeText(currentCodeContent);
  if (codePanelCopy) { codePanelCopy.textContent = "✓ Copied"; setTimeout(() => codePanelCopy.textContent = "⎘ Copy", 1500); }
});

codePanelDl?.addEventListener("click", () => {
  const ext = currentCodeLang === "javascript" ? "js" : currentCodeLang === "python" ? "py" : currentCodeLang === "html" ? "html" : currentCodeLang === "css" ? "css" : currentCodeLang === "json" ? "json" : currentCodeLang || "txt";
  downloadText(currentCodeContent, `aria-code.${ext}`);
});

codePanelPreview?.addEventListener("click", () => {
  if (!codePanelFrame || !codePanelCode) return;
  const pre = document.getElementById("codePanelContent");

  if (!previewMode && (currentCodeLang === "html" || currentCodeLang === "")) {
    // Full HTML — render without ARIA styling (raw iframe)
    previewMode = true;
    codePanelFrame.style.display = "block";
    codePanelFrame.srcdoc = currentCodeContent;
    if (pre) pre.style.display = "none";
    codePanelPreview.textContent = "< Code";
  } else {
    // Back to code view
    previewMode = false;
    codePanelFrame.style.display = "none";
    if (pre) pre.style.display = "";
    codePanelPreview.textContent = "🖥 Preview";
  }
});

codePanelClose?.addEventListener("click", closeCodePanel);

window.ARIA_openCodePanel  = openCodePanel;
window.ARIA_closeCodePanel = closeCodePanel;

/* ── HELPER: download text ── */
function downloadText(content, filename) {
  const blob = new Blob([content], { type: "text/plain" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
window.ARIA_downloadCode = downloadText;

/* ============================================================
   HALO EFFECTS
   ============================================================ */
const halo = document.getElementById("ariaHalo");
let haloTimeout = null;

function triggerHalo(type, durationMs = 0) {
  const settings = loadSettings();
  if (settings.haloEffects === false) return;
  if (!halo) return;
  halo.className = "";
  void halo.offsetWidth; // reflow
  halo.classList.add(type);
  if (durationMs > 0) {
    clearTimeout(haloTimeout);
    haloTimeout = setTimeout(() => { halo.className = ""; }, durationMs);
  }
}
function clearHalo() { if (halo) halo.className = ""; clearTimeout(haloTimeout); }

window.ARIA_triggerHalo = triggerHalo;
window.ARIA_clearHalo   = clearHalo;

/* ============================================================
   MODE BUTTONS
   ============================================================ */
function wireMode(btnId, flag, label, onMsg, offMsg) {
  document.getElementById(btnId)?.addEventListener("click", () => {
    // All modes exclusive except thinkingMode
    if (flag !== "thinkingMode") { mathMode=false; programmingMode=false; studyMode=false; }
    if (flag === "mathMode")        { mathMode        = !mathMode; }
    if (flag === "programmingMode") { programmingMode = !programmingMode; }
    if (flag === "studyMode")       { studyMode       = !studyMode; }
    if (flag === "thinkingMode")    { thinkingMode    = !thinkingMode; }

    // Update button visuals
    ["mathModeBtn","codeAssistBtn","studyModeBtn"].forEach(id => {
      const b = document.getElementById(id);
      if (!b) return;
      const active = id==="mathModeBtn"?mathMode:id==="codeAssistBtn"?programmingMode:studyMode;
      b.classList.toggle("active", active);
    });
    const thinkBtn = document.getElementById("thinkingBtn");
    if (thinkBtn) thinkBtn.classList.toggle("active", thinkingMode);

    const isOn = flag==="mathMode"?mathMode:flag==="programmingMode"?programmingMode:flag==="studyMode"?studyMode:thinkingMode;
    addSystemMessage(isOn ? onMsg : offMsg);
    triggerHalo("pulse", 800);
  });
}

wireMode("mathModeBtn",    "mathMode",        "Math",    "📐 **Math/Homework mode ON.** Step-by-step working guaranteed.", "Math mode off.");
wireMode("codeAssistBtn",  "programmingMode", "Code",    "💻 **Programming mode ON.** Full runnable code with comments.", "Programming mode off.");
wireMode("studyModeBtn",   "studyMode",       "Study",   "📚 **Study mode ON.** Upload your notes and I'll quiz you.", "Study mode off.");
wireMode("thinkingBtn",    "thinkingMode",    "Think",   "🧠 **Thinking mode ON.** ARIA will show her reasoning process.", "Thinking mode off.");

/* ── SEARCH BUTTON ── */
document.getElementById("webSearchBtn")?.addEventListener("click", async () => {
  const q = userInput?.value.trim();
  if (!q) { addSystemMessage("Type a query first, then click 🔍"); return; }
  addSystemMessage(`🔍 Searching: **${q}**…`);
  try {
    const res  = await fetch("/api/search", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({query:q}) });
    const data = await res.json();
    if (data.error) { addSystemMessage(`Search error: ${data.error}`); return; }
    const txt = (data.results||[]).map((r,i)=>`**${i+1}. [${r.title}](${r.url})**\n${r.snippet}`).join("\n\n");
    addSystemMessage(`**Results for "${q}":**\n\n${txt}`);
  } catch(e) { addSystemMessage(`Search error: ${e.message}`); }
});

/* ── IMAGE BUTTON ── */
document.getElementById("imagineBtn")?.addEventListener("click", async () => {
  const prompt = userInput?.value.trim();
  if (!prompt) { addSystemMessage("Type an image description first, then click 🎨"); return; }
  addSystemMessage(`🎨 Generating: **${prompt.slice(0,60)}**…`);
  try {
    const res  = await fetch("/api/imagine", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({prompt}) });
    const data = await res.json();
    if (data.error) { addSystemMessage(`Image error: ${data.error}`); return; }
    addImageMessage(data.url, prompt);
  } catch(e) { addSystemMessage(`Image error: ${e.message}`); }
});

/* ── CALENDAR BUTTON ── */
document.getElementById("calendarBtn")?.addEventListener("click", async () => {
  addSystemMessage("📅 Loading calendar…");
  try {
    const res  = await fetch("/api/calendar/events");
    const data = await res.json();
    if (data.error) { addSystemMessage(`Calendar: ${data.error}`); return; }
    if (!data.events?.length) { addSystemMessage("No upcoming events."); return; }
    addSystemMessage("**Upcoming events:**\n\n" + data.events.map(e=>{
      const d=new Date(e.start).toLocaleString("en-US",{weekday:"short",month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"});
      return `📅 **${e.title}** — ${d}`;
    }).join("\n"));
  } catch(e) { addSystemMessage(`Calendar error: ${e.message}`); }
});

/* ── BG TASK BUTTON ── */
document.getElementById("bgTaskBtn")?.addEventListener("click", async () => {
  const task = userInput?.value.trim();
  if (!task) { addSystemMessage("Type a task description first, then click ⚙"); return; }
  userInput.value = ""; userInput.style.height = "auto";
  addSystemMessage(`⚙ Running in background: **${task.slice(0,60)}**…`);
  try {
    const cs = loadSettings();
    const res  = await fetch("/api/background", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({task, provider:cs.provider||"openrouter", personality:cs.personality||"hacker"}) });
    const data = await res.json();
    if (data.error) { addSystemMessage(`BG error: ${data.error}`); return; }
    const taskId = data.id;
    addSystemMessage(`⚙ Task **${taskId}** started. I'll notify you when done.`);
    // Poll for completion
    const poll = setInterval(async () => {
      try {
        const r = await fetch(`/api/background/${taskId}`);
        const d = await r.json();
        if (d.status === "done") {
          clearInterval(poll);
          addAIMessage(`✅ **Background task complete:**\n\n${d.result}`);
        } else if (d.status === "error") {
          clearInterval(poll);
          addSystemMessage(`❌ BG task failed: ${d.result}`);
        }
      } catch {}
    }, 3000);
  } catch(e) { addSystemMessage(`BG error: ${e.message}`); }
});

/* ── COMMANDS MODAL ── */
document.getElementById("commandsBtn")?.addEventListener("click", async () => {
  const modal = document.getElementById("commandsModal");
  const list  = document.getElementById("commandsList");
  if (!modal || !list) return;

  // Load tool list from server
  try {
    const res  = await fetch("/api/tools");
    const data = await res.json();
    const tools = data.tools || [];
    const slashCmds = [
      { name: "/calc <expr>",    desc: "Calculator — e.g. /calc sqrt(144)" },
      { name: "/time",           desc: "Current server time" },
      { name: "/weather",        desc: "Weather for Mason OH (or /weather lat,lon)" },
      { name: "/notes add|list|delete|clear", desc: "Session notes" },
      { name: "/todo add|list|done|delete",   desc: "Task list" },
      { name: "/timer start|list|cancel",     desc: "Countdown timers" },
      { name: "/search <query>", desc: "Returns search links" },
      { name: "/news [topic]",   desc: "Latest headlines" },
      { name: "/system",         desc: "Server info" },
      { name: "/scrape <url>",   desc: "Extract text from a webpage" },
      { name: "/imagine <desc>", desc: "Generate an image (Pollinations/DALL-E)" },
      { name: "/calendar",       desc: "Show upcoming Google Calendar events" },
      { name: "/calendar add Title | date | date", desc: "Add a calendar event" },
      { name: "/gdoc <doc-id>",  desc: "Read a Google Doc" },
      { name: "/help",           desc: "Show this list in chat" },
    ];
    list.innerHTML = slashCmds.map(c => `
      <div class="commandItem">
        <span class="commandName">${c.name}</span>
        <span class="commandDesc">${c.desc}</span>
      </div>`).join("");
  } catch {
    list.innerHTML = "<div style='color:var(--text-muted);font-size:11px;padding:12px'>Could not load commands.</div>";
  }

  modal.style.display = "flex";
  triggerHalo("pulse", 600);
});
document.getElementById("commandsCloseBtn")?.addEventListener("click", () => {
  document.getElementById("commandsModal").style.display = "none";
});

/* ── BG TASKS MODAL ── */
document.getElementById("bgTasksListBtn")?.addEventListener("click", async () => {
  const modal = document.getElementById("bgTasksModal");
  const list  = document.getElementById("bgTasksList");
  if (!modal || !list) return;
  try {
    const res  = await fetch("/api/background");
    const tasks = await res.json();
    if (!tasks.length) { list.innerHTML = "<div style='color:var(--text-muted);font-size:11px;padding:12px'>No background tasks.</div>"; }
    else {
      list.innerHTML = tasks.map(t => `
        <div class="bgTaskItem ${t.status}">
          <div style="color:var(--text-blaze);font-size:11px">${t.task}</div>
          <div style="color:var(--text-muted);font-size:10px;margin-top:3px">${t.status.toUpperCase()} — ${new Date(t.started).toLocaleTimeString()}</div>
        </div>`).join("");
    }
  } catch { list.innerHTML = "<div style='color:#ff4444;padding:12px'>Error loading tasks.</div>"; }
  modal.style.display = "flex";
});
document.getElementById("bgTasksCloseBtn")?.addEventListener("click", () => {
  document.getElementById("bgTasksModal").style.display = "none";
});

/* ============================================================
   FILE UPLOAD (inline attach button)
   ============================================================ */
document.getElementById("fileUploadBtn")?.addEventListener("change", async (e) => {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;

  for (const file of files) {
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res  = await fetch("/api/upload", { method:"POST", body:formData });
      const data = await res.json();
      if (data.error) { addSystemMessage(`Upload failed: ${data.error}`); continue; }

      if (data.type === "image") {
        pendingFiles.push({ type:"image", name:file.name, base64:data.base64, text:data.text });
        documentContext += `\n[Image uploaded: ${file.name}]`;
      } else {
        pendingFiles.push({ type:"document", name:file.name, text:data.text });
        documentContext += `\n[Document: ${file.name}]\n${data.text.slice(0,2000)}`;
        documentName = file.name;
      }
      renderAttachPreviews();
    } catch(err) { addSystemMessage(`Upload error: ${err.message}`); }
  }
  e.target.value = "";
});

function renderAttachPreviews() {
  const row = document.getElementById("attachPreviewRow");
  if (!row) return;
  if (!pendingFiles.length) { row.style.display = "none"; row.innerHTML = ""; return; }
  row.style.display = "flex";
  row.innerHTML = pendingFiles.map((f, i) => `
    <div class="attachThumb" title="${f.name}">
      ${f.type==="image" ? `<img src="${f.base64}" alt="${f.name}">` : `<span>${f.name.slice(0,8)}</span>`}
      <span class="attachRemove" onclick="window.ARIA_removeAttach(${i})">✕</span>
    </div>`).join("");
}
window.ARIA_removeAttach = (i) => {
  pendingFiles.splice(i, 1);
  if (!pendingFiles.length) documentContext = "";
  renderAttachPreviews();
};

/* ============================================================
   CHAT MANAGEMENT
   ============================================================ */
function createNewChat() {
  const id = "chat_" + Date.now();
  chats.unshift({ id, title:"New Chat", messages:[], createdAt:Date.now() });
  currentChatId = id; documentContext=""; documentName=""; pendingFiles=[];
  saveChats(); syncToServer();
}
function getCurrentChat() { return chats.find(c=>c.id===currentChatId)||null; }

export function deleteChat(chatId) {
  chats = chats.filter(c=>c.id!==chatId);
  if (currentChatId===chatId) { currentChatId=chats.length?chats[0].id:null; if(!currentChatId)createNewChat(); }
  saveChats(); syncToServer(); renderChatList(); renderMessages();
}
export function clearAllChats() { chats=[]; createNewChat(); renderChatList(); renderMessages(); }
export function renameChat(chatId) {
  const chat=chats.find(c=>c.id===chatId); if(!chat)return;
  const t=prompt("Rename:",chat.title); if(!t?.trim())return;
  chat.title=t.trim().slice(0,40); saveChats(); syncToServer(); renderChatList();
}
export function deleteMessage(chatId,idx) {
  const chat=chats.find(c=>c.id===chatId); if(!chat?.messages[idx])return;
  chat.messages.splice(idx,1); saveChats(); renderMessages();
}
export function copyMessage(content) { navigator.clipboard?.writeText(content).then(()=>window.ARIA_showToast?.("Copied")); }
export function regenerateMessage(chatId,idx) {
  const chat=chats.find(c=>c.id===chatId); if(!chat)return;
  const userMsg=[...chat.messages].slice(0,idx).reverse().find(m=>m.role==="user");
  if(!userMsg)return;
  chat.messages=chat.messages.slice(0,idx);
  saveChats(); renderMessages(); sendMessageContent(userMsg.content,chat);
}

window.ARIA_deleteChat    = deleteChat;
window.ARIA_clearAllChats = clearAllChats;
window.ARIA_renameChat    = renameChat;
window.ARIA_deleteMessage = deleteMessage;
window.ARIA_copyMessage   = copyMessage;
window.ARIA_regenerateMsg = regenerateMessage;
window.ARIA_renderChatList = renderChatList;
window.ARIA_loadFromServer = loadFromServer;

/* ── EVENTS ── */
newChatBtn?.addEventListener("click", () => {
  createNewChat(); renderChatList(); renderMessages();
  closeCodePanel(); window.ARIA_closeSidebar?.();
});
sendBtn?.addEventListener("click", sendMessage);
userInput?.addEventListener("keydown", e => {
  currentSettings = loadSettings();
  if (e.key==="Enter" && !e.shiftKey && currentSettings.sendOnEnter!==false) {
    e.preventDefault(); sendMessage();
  }
});
userInput?.addEventListener("input", () => {
  userInput.style.height = "auto";
  userInput.style.height = Math.min(userInput.scrollHeight,120)+"px";
});

/* ============================================================
   RENDER CHAT LIST
   ============================================================ */
function renderChatList() {
  if (!chatList) return;
  chatList.innerHTML = "";
  chats.forEach(chat => {
    const row = document.createElement("div");
    row.className = "chatRow"+(chat.id===currentChatId?" active":"");
    const btn = document.createElement("button");
    btn.className = "chatItem"+(chat.id===currentChatId?" active":"");
    btn.textContent = chat.title||"Untitled"; btn.title = chat.title;
    btn.onclick = () => { currentChatId=chat.id; renderChatList(); renderMessages(); window.ARIA_closeSidebar?.(); };
    const rBtn = document.createElement("button");
    rBtn.className="chatActionBtn chatRenameBtn"; rBtn.title="Rename"; rBtn.textContent="✎";
    rBtn.onclick=e=>{e.stopPropagation();renameChat(chat.id);};
    const dBtn = document.createElement("button");
    dBtn.className="chatActionBtn chatDeleteBtn"; dBtn.title="Delete"; dBtn.textContent="✕";
    dBtn.onclick=e=>{e.stopPropagation();if(confirm(`Delete "${chat.title}"?`))deleteChat(chat.id);};
    row.appendChild(btn); row.appendChild(rBtn); row.appendChild(dBtn);
    chatList.appendChild(row);
  });
}

/* ============================================================
   RENDER MESSAGES — with think blocks + auto code panel
   ============================================================ */
function renderMessages() {
  if (!messages) return;
  messages.innerHTML = "";
  const chat = getCurrentChat(); if (!chat) return;

  let hasCode = false;
  let lastCodeContent = "";
  let lastCodeLang = "";

  chat.messages.forEach((msg, idx) => {
    const div = document.createElement("div");
    div.classList.add("msg", msg.role);

    let bodyHTML;
    if (msg.type==="image" && msg.imageUrl) {
      bodyHTML = `<div class="msgImageWrap"><img src="${msg.imageUrl}" alt="Generated" class="msgImage" onclick="window.open('${msg.imageUrl}','_blank')"><div class="imgActions"><a href="${msg.imageUrl}" download="aria-image.png" class="msgActionBtn">⬇ Download</a></div></div>`;
    } else if (msg.role==="user") {
      // Render attach thumbnails
      const thumbs = (msg.attachments||[]).map(a=>
        a.type==="image"?`<div class="msgAttachThumb"><img src="${a.base64}" alt="${a.name}"></div>`:
        `<div class="msgAttachThumb" style="display:flex;align-items:center;justify-content:center;font-size:9px;padding:3px">${a.name.slice(0,10)}</div>`
      ).join("");
      const attachRow = thumbs ? `<div class="msgAttachments">${thumbs}</div>` : "";
      bodyHTML = `${attachRow}<p class="userPara">${escapeHtml(msg.content).replace(/\n/g,"<br>")}</p>`;
    } else {
      bodyHTML = renderMarkdown(msg.content);
    }

    const time   = new Date(msg.timestamp).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});
    const isAria = msg.role==="aria";

    div.innerHTML = `
      <div class="msgHeader">
        <div class="msgSender">${msg.role==="user"?"YOU":"ARIA"}</div>
        <div class="msgMeta">
          <span class="msgTimestamp">${time}</span>
          <button class="msgActionBtn msgCopyBtn" title="Copy" onclick="window.ARIA_copyMessage(${JSON.stringify(msg.content)})">⎘</button>
          ${isAria?`<button class="msgActionBtn msgRegenBtn" title="Regenerate" onclick="window.ARIA_regenerateMsg('${chat.id}',${idx})">↺</button>`:""}
          <button class="msgActionBtn msgDeleteBtn" title="Delete" onclick="window.ARIA_deleteMessage('${chat.id}',${idx})">✕</button>
        </div>
      </div>
      <div class="msgBody">${bodyHTML}</div>`;

    messages.appendChild(div);

    // Track if this message has code — auto-open panel for most recent code
    if (isAria && msg.content) {
      const codeMatch = msg.content.match(/```(\w*)\n?([\s\S]*?)```/);
      if (codeMatch) {
        hasCode = true;
        lastCodeContent = codeMatch[2].trim();
        lastCodeLang    = codeMatch[1] || "code";
      }
    }
  });

  // Wire code panel buttons on rendered blocks
  messages.querySelectorAll(".codePanelBtn").forEach(btn => {
    btn.addEventListener("click", () => {
      const code = decodeURIComponent(btn.dataset.code);
      openCodePanel(code, btn.dataset.lang);
    });
  });

  if (isGenerating) {
    const stop = document.createElement("div");
    stop.id = "stopGenBtn";
    stop.innerHTML = `<button onclick="window.ARIA_stopGeneration?.()">⏹ Stop generating</button>`;
    messages.appendChild(stop);
  }

  messages.scrollTop = messages.scrollHeight;

  // Auto-open code panel for last code block (only if it just appeared — not on history load)
  if (hasCode && isGenerating === false && lastCodeContent) {
    // Small delay so the message renders first
    setTimeout(() => openCodePanel(lastCodeContent, lastCodeLang), 50);
  }
}

/* ── SYSTEM + IMAGE MESSAGE HELPERS ── */
function addSystemMessage(content) {
  const chat=getCurrentChat(); if(!chat)return;
  chat.messages.push({role:"aria",content,timestamp:Date.now()});
  saveChats(); renderMessages();
}
function addImageMessage(url, prompt) {
  const chat=getCurrentChat(); if(!chat)return;
  chat.messages.push({role:"aria",content:`Image: ${prompt}`,type:"image",imageUrl:url,timestamp:Date.now()});
  saveChats(); renderMessages();
}
function addAIMessage(content) {
  const chat=getCurrentChat(); if(!chat)return;
  chat.messages.push({role:"aria",content,timestamp:Date.now()});
  saveChats(); syncToServer(); renderMessages();
  if(ttsEnabled)speak(content);
}

/* ============================================================
   SEND MESSAGE
   ============================================================ */
async function sendMessage() {
  const text = userInput?.value.trim();
  if (!text||isGenerating) return;
  currentSettings = loadSettings();
  const chat = getCurrentChat(); if(!chat)return;

  // Capture pending files before clearing
  const attachments = [...pendingFiles];
  pendingFiles = [];
  renderAttachPreviews();

  chat.messages.push({role:"user", content:text, timestamp:Date.now(), attachments:attachments.length?attachments:undefined});
  if (chat.title==="New Chat") { chat.title=text.slice(0,35)+(text.length>35?"…":""); renderChatList(); }
  userInput.value=""; userInput.style.height="auto";
  saveChats(); syncToServer(); renderMessages();

  // Slash command shortcuts
  const cmds = [
    [/^\/calc (.+)/i,    m=>runTool("calc",m[1])],
    [/^\/time/i,         _=>runTool("time","")],
    [/^\/weather(.*)/i,  m=>runTool("weather",m[1].trim())],
    [/^\/notes (.+)/i,   m=>runTool("notes",m[1])],
    [/^\/todo (.+)/i,    m=>runTool("todo",m[1])],
    [/^\/timer (.+)/i,   m=>runTool("timer",m[1])],
    [/^\/search (.+)/i,  m=>runTool("search",m[1])],
    [/^\/news(.*)/i,     m=>runTool("news",m[1].trim())],
    [/^\/system/i,       _=>runTool("system","")],
    [/^\/help/i,         _=>Promise.resolve(HELP_TEXT)],
  ];
  for (const [re,fn] of cmds) {
    const match = text.match(re);
    if (match) { addSystemMessage(await fn(match)); return; }
  }

  await sendMessageContent(text, chat, attachments);
}

const HELP_TEXT = `**ARIA Commands**
\`/calc <expr>\` /time /weather [lat,lon] /notes /todo /timer /search /news /system /help

**Buttons:** 📎 Attach file | ∑ Math | 💻 Code | 📚 Study | 🔍 Search | 🎨 Image | 📅 Calendar | 🧠 Think | ⚙ Background`;

async function sendMessageContent(text, chat, attachments=[]) {
  isGenerating=true; setSendState(true); triggerHalo("thinking");
  const typingId = showTypingIndicator();
  let abortController = new AbortController();
  window.ARIA_stopGeneration = () => {
    abortController.abort(); isGenerating=false; setSendState(false); clearHalo();
    removeTypingIndicator(typingId); renderMessages();
  };

  try {
    const docCtx = attachments.map(a=>a.text||"").join("\n") || documentContext;
    const res = await fetch("/api/chat", {
      method:"POST", headers:{"Content-Type":"application/json"},
      signal:abortController.signal,
      body:JSON.stringify({
        message:      text,
        history:      chat.messages.slice(-20).map(m=>({role:m.role==="aria"?"assistant":"user",content:m.content})),
        provider:     currentSettings.provider||"openrouter",
        personality:  currentSettings.personality||"hacker",
        mathMode, programmingMode, studyMode, thinkingMode,
        documentContext: docCtx,
      }),
    });
    const data = await res.json();
    removeTypingIndicator(typingId);
    clearHalo();

    // Handle image result from agentic pipeline
    if (data.imageUrl) {
      addImageMessage(data.imageUrl, data.imagePrompt||text);
      if (data.reply) addAIMessage(data.reply);
    } else {
      addAIMessage(data.reply?.trim()||"[No reply]");
    }

    // Tool steps info (optional debug)
    if (data.steps?.length) {
      console.log("[ARIA tools used]:", data.steps.map(s=>`${s.tool}: ${s.input}`).join(", "));
    }

  } catch(err) {
    removeTypingIndicator(typingId); clearHalo();
    if (err.name!=="AbortError") addAIMessage("[Error contacting server]");
  } finally {
    isGenerating=false; setSendState(false);
  }
}

function setSendState(on) {
  if(sendBtn){sendBtn.disabled=on;sendBtn.textContent=on?"…":"Send";sendBtn.style.opacity=on?"0.5":"1";}
  if(userInput)userInput.disabled=on;
}
function showTypingIndicator() {
  const id="typing_"+Date.now();
  const div=document.createElement("div");
  div.classList.add("msg","aria","typingIndicator"); div.id=id;
  div.innerHTML=`<div class="msgSender">ARIA</div><div class="typingDots"><span></span><span></span><span></span></div>`;
  messages.appendChild(div); messages.scrollTop=messages.scrollHeight;
  return id;
}
function removeTypingIndicator(id){document.getElementById(id)?.remove();}

/* ============================================================
   MARKDOWN — with think blocks + code panel buttons
   ============================================================ */
function escapeHtml(t) {
  return String(t).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

function renderMarkdown(text) {
  if (!text) return "";

  // ── THINK BLOCKS ── render before escaping
  text = text.replace(/<think>([\s\S]*?)<\/think>/gi, (_, inner) => {
    const escaped = escapeHtml(inner.trim());
    return `__THINKBLOCK__${btoa(unescape(encodeURIComponent(escaped)))}__THINKBLOCK__`;
  });

  let h = escapeHtml(text);

  // Restore think blocks as collapsible details
  h = h.replace(/__THINKBLOCK__([A-Za-z0-9+/=]+)__THINKBLOCK__/g, (_, b64) => {
    const content = decodeURIComponent(escape(atob(b64)));
    return `<details class="thinkBlock"><summary>🧠 ARIA is thinking…</summary><div class="thinkContent">${content}</div></details>`;
  });

  // Code blocks with Panel + Copy + Download buttons
  h = h.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const clean   = code.trim();
    const encoded = encodeURIComponent(clean);
    const ext     = ({javascript:"js",python:"py",html:"html",css:"css",json:"json",typescript:"ts",bash:"sh",shell:"sh"})[lang]||lang||"txt";
    const isHTML  = lang==="html"||lang==="HTML";
    return `<div class="codeBlock">
      ${lang?`<span class="codeLabel">${lang.toUpperCase()}</span>`:""}
      <div class="codeActions">
        <button class="codePanelBtn codeActionBtn" data-code="${encoded}" data-lang="${lang}" title="Open in side panel">⤢ Panel</button>
        <button class="codeActionBtn" onclick="navigator.clipboard?.writeText(decodeURIComponent('${encoded}'));this.textContent='✓';setTimeout(()=>this.textContent='⎘',1200)" title="Copy">⎘</button>
        <button class="codeActionBtn" onclick="window.ARIA_downloadCode(decodeURIComponent('${encoded}'),'aria-code.${ext}')" title="Download">⬇ .${ext}</button>
        ${isHTML?`<button class="codeActionBtn" onclick="window.ARIA_openCodePanel(decodeURIComponent('${encoded}'),'html');setTimeout(()=>document.getElementById('codePanelPreviewBtn')?.click(),100)" title="Preview in panel">🖥 Preview</button>`:""}
      </div>
      <pre><code>${escapeHtml(clean)}</code></pre>
    </div>`;
  });

  h = h.replace(/`([^`]+)`/g,'<code class="inlineCode">$1</code>');
  h = h.replace(/^### (.+)$/gm,'<h3 class="mdH3">$1</h3>');
  h = h.replace(/^## (.+)$/gm, '<h2 class="mdH2">$1</h2>');
  h = h.replace(/^# (.+)$/gm,  '<h1 class="mdH1">$1</h1>');
  h = h.replace(/^---$/gm,'<hr class="mdHr"/>');
  h = h.replace(/\*\*\*(.+?)\*\*\*/g,"<strong><em>$1</em></strong>");
  h = h.replace(/\*\*(.+?)\*\*/g,'<strong class="mdBold">$1</strong>');
  h = h.replace(/\*(.+?)\*/g,'<em class="mdItalic">$1</em>');
  h = h.replace(/!\[([^\]]*)\]\(([^)]+)\)/g,(_,alt,src)=>`<div class="msgImageWrap"><img src="${src}" alt="${alt}" class="msgImage"><div class="imgActions"><a href="${src}" download="aria-image.png" class="msgActionBtn">⬇</a></div></div>`);
  h = h.replace(/\[([^\]]+)\]\(([^)]+)\)/g,'<a href="$2" target="_blank" rel="noopener" class="mdLink">$1</a>');
  h = h.replace(/((?:^[*\-] .+\n?)+)/gm,b=>`<ul class="mdList">${b.trim().split("\n").map(l=>`<li>${l.replace(/^[*\-] /,"")}</li>`).join("")}</ul>`);
  h = h.replace(/((?:^\d+\. .+\n?)+)/gm,b=>`<ol class="mdList">${b.trim().split("\n").map(l=>`<li>${l.replace(/^\d+\. /,"")}</li>`).join("")}</ol>`);
  h = h.split(/\n{2,}/).map(b=>{
    const t=b.trim();
    if(!t||/^<(h[1-3]|ul|ol|div|details|pre|hr)/.test(t))return t;
    return`<p class="mdPara">${t.replace(/\n/g,"<br/>")}</p>`;
  }).join("\n");
  return h;
}

/* ── PERSISTENCE ── */
function saveChats(){localStorage.setItem("aria_chats",JSON.stringify(chats));}
async function syncToServer(){
  try{await fetch("/api/saveChats",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({userId:window.ARIA_userId||"sarvin",chats})});}catch{}
}
async function loadFromServer(){
  try{
    const uid=window.ARIA_userId||"sarvin";
    const res=await fetch(`/api/loadChats?userId=${uid}`);
    const data=await res.json();
    if(data.chats?.length>chats.length){
      const localIds=new Set(chats.map(c=>c.id));
      chats=[...data.chats.filter(c=>!localIds.has(c.id)),...chats].sort((a,b)=>b.id.localeCompare(a.id));
      currentChatId=chats[0].id; saveChats(); renderChatList(); renderMessages();
    }
  }catch{}
}