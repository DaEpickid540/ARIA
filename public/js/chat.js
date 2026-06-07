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
  const tid = showTypingIndicator("search");
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
  const tid = showTypingIndicator("search");
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
  const tid = showTypingIndicator("image");
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
  const tid = showTypingIndicator("files", "calendar events");
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

/* ── BG TASKS MODAL ── (rendering now handled by taskPanel.js) */
document.getElementById("bgTasksListBtn")?.addEventListener("click", () => {
  const modal = document.getElementById("bgTasksModal");
  if (modal) modal.style.display = "flex";
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
/* ── EMPTY / NEW CHAT STATE ── */
// Shown when the current chat has no messages. Provides a welcome and
// quick-start suggestions that drop into the input box when clicked.
function renderEmptyState() {
  if (!messages) return;

  const greetings = [
    "What's on your mind?",
    "Where do we start?",
    "What can I help with?",
    "What are we building?",
    "Ready when you are.",
  ];
  const greeting = greetings[Math.floor(Math.random() * greetings.length)];

  // Hour-aware sub-greeting
  const hour = new Date().getHours();
  let timeOfDay = "";
  if (hour < 5) timeOfDay = "Up late.";
  else if (hour < 12) timeOfDay = "Good morning.";
  else if (hour < 17) timeOfDay = "Good afternoon.";
  else if (hour < 22) timeOfDay = "Good evening.";
  else timeOfDay = "Working late.";

  const suggestions = [
    {
      icon: "💻",
      label: "Help me debug code",
      text: "Help me debug this code: ",
    },
    { icon: "📚", label: "Explain a concept", text: "Explain " },
    { icon: "✍️", label: "Draft something", text: "Help me write " },
    { icon: "🧮", label: "Quick math", text: "Calculate " },
    { icon: "🔍", label: "Search the web", text: "Search for " },
    { icon: "🎨", label: "Generate an image", text: "Imagine: " },
  ];

  const html = `
    <div class="emptyChatState">
      <div class="emptyChatLogo">
        <span class="bootLogoA">A</span><span class="bootLogoR">R</span><span class="bootLogoI">I</span><span class="bootLogoA2">A</span>
      </div>
      <div class="emptyChatGreeting">${timeOfDay}</div>
      <div class="emptyChatPrompt">${greeting}</div>
      <div class="emptyChatSuggestions">
        ${suggestions
          .map(
            (s) =>
              `<button class="emptyChatSuggestion" data-text="${s.text.replace(
                /"/g,
                "&quot;",
              )}">
                <span class="emptyChatIcon">${s.icon}</span>
                <span class="emptyChatLabel">${s.label}</span>
              </button>`,
          )
          .join("")}
      </div>
      <div class="emptyChatHint">Tip: Press <kbd>Ctrl</kbd>+<kbd>K</kbd> for commands</div>
    </div>
  `;
  messages.innerHTML = html;

  // Wire suggestion clicks
  messages.querySelectorAll(".emptyChatSuggestion").forEach((btn) => {
    btn.addEventListener("click", () => {
      const input = document.getElementById("userInput");
      if (input) {
        input.value = btn.dataset.text;
        input.focus();
        // Place caret at end
        input.setSelectionRange(input.value.length, input.value.length);
        // Trigger resize/halo if any listeners are attached
        input.dispatchEvent(new Event("input"));
      }
    });
  });
}

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

  // ── Empty state: show welcome + suggestions when chat has no messages ──
  if (chat.messages.length === 0) {
    renderEmptyState();
    return;
  }

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
        <div class="msgSender">${msg.role === "user" ? "YOU" : "ARIA"}${
      msg.pinned ? ' <span class="msgPinBadge" title="Pinned">📌</span>' : ""
    }${
      msg.starred ? ' <span class="msgStarBadge" title="Starred">⭐</span>' : ""
    }</div>
        <div class="msgMeta">
          <span class="msgTimestamp">${time}</span>
          <button class="msgActionBtn msgCopyBtn" title="Copy" onclick="window.ARIA_copyMessage(${JSON.stringify(
            msg.content,
          )})">⎘</button>
          <button class="msgActionBtn msgStarBtn ${
            msg.starred ? "active" : ""
          }" title="${
      msg.starred ? "Unstar" : "Star"
    }" onclick="window.ARIA_starMessage('${chat.id}',${idx})">${
      msg.starred ? "⭐" : "☆"
    }</button>
          <button class="msgActionBtn msgPinBtn ${
            msg.pinned ? "active" : ""
          }" title="${
      msg.pinned ? "Unpin" : "Pin"
    }" onclick="window.ARIA_pinMessage('${chat.id}',${idx})">📌</button>
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
    // Init native MathGrapher (no external script needed)
    setTimeout(_initDesmos, 80);
  }
  requestAnimationFrame(() => {
    p.classList.add("open");
    document.body.classList.add("mathPanelOpen");
  });
}

async function _initDesmos() {
  const el = document.getElementById("desmosContainer");
  if (!el || window._mathGrapher) return;
  try {
    const { MathGrapher } = await import("./mathGrapher.js");
    window._mathGrapher = new MathGrapher(el);
    // Listen for theme changes — redraw with new colors
    const observer = new MutationObserver(() => {
      window._mathGrapher?.draw();
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style"],
    });
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["class"],
    });
  } catch (e) {
    el.innerHTML = `<div style="padding:20px;color:#ff4444">Failed to load grapher: ${e.message}</div>`;
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
    if (!window._mathGrapher) _initDesmos();
    // Trigger resize so canvas fills its container after being shown
    else
      setTimeout(
        () => window._mathGrapher?.resize() && window._mathGrapher?.draw(),
        50,
      );
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
  // Detect task type from the message for the right loader animation
  const _detectedTask =
    window._ARIALoader?.detectTaskFromMessage(text) || "thinking";
  const tid = showTypingIndicator(_detectedTask, text.slice(0, 60));
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
    chatId: currentChatId,
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

        // ── Live thinking panel ──────────────────────────────────────
        const thinkLiveDiv = document.createElement("div");
        thinkLiveDiv.id = streamId + "_think";
        thinkLiveDiv.className = "thinkLivePanel";
        thinkLiveDiv.innerHTML = `
          <div class="thinkLiveHeader">
            <span class="thinkLiveDot pulse"></span>
            <span class="thinkLiveLabel">ARIA is reasoning\u2026</span>
            <span class="thinkLiveCount" id="${streamId}_count"></span>
          </div>
          <div class="thinkRawScroll" id="${streamId}_raw"></div>
          <div class="thinkLiveSteps" id="${streamId}_steps"></div>`;
        messages.appendChild(thinkLiveDiv);

        // ── Answer bubble \u2014 shown from the FIRST answer token ────────
        const streamDiv = document.createElement("div");
        streamDiv.classList.add("msg", "aria");
        streamDiv.id = streamId;
        streamDiv.style.display = "none";
        streamDiv.innerHTML = `
          <div class="msgSender">ARIA</div>
          <div class="msgBody streamBody" id="${streamId}_body">
            <span class="streamCursor"></span>
          </div>`;
        messages.appendChild(streamDiv);

        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        let accumulated = ""; // raw full text (think + answer)
        let answerText = ""; // only post-think answer tokens
        let inThink = false;
        let thinkDone = false;
        let stepsShown = new Set();

        // 60fps throttled DOM update during streaming
        let _renderPending = false;
        function scheduleRender() {
          if (_renderPending) return;
          _renderPending = true;
          requestAnimationFrame(() => {
            _renderPending = false;
            const bodyEl = document.getElementById(streamId + "_body");
            if (!bodyEl || !answerText) return;
            // Lightweight inline render while streaming — avoids full markdown parse each token
            const safe = answerText
              .replace(/&/g, "&amp;")
              .replace(/</g, "&lt;")
              .replace(/>/g, "&gt;")
              .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
              .replace(/\*(.+?)\*/g, "<em>$1</em>")
              .replace(/`([^`]+)`/g, "<code>$1</code>")
              .replace(/\n/g, "<br>");
            bodyEl.innerHTML = safe + '<span class="streamCursor"></span>';
            messages.scrollTop = messages.scrollHeight;
          });
        }

        // Tool / step bar (inserted above answer)
        let stepBar = null;
        function getStepBar() {
          if (!stepBar) {
            stepBar = document.createElement("div");
            stepBar.className = "clawLiveStepBar";
            messages.insertBefore(stepBar, streamDiv);
          }
          return stepBar;
        }

        // Show a reasoning thought as a pill in the think panel
        // Detects lines starting with → (the new free-form marker)
        function showLiveStep(line) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("\u2192")) return; // →
          const text = trimmed.slice(1).trim();
          if (!text || text.length < 4) return;
          const key = text.slice(0, 40); // dedupe by first 40 chars
          if (stepsShown.has(key)) return;
          stepsShown.add(key);
          const stepsEl = document.getElementById(streamId + "_steps");
          if (!stepsEl) return;
          const pill = document.createElement("div");
          pill.className = "thinkLiveStep thinkLiveStepIn";
          pill.innerHTML = `<span class="thinkArrow">\u2192</span><span class="thinkStepText">${escapeHtml(
            text.slice(0, 100),
          )}</span>`;
          stepsEl.appendChild(pill);
          // Update count badge
          const countEl = document.getElementById(streamId + "_count");
          if (countEl) countEl.textContent = stepsShown.size + " thoughts";
          messages.scrollTop = messages.scrollHeight;
        }

        // Throttled raw-text update for the think panel scroll area
        let _rawRenderPending = false;
        function scheduleRawRender(text) {
          if (_rawRenderPending) return;
          _rawRenderPending = true;
          requestAnimationFrame(() => {
            _rawRenderPending = false;
            const rawEl = document.getElementById(streamId + "_raw");
            if (!rawEl) return;
            rawEl.textContent = text;
            rawEl.scrollTop = rawEl.scrollHeight;
          });
        }

        // ── Main read loop ──────────────────────────────────────────
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

              // ── Stream start heartbeat (server connected, first token incoming) ──
              if (evt.stream_start) {
                // Loader was already removed when streaming headers were received —
                // this just ensures we scroll to the think panel
                messages.scrollTop = messages.scrollHeight;
                continue;
              }

              // ── Tool / agent step event ──
              if (evt.step) {
                // Update think panel label to reflect current tool
                const hdr = thinkLiveDiv.querySelector(".thinkLiveLabel");
                if (hdr && evt.type === "claw")
                  hdr.textContent = "CLAW — EXECUTING";
                if (hdr && evt.type === "source")
                  hdr.textContent = "QUERYING NETWORK";
                if (
                  hdr &&
                  (evt.type === "tool_start" || evt.type === "tool_done")
                )
                  hdr.textContent =
                    evt.type === "tool_done" ? "TOOL COMPLETE" : "RUNNING TOOL";
                const icons = {
                  tool_start: "\uD83D\uDD27",
                  tool_done: "\u2713",
                  agent: "\uD83E\uDD16",
                  source: "\uD83C\uDF10",
                  thinking: "\uD83D\uDCAD",
                  claw: "\uD83E\uDDBE",
                };
                const icon = icons[evt.type] || "\u2699";
                const label = (evt.msg || evt.tool || evt.agent || "").slice(
                  0,
                  120,
                );
                const pill = document.createElement("div");
                pill.className =
                  "clawStepPill clawStepIn" +
                  (evt.type === "tool_done" ? " clawStepDone" : "");
                if (evt.type === "source" && evt.url) {
                  pill.innerHTML = `<span class="clawStepIcon">\uD83C\uDF10</span><a href="${escapeHtml(
                    evt.url,
                  )}" target="_blank" class="clawStepLink">${escapeHtml(
                    (evt.title || evt.url).slice(0, 100),
                  )}</a>`;
                } else {
                  pill.innerHTML = `<span class="clawStepIcon">${icon}</span><span class="clawStepText">${escapeHtml(
                    label,
                  )}</span>`;
                }
                getStepBar().appendChild(pill);
                messages.scrollTop = messages.scrollHeight;
                continue;
              }

              // ── Token delta ──
              if (evt.delta) {
                accumulated += evt.delta;

                if (!thinkDone) {
                  const tOpen = accumulated.indexOf("<think>");
                  const tClose = accumulated.indexOf("</think>");

                  if (tClose !== -1) {
                    // Think block finished — switch to answer mode
                    thinkDone = true;
                    inThink = false;
                    const thinkContent = accumulated.slice(
                      tOpen !== -1 ? tOpen + 7 : 0,
                      tClose,
                    );
                    // Final pass: catch any → lines we missed
                    for (const tl of thinkContent.split("\n")) {
                      showLiveStep(tl.trim());
                    }
                    // Seal the think panel — collapse raw text, keep pills
                    const hdr = thinkLiveDiv.querySelector(".thinkLiveHeader");
                    if (hdr)
                      hdr.innerHTML = `<span class="thinkLiveDot done"></span><span class="thinkLiveLabel">Reasoned</span><span class="thinkLiveCount">${
                        stepsShown.size
                      } thought${stepsShown.size !== 1 ? "s" : ""}</span>`;
                    const rawEl = document.getElementById(streamId + "_raw");
                    if (rawEl) rawEl.style.display = "none"; // collapse raw during answer
                    thinkLiveDiv.classList.add("thinkLiveDone");
                    // First answer tokens
                    answerText = accumulated.slice(tClose + 8).trimStart();
                    if (answerText) {
                      streamDiv.style.display = "";
                      scheduleRender();
                    }
                  } else if (tOpen !== -1) {
                    // Inside think — stream raw text + detect → markers
                    inThink = true;
                    const thinkSoFar = accumulated.slice(tOpen + 7);
                    // Update raw text display (every token, throttled to rAF)
                    scheduleRawRender(thinkSoFar);
                    // Detect completed → lines (look at second-to-last line since last may be partial)
                    const lines = thinkSoFar.split("\n");
                    if (lines.length >= 2) {
                      showLiveStep(lines[lines.length - 2].trim());
                    }
                  } else {
                    // No think block — stream straight to answer bubble immediately
                    thinkDone = true;
                    thinkLiveDiv.remove();
                    answerText = accumulated;
                    streamDiv.style.display = "";
                    scheduleRender();
                  }
                } else {
                  // Already past think — every delta goes directly to answer
                  answerText += evt.delta;
                  scheduleRender();
                }
              }

              // ── Done event (server sends authoritative final content) ──
              if (evt.done && evt.full) {
                const tc = evt.full.indexOf("</think>");
                answerText =
                  tc !== -1 ? evt.full.slice(tc + 8).trimStart() : evt.full;
                accumulated = evt.full;
              }
            } catch {} // malformed SSE line
          }
        }

        // ── Stream ended ────────────────────────────────────────────
        // Fallback: if </think> never closed (model cut off), extract whatever answer we have
        if (!thinkDone && accumulated.length > 0) {
          const tc = accumulated.indexOf("</think>");
          answerText =
            tc !== -1 ? accumulated.slice(tc + 8).trimStart() : accumulated;
          // Show the raw think content we have so far
          const rawEl = document.getElementById(streamId + "_raw");
          if (rawEl) rawEl.style.display = "none";
          thinkLiveDiv.classList.add("thinkLiveDone");
        }
        if (stepsShown.size === 0 && !inThink) thinkLiveDiv.remove();

        const finalText =
          answerText.trim() || accumulated.trim() || "[No reply]";

        // ── Update the stream bubble IN PLACE — no flash, no teardown ──
        // Apply full renderMarkdown to the existing bubble instead of removing + rebuilding.
        const finalBodyEl = document.getElementById(streamId + "_body");
        if (finalBodyEl) {
          finalBodyEl.innerHTML = renderMarkdown(finalText);
        }
        streamDiv.style.display = "";
        streamDiv.querySelector(".streamCursor")?.remove();

        // Save to chat history without triggering a full re-render
        const _chat = getCurrentChat();
        if (_chat) {
          _chat.messages.push({
            role: "aria",
            content: finalText,
            timestamp: Date.now(),
          });
          saveChats();
          syncToServer();
          if (ttsEnabled) speak(finalText);
        }
        // RAG indexing (fire and forget)
        const _chatId = req?.body?.chatId || currentChatId;
        if (finalText.length >= 30) {
          fetch("/api/rag/index-chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chatId: _chatId,
              role: "assistant",
              content: finalText,
            }),
          }).catch(() => {});
        }
        messages.scrollTop = messages.scrollHeight;
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
/* ── ARIA LOADER (replaces old typing dots) ── */
let _ariaLoaderModule = null;
async function _getLoaderMod() {
  if (!_ariaLoaderModule) {
    _ariaLoaderModule = await import("./ariaLoader.js");
  }
  return _ariaLoaderModule;
}

function showTypingIndicator(task = "thinking", detail = "") {
  const id = "typing_" + Date.now();
  // Lazy-load the loader module and create the loader
  _getLoaderMod().then((mod) => {
    // Only create if the id slot is still needed (not already removed)
    if (!document.getElementById(id) && messages) {
      const realId = mod.showARIALoader(messages, { task, detail });
      // Remap: if caller already called removeTypingIndicator(id) before promise resolved,
      // clean up immediately
      if (window._pendingLoaderRemove?.has(id)) {
        window._pendingLoaderRemove.delete(id);
        mod.removeARIALoader(realId);
      } else {
        // Store the mapping from the placeholder id to the real loader id
        if (!window._loaderIdMap) window._loaderIdMap = new Map();
        window._loaderIdMap.set(id, realId);
      }
    }
  });
  return id;
}

function removeTypingIndicator(id) {
  if (!id) return;
  _getLoaderMod().then((mod) => {
    const realId = window._loaderIdMap?.get(id);
    if (realId) {
      mod.removeARIALoader(realId);
      window._loaderIdMap.delete(id);
    } else {
      // Promise not resolved yet — mark for removal when it does
      if (!window._pendingLoaderRemove) window._pendingLoaderRemove = new Set();
      window._pendingLoaderRemove.add(id);
      // Also try direct removal after a short delay as fallback
      setTimeout(() => {
        const rid = window._loaderIdMap?.get(id);
        if (rid) {
          mod.removeARIALoader(rid);
          window._loaderIdMap.delete(id);
        }
      }, 500);
    }
  });
  // Fallback: also remove any direct-id elements (for old callers)
  setTimeout(() => document.getElementById(id)?.remove(), 600);
}

function updateTypingIndicatorTask(id, task, detail = "") {
  _getLoaderMod().then((mod) => {
    const realId = window._loaderIdMap?.get(id);
    if (realId) mod.updateLoaderTask(realId, task, detail);
  });
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

  // ── STEP 1: Extract think blocks FIRST (before any tag stripping) ──
  // CRITICAL ORDER: stripping <think> tags first (old code) means the
  // extraction regex below never matches → raw reasoning leaks into output.
  const thinkPlaceholders = [];
  text = text.replace(/<think>([\s\S]*?)<\/think>/gi, (_, inner) => {
    const cleaned = inner.trim();
    const stepRegex = /\[STEP \d+\s*[—–-]\s*([A-Z &]+)\]:\s*([^\n]+)/gi;
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

  // ── STEP 2: Strip leftover/unclosed think tags and unsafe HTML ──
  text = text.replace(/<think>[\s\S]*/gi, ""); // unclosed <think> — drop remainder
  text = text.replace(/<\/think>/gi, "");
  text = text.replace(/<[^>]{0,200}$/, ""); // incomplete trailing tag
  const SAFE_TAG_RE = /^\/?(b|i|strong|em|code|pre|br|hr|ul|ol|li|blockquote|details|summary|table|thead|tbody|tr|th|td)$/i;
  text = text.replace(/<(\/?[a-zA-Z][a-zA-Z0-9]*)[^>]*>/g, (m, tag) =>
    SAFE_TAG_RE.test(tag) ? m : "",
  );

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
      body: JSON.stringify({
        userId: window.ARIA_userId || "sarvin",
        chats,
        sourceDeviceId: getDeviceId(),
      }),
    });
  } catch {}
}

/* ── DEVICE ID + CROSS-DEVICE LIVE SYNC ── */
function getDeviceId() {
  let id = localStorage.getItem("aria_device_id");
  if (!id) {
    id = "dev_" + Math.random().toString(36).slice(2, 10);
    localStorage.setItem("aria_device_id", id);
  }
  return id;
}

let _syncEventSource = null;
let _syncReconnectDelay = 1000;
function startChatSyncSubscription() {
  const uid = window.ARIA_userId || "sarvin";
  const did = getDeviceId();
  try {
    _syncEventSource?.close();
  } catch {}
  _syncEventSource = new EventSource(
    `/api/sync/subscribe?userId=${encodeURIComponent(
      uid,
    )}&deviceId=${encodeURIComponent(did)}`,
  );
  _syncEventSource.onopen = () => {
    _syncReconnectDelay = 1000;
    console.log("[SYNC] Connected — chats now sync live across devices.");
  };
  _syncEventSource.onmessage = async (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data.type === "chats_updated" && data.sourceDeviceId !== did) {
        // Another device updated chats — pull the latest
        await loadFromServer();
      }
    } catch {}
  };
  _syncEventSource.onerror = () => {
    try {
      _syncEventSource.close();
    } catch {}
    _syncEventSource = null;
    setTimeout(startChatSyncSubscription, _syncReconnectDelay);
    _syncReconnectDelay = Math.min(_syncReconnectDelay * 1.5, 30000);
  };
}
// Start the live sync once on module init
if (typeof window !== "undefined" && "EventSource" in window) {
  setTimeout(startChatSyncSubscription, 1500);
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

/* ════════════════════════════════════════════════════════════════
   MARK 1.5 FEATURES
   ════════════════════════════════════════════════════════════════ */

/* ── PIN / STAR MESSAGES ──────────────────────────────────────── */
window.ARIA_pinMessage = function (chatId, idx) {
  const chat = chats.find((c) => c.id === chatId);
  if (!chat?.messages[idx]) return;
  chat.messages[idx].pinned = !chat.messages[idx].pinned;
  syncToServer();
  renderMessages();
  showToast(
    chat.messages[idx].pinned ? "Message pinned" : "Message unpinned",
    "📌",
  );
};
window.ARIA_starMessage = function (chatId, idx) {
  const chat = chats.find((c) => c.id === chatId);
  if (!chat?.messages[idx]) return;
  chat.messages[idx].starred = !chat.messages[idx].starred;
  syncToServer();
  renderMessages();
  showToast(chat.messages[idx].starred ? "Message starred" : "Unstarred", "⭐");
};

// Show all starred/pinned messages in current chat
window.ARIA_showStarred = function () {
  const chat = getCurrentChat();
  if (!chat) return;
  const starred = chat.messages.filter((m) => m.starred || m.pinned);
  if (!starred.length) {
    showToast("No starred or pinned messages", "☆");
    return;
  }
  let html = starred
    .map(
      (m, i) =>
        `<div style="padding:8px 0;border-bottom:1px solid var(--border-cut)">
      <div style="font-size:10px;color:var(--text-muted)">${m.role.toUpperCase()} ${
          m.starred ? "⭐" : ""
        } ${m.pinned ? "📌" : ""}</div>
      <div style="font-size:12px;margin-top:4px;color:var(--text-blaze)">${String(
        m.content,
      ).slice(0, 200)}${m.content.length > 200 ? "…" : ""}</div>
    </div>`,
    )
    .join("");
  _showQuickModal("Starred & Pinned", html);
};

/* ── CHAT SEARCH (Ctrl+F / Cmd+F) ────────────────────────────── */
let _searchActive = false;
let _searchMatches = [];
let _searchIdx = 0;

function _buildSearchBar() {
  if (document.getElementById("chatSearchBar")) return;
  const bar = document.createElement("div");
  bar.id = "chatSearchBar";
  bar.innerHTML = `
    <input id="chatSearchInput" placeholder="Search messages…" autocomplete="off" />
    <span id="chatSearchCount"></span>
    <button id="chatSearchPrev" title="Previous">↑</button>
    <button id="chatSearchNext" title="Next">↓</button>
    <button id="chatSearchClose" title="Close">✕</button>
  `;
  document.getElementById("chatArea")?.prepend(bar);
  document.getElementById("chatSearchClose").onclick = _closeSearch;
  document.getElementById("chatSearchPrev").onclick = () => _navigateSearch(-1);
  document.getElementById("chatSearchNext").onclick = () => _navigateSearch(1);
  document
    .getElementById("chatSearchInput")
    .addEventListener("input", _runSearch);
  document
    .getElementById("chatSearchInput")
    .addEventListener("keydown", (e) => {
      if (e.key === "Enter") _navigateSearch(e.shiftKey ? -1 : 1);
      if (e.key === "Escape") _closeSearch();
    });
}

function _openSearch() {
  _searchActive = true;
  _buildSearchBar();
  const bar = document.getElementById("chatSearchBar");
  bar.classList.add("open");
  document.getElementById("chatSearchInput").focus();
}
function _closeSearch() {
  _searchActive = false;
  const bar = document.getElementById("chatSearchBar");
  bar?.classList.remove("open");
  document.querySelectorAll(".msgSearchHighlight").forEach((el) => {
    el.outerHTML = el.textContent;
  });
  document
    .querySelectorAll(".msg.searchMatch")
    .forEach((el) => el.classList.remove("searchMatch", "searchActive"));
  _searchMatches = [];
}
function _runSearch() {
  const q = document
    .getElementById("chatSearchInput")
    ?.value.trim()
    .toLowerCase();
  document.querySelectorAll(".msgSearchHighlight").forEach((el) => {
    el.outerHTML = el.textContent;
  });
  document
    .querySelectorAll(".msg.searchMatch")
    .forEach((el) => el.classList.remove("searchMatch", "searchActive"));
  _searchMatches = [];
  _searchIdx = 0;
  if (!q || q.length < 2) {
    document.getElementById("chatSearchCount").textContent = "";
    return;
  }

  const msgs = document.querySelectorAll(".msg .msgBody");
  msgs.forEach((body, i) => {
    const text = body.textContent || "";
    if (text.toLowerCase().includes(q)) {
      const msgEl = body.closest(".msg");
      msgEl.classList.add("searchMatch");
      _searchMatches.push(msgEl);
      // Highlight
      body.innerHTML = body.innerHTML.replace(
        new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"),
        (m) => `<mark class="msgSearchHighlight">${m}</mark>`,
      );
    }
  });
  const count = document.getElementById("chatSearchCount");
  count.textContent = _searchMatches.length
    ? `1 / ${_searchMatches.length}`
    : "No results";
  if (_searchMatches.length) _highlightMatch(0);
}
function _navigateSearch(dir) {
  if (!_searchMatches.length) return;
  _searchIdx =
    (_searchIdx + dir + _searchMatches.length) % _searchMatches.length;
  _highlightMatch(_searchIdx);
  document.getElementById("chatSearchCount").textContent = `${
    _searchIdx + 1
  } / ${_searchMatches.length}`;
}
function _highlightMatch(idx) {
  document
    .querySelectorAll(".msg.searchActive")
    .forEach((el) => el.classList.remove("searchActive"));
  const el = _searchMatches[idx];
  if (!el) return;
  el.classList.add("searchActive");
  el.scrollIntoView({ behavior: "smooth", block: "center" });
}

// Wire Ctrl+F / Cmd+F
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "f") {
    const chatArea = document.getElementById("chatArea");
    if (!chatArea || chatArea.style.display === "none") return;
    e.preventDefault();
    _openSearch();
  }
});
export { _openSearch as openChatSearch };

/* ── @ARIA PREFIX ─────────────────────────────────────────────── */
// Typing @aria at the start of the input auto-focuses and cleans up
const _userInput = document.getElementById("userInput");
if (_userInput) {
  _userInput.addEventListener("input", () => {
    const val = _userInput.value;
    if (/^@aria\s/i.test(val)) {
      _userInput.value = val.replace(/^@aria\s+/i, "");
      // Flash the ARIA logo or input to indicate it's addressed
      document.getElementById("chatHeader")?.classList.add("ariaAddressed");
      setTimeout(
        () =>
          document
            .getElementById("chatHeader")
            ?.classList.remove("ariaAddressed"),
        800,
      );
    }
  });
}

/* ── SPLIT PANE MODE ──────────────────────────────────────────── */
let _splitPaneActive = false;
let _splitChat2Id = null;

window.ARIA_toggleSplitPane = function () {
  _splitPaneActive = !_splitPaneActive;
  const appLayout =
    document.getElementById("appLayout") ||
    document.getElementById("chatLayout") ||
    document.querySelector(".appLayout");
  if (!appLayout) {
    showToast("Split pane layout not available", "✗");
    _splitPaneActive = false;
    return;
  }

  if (_splitPaneActive) {
    appLayout.classList.add("splitPaneActive");
    // Create second pane if not exists
    let pane2 = document.getElementById("chatPane2");
    if (!pane2) {
      pane2 = document.createElement("div");
      pane2.id = "chatPane2";
      pane2.className = "chatPaneSecondary";
      pane2.innerHTML = `
        <div class="pane2Header">
          <select id="pane2ChatSelect" class="pane2Select"></select>
          <button class="pane2CloseBtn" onclick="window.ARIA_toggleSplitPane()">✕</button>
        </div>
        <div id="pane2Messages" class="messages"></div>
      `;
      appLayout.appendChild(pane2);
      _renderPane2ChatList();
    }
    showToast("Split pane on", "◫");
  } else {
    appLayout.classList.remove("splitPaneActive");
    document.getElementById("chatPane2")?.remove();
    showToast("Split pane off", "▭");
  }
};

function _renderPane2ChatList() {
  const sel = document.getElementById("pane2ChatSelect");
  if (!sel) return;
  sel.innerHTML = chats
    .map((c) => `<option value="${c.id}">${c.title || "Chat"}</option>`)
    .join("");
  sel.value = chats[1]?.id || chats[0]?.id || "";
  _splitChat2Id = sel.value;
  sel.addEventListener("change", () => {
    _splitChat2Id = sel.value;
    _renderPane2();
  });
  _renderPane2();
}
function _renderPane2() {
  const pane = document.getElementById("pane2Messages");
  if (!pane || !_splitChat2Id) return;
  const chat = chats.find((c) => c.id === _splitChat2Id);
  if (!chat) return;
  pane.innerHTML = chat.messages
    .map(
      (m) =>
        `<div class="msg ${m.role}"><div class="msgSender">${
          m.role === "user" ? "YOU" : "ARIA"
        }</div><div class="msgBody"><p class="userPara">${String(
          m.content,
        ).replace(/</g, "&lt;")}</p></div></div>`,
    )
    .join("");
  pane.scrollTop = pane.scrollHeight;
}

/* ── QUICK MODAL HELPER ───────────────────────────────────────── */
function _showQuickModal(title, html) {
  let modal = document.getElementById("ariaQuickModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "ariaQuickModal";
    modal.innerHTML = `
      <div id="ariaQuickModalInner">
        <div id="ariaQuickModalHeader">
          <span id="ariaQuickModalTitle"></span>
          <button id="ariaQuickModalClose">✕</button>
        </div>
        <div id="ariaQuickModalBody"></div>
      </div>`;
    document.body.appendChild(modal);
    document.getElementById("ariaQuickModalClose").onclick = () => {
      modal.style.display = "none";
    };
    modal.addEventListener("click", (e) => {
      if (e.target === modal) modal.style.display = "none";
    });
  }
  document.getElementById("ariaQuickModalTitle").textContent = title;
  document.getElementById("ariaQuickModalBody").innerHTML = html;
  modal.style.display = "flex";
}

/* ── MEMORY UI ────────────────────────────────────────────────── */
window.ARIA_showMemoryUI = async function () {
  try {
    const [memRes, ragRes] = await Promise.all([
      fetch("/api/memory").then((r) => r.json()),
      fetch("/api/rag/stats").then((r) => r.json()),
    ]);
    const facts = memRes.facts || [];
    const factsHtml = facts.length
      ? facts
          .map(
            (f, i) => `<div class="memFactRow">
          <span class="memFactText">${String(f).replace(/</g, "&lt;")}</span>
          <button class="memFactDel" onclick="window.ARIA_deleteFact(${i})">✕</button>
        </div>`,
          )
          .join("")
      : "<div style='color:var(--text-muted);font-size:11px'>No facts yet.</div>";

    const ragHtml = `
      <div style="margin-top:14px;font-size:11px;color:var(--red-core);letter-spacing:0.1em;text-transform:uppercase;margin-bottom:6px">RAG KNOWLEDGE BASE</div>
      <div style="font-size:11px;color:var(--text-muted)">
        ${ragRes.totalEntries || 0} vectors indexed · 
        Chat: ${ragRes.byNamespace?.chat || 0} · 
        Training: ${ragRes.byNamespace?.training || 0} · 
        ~${ragRes.estimatedSizeMB || 0}MB
      </div>
      <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
        <button class="memBtn" onclick="window.ARIA_searchRAG()">🔍 Search</button>
        <button class="memBtn" onclick="window.ARIA_clearRAGNamespace('chat')">Clear chat index</button>
        <button class="memBtn" onclick="window.ARIA_ingestDoc()">+ Ingest document</button>
      </div>`;

    const searchHtml = `
      <div style="margin-top:14px;font-size:11px;color:var(--red-core);letter-spacing:0.1em;text-transform:uppercase;margin-bottom:6px">SEARCH MEMORY</div>
      <div style="display:flex;gap:8px">
        <input id="memSearchInput" placeholder="Search across all memories…" style="flex:1;padding:6px 8px;background:var(--bg-void);border:1px solid var(--border-cut);border-radius:2px;color:var(--text-blaze);font-size:12px">
        <button class="memBtn" onclick="window.ARIA_doMemSearch()">Search</button>
      </div>
      <div id="memSearchResults" style="margin-top:8px;font-size:11px;max-height:160px;overflow-y:auto"></div>`;

    _showQuickModal(
      "Memory & Knowledge",
      `
      <div style="font-size:11px;color:var(--red-core);letter-spacing:0.1em;text-transform:uppercase;margin-bottom:8px">FACTS (${facts.length})</div>
      <div id="memFactsList">${factsHtml}</div>
      <button class="memBtn" style="margin-top:8px" onclick="window.ARIA_addFact()">+ Add fact</button>
      ${ragHtml}
      ${searchHtml}
    `,
    );
  } catch (e) {
    showToast("Failed to load memory: " + e.message, "✗");
  }
};

window.ARIA_deleteFact = async function (idx) {
  await fetch("/api/memory", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "delete", index: idx }),
  });
  window.ARIA_showMemoryUI();
};
window.ARIA_addFact = async function () {
  const fact = prompt("Add fact to ARIA's memory:");
  if (!fact?.trim()) return;
  await fetch("/api/memory", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "add", fact: fact.trim() }),
  });
  window.ARIA_showMemoryUI();
};
window.ARIA_searchRAG = function () {
  document.getElementById("memSearchInput")?.focus();
};
window.ARIA_clearRAGNamespace = async function (ns) {
  if (!confirm(`Clear all ${ns} vectors from RAG index?`)) return;
  await fetch("/api/rag/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ namespace: ns }),
  });
  showToast("Cleared " + ns + " index", "✓");
  window.ARIA_showMemoryUI();
};
window.ARIA_ingestDoc = function () {
  const source = prompt("Source name (e.g. my-notes.md):");
  if (!source) return;
  const text = prompt("Paste document text to ingest:");
  if (!text?.trim()) return;
  fetch("/api/rag/ingest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source, text, namespace: "training" }),
  })
    .then((r) => r.json())
    .then((d) =>
      showToast(
        d.chunks
          ? `Ingested ${d.chunks} chunks from "${source}"`
          : d.message || "Ingested",
        "✓",
      ),
    )
    .catch(() => showToast("Ingest failed", "✗"));
};
window.ARIA_doMemSearch = async function () {
  const q = document.getElementById("memSearchInput")?.value.trim();
  if (!q) return;
  const el = document.getElementById("memSearchResults");
  el.innerHTML = "<span style='color:var(--text-muted)'>Searching…</span>";
  try {
    const r = await fetch("/api/rag/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: q, topK: 5 }),
    });
    const data = await r.json();
    el.innerHTML = data.results?.length
      ? data.results
          .map(
            (
              r,
            ) => `<div style="padding:6px 0;border-bottom:1px solid var(--border-cut)">
          <div style="font-size:10px;color:var(--red-core)">${
            r.namespace
          } · score:${r.score.toFixed(2)}</div>
          <div style="color:var(--text-blaze)">${String(r.text)
            .slice(0, 150)
            .replace(/</g, "&lt;")}…</div>
        </div>`,
          )
          .join("")
      : "<span style='color:var(--text-muted)'>No results.</span>";
  } catch {
    el.innerHTML = "<span style='color:#ff4444'>Search failed.</span>";
  }
};

/* ── SKILLS UI ────────────────────────────────────────────────── */
window.ARIA_showSkillsUI = async function () {
  try {
    const data = await fetch("/api/skills").then((r) => r.json());
    const skillsHtml = data.skills?.length
      ? data.skills
          .map(
            (s) => `
        <div class="skillRow ${s.active ? "active" : ""}">
          <div class="skillMeta">
            <div class="skillName">${s.name}${
              s.version !== "1.0"
                ? ` <span style="font-size:9px;color:var(--text-muted)">v${s.version}</span>`
                : ""
            }</div>
            <div class="skillDesc">${String(s.description).slice(0, 120)}</div>
            ${
              s.hasTriggers
                ? '<div class="skillTriggerBadge">auto-triggers</div>'
                : ""
            }
          </div>
          <div class="skillActions">
            <button class="skillToggleBtn ${
              s.active ? "on" : "off"
            }" onclick="window.ARIA_toggleSkill('${s.id}')">${
              s.active ? "ON" : "OFF"
            }</button>
            ${
              s.location === "user"
                ? `<button class="skillEditBtn" onclick="window.ARIA_editSkill('${s.id}')">Edit</button>`
                : ""
            }
          </div>
        </div>`,
          )
          .join("")
      : "<div style='color:var(--text-muted);font-size:11px;padding:8px'>No skills installed. Create one below or drop a SKILL.md into skills/user/.</div>";

    _showQuickModal(
      "Skills",
      `
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:12px">
        ${data.active} active · ${data.total} installed · 
        <a href="#" onclick="window.ARIA_createSkill();return false" style="color:var(--red-core)">+ New skill</a>
      </div>
      <div id="skillsList">${skillsHtml}</div>
    `,
    );
  } catch {
    showToast("Failed to load skills", "✗");
  }
};
window.ARIA_toggleSkill = async function (id) {
  await fetch(`/api/skills/${id}/toggle`, { method: "POST" });
  window.ARIA_showSkillsUI();
};
window.ARIA_editSkill = async function (id) {
  try {
    const data = await fetch(`/api/skills/${id}/content`).then((r) => r.json());
    const newContent = prompt(
      `Edit skill "${id}" (SKILL.md content):`,
      data.content,
    );
    if (newContent === null) return;
    await fetch(`/api/skills/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: newContent }),
    });
    showToast("Skill updated", "✓");
    window.ARIA_showSkillsUI();
  } catch {
    showToast("Edit failed", "✗");
  }
};
window.ARIA_createSkill = async function () {
  const id = prompt("Skill ID (e.g. my-skill):");
  if (!id?.trim()) return;
  const template = `---\nname: ${id}\ndescription: What this skill does\nversion: 1.0\ntriggers: []\n---\n\n# ${id}\n\nWrite your skill instructions here.\n`;
  const content = prompt("SKILL.md content:", template);
  if (content === null) return;
  await fetch("/api/skills", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: id.trim(), content }),
  });
  showToast("Skill created", "✓");
  window.ARIA_showSkillsUI();
};

/* ── CLAW MACRO RECORDER ──────────────────────────────────────── */
let _macroRecording = false;
let _macroSteps = [];
let _macros = JSON.parse(localStorage.getItem("aria_macros") || "{}");

window.ARIA_startMacroRecord = function () {
  _macroRecording = true;
  _macroSteps = [];
  showToast("Macro recording started", "⏺");
  // Notify server to tag claw commands as macro steps
  fetch("/api/claw/macro/record", { method: "POST" }).catch(() => {});
};

window.ARIA_stopMacroRecord = function () {
  _macroRecording = false;
  const name = prompt(`Save macro as (${_macroSteps.length} steps recorded):`);
  if (name?.trim()) {
    _macros[name.trim()] = { steps: _macroSteps, createdAt: Date.now() };
    localStorage.setItem("aria_macros", JSON.stringify(_macros));
    showToast(`Macro "${name}" saved`, "✓");
  }
  fetch("/api/claw/macro/stop", { method: "POST" }).catch(() => {});
};

window.ARIA_runMacro = function (name) {
  const macro = _macros[name];
  if (!macro) {
    showToast("Macro not found", "✗");
    return;
  }
  fetch("/api/claw/macro/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ steps: macro.steps }),
  })
    .then(() => showToast(`Macro "${name}" running`, "▶"))
    .catch(() => showToast("Macro run failed", "✗"));
};

window.ARIA_showMacros = function () {
  const names = Object.keys(_macros);
  if (!names.length) {
    showToast("No macros saved yet", "⏺");
    return;
  }
  const html = names
    .map(
      (n) => `
    <div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border-cut)">
      <span style="flex:1;font-size:12px">${n} <span style="color:var(--text-muted);font-size:10px">(${_macros[n].steps.length} steps)</span></span>
      <button class="memBtn" onclick="window.ARIA_runMacro('${n}')">▶ Run</button>
      <button class="memBtn" onclick="delete _macros['${n}'];localStorage.setItem('aria_macros',JSON.stringify(_macros));window.ARIA_showMacros()">✕</button>
    </div>`,
    )
    .join("");
  _showQuickModal(
    "Claw Macros",
    `
    <div style="margin-bottom:8px;display:flex;gap:8px">
      <button class="memBtn" onclick="window.ARIA_startMacroRecord()">⏺ Record</button>
      <button class="memBtn" onclick="window.ARIA_stopMacroRecord()">⏹ Stop & Save</button>
    </div>
    ${html}
  `,
  );
};

/* ── DAILY BRIEFING RECEIVER ──────────────────────────────────── */
(function initBriefingSubscription() {
  const es = new EventSource("/api/briefing/subscribe");
  es.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data.type === "briefing" && data.text) {
        // Add the briefing as an ARIA message in the current chat
        const chat = getCurrentChat();
        if (chat) {
          const briefMsg = {
            role: "aria",
            content:
              "🌅 **Good morning! Here's your daily briefing:**\n\n" +
              data.text,
            timestamp: Date.now(),
          };
          chat.messages.push(briefMsg);
          syncToServer();
          renderMessages();
          showToast("Morning briefing ready", "🌅");
        }
      }
    } catch {}
  };
})();

/* ── MULTI-AGENT ORCHESTRATION (server-side) ──────────────────── */
window.ARIA_multiAgent = async function (task) {
  const taskText =
    task || prompt("Multi-agent task (ARIA will coordinate sub-agents):");
  if (!taskText?.trim()) return;
  showToast("Spawning multi-agent task…", "🤖");
  try {
    const res = await fetch("/api/multi-agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task: taskText }),
    });
    const data = await res.json();
    if (data.taskId) {
      const chat = getCurrentChat();
      if (chat) {
        chat.messages.push({
          role: "aria",
          content: `🤖 Multi-agent task started (ID: \`${data.taskId}\`). Results will appear as each sub-agent completes.`,
          timestamp: Date.now(),
        });
        renderMessages();
        syncToServer();
      }
    }
  } catch {
    showToast("Multi-agent failed", "✗");
  }
};
