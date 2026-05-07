import { speak, ttsEnabled } from "./tts.js";
import { loadSettings } from "./personality.js";
import { runTool } from "./tools.js";

/* ── STATE ── */
let chats = [];
let currentChatId = null;
let currentSettings = loadSettings();
let isGenerating = false;
let documentContext = "";
let mathMode = false;
let programmingMode = false;
let studyMode = false;
let pendingFiles = [];
let musicTutorMode = false;
let previewActive = false;
let workspaceRepoUrl = "";

const newChatBtn = document.getElementById("newChatBtn");
const sendBtn = document.getElementById("sendBtn");
const userInput = document.getElementById("userInput");
const messages = document.getElementById("messages");
const chatList = document.getElementById("chatList");
const layout = document.getElementById("layout");

/* ── LOAD ── */
try {
  const saved = localStorage.getItem("aria_chats");
  if (saved) {
    chats = JSON.parse(saved);
    if (chats.length) currentChatId = chats[0].id;
  }
} catch {
  chats = [];
}
if (!currentChatId) createNewChat();
renderChatList();
renderMessages();
loadFromServer();

/* ============================================================
   HALO EFFECTS
   ============================================================ */
const halo = document.getElementById("ariaHalo");
let haloTimer = null;

function triggerHalo(type, durationMs = 0) {
  const s = loadSettings();
  if (s.haloEffects === false) return;
  const intensity = s.haloIntensity ?? 0.5;
  if (!halo) return;
  halo.className = "";
  void halo.offsetWidth;
  halo.classList.add(type);
  halo.style.setProperty("--halo-intensity", intensity);
  if (durationMs > 0) {
    clearTimeout(haloTimer);
    haloTimer = setTimeout(() => {
      if (halo) halo.className = "";
    }, durationMs);
  }
}
function clearHalo() {
  if (halo) halo.className = "";
  clearTimeout(haloTimer);
}
window.ARIA_triggerHalo = triggerHalo;
window.ARIA_clearHalo = clearHalo;

// ── PASTE handler — images + text ──
document.addEventListener("paste", async (e) => {
  const items = [...(e.clipboardData?.items || [])];
  const imageItem = items.find((it) => it.type.startsWith("image/"));

  if (imageItem) {
    e.preventDefault();
    const file = imageItem.getAsFile();
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file, "pasted-image.png");
    try {
      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (data.base64) {
        pendingFiles.push({
          type: "image",
          name: "pasted-image.png",
          base64: data.base64,
          mimeType: file.type,
          text: "[Pasted image]",
        });
        documentContext += "\n[Pasted Image]";
        renderAttachPreviews();
        window.ARIA_showNotification?.("Image pasted ✓");
      }
    } catch (e) {
      console.error("[ARIA] Paste upload failed:", e);
    }
    return;
  }

  // Text paste — let browser handle it normally (goes into textarea)
});

// Wire halo intensity slider
document.getElementById("haloIntensity")?.addEventListener("input", (e) => {
  const s = loadSettings();
  s.haloIntensity = parseFloat(e.target.value);
  import("./personality.js").then((m) => m.saveSettings?.(s));
  triggerHalo("pulse", 800);
});
document
  .getElementById("toggle_haloEffects")
  ?.addEventListener("click", (e) => {
    const btn = e.currentTarget;
    const on = btn.textContent.trim() === "ON";
    btn.textContent = on ? "OFF" : "ON";
    btn.classList.toggle("active", !on);
    const s = loadSettings();
    s.haloEffects = !on;
    import("./personality.js").then((m) => m.saveSettings?.(s));
    if (!on) triggerHalo("pulse", 700);
  });

/* ============================================================
   CODE PANEL — side by side with chat
   ============================================================ */
const codePanelEl = document.getElementById("codePanel");
const codePanelCode = document.getElementById("codePanelCode");
const codePanelLang = document.getElementById("codePanelLang");
const codePanelCopy = document.getElementById("codePanelCopyBtn");
const codePanelDl = document.getElementById("codePanelDownloadBtn");
const codePanelClose = document.getElementById("codePanelCloseBtn");

let currentCodeContent = "";
let currentCodeLang = "";

function openCodePanel(code, lang) {
  currentCodeContent = code;
  currentCodeLang = lang || "code";
  previewActive = false;
  if (codePanelCode) codePanelCode.textContent = code;
  if (codePanelLang) codePanelLang.textContent = (lang || "CODE").toUpperCase();

  const pre = document.getElementById("codePanelContent");
  const frame = document.getElementById("codePanelPreviewFrame");
  const prevBtn = document.getElementById("codePanelPreviewBtn");
  if (pre) pre.style.display = "";
  if (frame) {
    frame.style.display = "none";
    frame.srcdoc = "";
  }
  if (prevBtn) {
    const isHTML = ["html", "htm", "svg"].includes((lang || "").toLowerCase());
    prevBtn.style.display = isHTML ? "" : "none";
    prevBtn.textContent = "🖥 Preview";
  }
  codePanelEl?.classList.add("open");
  layout?.classList.add("code-split");
  window.ARIA_collapseSidebar?.();
}
function closeCodePanel() {
  codePanelEl?.classList.remove("open");
  layout?.classList.remove("code-split");
  window.ARIA_expandSidebar?.();
}

codePanelCopy?.addEventListener("click", () => {
  navigator.clipboard
    ?.writeText(currentCodeContent)
    .then(() => showToast("Code copied", "⎘"));
  if (codePanelCopy) {
    codePanelCopy.textContent = "✓ Copied!";
    setTimeout(() => (codePanelCopy.textContent = "⎘ Copy"), 1500);
  }
});
codePanelDl?.addEventListener("click", () => {
  const extMap = {
    javascript: "js",
    typescript: "ts",
    python: "py",
    html: "html",
    css: "css",
    json: "json",
    bash: "sh",
    shell: "sh",
    java: "java",
    cpp: "cpp",
    c: "c",
    rust: "rs",
  };
  const ext = extMap[currentCodeLang] || currentCodeLang || "txt";
  downloadText(currentCodeContent, `aria-code.${ext}`);
});
codePanelClose?.addEventListener("click", closeCodePanel);

document
  .getElementById("codePanelPreviewBtn")
  ?.addEventListener("click", () => {
    const pre = document.getElementById("codePanelContent");
    const frame = document.getElementById("codePanelPreviewFrame");
    const btn = document.getElementById("codePanelPreviewBtn");
    if (!frame) return;
    previewActive = !previewActive;
    if (previewActive) {
      frame.srcdoc = currentCodeContent;
      frame.style.display = "flex";
      if (pre) pre.style.display = "none";
      if (btn) btn.textContent = "< Code";
    } else {
      frame.style.display = "none";
      if (pre) pre.style.display = "";
      if (btn) btn.textContent = "🖥 Preview";
    }
  });

window.ARIA_openCodePanel = openCodePanel;
window.ARIA_closeCodePanel = closeCodePanel;

function downloadText(content, filename) {
  const blob = new Blob([content], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  showToast("Downloaded " + filename, "⬇");
}
window.ARIA_downloadCode = downloadText;

/* ── PERSISTENT STOP / PAUSE BAR ── */
window._ariaPaused = false;
window._ariaPauseResolve = null;

(function injectStopBar() {
  const existing = document.getElementById("ariaStopBar");
  if (existing) return;
  const bar = document.createElement("div");
  bar.id = "ariaStopBar";
  // Always in DOM, visibility controlled by class not display
  bar.innerHTML = `
    <button id="ariaStopBtn" title="Stop generation">⏹ Stop</button>
    <button id="ariaPauseBtn" title="Pause and inject a thought">⏸ Pause</button>
    <div id="ariaPauseInject">
      <input id="ariaPauseInput" type="text" placeholder="Inject a thought… ARIA will consider it before continuing" autocomplete="off">
      <button id="ariaPauseResumeBtn">▶ Resume</button>
    </div>
  `;
  // Insert directly above #inputBar (inside #chatWindow so it doesn't float)
  const inputBar = document.getElementById("inputBar");
  if (inputBar) {
    inputBar.parentNode.insertBefore(bar, inputBar);
  } else {
    document.body.appendChild(bar);
  }

  document.getElementById("ariaStopBtn")?.addEventListener("click", () => {
    window.ARIA_stopGeneration?.();
    window._ariaPaused = false;
    bar.classList.remove("active");
    document.getElementById("ariaPauseInject")?.classList.remove("active");
    document.getElementById("ariaPauseBtn").textContent = "⏸ Pause";
    showToast("Generation stopped", "⏹");
  });

  document.getElementById("ariaPauseBtn")?.addEventListener("click", () => {
    if (window._ariaPaused) {
      // Resume without a thought
      window._ariaPaused = false;
      document.getElementById("ariaPauseInject")?.classList.remove("active");
      document.getElementById("ariaPauseBtn").textContent = "⏸ Pause";
      if (userInput) userInput.disabled = true;
      window._ariaPauseResolve?.("resume");
      showToast("Resumed", "▶");
    } else {
      // Pause
      window._ariaPaused = true;
      document.getElementById("ariaPauseInject")?.classList.add("active");
      document.getElementById("ariaPauseBtn").textContent = "▶ Resume";
      if (userInput) userInput.disabled = false;
      document.getElementById("ariaPauseInput")?.focus();
      showToast("Paused — inject a thought then resume", "⏸");
    }
  });

  document
    .getElementById("ariaPauseResumeBtn")
    ?.addEventListener("click", () => {
      const val = document.getElementById("ariaPauseInput")?.value.trim();
      window._ariaPaused = false;
      document.getElementById("ariaPauseInject")?.classList.remove("active");
      document.getElementById("ariaPauseBtn").textContent = "⏸ Pause";
      if (userInput) userInput.disabled = true;
      if (document.getElementById("ariaPauseInput"))
        document.getElementById("ariaPauseInput").value = "";
      window._ariaPauseResolve?.(val || "resume");
      if (val) showToast("Thought injected — resuming", "💡");
    });

  // Enter key in pause input = resume
  document
    .getElementById("ariaPauseInput")
    ?.addEventListener("keydown", (e) => {
      if (e.key === "Enter")
        document.getElementById("ariaPauseResumeBtn")?.click();
    });
})();

/* ============================================================
   TOOLS DROPDOWN (sidebar)
   Each tool uses the SAME chat box — no separate messages
   ============================================================ */
const toolsDropBtn = document.getElementById("toolsDropdownBtn");
const toolsDropMenu = document.getElementById("toolsDropdown");

toolsDropBtn?.addEventListener("click", (e) => {
  e.stopPropagation();
  const open = toolsDropMenu?.style.display !== "none";
  if (toolsDropMenu) toolsDropMenu.style.display = open ? "none" : "block";
  toolsDropBtn.classList.toggle("active", !open);
  triggerHalo("pulse", 600);
});
document.addEventListener("click", () => {
  if (toolsDropMenu) toolsDropMenu.style.display = "none";
  toolsDropBtn?.classList.remove("active");
});

// Tool dropdown item actions — trigger the hidden buttons
function toolAction(id) {
  document.getElementById(id)?.click();
  if (toolsDropMenu) toolsDropMenu.style.display = "none";
  toolsDropBtn?.classList.remove("active");
}
document
  .getElementById("tool_math")
  ?.addEventListener("click", () => toolAction("mathModeBtn"));
document
  .getElementById("tool_code")
  ?.addEventListener("click", () => toolAction("codeAssistBtn"));
document
  .getElementById("tool_study")
  ?.addEventListener("click", () => toolAction("studyModeBtn"));
document.getElementById("tool_commands")?.addEventListener("click", () => {
  toolAction("commandsBtn");
});

// Web search — prompt user in the textarea
document.getElementById("tool_search")?.addEventListener("click", () => {
  if (toolsDropMenu) toolsDropMenu.style.display = "none";
  promptToolInput(
    "🔍 Web Search — type your query in the box and press Send to search:",
  );
});

// Image generation — prompt user
document.getElementById("tool_imagine")?.addEventListener("click", () => {
  if (toolsDropMenu) toolsDropMenu.style.display = "none";
  promptToolInput(
    "🎨 Image Generation — describe the image you want and press Send:",
  );
});

// Calendar
document
  .getElementById("tool_calendar")
  ?.addEventListener("click", async () => {
    if (toolsDropMenu) toolsDropMenu.style.display = "none";
    await fetchAndShowCalendar();
  });

// Background task
document.getElementById("tool_bg")?.addEventListener("click", () => {
  if (toolsDropMenu) toolsDropMenu.style.display = "none";
  promptToolInput(
    "⚙ Background Task — describe what you want ARIA to do in the background:",
  );
});

function promptToolInput(hint) {
  setInputHint(hint);
  userInput?.focus();
}

function setInputHint(text) {
  if (!userInput) return;
  userInput.placeholder = text;
  setTimeout(() => {
    userInput.placeholder = "Message ARIA...";
  }, 8000);
}

/* ── MODE TOGGLE BUTTONS (hidden, triggered from dropdown) ── */
function wireMode(btnId, flagSetter, onMsg, offMsg) {
  document.getElementById(btnId)?.addEventListener("click", () => {
    flagSetter();
    renderChatList(); // update active indicator
    const isOn = flagSetter.isOn();
    addSystemMessage(isOn ? onMsg : offMsg);
    triggerHalo("pulse", 700);
  });
}

// Mode toggle logic — mutual exclusion for main modes
function toggleMath() {
  mathMode = !mathMode;
  if (mathMode) {
    programmingMode = false;
    studyMode = false;
  }
}
toggleMath.isOn = () => mathMode;
function toggleCode() {
  programmingMode = !programmingMode;
  if (programmingMode) {
    mathMode = false;
    studyMode = false;
  }
}
toggleCode.isOn = () => programmingMode;
function toggleStudy() {
  studyMode = !studyMode;
  if (studyMode) {
    mathMode = false;
    programmingMode = false;
  }
}
toggleStudy.isOn = () => studyMode;
wireMode(
  "mathModeBtn",
  toggleMath,
  "📐 **Math mode ON** — step-by-step working for every problem.",
  "Math mode off.",
);
wireMode(
  "codeAssistBtn",
  toggleCode,
  "💻 **Programming mode ON** — full runnable code with comments.",
  "Programming mode off.",
);
wireMode(
  "studyModeBtn",
  toggleStudy,
  "📚 **Study mode ON** — upload notes and I'll quiz you.",
  "Study mode off.",
);
// ── Music Tutor ──
document.getElementById("tool_music")?.addEventListener("click", () => {
  musicTutorMode = !musicTutorMode;
  if (toolsDropMenu) toolsDropMenu.style.display = "none";
  toolsDropBtn?.classList.remove("active");
  showChatNotification(
    musicTutorMode ? "🎵 Music Tutor ON" : "Music Tutor off",
  );
  if (musicTutorMode) showMusicPanel();
  else hideMusicPanel();
  triggerHalo("pulse", 800);
});

// ── Workspace / Repo ──
document.getElementById("tool_workspace")?.addEventListener("click", () => {
  if (toolsDropMenu) toolsDropMenu.style.display = "none";
  const url = prompt(
    "Enter GitHub repo URL (e.g. https://github.com/user/repo):",
  );
  if (url?.trim()) {
    workspaceRepoUrl = url.trim();
    showChatNotification(
      "🗂 Workspace: " + workspaceRepoUrl.split("/").slice(-1)[0],
    );
    addSystemMessage(
      "🗂 **Workspace mode** — repo loaded: `" +
        workspaceRepoUrl +
        "`. Ask me to read files, suggest improvements, or generate new ones.",
    );
  }
});

/* doWebSearch — called by AI ACTION:search and slash commands */
async function doWebSearch(q, engineOverride = null) {
  const chat = getCurrentChat();
  if (!chat) return;

  // Ask which engine to use (unless already specified)
  const engine = engineOverride || (await _pickSearchEngine());
  if (!engine) return; // user cancelled

  chat.messages.push({
    role: "user",
    content: "🔍 Search: " + q,
    timestamp: Date.now(),
  });
  saveChats();
  renderMessages();
  const tid = showTypingIndicator();
  try {
    const res = await fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: q, engine }),
    });
    const data = await res.json();
    removeTypingIndicator(tid);
    if (data.error) {
      addAIMessage("Search error: " + data.error);
      return;
    }
    const engineTag =
      data.engine === "serpapi" ? "via SerpAPI" : "via built-in crawler";
    const txt = (data.results || [])
      .map((r, i) => {
        let out =
          "**" +
          (i + 1) +
          ". [" +
          r.title +
          "](" +
          r.url +
          ")**\n" +
          (r.snippet || "");
        if (r.crawledContent)
          out += "\n\n> " + r.crawledContent.slice(0, 500) + "…";
        return out;
      })
      .join("\n\n");
    addAIMessage(
      '**Search results for "' + q + '" (' + engineTag + "):**\n\n" + txt,
    );
  } catch (e) {
    removeTypingIndicator(tid);
    addAIMessage("Search error: " + e.message);
  }
}

/* Scrape a URL with engine choice popup */
async function doScrapeWithChoice(url) {
  const chat = getCurrentChat();
  if (!chat) return;
  const engine = await _pickScrapeEngine(url);
  if (!engine) return;

  chat.messages.push({
    role: "user",
    content: "🕷 Scraping: " + url,
    timestamp: Date.now(),
  });
  saveChats();
  renderMessages();
  const tid = showTypingIndicator();
  try {
    let result = "";
    if (engine === "serpapi") {
      // Use SerpAPI scrape
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "site:" + url, engine: "serpapi" }),
      });
      const d = await res.json();
      result =
        (d.results || [])
          .map((r) => "**" + r.title + "**\n" + r.snippet)
          .join("\n\n") || "No results.";
    } else {
      // Use built-in crawler
      const res = await fetch("/api/crawl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, depth: 1, extractLinks: true }),
      });
      const d = await res.json();
      if (d.error) {
        result = "Crawl error: " + d.error;
      } else {
        result = "**" + d.title + "**\n\n" + d.text;
        if (d.links?.length)
          result += "\n\n**Links found:**\n" + d.links.slice(0, 8).join("\n");
      }
    }
    removeTypingIndicator(tid);
    addAIMessage(result);
  } catch (e) {
    removeTypingIndicator(tid);
    addAIMessage("Scrape error: " + e.message);
  }
}

/* Engine picker popup */
function _pickSearchEngine() {
  return new Promise((resolve) => {
    const hasSerpApi = true; // server will fallback automatically; let user choose
    const el = document.createElement("div");
    el.id = "searchEnginePicker";
    el.innerHTML = `
      <div id="searchEngineBox">
        <div id="searchEngineTitle">🔍 SEARCH ENGINE</div>
        <div id="searchEngineDesc">Choose how ARIA searches the web:</div>
        <div id="searchEngineBtns">
          <button class="searchEngineBtn" data-engine="crawler">
            <span>🕷 Built-in Crawler</span>
            <small>DuckDuckGo + page crawl<br>No API key needed</small>
          </button>
          <button class="searchEngineBtn" data-engine="serpapi">
            <span>⚡ SerpAPI</span>
            <small>Structured results<br>Requires API key</small>
          </button>
        </div>
        <button id="searchEngineCancel">Cancel</button>
      </div>`;
    document.body.appendChild(el);
    el.querySelectorAll(".searchEngineBtn").forEach((btn) => {
      btn.addEventListener("click", () => {
        el.remove();
        resolve(btn.dataset.engine);
      });
    });
    document
      .getElementById("searchEngineCancel")
      .addEventListener("click", () => {
        el.remove();
        resolve(null);
      });
  });
}

function _pickScrapeEngine(url) {
  return new Promise((resolve) => {
    const el = document.createElement("div");
    el.id = "searchEnginePicker";
    el.innerHTML = `
      <div id="searchEngineBox">
        <div id="searchEngineTitle">🕷 SCRAPE ENGINE</div>
        <div id="searchEngineDesc" style="word-break:break-all;opacity:.6;font-size:10px;margin-bottom:12px">${url}</div>
        <div id="searchEngineBtns">
          <button class="searchEngineBtn" data-engine="crawler">
            <span>🕷 Built-in Crawler</span>
            <small>Full page crawl<br>Follows links, extracts content</small>
          </button>
          <button class="searchEngineBtn" data-engine="serpapi">
            <span>⚡ SerpAPI</span>
            <small>Site-indexed results<br>Requires API key</small>
          </button>
        </div>
        <button id="searchEngineCancel">Cancel</button>
      </div>`;
    document.body.appendChild(el);
    el.querySelectorAll(".searchEngineBtn").forEach((btn) => {
      btn.addEventListener("click", () => {
        el.remove();
        resolve(btn.dataset.engine);
      });
    });
    document
      .getElementById("searchEngineCancel")
      .addEventListener("click", () => {
        el.remove();
        resolve(null);
      });
  });
}

/* ── IMAGE GEN button (hidden) ── */
document.getElementById("imagineBtn")?.addEventListener("click", async () => {
  const prompt = userInput?.value.trim();
  if (!prompt) return;
  await doImagine(prompt);
});

async function doImagine(prompt) {
  const chat = getCurrentChat();
  if (!chat) return;
  chat.messages.push({
    role: "user",
    content: `🎨 Generate image: ${prompt}`,
    timestamp: Date.now(),
  });
  saveChats();
  renderMessages();
  const tid = showTypingIndicator();
  try {
    const res = await fetch("/api/imagine", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });
    const data = await res.json();
    removeTypingIndicator(tid);
    if (data.error) {
      addAIMessage(`Image error: ${data.error}`);
      return;
    }
    // Add image + download link in SAME conversation
    const chat2 = getCurrentChat();
    if (chat2) {
      chat2.messages.push({
        role: "aria",
        type: "image",
        imageUrl: data.url,
        content: `Generated: ${prompt}`,
        prompt,
        timestamp: Date.now(),
      });
      saveChats();
      renderMessages();
    }
  } catch (e) {
    removeTypingIndicator(tid);
    addAIMessage(`Image error: ${e.message}`);
  }
}

/* ── CALENDAR ── */
document
  .getElementById("calendarBtn")
  ?.addEventListener("click", fetchAndShowCalendar);

async function fetchAndShowCalendar() {
  const chat = getCurrentChat();
  if (!chat) return;
  const tid = showTypingIndicator();
  try {
    const res = await fetch("/api/calendar/events");
    const data = await res.json();
    removeTypingIndicator(tid);
    if (data.error) {
      addAIMessage(`Calendar: ${data.error}`);
      return;
    }
    if (!data.events?.length) {
      addAIMessage("No upcoming events in the next 7 days.");
      return;
    }
    addAIMessage(
      "**📅 Upcoming events:**\n\n" +
        data.events
          .map((e) => {
            const d = new Date(e.start).toLocaleString("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            });
            return `📅 **${e.title}** — ${d}${
              e.location ? ` @ ${e.location}` : ""
            }`;
          })
          .join("\n"),
    );
  } catch (e) {
    removeTypingIndicator(tid);
    addAIMessage(`Calendar error: ${e.message}`);
  }
}

/* ── BG TASK ── */
document.getElementById("bgTaskBtn")?.addEventListener("click", async () => {
  const task = userInput?.value.trim();
  if (!task) return;
  await doBgTask(task);
});

async function doBgTask(task) {
  const chat = getCurrentChat();
  if (!chat) return;
  chat.messages.push({
    role: "user",
    content: `⚙ Background task: ${task}`,
    timestamp: Date.now(),
  });
  userInput.value = "";
  userInput.style.height = "auto";
  saveChats();
  renderMessages();
  try {
    const cs = loadSettings();
    const res = await fetch("/api/background", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        task,
        provider: cs.provider || "openrouter",
        personality: cs.personality || "hacker",
      }),
    });
    const data = await res.json();
    if (data.error) {
      addAIMessage(`BG error: ${data.error}`);
      return;
    }
    addAIMessage(
      `⚙ Task \`${data.id}\` started — running in background. I'll show the result here when done.`,
    );
    const poll = setInterval(async () => {
      try {
        const r = await fetch(`/api/background/${data.id}`);
        const d = await r.json();
        if (d.status === "done") {
          clearInterval(poll);
          addAIMessage(`✅ **Task complete:**\n\n${d.result}`);
        } else if (d.status === "error") {
          clearInterval(poll);
          addAIMessage(`❌ Task failed: ${d.result}`);
        }
      } catch {}
    }, 3000);
  } catch (e) {
    addAIMessage(`BG error: ${e.message}`);
  }
}

/* ── COMMANDS MODAL ── */
document
  .getElementById("commandsBtn")
  ?.addEventListener("click", openCommandsModal);
document
  .getElementById("tool_commands")
  ?.addEventListener("click", openCommandsModal);
document.getElementById("commandsCloseBtn")?.addEventListener("click", () => {
  document.getElementById("commandsModal").style.display = "none";
});

async function openCommandsModal() {
  const modal = document.getElementById("commandsModal");
  const list = document.getElementById("commandsList");
  if (!modal || !list) return;
  const cmds = [
    { name: "/calc <expr>", desc: "Calculator — e.g. /calc sqrt(144)" },
    { name: "/time", desc: "Current server time" },
    { name: "/weather [lat,lon]", desc: "Weather (default: Mason OH)" },
    { name: "/notes add|list|delete", desc: "Session notes" },
    { name: "/todo add|list|done|delete", desc: "Task list" },
    { name: "/timer start|list|cancel", desc: "Countdown timers" },
    { name: "/search <query>", desc: "Web search" },
    { name: "/news [topic]", desc: "Latest headlines" },
    { name: "/system", desc: "Server info" },
    { name: "/scrape <url>", desc: "Extract text from webpage" },
    { name: "/imagine <desc>", desc: "Generate an image" },
    { name: "/calendar", desc: "View Google Calendar events" },
    { name: "/gdoc <doc-id>", desc: "Read a Google Doc" },
    { name: "/help", desc: "Show this list in chat" },
    { name: "∑ Math Mode", desc: "Step-by-step homework solver" },
    { name: "💻 Code Mode", desc: "Full runnable code with comments" },
    { name: "📚 Study Mode", desc: "Quiz from uploaded documents" },
    { name: "🧠 Thinking Mode", desc: "ARIA shows reasoning before answering" },
    { name: "🔍 Web Search", desc: "Type query → ARIA searches the web" },
    { name: "🎨 Generate Image", desc: "Type description → image generated" },
    { name: "📅 Calendar", desc: "Show upcoming events" },
    { name: "⚙ Background Task", desc: "Long tasks run in background" },
  ];
  list.innerHTML = cmds
    .map(
      (c) => `
    <div class="commandItem">
      <span class="commandName">${c.name}</span>
      <span class="commandDesc">${c.desc}</span>
    </div>`,
    )
    .join("");
  modal.style.display = "flex";
  triggerHalo("pulse", 600);
}

/* ── BG TASKS MODAL ── */
document
  .getElementById("bgTasksListBtn")
  ?.addEventListener("click", async () => {
    const modal = document.getElementById("bgTasksModal");
    const list = document.getElementById("bgTasksList");
    if (!modal || !list) return;
    try {
      const tasks = await (await fetch("/api/background")).json();
      list.innerHTML = !tasks.length
        ? "<div style='color:var(--text-muted);font-size:11px;padding:12px'>No background tasks yet.</div>"
        : tasks
            .map(
              (t) =>
                `<div class="bgTaskItem ${
                  t.status
                }"><div style="color:var(--text-blaze);font-size:11px">${
                  t.task
                }</div><div style="color:var(--text-muted);font-size:10px;margin-top:3px">${t.status.toUpperCase()} — ${new Date(
                  t.started,
                ).toLocaleTimeString()}</div></div>`,
            )
            .join("");
    } catch {
      list.innerHTML =
        "<div style='color:#ff4444;padding:12px'>Error loading tasks.</div>";
    }
    modal.style.display = "flex";
  });
document.getElementById("bgTasksCloseBtn")?.addEventListener("click", () => {
  document.getElementById("bgTasksModal").style.display = "none";
});

/* ============================================================
   FILE UPLOAD — attach inside textarea
   ============================================================ */
document
  .getElementById("fileUploadBtn")
  ?.addEventListener("change", async (e) => {
    for (const file of Array.from(e.target.files || [])) {
      const fd = new FormData();
      fd.append("file", file);
      try {
        const res = await fetch("/api/upload", { method: "POST", body: fd });
        const data = await res.json();
        if (data.error) {
          addSystemMessage(`Upload failed: ${data.error}`);
          continue;
        }
        if (data.type === "image") {
          pendingFiles.push({
            type: "image",
            name: file.name,
            base64: data.base64,
            text: data.text,
          });
          documentContext += `\n[Image: ${file.name}]`;
        } else {
          pendingFiles.push({
            type: "document",
            name: file.name,
            text: data.text,
          });
          documentContext += `\n[Doc: ${file.name}]\n${data.text.slice(
            0,
            2000,
          )}`;
        }
        renderAttachPreviews();
      } catch (err) {
        addSystemMessage(`Upload error: ${err.message}`);
      }
    }
    e.target.value = "";
  });

function renderAttachPreviews() {
  const row = document.getElementById("attachPreviewRow");
  if (!row) return;
  if (!pendingFiles.length) {
    row.style.display = "none";
    row.innerHTML = "";
    return;
  }
  row.style.display = "flex";
  row.innerHTML = pendingFiles
    .map(
      (f, i) => `
    <div class="attachThumb" title="${f.name}">
      ${
        f.type === "image"
          ? `<img src="${f.base64}" alt="${f.name}">`
          : `<span>${f.name.slice(0, 8)}</span>`
      }
      <span class="attachRemove" onclick="window.ARIA_removeAttach(${i})">✕</span>
    </div>`,
    )
    .join("");
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
  chats.unshift({ id, title: "New Chat", messages: [], createdAt: Date.now() });
  currentChatId = id;
  documentContext = "";
  pendingFiles = [];
  saveChats();
  syncToServer();
}
function getCurrentChat() {
  return chats.find((c) => c.id === currentChatId) || null;
}

export function deleteChat(chatId) {
  chats = chats.filter((c) => c.id !== chatId);
  if (currentChatId === chatId) {
    currentChatId = chats.length ? chats[0].id : null;
    if (!currentChatId) createNewChat();
  }
  saveChats();
  syncToServer();
  renderChatList();
  renderMessages();
}
export function clearAllChats() {
  chats = [];
  createNewChat();
  renderChatList();
  renderMessages();
}
export function renameChat(chatId) {
  const chat = chats.find((c) => c.id === chatId);
  if (!chat) return;
  const t = prompt("Rename:", chat.title);
  if (!t?.trim()) return;
  chat.title = t.trim().slice(0, 40);
  saveChats();
  syncToServer();
  renderChatList();
}
export function deleteMessage(chatId, idx) {
  const chat = chats.find((c) => c.id === chatId);
  if (!chat?.messages[idx]) return;
  chat.messages.splice(idx, 1);
  saveChats();
  renderMessages();
}
export function copyMessage(content) {
  navigator.clipboard
    ?.writeText(content)
    .then(() => showToast("Copied to clipboard", "⎘"))
    .catch(() => showToast("Copy failed", "✗"));
}
export function regenerateMessage(chatId, idx) {
  const chat = chats.find((c) => c.id === chatId);
  if (!chat) return;
  const um = [...chat.messages]
    .slice(0, idx)
    .reverse()
    .find((m) => m.role === "user");
  if (!um) return;
  chat.messages = chat.messages.slice(0, idx);
  saveChats();
  renderMessages();
  sendMessageContent(um.content, chat);
}

window.ARIA_deleteChat = deleteChat;
window.ARIA_clearAllChats = clearAllChats;
window.ARIA_renameChat = renameChat;
window.ARIA_deleteMessage = deleteMessage;
window.ARIA_copyMessage = copyMessage;
window.ARIA_regenerateMsg = regenerateMessage;
window.ARIA_renderChatList = renderChatList;
window.ARIA_doScrapeWithChoice = doScrapeWithChoice;
window.ARIA_doWebSearch = doWebSearch;
window.ARIA_loadFromServer = loadFromServer;

newChatBtn?.addEventListener("click", () => {
  createNewChat();
  renderChatList();
  renderMessages();
  closeCodePanel();
  window.ARIA_closeSidebar?.();
});
sendBtn?.addEventListener("click", sendMessage);
userInput?.addEventListener("keydown", (e) => {
  currentSettings = loadSettings();
  if (
    e.key === "Enter" &&
    !e.shiftKey &&
    currentSettings.sendOnEnter !== false
  ) {
    e.preventDefault();
    sendMessage();
  }
});
userInput?.addEventListener("input", () => {
  userInput.style.height = "auto";
  userInput.style.height = Math.min(userInput.scrollHeight, 120) + "px";
});

/* ── DRAG & DROP into textarea (files and image URLs) ── */
const _dndWrap = document.getElementById("textareaWrap");
if (_dndWrap) {
  _dndWrap.addEventListener("dragover", (e) => {
    e.preventDefault();
    _dndWrap.classList.add("drag-over");
  });
  _dndWrap.addEventListener("dragleave", () =>
    _dndWrap.classList.remove("drag-over"),
  );
  _dndWrap.addEventListener("drop", async (e) => {
    e.preventDefault();
    _dndWrap.classList.remove("drag-over");
    const files = Array.from(e.dataTransfer.files || []);
    const imgUrl =
      e.dataTransfer.getData("text/uri-list") ||
      e.dataTransfer.getData("text/plain");
    for (const file of files) {
      const fd = new FormData();
      fd.append("file", file);
      try {
        const res = await fetch("/api/upload", { method: "POST", body: fd });
        const data = await res.json();
        if (data.type === "image") {
          pendingFiles.push({
            type: "image",
            name: file.name,
            base64: data.base64,
            text: data.text,
          });
          documentContext += "\n[Image: " + file.name + "]";
        } else if (data.text) {
          pendingFiles.push({
            type: "document",
            name: file.name,
            text: data.text,
          });
          documentContext += "\n[Doc: " + file.name + "]";
        }
        renderAttachPreviews();
      } catch {}
    }
    if (!files.length && imgUrl && imgUrl.startsWith("http")) {
      if (userInput) userInput.value += (userInput.value ? " " : "") + imgUrl;
    }
  });
}

/* ============================================================
   RENDER CHAT LIST
   ============================================================ */
function renderChatList() {
  if (!chatList) return;
  chatList.innerHTML = "";
  chats.forEach((chat) => {
    const row = document.createElement("div");
    row.className = "chatRow" + (chat.id === currentChatId ? " active" : "");
    const btn = document.createElement("button");
    btn.className = "chatItem" + (chat.id === currentChatId ? " active" : "");
    btn.textContent = chat.title || "Untitled";
    btn.title = chat.title;
    btn.onclick = () => {
      currentChatId = chat.id;
      renderChatList();
      renderMessages();
      window.ARIA_closeSidebar?.();
    };
    const rBtn = document.createElement("button");
    rBtn.className = "chatActionBtn chatRenameBtn";
    rBtn.title = "Rename";
    rBtn.textContent = "✎";
    rBtn.onclick = (e) => {
      e.stopPropagation();
      renameChat(chat.id);
    };
    const dBtn = document.createElement("button");
    dBtn.className = "chatActionBtn chatDeleteBtn";
    dBtn.title = "Delete";
    dBtn.textContent = "✕";
    dBtn.onclick = (e) => {
      e.stopPropagation();
      if (confirm(`Delete "${chat.title}"?`)) deleteChat(chat.id);
    };
    row.appendChild(btn);
    row.appendChild(rBtn);
    row.appendChild(dBtn);
    chatList.appendChild(row);
  });
}

/* ============================================================
   RENDER MESSAGES
   ============================================================ */
function renderMessages() {
  if (!messages) return;
  messages.innerHTML = "";
  const chat = getCurrentChat();
  if (!chat) return;

  chat.messages.forEach((msg, idx) => {
    const div = document.createElement("div");
    div.classList.add("msg", msg.role);

    let bodyHTML;
    if (msg.type === "image" && msg.imageUrl) {
      bodyHTML = `<div class="msgImageWrap">
        <img src="${msg.imageUrl}" alt="Generated" class="msgImage" onclick="window.open('${msg.imageUrl}','_blank')">
        <div class="imgActions">
          <a href="${msg.imageUrl}" download="aria-image.png" class="fileDownloadBtn">⬇ Download Image</a>
        </div>
      </div>`;
    } else if (msg.role === "user") {
      const thumbs = (msg.attachments || [])
        .map((a) =>
          a.type === "image"
            ? `<div class="msgAttachThumb"><img src="${a.base64}" alt="${a.name}"></div>`
            : `<div class="msgAttachThumb docThumb">${a.name.slice(
                0,
                10,
              )}</div>`,
        )
        .join("");
      bodyHTML = `${thumbs ? `<div class="msgAttachments">${thumbs}</div>` : ""}
        <p class="userPara">${escapeHtml(msg.content).replace(
          /\n/g,
          "<br>",
        )}</p>`;
    } else {
      bodyHTML = renderMarkdown(msg.content);
      // Append download links for any code blocks
      const codeMatches = [
        ...msg.content.matchAll(/```(\w*)\n?([\s\S]*?)```/g),
      ];
      if (codeMatches.length) {
        const extMap = {
          javascript: "js",
          typescript: "ts",
          python: "py",
          html: "html",
          css: "css",
          json: "json",
          bash: "sh",
          shell: "sh",
        };
        const dlLinks = codeMatches
          .map((m, i) => {
            const lang = m[1] || "txt";
            const ext = extMap[lang] || lang || "txt";
            const enc = encodeURIComponent(m[2].trim());
            return `<button class="fileDownloadBtn" onclick="window.ARIA_downloadCode(decodeURIComponent('${enc}'),'aria-code-${
              i + 1
            }.${ext}')">⬇ Download .${ext}</button>`;
          })
          .join(" ");
        bodyHTML += `<div class="codeDownloadRow">${dlLinks}</div>`;
      }
    }

    const time = new Date(msg.timestamp).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    const isAria = msg.role === "aria";
    div.innerHTML = `
      <div class="msgHeader">
        <div class="msgSender">${msg.role === "user" ? "YOU" : "ARIA"}</div>
        <div class="msgMeta">
          <span class="msgTimestamp">${time}</span>
          <button class="msgActionBtn msgCopyBtn" title="Copy" onclick="window.ARIA_copyMessage(${JSON.stringify(
            msg.content,
          )})">⎘</button>
          ${
            isAria
              ? `<button class="msgActionBtn msgRegenBtn" title="Regenerate" onclick="window.ARIA_regenerateMsg('${chat.id}',${idx})">↺</button>`
              : ""
          }
          <button class="msgActionBtn msgDeleteBtn" title="Delete" onclick="window.ARIA_deleteMessage('${
            chat.id
          }',${idx})">✕</button>
        </div>
      </div>
      <div class="msgBody">${bodyHTML}</div>`;
    messages.appendChild(div);
  });

  // Wire code panel buttons
  messages.querySelectorAll(".codePanelBtn").forEach((btn) => {
    btn.addEventListener("click", () =>
      openCodePanel(decodeURIComponent(btn.dataset.code), btn.dataset.lang),
    );
  });

  messages.scrollTop = messages.scrollHeight;
}

/* ── CHAT NOTIFICATION ── */
let _notifT = null;
function showChatNotification(text, ms = 3000) {
  const el = document.getElementById("chatNotification");
  if (!el) return;
  el.textContent = text.replace(/\*\*/g, "");
  el.classList.add("visible");
  clearTimeout(_notifT);
  _notifT = setTimeout(() => el.classList.remove("visible"), ms);
}
window.ARIA_showNotification = showChatNotification;

/* ── ACTION TOAST — top-right corner notice ── */
let _toastTimer = null;
function showToast(msg, icon = "✓") {
  let el = document.getElementById("ariaToast");
  if (!el) {
    el = document.createElement("div");
    el.id = "ariaToast";
    document.body.appendChild(el);
  }
  el.innerHTML = `<span class="ariaToastIcon">${icon}</span><span>${msg}</span>`;
  el.classList.remove("ariaToastOut");
  el.classList.add("ariaToastIn");
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => {
    el.classList.replace("ariaToastIn", "ariaToastOut");
  }, 2200);
}
window.ARIA_showToast = showToast;

/* ── INSERT MATH / SYMBOL into textarea ── */
window.insertMath = function (sym) {
  const inp = document.getElementById("userInput");
  if (!inp) return;
  const s = inp.selectionStart ?? inp.value.length;
  const e = inp.selectionEnd ?? s;
  inp.value = inp.value.slice(0, s) + sym + inp.value.slice(e);
  inp.selectionStart = inp.selectionEnd = s + sym.length;
  inp.focus();
  inp.dispatchEvent(new Event("input"));
};

/* ── MATH PANEL — Desmos embed + symbol keyboard ── */
function showMathPanel() {
  let p = document.getElementById("mathPanel");
  if (!p) {
    p = document.createElement("div");
    p.id = "mathPanel";
    p.innerHTML = buildMathPanelHTML();
    document.body.appendChild(p);
    // Load Desmos API if not already loaded
    if (!window.Desmos) {
      const s = document.createElement("script");
      s.src =
        "https://www.desmos.com/api/v1.9/calculator.js?apiKey=dcb31709b452b1cf9dc26972add0fda6";
      s.onload = () => _initDesmos();
      document.head.appendChild(s);
    } else {
      setTimeout(_initDesmos, 50);
    }
  }
  requestAnimationFrame(() => {
    p.classList.add("open");
    document.body.classList.add("mathPanelOpen");
  });
}

function _initDesmos() {
  const el = document.getElementById("desmosContainer");
  if (!el || window._desmosCalc) return;
  window._desmosCalc = window.Desmos?.GraphingCalculator(el, {
    keypad: true,
    expressions: true,
    settingsMenu: true,
    zoomButtons: true,
    expressionsTopbar: true,
    border: false,
    // Dark theme via API — much more reliable than CSS overrides
    backgroundColor: "#0d0000",
    textColor: "#cc4444",
    defaultAxesNumbers: true,
  });
  // Tint the graph canvas lines/labels after init
  if (window._desmosCalc) {
    try {
      window._desmosCalc.updateSettings({ backgroundColor: "#0d0000" });
    } catch {}
  }
}
function hideMathPanel() {
  const p = document.getElementById("mathPanel");
  if (p) p.classList.remove("open");
  document.body.classList.remove("mathPanelOpen");
}
window.ARIA_hideMathPanel = hideMathPanel;

window._switchMathTab = function (tab) {
  const calc = document.getElementById("desmosContainer");
  const viz = document.getElementById("mathVizContainer");
  const keys = document.getElementById("mathPanelBody");
  const btnCalc = document.getElementById("mathTabCalc");
  const btnViz = document.getElementById("mathTabViz");
  const btnKeys = document.getElementById("mathTabKeys");
  [calc, viz, keys].forEach((el) => {
    if (el) el.style.display = "none";
  });
  [btnCalc, btnViz, btnKeys].forEach((b) => b?.classList.remove("active"));
  if (tab === "calc") {
    if (calc) calc.style.display = "";
    btnCalc?.classList.add("active");
    if (!window._desmosCalc) _initDesmos();
  } else if (tab === "viz") {
    if (viz) {
      viz.style.display = "flex";
      viz.style.flexDirection = "column";
    }
    btnViz?.classList.add("active");
    _initMathViz();
  } else {
    if (keys) keys.style.display = "";
    btnKeys?.classList.add("active");
  }
};

/* ── 3D / 2D Math Visualiser using Canvas + function parser ── */
let _mathVizCtx = null;
let _mathVizAnimId = null;
let _mathViz3dScene = null;

function _initMathViz() {
  const canvas = document.getElementById("mathVizCanvas");
  if (!canvas || _mathVizCtx) return;
  _mathVizCtx = canvas.getContext("2d");
  // Set canvas resolution to match display
  const resize = () => {
    canvas.width = canvas.clientWidth * devicePixelRatio;
    canvas.height = canvas.clientHeight * devicePixelRatio;
  };
  resize();
  new ResizeObserver(resize).observe(canvas);
}

window._renderMathViz = function () {
  const expr = document.getElementById("mathVizExpr")?.value.trim();
  const type = document.getElementById("mathVizType")?.value || "2d";
  if (!expr) return;
  cancelAnimationFrame(_mathVizAnimId);
  if (type === "3d" || type === "shape") {
    _render3D(expr, type);
  } else {
    _render2D(expr, type);
  }
  // Render LaTeX via MathJax if available
  const latexEl = document.getElementById("mathVizLatex");
  if (latexEl) {
    latexEl.textContent = expr;
    if (window.MathJax?.typesetPromise) {
      latexEl.innerHTML =
        "\\(" +
        expr
          .replace(/\*\*/g, "^")
          .replace(/\*/g, "\\cdot ")
          .replace(/sqrt\(([^)]+)\)/g, "\\sqrt{$1}")
          .replace(/pi/g, "\\pi")
          .replace(/inf/g, "\\infty") +
        "\\)";
      window.MathJax.typesetPromise([latexEl]).catch(() => {});
    }
  }
};

function _safeEval(expr, vars = {}) {
  try {
    const fn = new Function(
      ...Object.keys(vars),
      `
      const sin=Math.sin,cos=Math.cos,tan=Math.tan,sqrt=Math.sqrt,
            abs=Math.abs,log=Math.log,exp=Math.exp,pow=Math.pow,
            pi=Math.PI,e=Math.E,sign=Math.sign,floor=Math.floor,
            ceil=Math.ceil,round=Math.round;
      return ${expr.replace(/\^/g, "**")};
    `,
    );
    return fn(...Object.values(vars));
  } catch {
    return NaN;
  }
}

function _render2D(expr, type) {
  const canvas = document.getElementById("mathVizCanvas");
  const ctx = _mathVizCtx;
  if (!canvas || !ctx) return;
  const W = canvas.width,
    H = canvas.height;
  const dpr = devicePixelRatio;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);

  const xMin = -8,
    xMax = 8,
    yMin = -6,
    yMax = 6;
  const toCanvasX = (x) => ((x - xMin) / (xMax - xMin)) * W;
  const toCanvasY = (y) => H - ((y - yMin) / (yMax - yMin)) * H;

  // Grid
  ctx.strokeStyle = "rgba(255,0,0,0.12)";
  ctx.lineWidth = 1;
  for (let gx = Math.ceil(xMin); gx <= xMax; gx++) {
    ctx.beginPath();
    ctx.moveTo(toCanvasX(gx), 0);
    ctx.lineTo(toCanvasX(gx), H);
    ctx.stroke();
  }
  for (let gy = Math.ceil(yMin); gy <= yMax; gy++) {
    ctx.beginPath();
    ctx.moveTo(0, toCanvasY(gy));
    ctx.lineTo(W, toCanvasY(gy));
    ctx.stroke();
  }
  // Axes
  ctx.strokeStyle = "rgba(255,0,0,0.5)";
  ctx.lineWidth = 1.5 * dpr;
  ctx.beginPath();
  ctx.moveTo(0, toCanvasY(0));
  ctx.lineTo(W, toCanvasY(0));
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(toCanvasX(0), 0);
  ctx.lineTo(toCanvasX(0), H);
  ctx.stroke();

  // Plot
  const steps = W * 2;
  ctx.strokeStyle = "#ff2222";
  ctx.lineWidth = 2 * dpr;
  ctx.beginPath();
  let first = true;
  for (let i = 0; i <= steps; i++) {
    const x = xMin + (i / steps) * (xMax - xMin);
    let y;
    if (type === "polar") {
      const r = _safeEval(expr, { t: x });
      const px = r * Math.cos(x),
        py = r * Math.sin(x);
      const cx = toCanvasX(px),
        cy = toCanvasY(py);
      first ? ctx.moveTo(cx, cy) : ctx.lineTo(cx, cy);
      first = false;
      continue;
    }
    y = _safeEval(expr, { x });
    if (!isFinite(y)) {
      first = true;
      continue;
    }
    const cx = toCanvasX(x),
      cy = toCanvasY(y);
    first ? ctx.moveTo(cx, cy) : ctx.lineTo(cx, cy);
    first = false;
  }
  ctx.stroke();

  // Label
  ctx.fillStyle = "rgba(255,100,100,0.7)";
  ctx.font = `${12 * dpr}px Share Tech Mono, monospace`;
  ctx.fillText("y = " + expr, 8 * dpr, 18 * dpr);
}

function _render3D(expr, type) {
  const canvas = document.getElementById("mathVizCanvas");
  const ctx = _mathVizCtx;
  if (!canvas || !ctx) return;
  const W = canvas.width,
    H = canvas.height;
  const dpr = devicePixelRatio;
  let angle = 0;

  // Simple 3D wireframe renderer (no external lib)
  function project(x, y, z, rot) {
    const cos = Math.cos(rot),
      sin = Math.sin(rot);
    const rx = x * cos - z * sin;
    const rz = x * sin + z * cos;
    const scale = (350 * dpr) / (rz + 6);
    return { sx: W / 2 + rx * scale, sy: H / 2 - y * scale };
  }

  function drawFrame() {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    angle += 0.008;

    if (type === "shape") {
      // Named shapes
      const name = expr.toLowerCase().trim();
      if (name === "sphere") {
        for (let lat = -Math.PI / 2; lat < Math.PI / 2; lat += 0.25) {
          ctx.beginPath();
          let f = true;
          for (let lon = 0; lon <= Math.PI * 2 + 0.01; lon += 0.1) {
            const x = Math.cos(lat) * Math.cos(lon) * 2;
            const z = Math.cos(lat) * Math.sin(lon) * 2;
            const y = Math.sin(lat) * 2;
            const p = project(x, y, z, angle);
            f ? ctx.moveTo(p.sx, p.sy) : ctx.lineTo(p.sx, p.sy);
            f = false;
          }
          ctx.strokeStyle = `rgba(255,${Math.floor(128 + lat * 80)},50,0.6)`;
          ctx.lineWidth = 1 * dpr;
          ctx.stroke();
        }
      } else if (name === "torus") {
        const R = 2,
          r = 0.8;
        for (let u = 0; u < Math.PI * 2; u += 0.2) {
          ctx.beginPath();
          let f = true;
          for (let v = 0; v < Math.PI * 2 + 0.01; v += 0.1) {
            const x = (R + r * Math.cos(v)) * Math.cos(u);
            const z = (R + r * Math.cos(v)) * Math.sin(u);
            const y = r * Math.sin(v);
            const p = project(x, y, z, angle);
            f ? ctx.moveTo(p.sx, p.sy) : ctx.lineTo(p.sx, p.sy);
            f = false;
          }
          ctx.strokeStyle = "rgba(255,60,60,0.5)";
          ctx.lineWidth = 1 * dpr;
          ctx.stroke();
        }
      } else if (name === "cone") {
        for (let t = 0; t < Math.PI * 2; t += 0.2) {
          ctx.beginPath();
          const top = project(0, 2, 0, angle);
          ctx.moveTo(top.sx, top.sy);
          const b = project(Math.cos(t) * 1.5, -2, Math.sin(t) * 1.5, angle);
          ctx.lineTo(b.sx, b.sy);
          ctx.strokeStyle = "rgba(255,80,40,0.6)";
          ctx.lineWidth = 1 * dpr;
          ctx.stroke();
        }
        // Base circle
        ctx.beginPath();
        let f = true;
        for (let t = 0; t < Math.PI * 2 + 0.01; t += 0.1) {
          const p = project(Math.cos(t) * 1.5, -2, Math.sin(t) * 1.5, angle);
          f ? ctx.moveTo(p.sx, p.sy) : ctx.lineTo(p.sx, p.sy);
          f = false;
        }
        ctx.strokeStyle = "rgba(255,80,40,0.6)";
        ctx.stroke();
      }
    } else {
      // 3D surface z = f(x,y)
      const N = 20,
        range = 3;
      const pts = [];
      for (let i = 0; i <= N; i++) {
        pts[i] = [];
        for (let j = 0; j <= N; j++) {
          const x = (i / N) * range * 2 - range;
          const y_val = (j / N) * range * 2 - range;
          const z = _safeEval(expr, { x, y: y_val });
          pts[i][j] = {
            x,
            y: isFinite(z) ? Math.max(-3, Math.min(3, z)) : 0,
            z: y_val,
          };
        }
      }
      for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
          const p1 = project(pts[i][j].x, pts[i][j].y, pts[i][j].z, angle);
          const p2 = project(
            pts[i + 1][j].x,
            pts[i + 1][j].y,
            pts[i + 1][j].z,
            angle,
          );
          const p3 = project(
            pts[i][j + 1].x,
            pts[i][j + 1].y,
            pts[i][j + 1].z,
            angle,
          );
          const h = Math.floor(((pts[i][j].y + 3) / 6) * 180);
          ctx.strokeStyle = `hsla(${h},80%,55%,0.5)`;
          ctx.lineWidth = 0.8 * dpr;
          ctx.beginPath();
          ctx.moveTo(p1.sx, p1.sy);
          ctx.lineTo(p2.sx, p2.sy);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(p1.sx, p1.sy);
          ctx.lineTo(p3.sx, p3.sy);
          ctx.stroke();
        }
      }
    }
    ctx.fillStyle = "rgba(255,80,80,0.6)";
    ctx.font = `${11 * dpr}px Share Tech Mono,monospace`;
    ctx.fillText(expr, 8 * dpr, 18 * dpr);
    _mathVizAnimId = requestAnimationFrame(drawFrame);
  }
  drawFrame();
}

// Load MathJax for LaTeX rendering
if (!window.MathJax) {
  window.MathJax = {
    tex: { inlineMath: [["\\(", "\\)"]] },
    startup: { typeset: false },
  };
  const s = document.createElement("script");
  s.src = "https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js";
  s.async = true;
  document.head.appendChild(s);
}

function buildMathPanelHTML() {
  const INS = {
    sin: "sin()",
    cos: "cos()",
    tan: "tan()",
    csc: "csc()",
    sec: "sec()",
    cot: "cot()",
    "sin⁻¹": "sin⁻¹()",
    "cos⁻¹": "cos⁻¹()",
    "tan⁻¹": "tan⁻¹()",
    sinh: "sinh()",
    cosh: "cosh()",
    tanh: "tanh()",
    log: "log()",
    ln: "ln()",
    "log₂": "log₂()",
    logₙ: "logₙ()",
    "( )": "()",
    "√()": "√()",
    "a/b": "a/b",
    "a/bc": "(a+b)/c",
    GRAPH: "GRAPH: y = ",
    TABLE: "TABLE: x | y\n",
    WINDOW: "WINDOW: x[-10,10] y[-10,10]",
    "|x|": "|x|",
    "x²": "x²",
    "x³": "x³",
    xⁿ: "x^n",
  };
  const secs = [
    {
      l: "NUMBERS",
      k: [
        "7",
        "8",
        "9",
        "÷",
        "4",
        "5",
        "6",
        "×",
        "1",
        "2",
        "3",
        "-",
        "0",
        ".",
        "( )",
        "+",
      ],
    },
    {
      l: "POWERS / √",
      k: [
        "x²",
        "x³",
        "xⁿ",
        "√()",
        "∛",
        "∜",
        "e^",
        "10^",
        "log",
        "ln",
        "log₂",
        "logₙ",
      ],
    },
    {
      l: "ALGEBRA",
      k: [
        "x",
        "y",
        "z",
        "n",
        "a",
        "b",
        "=",
        "≠",
        "≈",
        "<",
        ">",
        "≤",
        "≥",
        "±",
        "|x|",
        "∞",
      ],
    },
    {
      l: "FRACTIONS",
      k: [
        "a/b",
        "a/bc",
        "1/x",
        "²/₃",
        "⁻¹",
        "→",
        "←",
        "∝",
        "∴",
        "∵",
        "⌊⌋",
        "⌈⌉",
      ],
    },
    {
      l: "TRIG",
      k: [
        "sin",
        "cos",
        "tan",
        "csc",
        "sec",
        "cot",
        "sin⁻¹",
        "cos⁻¹",
        "tan⁻¹",
        "sinh",
        "cosh",
        "tanh",
      ],
    },
    {
      l: "CALCULUS",
      k: [
        "d/dx",
        "∫",
        "∬",
        "∭",
        "∂",
        "dy/dx",
        "δ/δx",
        "Σ",
        "Π",
        "lim",
        "∇",
        "∮",
      ],
    },
    {
      l: "GREEK",
      k: [
        "α",
        "β",
        "γ",
        "δ",
        "ε",
        "θ",
        "λ",
        "μ",
        "π",
        "σ",
        "τ",
        "φ",
        "χ",
        "ψ",
        "ω",
        "Ω",
        "Δ",
        "Γ",
        "Λ",
        "Ξ",
        "Σ",
        "Φ",
        "Ψ",
      ],
    },
    {
      l: "SETS / LOGIC",
      k: [
        "∈",
        "∉",
        "⊆",
        "⊂",
        "⊃",
        "∪",
        "∩",
        "∅",
        "∀",
        "∃",
        "¬",
        "∧",
        "∨",
        "⊕",
        "⇒",
        "⟺",
      ],
    },
    {
      l: "STATS",
      k: ["x̄", "σ", "μ", "r", "r²", "P(", "C(", "n!", "Q₁", "Q₃", "IQR", "z="],
    },
    {
      l: "MATRIX",
      k: [
        "[  ]",
        "det(",
        "tr(",
        "⁻¹",
        "ᵀ",
        "·",
        "⊗",
        "dim",
        "rref",
        "rank",
        "‖v‖",
        "∑ᵢ",
      ],
    },
    {
      l: "TI-30 / GRAPH",
      k: [
        "y=",
        "GRAPH",
        "TABLE",
        "WINDOW",
        "ZOOM",
        "TRACE",
        "nCr",
        "nPr",
        "STAT",
        "LinReg",
        "STO→",
        "ANS",
      ],
    },
  ];

  const body = secs
    .map((sec) => {
      const keys = sec.k
        .map((k) => {
          const ins = (INS[k] !== undefined ? INS[k] : k)
            .replace(/\\/g, "\\\\")
            .replace(/'/g, "\\'");
          return `<button class="mathKey" onclick="window.insertMath('${ins}')">${k}</button>`;
        })
        .join("");
      return `<div class="mathSection"><div class="mathSectionLabel">${sec.l}</div><div class="mathKeyGrid">${keys}</div></div>`;
    })
    .join("");

  return `
    <div id="mathPanelHeader">
      <span>∑ MATH</span>
      <div style="display:flex;gap:4px;align-items:center">
        <button class="mathTabBtn active" id="mathTabCalc" onclick="window._switchMathTab('calc')">Calculator</button>
        <button class="mathTabBtn" id="mathTabViz" onclick="window._switchMathTab('viz')">Visualise</button>
        <button class="mathTabBtn" id="mathTabKeys" onclick="window._switchMathTab('keys')">Symbols</button>
        <button onclick="window.ARIA_hideMathPanel()" title="Close" style="margin-left:6px">✕</button>
      </div>
    </div>
    <div id="desmosContainer" style="flex:1;min-height:380px;"></div>
    <div id="mathVizContainer" style="display:none;flex:1;flex-direction:column;min-height:380px;overflow:hidden;">
      <div id="mathVizInput" style="display:flex;gap:6px;padding:8px;border-bottom:1px solid var(--red-dim)">
        <input id="mathVizExpr" type="text" placeholder="e.g. sin(x), x^2-4, sphere, torus" style="flex:1;background:var(--bg-abyss);border:1px solid var(--red-dim);color:var(--text-hot);font-family:'Share Tech Mono',monospace;font-size:11px;padding:4px 8px;outline:none">
        <select id="mathVizType" style="background:var(--bg-abyss);border:1px solid var(--red-dim);color:var(--text-hot);font-family:'Share Tech Mono',monospace;font-size:10px;padding:3px">
          <option value="2d">2D Graph</option>
          <option value="3d">3D Surface</option>
          <option value="shape">3D Shape</option>
          <option value="polar">Polar</option>
        </select>
        <button onclick="window._renderMathViz()" style="background:transparent;border:1px solid var(--red-core);color:var(--red-core);font-family:'Orbitron',sans-serif;font-size:8px;letter-spacing:.1em;padding:4px 10px;cursor:crosshair">PLOT</button>
      </div>
      <canvas id="mathVizCanvas" style="flex:1;width:100%;background:#000"></canvas>
      <div id="mathVizLatex" style="padding:8px;font-size:12px;color:var(--text-muted);min-height:40px;border-top:1px solid var(--border-cut)"></div>
    </div>
    <div id="mathPanelBody" style="display:none">${body}</div>`;
}

/* ── MUSIC TUTOR PANEL (right-side) ── */
function showMusicPanel() {
  let p = document.getElementById("musicPanel");
  if (!p) {
    p = document.createElement("div");
    p.id = "musicPanel";
    p.innerHTML = buildMusicPanelHTML();
    document.body.appendChild(p);
  }
  requestAnimationFrame(() => p.classList.add("open"));
}
function hideMusicPanel() {
  const p = document.getElementById("musicPanel");
  if (p) p.classList.remove("open");
}

function buildMusicPanelHTML() {
  const mk = (sym, label) =>
    `<button class="mathKey" onclick="window.insertMath('${sym}')">${
      label || sym
    }</button>`;
  return `
    <div id="musicPanelHeader">
      <span>🎵 MUSIC KEYBOARD</span>
      <button onclick="document.getElementById('musicPanel').classList.remove('open')">✕</button>
    </div>
    <div id="musicPanelBody">
      <div class="mathSection"><div class="mathSectionLabel">CLEF / NOTATION</div>
        <div class="mathKeyGrid">
          ${mk("𝄞", "Treble 𝄞")}${mk("𝄢", "Bass 𝄢")}${mk("𝄡", "Staff")}${mk(
    "𝄀",
    "Bar |",
  )}
          ${mk("♩", "♩ Quarter")}${mk("♪", "♪ 8th")}${mk("♫", "♫ Beam")}${mk(
    "𝅗𝅥",
    "Half",
  )}
          ${mk("𝅝", "Whole")}${mk("𝄽", "Rest")}${mk("𝄾", "8th Rest")}${mk(
    "𝄿",
    "16th Rest",
  )}
        </div>
      </div>
      <div class="mathSection"><div class="mathSectionLabel">ACCIDENTALS</div>
        <div class="mathKeyGrid">
          ${mk("♭", "♭ Flat")}${mk("♯", "♯ Sharp")}${mk("♮", "♮ Natural")}${mk(
    "𝄪",
    "𝄪 Dbl#",
  )}
          ${mk("𝄫", "𝄫 Dbl♭")}${mk("½♭", "Half♭")}${mk("½♯", "Half♯")}${mk(
    "¾♯",
    "3/4♯",
  )}
        </div>
      </div>
      <div class="mathSection"><div class="mathSectionLabel">NOTES (C-B)</div>
        <div class="mathKeyGrid">
          ${["C", "D", "E", "F", "G", "A", "B"].map((n) => mk(n)).join("")}
          ${["C#", "Db", "D#", "Eb", "F#", "Gb", "G#", "Ab", "A#", "Bb"]
            .map((n) => mk(n))
            .join("")}
        </div>
      </div>
      <div class="mathSection"><div class="mathSectionLabel">INTERVALS (RCM)</div>
        <div class="mathKeyGrid">
          ${[
            "Unison",
            "min 2nd",
            "Maj 2nd",
            "min 3rd",
            "Maj 3rd",
            "P4",
            "Aug 4th",
            "Dim 5th",
            "P5",
            "min 6th",
            "Maj 6th",
            "min 7th",
            "Maj 7th",
            "Octave",
          ]
            .map((n) => mk(n + " "))
            .join("")}
        </div>
      </div>
      <div class="mathSection"><div class="mathSectionLabel">DYNAMICS</div>
        <div class="mathKeyGrid">
          ${[
            "ppp",
            "pp",
            "p",
            "mp",
            "mf",
            "f",
            "ff",
            "fff",
            "sf",
            "sfz",
            "fz",
            "fp",
            "cresc.",
            "dim.",
            "decresc.",
            "subito f",
          ]
            .map((n) => mk(n + " "))
            .join("")}
        </div>
      </div>
      <div class="mathSection"><div class="mathSectionLabel">TEMPO / EXPRESSION</div>
        <div class="mathKeyGrid">
          ${[
            "Allegro",
            "Andante",
            "Adagio",
            "Presto",
            "Largo",
            "Moderato",
            "Vivace",
            "rit.",
            "accel.",
            "a tempo",
            "poco a poco",
            "con fuoco",
            "legato",
            "staccato",
            "tenuto",
            "marcato",
          ]
            .map((n) => mk(n + " "))
            .join("")}
        </div>
      </div>
      <div class="mathSection"><div class="mathSectionLabel">TIME / KEY SIGNATURES</div>
        <div class="mathKeyGrid">
          ${[
            "4/4",
            "3/4",
            "2/4",
            "6/8",
            "9/8",
            "12/8",
            "2/2",
            "3/8",
            "5/4",
            "7/8",
          ]
            .map((n) => mk(n + " "))
            .join("")}
          ${[
            "C major",
            "G major",
            "D major",
            "A major",
            "E major",
            "B major",
            "F major",
            "Bb major",
            "Eb major",
            "Ab major",
            "Db major",
            "Gb major",
            "A minor",
            "E minor",
            "B minor",
            "D minor",
            "G minor",
            "C minor",
            "F minor",
            "Bb minor",
          ]
            .map((n) => mk(n + " "))
            .join("")}
        </div>
      </div>
      <div class="mathSection"><div class="mathSectionLabel">RCM LEVELS (PIANO)</div>
        <div class="mathKeyGrid">
          ${[
            "Prep A",
            "Prep B",
            "Level 1",
            "Level 2",
            "Level 3",
            "Level 4",
            "Level 5",
            "Level 6",
            "Level 7",
            "Level 8",
            "Level 9",
            "Level 10",
            "ARCT",
          ]
            .map((n) => mk("RCM " + n + " "))
            .join("")}
        </div>
      </div>
      <div class="mathSection"><div class="mathSectionLabel">VIOLIN (RCM)</div>
        <div class="mathKeyGrid">
          ${[
            "Open string",
            "1st pos",
            "2nd pos",
            "3rd pos",
            "Shift",
            "Vibrato",
            "Détaché",
            "Martelé",
            "Spiccato",
            "Sautillé",
            "Col legno",
            "Sul ponticello",
            "Sul tasto",
            "Pizzicato",
            "Arco",
            "Harmonics",
          ]
            .map((n) => mk(n + " "))
            .join("")}
        </div>
      </div>
    </div>`;
}

/* ── Auto show/hide math panel when math mode toggles ── */
document.getElementById("mathModeBtn")?.addEventListener(
  "click",
  () => {
    setTimeout(() => {
      if (mathMode) showMathPanel();
      else hideMathPanel();
    }, 50);
  },
  true,
);

/* ── Tool dropdown extras ── */
document.getElementById("tool_link")?.addEventListener("click", () => {
  if (toolsDropMenu) toolsDropMenu.style.display = "none";
  toolsDropBtn?.classList.remove("active");
  import("./linkMode.js").then((m) => m.openLinkMode?.());
});
document.getElementById("tool_bluetooth")?.addEventListener("click", () => {
  if (toolsDropMenu) toolsDropMenu.style.display = "none";
  import("./linkMode.js").then((m) => m.scanBluetooth?.());
});
document.getElementById("tool_hometools")?.addEventListener("click", () => {
  if (toolsDropMenu) toolsDropMenu.style.display = "none";
  import("./linkMode.js").then((m) => m.showHomeToolsInSidebar?.());
});

function addSystemMessage(content) {
  const chat = getCurrentChat();
  if (!chat) return;
  chat.messages.push({ role: "aria", content, timestamp: Date.now() });
  saveChats();
  renderMessages();
}

function addAIMessage(content) {
  const chat = getCurrentChat();
  if (!chat) return;
  chat.messages.push({ role: "aria", content, timestamp: Date.now() });
  saveChats();
  syncToServer();
  renderMessages();
  if (ttsEnabled) speak(content);
}

/* ============================================================
   SEND MESSAGE
   ============================================================ */
async function sendMessage() {
  const text = userInput?.value.trim();
  if (!text || isGenerating) return;
  currentSettings = loadSettings();
  const chat = getCurrentChat();
  if (!chat) return;

  const attachments = [...pendingFiles];
  pendingFiles = [];
  renderAttachPreviews();

  chat.messages.push({
    role: "user",
    content: text,
    timestamp: Date.now(),
    attachments: attachments.length ? attachments : undefined,
  });
  if (chat.title === "New Chat") {
    chat.title = text.slice(0, 35) + (text.length > 35 ? "…" : "");
    renderChatList();
  }
  userInput.value = "";
  userInput.style.height = "auto";
  saveChats();
  syncToServer();
  renderMessages();

  // Slash commands
  const cmds = [
    [/^\/calc (.+)/i, (m) => runTool("calc", m[1])],
    [/^\/time/i, (_) => runTool("time", "")],
    [/^\/weather(.*)/i, (m) => runTool("weather", m[1].trim())],
    [/^\/notes (.+)/i, (m) => runTool("notes", m[1])],
    [/^\/todo (.+)/i, (m) => runTool("todo", m[1])],
    [/^\/timer (.+)/i, (m) => runTool("timer", m[1])],
    [
      /^\/search (.+)/i,
      (m) => {
        doWebSearch(m[1]);
        return null;
      },
    ],
    [
      /^\/imagine (.+)/i,
      (m) => {
        doImagine(m[1]);
        return null;
      },
    ],
    [/^\/news(.*)/i, (m) => runTool("news", m[1].trim())],
    [/^\/system/i, (_) => runTool("system", "")],
    [/^\/help/i, (_) => Promise.resolve(HELP_TEXT)],
  ];
  for (const [re, fn] of cmds) {
    const match = text.match(re);
    if (match) {
      const r = await fn(match);
      if (r) addAIMessage(r);
      return;
    }
  }

  await sendMessageContent(text, chat, attachments);
}

const HELP_TEXT = `**ARIA Commands**
/calc /time /weather /notes /todo /timer /search /news /system /imagine /help

Open **🔧 Tools** in the sidebar for mode toggles and tool shortcuts.`;

async function sendMessageContent(text, chat, attachments = []) {
  isGenerating = true;
  setSendState(true);
  triggerHalo("thinking");
  const tid = showTypingIndicator();
  let abort = new AbortController();
  window.ARIA_stopGeneration = () => {
    abort.abort();
    isGenerating = false;
    setSendState(false);
    clearHalo();
    removeTypingIndicator(tid);
    renderMessages();
  };

  const docCtx =
    attachments.map((a) => a.text || "").join("\n") || documentContext;
  const payload = {
    message: text,
    history: chat.messages.slice(-20).map((m) => {
      const images = (m.attachments || []).filter(
        (a) => a.type === "image" && a.base64,
      );
      if (m.role === "user" && images.length) {
        return {
          role: "user",
          content: [
            ...images.map((img) => ({
              type: "image_url",
              image_url: { url: img.base64, detail: "auto" },
            })),
            { type: "text", text: m.content || "" },
          ],
        };
      }
      return {
        role: m.role === "aria" ? "assistant" : "user",
        content: m.content,
      };
    }),
    provider: currentSettings.provider || "openrouter",
    model: (() => {
      const p = currentSettings.provider;
      if (p === "openrouter") return currentSettings.orModel || undefined;
      if (p === "cloudflare")
        return currentSettings.cfAutoModel !== false
          ? undefined
          : currentSettings.cfModel || undefined;
      if (p === "ollama") return currentSettings.ollamaModel || undefined;
      if (p === "lmstudio") return currentSettings.lmstudioModel || undefined;
      return undefined;
    })(),
    imageProvider: currentSettings.imageProvider || "auto",
    personality: currentSettings.personality || "hacker",
    mathMode,
    programmingMode,
    studyMode,
    musicTutorMode,
    workspaceRepo: workspaceRepoUrl || undefined,
    documentContext: docCtx,
    imageAttachments: attachments
      .filter((a) => a.type === "image" && a.base64)
      .map((a) => ({
        base64: a.base64,
        mimeType: a.mimeType || "image/jpeg",
        name: a.name,
      })),
  };

  try {
    // ── STREAMING PATH (OpenRouter) ───────────────────────────
    if ((currentSettings.provider || "openrouter") === "openrouter") {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abort.signal,
        body: JSON.stringify(payload),
      });

      if (res.headers.get("content-type")?.includes("text/event-stream")) {
        removeTypingIndicator(tid);
        clearHalo();

        const streamId = "stream_" + Date.now();

        // ── Live thinking panel (shown while inside <think>)
        const thinkLiveId = streamId + "_think";
        const thinkLiveDiv = document.createElement("div");
        thinkLiveDiv.id = thinkLiveId;
        thinkLiveDiv.className = "thinkLivePanel";
        thinkLiveDiv.innerHTML = `<div class="thinkLiveHeader"><span class="thinkLiveDot pulse"></span> ARIA is reasoning…</div><div class="thinkLiveSteps" id="${thinkLiveId}_steps"></div>`;
        messages.appendChild(thinkLiveDiv);
        messages.scrollTop = messages.scrollHeight;

        // ── Answer bubble (hidden until </think> closes or no think block)
        const streamDiv = document.createElement("div");
        streamDiv.classList.add("msg", "aria");
        streamDiv.id = streamId;
        streamDiv.style.display = "none";
        streamDiv.innerHTML = `<div class="msgSender">ARIA</div><div class="msgBody streamBody" id="${streamId}_body"></div>`;
        messages.appendChild(streamDiv);

        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        let accumulated = "";
        let inThink = false;
        let answerBuf = "";
        let stepsShown = new Set();

        function showLiveStep(stepText) {
          const m = stepText.match(
            /\[STEP \d+\s*[—–-]\s*([A-Z &]+)\]:\s*(.+)/i,
          );
          if (!m) return;
          const label = m[1].trim();
          const detail = m[2].trim();
          if (stepsShown.has(label)) return;
          stepsShown.add(label);
          const stepsEl = document.getElementById(thinkLiveId + "_steps");
          if (!stepsEl) return;
          const pill = document.createElement("div");
          pill.className = "thinkLiveStep thinkLiveStepIn";
          pill.innerHTML =
            `<span class="thinkStepLabel">${escapeHtml(label)}</span>` +
            `<span class="thinkStepText">${escapeHtml(detail)}</span>`;
          stepsEl.appendChild(pill);
          messages.scrollTop = messages.scrollHeight;
        }

        // ── Step bar for tool/agent events (injected right before final msg)
        let stepBar = null;
        function getStepBar() {
          if (!stepBar) {
            stepBar = document.createElement("div");
            stepBar.className = "clawLiveStepBar";
            // Insert before streamDiv so pills end up above the answer
            messages.insertBefore(stepBar, streamDiv);
          }
          return stepBar;
        }

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const raw = line.slice(6).trim();
            try {
              const evt = JSON.parse(raw);

              // Sub-agent / tool step events
              if (evt.step) {
                const bar = getStepBar();
                let icon = "⚙";
                const label = (evt.msg || evt.tool || evt.agent || "").slice(
                  0,
                  120,
                );
                if (evt.type === "tool_start") icon = "🔧";
                if (evt.type === "tool_done") icon = "✓";
                if (evt.type === "agent") icon = "🤖";
                if (evt.type === "source") icon = "🌐";
                if (evt.type === "thinking") icon = "💭";
                if (evt.type === "claw") icon = "🦾";
                const pill = document.createElement("div");
                pill.className =
                  "clawStepPill clawStepIn" +
                  (evt.type === "tool_done" ? " clawStepDone" : "");
                if (evt.type === "source" && evt.url) {
                  pill.innerHTML =
                    `<span class="clawStepIcon">🌐</span>` +
                    `<a href="${escapeHtml(
                      evt.url,
                    )}" target="_blank" class="clawStepLink">` +
                    `${escapeHtml((evt.title || evt.url).slice(0, 100))}</a>`;
                } else {
                  pill.innerHTML =
                    `<span class="clawStepIcon">${icon}</span>` +
                    `<span class="clawStepText">${escapeHtml(label)}</span>`;
                }
                bar.appendChild(pill);
                messages.scrollTop = messages.scrollHeight;
              }

              if (evt.delta) {
                accumulated += evt.delta;
                const thinkOpen = accumulated.indexOf("<think>");
                const thinkClose = accumulated.indexOf("</think>");

                if (thinkOpen !== -1 && thinkClose === -1) {
                  inThink = true;
                  const newThink = accumulated.slice(thinkOpen + 7);
                  for (const tl of newThink.split("\n")) {
                    if (/\[STEP \d+/i.test(tl)) showLiveStep(tl.trim());
                  }
                } else if (thinkClose !== -1) {
                  if (inThink) {
                    inThink = false;
                    const thinkFull = accumulated.slice(
                      (accumulated.indexOf("<think>") || 0) + 7,
                      thinkClose,
                    );
                    for (const tl of thinkFull.split("\n")) {
                      if (/\[STEP \d+/i.test(tl)) showLiveStep(tl.trim());
                    }
                    thinkLiveDiv.classList.add("thinkLiveDone");
                    const hdr = thinkLiveDiv.querySelector(".thinkLiveHeader");
                    if (hdr) {
                      const dot = hdr.querySelector(".thinkLiveDot");
                      if (dot) {
                        dot.classList.remove("pulse");
                        dot.classList.add("done");
                      }
                      hdr.innerHTML =
                        `<span class="thinkLiveDot done"></span> ` +
                        `Reasoned · ${stepsShown.size} step${
                          stepsShown.size !== 1 ? "s" : ""
                        }`;
                    }
                  }
                  answerBuf = accumulated.slice(thinkClose + 8).trimStart();
                  if (answerBuf) {
                    streamDiv.style.display = "";
                    const bodyEl = document.getElementById(streamId + "_body");
                    if (bodyEl) bodyEl.innerHTML = renderMarkdown(answerBuf);
                    messages.scrollTop = messages.scrollHeight;
                  }
                } else if (!inThink && accumulated.length > 0) {
                  streamDiv.style.display = "";
                  const bodyEl = document.getElementById(streamId + "_body");
                  if (bodyEl) bodyEl.innerHTML = renderMarkdown(accumulated);
                  messages.scrollTop = messages.scrollHeight;
                }
              }
              if (evt.done && evt.full) accumulated = evt.full;
            } catch {}
          }
        }

        // Collapse think panel (keep it — don't remove)
        // if the model produced no steps, hide it entirely
        if (stepsShown.size === 0) {
          thinkLiveDiv.remove();
        } else {
          thinkLiveDiv.classList.add("thinkLiveDone");
        }

        // Remove the live stream preview — addAIMessage renders the final version
        // with the proper <details class="thinkBlock"> dropdown from renderMarkdown
        streamDiv.remove();
        addAIMessage(accumulated.trim() || "[No reply]");
        return;
      }

      // SSE not returned — treat as regular JSON
      const data = await res.json();
      removeTypingIndicator(tid);
      clearHalo();
      if (data.imageUrl) {
        const chat2 = getCurrentChat();
        if (chat2) {
          chat2.messages.push({
            role: "aria",
            type: "image",
            imageUrl: data.imageUrl,
            content: `Generated: ${data.imagePrompt || text}`,
            timestamp: Date.now(),
          });
          saveChats();
          renderMessages();
        }
        if (data.reply) addAIMessage(data.reply);
      } else {
        addAIMessage(data.reply?.trim() || "[No reply]");
      }
      return;
    }

    // ── NON-STREAMING PATH (all other providers) ──────────────
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: abort.signal,
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    removeTypingIndicator(tid);
    clearHalo();

    if (data.imageUrl) {
      const chat2 = getCurrentChat();
      if (chat2) {
        chat2.messages.push({
          role: "aria",
          type: "image",
          imageUrl: data.imageUrl,
          content: `Generated: ${data.imagePrompt || text}`,
          timestamp: Date.now(),
        });
        saveChats();
        renderMessages();
      }
      if (data.reply) addAIMessage(data.reply);
    } else {
      addAIMessage(data.reply?.trim() || "[No reply]");
    }
  } catch (err) {
    removeTypingIndicator(tid);
    clearHalo();
    if (err.name !== "AbortError") addAIMessage("[Error contacting server]");
  } finally {
    isGenerating = false;
    setSendState(false);
  }
}

function setSendState(on) {
  if (sendBtn) {
    sendBtn.disabled = on;
    sendBtn.textContent = on ? "…" : "Send";
    sendBtn.style.opacity = on ? "0.5" : "1";
  }
  // Show/hide stop bar via class (it lives in the DOM always)
  document.getElementById("ariaStopBar")?.classList.toggle("active", on);
  if (userInput) userInput.disabled = on && !window._ariaPaused;
}
function showTypingIndicator() {
  const id = "typing_" + Date.now();
  const div = document.createElement("div");
  div.classList.add("msg", "aria", "typingIndicator");
  div.id = id;
  div.innerHTML = `<div class="msgSender">ARIA</div><div class="typingDots"><span></span><span></span><span></span></div>`;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
  return id;
}
function removeTypingIndicator(id) {
  document.getElementById(id)?.remove();
}

/* ============================================================
   MARKDOWN
   ============================================================ */
function escapeHtml(t) {
  return String(t)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderMarkdown(text) {
  if (!text) return "";

  // ── STEP 1: Strip think tags and HTML leaks (on raw text) ──
  if (/<think>/i.test(text)) {
    text = text.replace(/^[\s\S]*?(?=<think>)/i, "");
  }
  text = text.replace(/<\/think>/gi, "").replace(/<think>/gi, "");
  text = text.replace(/<[^>]{0,200}$/, ""); // incomplete trailing tag
  const SAFE_TAG_RE = /^\/?(b|i|strong|em|code|pre|br|hr|ul|ol|li|blockquote|details|summary|table|thead|tbody|tr|th|td)$/i;
  text = text.replace(/<(\/?[a-zA-Z][a-zA-Z0-9]*)[^>]*>/g, (m, tag) =>
    SAFE_TAG_RE.test(tag) ? m : "",
  );

  // ── STEP 2: Extract think blocks BEFORE any escaping ──
  const thinkPlaceholders = [];
  text = text.replace(/<think>([\s\S]*?)<\/think>/gi, (_, inner) => {
    const cleaned = inner.trim();
    const stepRegex = /\[STEP \d+\s*[—–-]\s*([A-Z ]+)\]:\s*([^\n]+)/gi;
    const steps = [];
    let m;
    while ((m = stepRegex.exec(cleaned)) !== null) {
      steps.push({ label: m[1].trim(), text: m[2].trim() });
    }
    const pills = steps.length
      ? `<div class="thinkSteps">${steps
          .map(
            (s) =>
              `<span class="thinkStep"><span class="thinkStepLabel">${escapeHtml(
                s.label,
              )}</span><span class="thinkStepText">${escapeHtml(
                s.text,
              )}</span></span>`,
          )
          .join("")}</div>`
      : "";
    const idx = thinkPlaceholders.length;
    thinkPlaceholders.push({ pills, raw: cleaned });
    return `\x00THINK${idx}\x00`;
  });

  // ── STEP 3: Extract code blocks BEFORE escaping (protect content) ──
  const codePlaceholders = [];
  text = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const clean = code.trim();
    const enc = encodeURIComponent(clean);
    const extMap = {
      javascript: "js",
      typescript: "ts",
      python: "py",
      html: "html",
      css: "css",
      json: "json",
      bash: "sh",
      shell: "sh",
      cpp: "cpp",
      c: "c",
      rust: "rs",
      go: "go",
    };
    const ext = extMap[lang] || lang || "txt";
    const html = `<div class="codeBlock">
      ${lang ? `<span class="codeLabel">${lang.toUpperCase()}</span>` : ""}
      <div class="codeActions">
        <button class="codePanelBtn codeActionBtn" data-code="${enc}" data-lang="${lang}">⤢ Panel</button>
        <button class="codeActionBtn" onclick="navigator.clipboard?.writeText(decodeURIComponent('${enc}')).then(()=>window.ARIA_showToast('Code copied','⎘'));this.textContent='✓';setTimeout(()=>this.textContent='⎘',1300)">⎘ Copy</button>
        <button class="codeActionBtn" onclick="window.ARIA_downloadCode(decodeURIComponent('${enc}'),'aria-code.${ext}')">⬇ .${ext}</button>
      </div>
      <pre><code>${escapeHtml(clean)}</code></pre>
    </div>`;
    const idx = codePlaceholders.length;
    codePlaceholders.push(html);
    return `\x00CODE${idx}\x00`;
  });

  // ── STEP 4: escapeHtml the remaining text (safe, no code or think) ──
  let h = escapeHtml(text);

  // ── STEP 5: Apply markdown formatting on escaped text ──
  h = h.replace(/`([^`\n]+)`/g, '<code class="inlineCode">$1</code>');
  h = h.replace(/^### (.+)$/gm, '<h3 class="mdH3">$1</h3>');
  h = h.replace(/^## (.+)$/gm, '<h2 class="mdH2">$1</h2>');
  h = h.replace(/^# (.+)$/gm, '<h1 class="mdH1">$1</h1>');
  h = h.replace(/^---$/gm, '<hr class="mdHr"/>');
  h = h.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
  h = h.replace(/\*\*(.+?)\*\*/g, '<strong class="mdBold">$1</strong>');
  h = h.replace(/\*(.+?)\*/g, '<em class="mdItalic">$1</em>');
  h = h.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    (_, alt, src) =>
      `<div class="msgImageWrap"><img src="${src}" alt="${alt}" class="msgImage"><div class="imgActions"><a href="${src}" download class="fileDownloadBtn">⬇ Download</a></div></div>`,
  );
  h = h.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener" class="mdLink">$1</a>',
  );
  // Bullet lists
  h = h.replace(
    /((?:^[*\-] .+\n?)+)/gm,
    (b) =>
      `<ul class="mdList">${b
        .trim()
        .split("\n")
        .map((l) => `<li>${l.replace(/^[*\-] /, "")}</li>`)
        .join("")}</ul>`,
  );
  // Ordered lists
  h = h.replace(
    /((?:^\d+\. .+\n?)+)/gm,
    (b) =>
      `<ol class="mdList">${b
        .trim()
        .split("\n")
        .map((l) => `<li>${l.replace(/^\d+\. /, "")}</li>`)
        .join("")}</ol>`,
  );
  // Paragraphs
  h = h
    .split(/\n{2,}/)
    .map((b) => {
      const t = b.trim();
      if (!t || /^<(h[1-3]|ul|ol|div|details|pre|hr|\x00)/.test(t)) return t;
      return `<p class="mdPara">${t.replace(/\n/g, "<br/>")}</p>`;
    })
    .join("\n");

  // ── STEP 6: Restore code and think placeholders ──
  h = h.replace(
    /\x00CODE(\d+)\x00/g,
    (_, i) => codePlaceholders[parseInt(i)] || "",
  );
  h = h.replace(/\x00THINK(\d+)\x00/g, (_, i) => {
    const t = thinkPlaceholders[parseInt(i)];
    if (!t) return "";
    const b64 = btoa(unescape(encodeURIComponent(escapeHtml(t.raw))));
    return (
      t.pills +
      `<details class="thinkBlock"><summary>◈ Full reasoning log</summary><div class="thinkContent">${t.raw
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")}</div></details>`
    );
  });

  return h;
}

/* ── PERSISTENCE ── */
function saveChats() {
  localStorage.setItem("aria_chats", JSON.stringify(chats));
}
async function syncToServer() {
  try {
    await fetch("/api/saveChats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: window.ARIA_userId || "sarvin", chats }),
    });
  } catch {}
}
/* ── VERSION DISPLAY ── */
async function loadVersionFromGitHub() {
  try {
    const res = await fetch(
      "https://api.github.com/repos/DaEpickid540/ARIA/commits?per_page=1",
    );
    if (!res.ok) return;
    const data = await res.json();
    const sha = data[0]?.sha?.slice(0, 7) || "";
    // Count commits for version number
    const countRes = await fetch(
      "https://api.github.com/repos/DaEpickid540/ARIA/commits?per_page=100",
    );
    const commits = countRes.ok ? await countRes.json() : [];
    const major = 1;
    const minor = Math.floor(commits.length / 10);
    const patch = commits.length % 10;
    const verStr = `Mark ${major}.${minor}.${patch}`;
    const verEl = document.getElementById("ariaVersionLabel");
    if (verEl) verEl.textContent = verStr;
    localStorage.setItem("aria_version", verStr);
  } catch {
    const cached = localStorage.getItem("aria_version");
    const verEl = document.getElementById("ariaVersionLabel");
    if (verEl && cached) verEl.textContent = cached;
  }
}
loadVersionFromGitHub();
setInterval(loadVersionFromGitHub, 300_000); // refresh every 5 min

/* ── PiP MINI CHAT ── */
(function initPipChat() {
  const pipEl = document.getElementById("pipChat");
  const pipMsgs = document.getElementById("pipChatMessages");
  const pipInput = document.getElementById("pipChatInputField");
  const pipSend = document.getElementById("pipChatSend");
  const pipExpand = document.getElementById("pipChatExpand");
  const pipClose = document.getElementById("pipChatClose");
  const pipToggle = document.getElementById("pipToggleBtn");
  if (!pipEl) return;

  let pipOpen = false;

  pipToggle?.addEventListener("click", () => {
    pipOpen = !pipOpen;
    pipEl.style.display = pipOpen ? "flex" : "none";
  });
  pipClose?.addEventListener("click", () => {
    pipOpen = false;
    pipEl.style.display = "none";
  });
  pipExpand?.addEventListener("click", () => {
    pipOpen = false;
    pipEl.style.display = "none";
    document.getElementById("layout").style.display = "flex";
  });

  async function pipSend2() {
    const text = pipInput?.value.trim();
    if (!text) return;
    addPipMsg("You", text);
    if (pipInput) pipInput.value = "";
    try {
      const s = loadSettings();
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          provider: s.provider || "openrouter",
          personality: s.personality || "hacker",
          history: [],
        }),
      });
      const d = await res.json();
      addPipMsg("ARIA", d.reply || "…");
    } catch {
      addPipMsg("ARIA", "Connection error.");
    }
  }

  function addPipMsg(sender, text) {
    if (!pipMsgs) return;
    const d = document.createElement("div");
    d.className = "pipMsg " + (sender === "You" ? "pipMsgUser" : "pipMsgAria");
    d.innerHTML = `<b>${sender}:</b> ${String(text)
      .replace(/</g, "&lt;")
      .slice(0, 300)}`;
    pipMsgs.appendChild(d);
    pipMsgs.scrollTop = pipMsgs.scrollHeight;
  }

  pipSend?.addEventListener("click", pipSend2);
  pipInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") pipSend2();
  });

  // Drag
  const header = document.getElementById("pipChatHeader");
  let ox = 0,
    oy = 0,
    mx = 0,
    my = 0;
  header?.addEventListener("mousedown", (e) => {
    mx = e.clientX;
    my = e.clientY;
    const move = (e2) => {
      ox = e2.clientX - mx;
      oy = e2.clientY - my;
      mx = e2.clientX;
      my = e2.clientY;
      pipEl.style.left = pipEl.offsetLeft + ox + "px";
      pipEl.style.top = pipEl.offsetTop + oy + "px";
      pipEl.style.right = "auto";
      pipEl.style.bottom = "auto";
    };
    document.addEventListener("mousemove", move);
    document.addEventListener(
      "mouseup",
      () => document.removeEventListener("mousemove", move),
      { once: true },
    );
  });
})();

async function loadFromServer() {
  try {
    const uid = window.ARIA_userId || "sarvin";
    const res = await fetch(`/api/loadChats?userId=${uid}`);
    const data = await res.json();
    if (data.chats?.length > chats.length) {
      const localIds = new Set(chats.map((c) => c.id));
      chats = [
        ...data.chats.filter((c) => !localIds.has(c.id)),
        ...chats,
      ].sort((a, b) => b.id.localeCompare(a.id));
      currentChatId = chats[0].id;
      saveChats();
      renderChatList();
      renderMessages();
    }
  } catch {}
}
