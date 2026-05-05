// claw.js — ARIA Claw UI
// Features: kill switch, manual on/off, visualizer mode, confirm dialog, relay status

export function initClaw() {
  _buildKillSwitch();
  _buildPanel();
  _buildConfirmDialog();
  _startStatusPoll();
  window.ARIA_toggleClaw = toggleClaw;
  window.ARIA_killClaw = killClaw;
  window.ARIA_resumeClaw = resumeClaw;
  // Called by chat.js when server returns clawConfirm
  window.ARIA_clawConfirm = showConfirmDialog;

  // Wire sidebar button
  document
    .getElementById("sidebarClawBtn")
    ?.addEventListener("click", toggleClaw);

  console.log("[ARIA] Claw ready. Ctrl+Shift+A to open.");
}

/* ═══════════════════════════════════════════════════════════
   KILL SWITCH — always visible bottom-right, every tab/view
═══════════════════════════════════════════════════════════ */
function _buildKillSwitch() {
  const btn = document.createElement("button");
  btn.id = "clawKillSwitch";
  btn.innerHTML = "⬡<br>KILL";
  btn.title = "Emergency stop — halt ALL Claw actions immediately";
  btn.addEventListener("click", () => {
    const isKilled = btn.classList.contains("killed");
    isKilled ? resumeClaw() : killClaw();
  });
  document.body.appendChild(btn);
}

async function killClaw() {
  document.getElementById("clawKillSwitch")?.classList.add("killed");
  document.getElementById("clawKillSwitch") &&
    (document.getElementById("clawKillSwitch").innerHTML = "⬡<br>RESUME");
  _setStatus("● KILLED", "#ff4444");
  _log("⬡ KILL SWITCH", "All actions halted. Queue cleared.", "error");
  await fetch("/api/claw/kill", { method: "POST" }).catch(() => {});
}

async function resumeClaw() {
  document.getElementById("clawKillSwitch")?.classList.remove("killed");
  document.getElementById("clawKillSwitch") &&
    (document.getElementById("clawKillSwitch").innerHTML = "⬡<br>KILL");
  _setStatus("● READY", "");
  _log("SYSTEM", "Claw resumed.", "info");
  await fetch("/api/claw/resume", { method: "POST" }).catch(() => {});
}

/* ═══════════════════════════════════════════════════════════
   MAIN PANEL
═══════════════════════════════════════════════════════════ */
let _clawEnabled = true; // manual on/off
let _visualizerMode = false;
let _activeMode = "ai";

function _buildPanel() {
  const panel = document.createElement("div");
  panel.id = "clawPanel";
  panel.innerHTML = `
    <div id="clawHeader">
      <span id="clawTitle">🦾 ARIA CLAW</span>
      <div id="clawHeaderRight">
        <span id="clawRelayDot" class="clawDotOff" title="Relay status">⬡</span>
        <span id="clawStatus">● READY</span>
        <button class="clawHdrBtn" id="clawToggleBtn" title="Enable/disable Claw execution">ON</button>
        <button class="clawHdrBtn" id="clawVizBtn"    title="Visualizer mode — see each step">VIZ</button>
        <button class="clawHdrBtn" id="clawScreenBtn" title="Continuous screen watch — ARIA watches your screen">📷 WATCH</button>
        <button class="clawHdrBtn" onclick="document.getElementById('clawPanel').classList.remove('open')">✕</button>
      </div>
    </div>

    <div id="clawRelayBar">
      <span id="clawRelayName">No relay — <span id="clawSetupLink" style="text-decoration:underline;cursor:pointer">setup guide</span></span>
      <span id="clawRelayPlatform"></span>
    </div>

    <div id="clawTerminal">
      <div id="clawOutput"></div>
      <div id="clawInputRow">
        <span class="clawPrompt">ARIA&gt;</span>
        <input id="clawInput" type="text"
          placeholder="describe what ARIA should do on your PC..."
          autocomplete="off" spellcheck="false"/>
        <button id="clawRunBtn">⚡</button>
      </div>
    </div>

    <div id="clawModeRow">
      <span class="clawModeLabel">MODE:</span>
      <button class="clawModeBtn active" data-mode="ai"     title="AI plans steps automatically">🤖 AI</button>
      <button class="clawModeBtn"        data-mode="shell"  title="Direct shell command">💻 Shell</button>
      <button class="clawModeBtn"        data-mode="type"   title="Type text into active window">⌨ Type</button>
      <button class="clawModeBtn"        data-mode="hotkey" title="Press a keyboard shortcut (e.g. ctrl+t)">⌘ Key</button>
      <button class="clawModeBtn"        data-mode="mouse"  title="move X Y | click X Y | scroll up/down N">🖱 Mouse</button>
      <button id="clawClearBtn" title="Clear output">🗑</button>
    </div>`;
  document.body.appendChild(panel);

  const HINTS = {
    ai: "describe what ARIA should do on your PC...",
    shell: "ls -la  /  dir  /  Get-Process  /  echo hello",
    type: "Hello World!  (types into active window)",
    hotkey: "ctrl+t  /  alt+tab  /  ctrl+shift+n  /  win+d",
    mouse: "move 500 300  |  click 500 300  |  scroll down 3",
  };

  // Mode buttons
  panel.querySelectorAll(".clawModeBtn").forEach((btn) => {
    btn.addEventListener("click", () => {
      panel
        .querySelectorAll(".clawModeBtn")
        .forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      _activeMode = btn.dataset.mode;
      document.getElementById("clawInput").placeholder =
        HINTS[_activeMode] || "";
    });
  });

  // Run
  document
    .getElementById("clawRunBtn")
    .addEventListener("click", _runFromInput);
  document.getElementById("clawInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") _runFromInput();
  });

  // Clear
  document.getElementById("clawClearBtn").addEventListener("click", () => {
    document.getElementById("clawOutput").innerHTML = "";
  });

  // Manual ON/OFF toggle
  document.getElementById("clawToggleBtn").addEventListener("click", () => {
    _clawEnabled = !_clawEnabled;
    const btn = document.getElementById("clawToggleBtn");
    btn.textContent = _clawEnabled ? "ON" : "OFF";
    btn.classList.toggle("clawBtnOff", !_clawEnabled);
    _log(
      "SYSTEM",
      _clawEnabled
        ? "Claw enabled."
        : "Claw disabled — commands will not execute.",
      "info",
    );
    if (!_clawEnabled)
      fetch("/api/claw/kill", { method: "POST" }).catch(() => {});
    else fetch("/api/claw/resume", { method: "POST" }).catch(() => {});
  });

  // Continuous screen watch
  let _screenWatchInterval = null;
  document.getElementById("clawScreenBtn")?.addEventListener("click", () => {
    const btn = document.getElementById("clawScreenBtn");
    if (_screenWatchInterval) {
      clearInterval(_screenWatchInterval);
      _screenWatchInterval = null;
      btn.classList.remove("active");
      btn.textContent = "📷 WATCH";
      _log("SCREEN", "Screen watch stopped.", "info");
    } else {
      btn.classList.add("active");
      btn.textContent = "📷 ON";
      _log(
        "SCREEN",
        "Continuous screen watch active — ARIA sees your screen every 4s.",
        "info",
      );
      const doShot = () => {
        fetch("/api/claw", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ input: "take a screenshot", mode: "ai" }),
        }).catch(() => {});
      };
      doShot();
      _screenWatchInterval = setInterval(doShot, 4000);
    }
  });

  // Visualizer mode
  document.getElementById("clawVizBtn").addEventListener("click", () => {
    _visualizerMode = !_visualizerMode;
    document
      .getElementById("clawVizBtn")
      .classList.toggle("active", _visualizerMode);
    _log(
      "SYSTEM",
      _visualizerMode
        ? "Visualizer ON — you will see every command as it is executed."
        : "Visualizer OFF.",
      "info",
    );
  });

  // Setup guide
  document
    .getElementById("clawSetupLink")
    .addEventListener("click", () =>
      _log(
        "SETUP",
        [
          "HOW TO CONNECT YOUR PC TO ARIA CLAW",
          "",
          "1. Copy  claw-relay.js  to any folder on your PC",
          "2. Open a terminal and run:",
          "   node claw-relay.js https://your-aria-url.onrender.com",
          "",
          "Requirements: Node.js (already installed if you dev locally)",
          "No npm install, no pip, zero extra dependencies.",
          "Works on Windows, macOS, and Linux.",
          "",
          "While the relay runs, ARIA has full control of your PC.",
          "Use the ⬡ KILL button bottom-right to stop instantly.",
          "The ON/OFF toggle in this panel also pauses execution.",
        ].join("\n"),
        "info",
      ),
    );

  _log(
    "SYSTEM",
    "ARIA Claw initialized.\nConnect relay → full PC control.\nClick 'setup guide' for instructions.",
    "info",
  );
}

/* ═══════════════════════════════════════════════════════════
   CONFIRM DIALOG — for SENSITIVE actions
═══════════════════════════════════════════════════════════ */
let _confirmResolve = null;

function _buildConfirmDialog() {
  const dlg = document.createElement("div");
  dlg.id = "clawConfirmOverlay";
  dlg.innerHTML = `
    <div id="clawConfirmBox">
      <div id="clawConfirmTitle">⚠ CLAW PERMISSION REQUEST</div>
      <div id="clawConfirmBody"></div>
      <div id="clawConfirmAction"></div>
      <div id="clawConfirmBtns">
        <button id="clawConfirmDeny"  class="clawConfirmBtn deny">✕ DENY</button>
        <button id="clawConfirmAllow" class="clawConfirmBtn allow">✓ ALLOW</button>
      </div>
    </div>`;
  document.body.appendChild(dlg);

  document.getElementById("clawConfirmDeny").addEventListener("click", () => {
    dlg.style.display = "none";
    _log("CONFIRM", "Action DENIED by user.", "error");
    fetch("/api/claw/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "", approved: false }),
    });
    if (_confirmResolve) {
      _confirmResolve(false);
      _confirmResolve = null;
    }
  });
  document.getElementById("clawConfirmAllow").addEventListener("click", () => {
    const action = document.getElementById("clawConfirmAction").dataset.action;
    dlg.style.display = "none";
    _log("CONFIRM", "Action APPROVED — executing.", "output");
    fetch("/api/claw/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, approved: true }),
    });
    if (_confirmResolve) {
      _confirmResolve(true);
      _confirmResolve = null;
    }
  });
}

function showConfirmDialog({ action, description }) {
  const dlg = document.getElementById("clawConfirmOverlay");
  document.getElementById("clawConfirmBody").textContent =
    description || "ARIA wants to run a sensitive action:";
  document.getElementById("clawConfirmAction").textContent = action;
  document.getElementById("clawConfirmAction").dataset.action = action;
  dlg.style.display = "flex";
  // Open claw panel so user can see context
  document.getElementById("clawPanel")?.classList.add("open");
  _log("⚠ CONFIRM NEEDED", "Action: " + action, "error");
  return new Promise((r) => {
    _confirmResolve = r;
  });
}

/* ═══════════════════════════════════════════════════════════
   STATUS POLL — relay connection + visualizer updates
═══════════════════════════════════════════════════════════ */
function _startStatusPoll() {
  async function poll() {
    try {
      const d = await fetch("/api/claw/status").then((r) => r.json());
      const dot = document.getElementById("clawRelayDot");
      const nameEl = document.getElementById("clawRelayName");
      const platEl = document.getElementById("clawRelayPlatform");
      const killBtn = document.getElementById("clawKillSwitch");

      // Kill switch state
      if (d.killed) {
        killBtn?.classList.add("killed");
        killBtn && (killBtn.innerHTML = "⬡<br>RESUME");
      } else {
        killBtn?.classList.remove("killed");
        killBtn && (killBtn.innerHTML = "⬡<br>KILL");
      }

      // Relay status
      if (d.relays?.length) {
        const relay = d.relays[0];
        if (dot) {
          dot.textContent = "●";
          dot.className = "clawDotOn";
          dot.title = "Relay connected";
        }
        const setupLink =
          '<span id="clawSetupLink" style="text-decoration:underline;cursor:pointer">setup guide</span>';
        if (nameEl) nameEl.innerHTML = relay.hostname || relay.id;
        if (platEl) platEl.textContent = relay.platform || "";
      } else {
        if (dot) {
          dot.textContent = "⬡";
          dot.className = "clawDotOff";
          dot.title = "No relay";
        }
        if (nameEl)
          nameEl.innerHTML =
            'No relay — <span id="clawSetupLink" style="text-decoration:underline;cursor:pointer" onclick="document.getElementById(\'clawSetupLink\').dispatchEvent(new Event(\'click\'))">setup guide</span>';
        if (platEl) platEl.textContent = "";
      }
    } catch {}
  }
  poll();
  setInterval(poll, 4000);
}

/* ═══════════════════════════════════════════════════════════
   COMMAND EXECUTION (from panel input)
═══════════════════════════════════════════════════════════ */
async function _runFromInput() {
  const v = document.getElementById("clawInput")?.value.trim();
  if (!v) return;
  document.getElementById("clawInput").value = "";
  if (!_clawEnabled) {
    _log("BLOCKED", "Claw is OFF. Toggle ON to execute.", "error");
    return;
  }
  _log("YOU", v, "user");
  _setStatus("● RUNNING", "var(--red-neon)");

  try {
    const res = await fetch("/api/claw", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: v, mode: _activeMode }),
    });
    const data = await res.json();
    if (data.error) {
      _log("ERROR", data.error, "error");
    } else {
      if (data.output) _log("ARIA", data.output, "output");
      if (_visualizerMode && data.queued?.length) {
        data.queued.forEach((q) => _log("EXEC", q, "viz"));
      }
      if (!data.relayConnected && _activeMode !== "ai") {
        _log(
          "WARN",
          "No relay connected. Start claw-relay.js on your machine.",
          "error",
        );
      }
    }
  } catch (e) {
    _log("ERROR", "Network: " + e.message, "error");
  } finally {
    _setStatus("● READY", "");
    document.getElementById("clawOutput")?.scrollTo(0, 999999);
  }
}

/* ═══════════════════════════════════════════════════════════
   PANEL TOGGLE
═══════════════════════════════════════════════════════════ */
function toggleClaw() {
  document.getElementById("clawPanel")?.classList.toggle("open");
  if (document.getElementById("clawPanel")?.classList.contains("open")) {
    document.getElementById("clawInput")?.focus();
  }
}

/* ═══════════════════════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════════════════════ */
function _setStatus(text, color) {
  const el = document.getElementById("clawStatus");
  if (el) {
    el.textContent = text;
    el.style.color = color || "";
  }
}

function _log(label, text, type = "output") {
  const out = document.getElementById("clawOutput");
  if (!out) return;
  const e = document.createElement("div");
  e.className = "clawEntry clawEntry-" + type;
  e.innerHTML =
    '<span class="clawEntryLabel">' +
    label +
    "</span>" +
    '<pre class="clawEntryText">' +
    _esc(text) +
    "</pre>";
  out.appendChild(e);
  out.scrollTop = out.scrollHeight;
}

function _esc(t) {
  return String(t)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Called from chat.js when ARIA's reply has clawConfirm
window.ARIA_handleClawConfirm = showConfirmDialog;
