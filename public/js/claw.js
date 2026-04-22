// claw.js — ARIA Claw UI: command panel + always-visible kill switch

export function initClaw() {
  _buildKillSwitch();
  _buildPanel();
  _startStatusPoll();

  window.ARIA_toggleClaw = toggleClaw;
  window.ARIA_runClawCmd = runCommand;
  window.ARIA_killClaw = killClaw;
  window.ARIA_resumeClaw = resumeClaw;

  console.log("[ARIA] Claw initialized. Ctrl+Shift+A to open.");
}

/* ── Kill switch — always visible, fixed position ─────────────── */
function _buildKillSwitch() {
  const btn = document.createElement("button");
  btn.id = "clawKillSwitch";
  btn.innerHTML = "⬡ KILL<br>CLAW";
  btn.title = "Emergency stop — immediately halt all ARIA Claw actions";
  btn.addEventListener("click", killClaw);
  document.body.appendChild(btn);
}

async function killClaw() {
  const btn = document.getElementById("clawKillSwitch");
  if (btn) {
    btn.classList.add("killed");
    btn.innerHTML = "⬡ KILLED<br>RESUME?";
    btn.onclick = resumeClaw;
  }
  document.getElementById("clawStatus") &&
    (document.getElementById("clawStatus").textContent = "● KILLED");
  _appendOutput(
    "⬡ KILL SWITCH",
    "All Claw actions halted. Relay queue cleared.",
    "error",
  );
  try {
    await fetch("/api/claw/kill", { method: "POST" });
  } catch {}
}

async function resumeClaw() {
  const btn = document.getElementById("clawKillSwitch");
  if (btn) {
    btn.classList.remove("killed");
    btn.innerHTML = "⬡ KILL<br>CLAW";
    btn.onclick = killClaw;
  }
  document.getElementById("clawStatus") &&
    (document.getElementById("clawStatus").textContent = "● READY");
  _appendOutput("SYSTEM", "Claw resumed.", "info");
  try {
    await fetch("/api/claw/resume", { method: "POST" });
  } catch {}
}

/* ── Main panel ──────────────────────────────────────────────── */
function _buildPanel() {
  const panel = document.createElement("div");
  panel.id = "clawPanel";
  panel.innerHTML = `
    <div id="clawHeader">
      <span id="clawTitle">🦾 ARIA CLAW</span>
      <div id="clawHeaderRight">
        <span id="clawRelayIndicator" class="clawRelayOff" title="Relay connection status">⬡ NO RELAY</span>
        <span id="clawStatus">● READY</span>
        <button class="clawHdrBtn" id="clawResumeBtn" style="display:none" onclick="window.ARIA_resumeClaw()">▶ RESUME</button>
        <button class="clawHdrBtn" onclick="document.getElementById('clawPanel').classList.remove('open')">✕</button>
      </div>
    </div>

    <div id="clawRelayBar">
      <span id="clawRelayName">No relay connected</span>
      <span id="clawRelayPlatform"></span>
      <span id="clawRelayHelp" onclick="window.ARIA_showClawSetup()">? Setup</span>
    </div>

    <div id="clawTerminal">
      <div id="clawOutput"></div>
      <div id="clawInputRow">
        <span class="clawPrompt">ARIA&gt;</span>
        <input id="clawInput" type="text"
          placeholder="describe what ARIA should do on your PC..."
          autocomplete="off" spellcheck="false"/>
        <button id="clawRunBtn">⚡ Run</button>
      </div>
    </div>

    <div id="clawModeRow">
      <span class="clawModeLabel">MODE:</span>
      <button class="clawModeBtn active" data-mode="ai"     title="AI plans and executes automatically">🤖 AI</button>
      <button class="clawModeBtn"        data-mode="shell"  title="Direct shell/terminal command">💻 Shell</button>
      <button class="clawModeBtn"        data-mode="keys"   title="Type text into active window">⌨ Type</button>
      <button class="clawModeBtn"        data-mode="hotkey" title="Press a keyboard shortcut">⌘ Hotkey</button>
      <button class="clawModeBtn"        data-mode="mouse"  title="move X Y | click X Y | scroll up/down N">🖱 Mouse</button>
      <button id="clawClearBtn">🗑</button>
    </div>`;
  document.body.appendChild(panel);

  let activeMode = "ai";
  const PLACEHOLDERS = {
    ai: "describe what ARIA should do on your PC...",
    shell: "ls -la  or  ipconfig  or  Get-Process",
    keys: "Hello, World!  (types into active window)",
    hotkey: "ctrl+t  or  alt+tab  or  ctrl+shift+n",
    mouse: "move 500 300  |  click 500 300  |  scroll down 3",
  };

  panel.querySelectorAll(".clawModeBtn").forEach((btn) => {
    btn.addEventListener("click", () => {
      panel
        .querySelectorAll(".clawModeBtn")
        .forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      activeMode = btn.dataset.mode;
      document.getElementById("clawInput").placeholder =
        PLACEHOLDERS[activeMode] || "";
    });
  });

  document.getElementById("clawRunBtn").addEventListener("click", () => {
    const v = document.getElementById("clawInput").value.trim();
    if (!v) return;
    document.getElementById("clawInput").value = "";
    runCommand(v, activeMode);
  });

  document.getElementById("clawInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("clawRunBtn").click();
  });

  document.getElementById("clawClearBtn").addEventListener("click", () => {
    document.getElementById("clawOutput").innerHTML = "";
  });

  // Setup help
  window.ARIA_showClawSetup = () =>
    _appendOutput(
      "SETUP",
      [
        "To enable full PC control:",
        "",
        "1. Copy  claw-relay.js  to any folder on your PC",
        "2. Run:  node claw-relay.js https://your-aria-url.onrender.com",
        "   (Node.js required — already installed if you dev locally)",
        "",
        "The relay runs in the background and polls ARIA for commands.",
        "No other installs needed. Zero dependencies.",
        "Works on Windows, macOS, and Linux.",
        "",
        "Kill switch: the red ⬡ KILL CLAW button (bottom-right corner)",
        "always stops execution instantly.",
      ].join("\n"),
      "info",
    );

  _appendOutput(
    "SYSTEM",
    "ARIA Claw online.\nConnect a relay on your machine to enable full control.\nClick '? Setup' for instructions.",
    "info",
  );
}

/* ── Status polling — shows relay connection in real time ─────── */
function _startStatusPoll() {
  async function poll() {
    try {
      const r = await fetch("/api/claw/status");
      const d = await r.json();

      const ind = document.getElementById("clawRelayIndicator");
      const name = document.getElementById("clawRelayName");
      const plat = document.getElementById("clawRelayPlatform");
      const resumeBtn = document.getElementById("clawResumeBtn");
      const killBtn = document.getElementById("clawKillSwitch");

      if (d.killed) {
        if (resumeBtn) resumeBtn.style.display = "";
        if (killBtn) killBtn.classList.add("killed");
      } else {
        if (resumeBtn) resumeBtn.style.display = "none";
        if (killBtn) killBtn.classList.remove("killed");
      }

      if (d.relays?.length) {
        const relay = d.relays[0];
        if (ind) {
          ind.textContent = "● RELAY LIVE";
          ind.className = "clawRelayOn";
        }
        if (name) name.textContent = relay.hostname || relay.id;
        if (plat) plat.textContent = relay.platform || "";
      } else {
        if (ind) {
          ind.textContent = "⬡ NO RELAY";
          ind.className = "clawRelayOff";
        }
        if (name) name.textContent = "No relay connected";
        if (plat) plat.textContent = "";
      }
    } catch {}
  }
  poll();
  setInterval(poll, 4000);
}

/* ── Toggle panel ─────────────────────────────────────────────── */
function toggleClaw() {
  const panel = document.getElementById("clawPanel");
  panel?.classList.toggle("open");
  if (panel?.classList.contains("open"))
    document.getElementById("clawInput")?.focus();
}

/* ── Send command to server ───────────────────────────────────── */
async function runCommand(input, mode = "ai") {
  const statusDot = document.getElementById("clawStatus");
  _appendOutput("YOU", input, "user");
  if (statusDot) {
    statusDot.textContent = "● RUNNING";
    statusDot.style.color = "var(--red-neon)";
  }

  try {
    const res = await fetch("/api/claw", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input, mode }),
    });
    const data = await res.json();
    if (data.error) {
      _appendOutput("ERROR", data.error, "error");
    } else {
      if (data.output) _appendOutput("ARIA", data.output, "output");
      if (data.queued?.length) {
        _appendOutput("QUEUED", data.queued.join("\n"), "dim");
      }
      if (!data.relayConnected && mode !== "ai") {
        _appendOutput(
          "WARN",
          "No relay connected — command queued but won't execute until relay starts.",
          "error",
        );
      }
    }
  } catch (e) {
    _appendOutput("ERROR", `Network error: ${e.message}`, "error");
  } finally {
    if (statusDot) {
      statusDot.textContent = "● READY";
      statusDot.style.color = "";
    }
    const out = document.getElementById("clawOutput");
    if (out) out.scrollTop = out.scrollHeight;
  }
}

/* ── Output helper ─────────────────────────────────────────────── */
function _appendOutput(label, text, type = "output") {
  const out = document.getElementById("clawOutput");
  if (!out) return;
  const e = document.createElement("div");
  e.className = `clawEntry clawEntry-${type}`;
  e.innerHTML = `<span class="clawEntryLabel">${label}</span><pre class="clawEntryText">${_esc(text)}</pre>`;
  out.appendChild(e);
  out.scrollTop = out.scrollHeight;
}
function _esc(t) {
  return String(t)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
