/**
 * claw.js — ARIA Claw UI
 * Ctrl+Shift+A to open panel.
 * Kill switch always visible bottom-right.
 * ON/OFF toggle and Visualizer mode in header.
 * Confirm dialog for sensitive actions.
 */

export function initClaw() {
  _buildKillSwitch();
  _buildPanel();
  _buildConfirmDialog();
  _startStatusPoll();

  window.ARIA_toggleClaw = toggleClaw;
  window.ARIA_killClaw = killClaw;
  window.ARIA_resumeClaw = resumeClaw;
  window.ARIA_clawConfirm = showConfirmDialog;
  window.ARIA_clawRelayConnected = false; // updated by status poll

  console.log("[ARIA] Claw ready. Ctrl+Shift+A to open.");
}

/* ── Kill switch ─────────────────────────────────────────── */
function _buildKillSwitch() {
  const btn = document.createElement("button");
  btn.id = "clawKillSwitch";
  btn.innerHTML = "⬡<br>KILL";
  btn.title = "Emergency stop — halt all Claw actions immediately";
  btn.addEventListener("click", () =>
    btn.classList.contains("killed") ? resumeClaw() : killClaw(),
  );
  document.body.appendChild(btn);
}

async function killClaw() {
  document.getElementById("clawKillSwitch")?.classList.add("killed");
  const ks = document.getElementById("clawKillSwitch");
  if (ks) ks.innerHTML = "⬡<br>RESUME";
  _setStatus("● KILLED", "#ff4444");
  _log("⬡ KILL", "All Claw actions halted.", "error");
  await fetch("/api/claw/kill", { method: "POST" }).catch(() => {});
}

async function resumeClaw() {
  document.getElementById("clawKillSwitch")?.classList.remove("killed");
  const ks = document.getElementById("clawKillSwitch");
  if (ks) ks.innerHTML = "⬡<br>KILL";
  _setStatus("● READY", "");
  _log("SYSTEM", "Claw resumed.", "info");
  await fetch("/api/claw/resume", { method: "POST" }).catch(() => {});
}

/* ── Main panel ──────────────────────────────────────────── */
let _enabled = true;
let _vizMode = false;
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
        <button class="clawHdrBtn" id="clawToggleBtn">ON</button>
        <button class="clawHdrBtn" id="clawVizBtn">VIZ</button>
        <button class="clawHdrBtn" id="clawCloseBtn">✕</button>
      </div>
    </div>
    <div id="clawRelayBar">
      <span id="clawRelayName">No relay — <u id="clawSetupLink" style="cursor:pointer">setup guide</u></span>
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
      <button class="clawModeBtn active" data-mode="ai">🤖 AI</button>
      <button class="clawModeBtn" data-mode="shell">💻 Shell</button>
      <button class="clawModeBtn" data-mode="type">⌨ Type</button>
      <button class="clawModeBtn" data-mode="hotkey">⌘ Key</button>
      <button class="clawModeBtn" data-mode="mouse">🖱 Mouse</button>
      <button id="clawClearBtn">🗑</button>
    </div>`;
  document.body.appendChild(panel);

  const HINTS = {
    ai: "describe what ARIA should do on your PC...",
    shell: "ls -la  /  dir  /  Get-Process",
    type: "Hello World  (types into active window)",
    hotkey: "ctrl+t  /  alt+tab  /  win+d",
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

  document
    .getElementById("clawRunBtn")
    .addEventListener("click", _runFromInput);
  document.getElementById("clawInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") _runFromInput();
  });
  document.getElementById("clawClearBtn").addEventListener("click", () => {
    document.getElementById("clawOutput").innerHTML = "";
  });
  document.getElementById("clawCloseBtn").addEventListener("click", () => {
    panel.classList.remove("open");
  });

  // ON/OFF toggle
  document.getElementById("clawToggleBtn").addEventListener("click", () => {
    _enabled = !_enabled;
    const btn = document.getElementById("clawToggleBtn");
    btn.textContent = _enabled ? "ON" : "OFF";
    btn.classList.toggle("clawBtnOff", !_enabled);
    _log(
      "SYSTEM",
      _enabled ? "Claw enabled." : "Claw paused — commands will not execute.",
      "info",
    );
    fetch(_enabled ? "/api/claw/resume" : "/api/claw/kill", {
      method: "POST",
    }).catch(() => {});
  });

  // Visualizer
  document.getElementById("clawVizBtn").addEventListener("click", () => {
    _vizMode = !_vizMode;
    document.getElementById("clawVizBtn").classList.toggle("active", _vizMode);
    _log(
      "SYSTEM",
      _vizMode
        ? "Visualizer ON — showing each command step."
        : "Visualizer OFF.",
      "info",
    );
  });

  // Setup guide
  document.getElementById("clawSetupLink").addEventListener("click", () => {
    _log(
      "SETUP",
      [
        "HOW TO CONNECT YOUR PC TO ARIA CLAW",
        "",
        "1. Download  claw-relay.js  from your ARIA repo root",
        "2. Open a terminal and run:",
        "   node claw-relay.js https://your-aria-url.onrender.com",
        "",
        "Requirements: Node.js only. Zero npm installs.",
        "Works on Windows, macOS, Linux.",
        "",
        "While the relay runs, ARIA can:",
        "  • Open apps and browser tabs",
        "  • Press keyboard shortcuts",
        "  • Type text into any window",
        "  • Run shell commands",
        "  • Write code to VS Code / Arduino IDE",
        "  • Take screenshots",
        "  • Control mouse",
        "",
        "Kill switch: ⬡ KILL button (bottom-right) stops everything instantly.",
      ].join("\n"),
      "info",
    );
  });

  _log(
    "SYSTEM",
    "ARIA Claw initialized.\nConnect relay → full PC control.\nClick 'setup guide' above for instructions.",
    "info",
  );
}

/* ── Confirm dialog ──────────────────────────────────────── */
let _confirmResolve = null;

function _buildConfirmDialog() {
  const dlg = document.createElement("div");
  dlg.id = "clawConfirmOverlay";
  dlg.innerHTML = `
    <div id="clawConfirmBox">
      <div id="clawConfirmTitle">⚠ PERMISSION REQUIRED</div>
      <div id="clawConfirmBody">ARIA wants to run a sensitive action:</div>
      <div id="clawConfirmAction"></div>
      <div id="clawConfirmBtns">
        <button class="clawConfirmBtn deny"  id="clawDenyBtn">✕ DENY</button>
        <button class="clawConfirmBtn allow" id="clawAllowBtn">✓ ALLOW</button>
      </div>
    </div>`;
  document.body.appendChild(dlg);

  document.getElementById("clawDenyBtn").addEventListener("click", () => {
    dlg.style.display = "none";
    _log("CONFIRM", "Action DENIED.", "error");
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

  document.getElementById("clawAllowBtn").addEventListener("click", () => {
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

export function showConfirmDialog({ action, description }) {
  const dlg = document.getElementById("clawConfirmOverlay");
  document.getElementById("clawConfirmBody").textContent =
    description || "ARIA wants to run:";
  document.getElementById("clawConfirmAction").textContent = action;
  document.getElementById("clawConfirmAction").dataset.action = action;
  dlg.style.display = "flex";
  document.getElementById("clawPanel")?.classList.add("open");
  _log("⚠ NEEDS APPROVAL", action, "error");
  return new Promise((r) => {
    _confirmResolve = r;
  });
}

/* ── Status poll ─────────────────────────────────────────── */
function _startStatusPoll() {
  async function poll() {
    try {
      const d = await fetch("/api/claw/status").then((r) => r.json());

      // Update relay dot + name
      const dot = document.getElementById("clawRelayDot");
      const name = document.getElementById("clawRelayName");
      const plat = document.getElementById("clawRelayPlatform");
      const ks = document.getElementById("clawKillSwitch");

      window.ARIA_clawRelayConnected = d.relays?.length > 0;

      if (d.relays?.length) {
        const relay = d.relays[0];
        if (dot) {
          dot.textContent = "●";
          dot.className = "clawDotOn";
        }
        if (name) name.innerHTML = relay.hostname || relay.id;
        if (plat) plat.textContent = relay.platform || "";
      } else {
        if (dot) {
          dot.textContent = "⬡";
          dot.className = "clawDotOff";
        }
        if (name)
          name.innerHTML =
            'No relay — <u id="clawSetupLink" style="cursor:pointer">setup guide</u>';
        // Re-wire setup link if re-rendered
        document
          .getElementById("clawSetupLink")
          ?.addEventListener("click", () =>
            document
              .getElementById("clawSetupLink")
              ?.dispatchEvent(new Event("click")),
          );
        if (plat) plat.textContent = "";
      }

      // Sync kill state
      if (d.killed) {
        ks?.classList.add("killed");
        if (ks) ks.innerHTML = "⬡<br>RESUME";
      } else {
        ks?.classList.remove("killed");
        if (ks) ks.innerHTML = "⬡<br>KILL";
      }
    } catch {}
  }
  poll();
  setInterval(poll, 4000);
}

/* ── Toggle ──────────────────────────────────────────────── */
function toggleClaw() {
  const panel = document.getElementById("clawPanel");
  panel?.classList.toggle("open");
  if (panel?.classList.contains("open"))
    document.getElementById("clawInput")?.focus();
}

/* ── Run command from panel ──────────────────────────────── */
async function _runFromInput() {
  const v = document.getElementById("clawInput")?.value.trim();
  if (!v) return;
  document.getElementById("clawInput").value = "";
  if (!_enabled) {
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
      if (_vizMode && data.queued?.length) {
        data.queued.forEach((q) => _log("STEP", q, "viz"));
      }
      if (!data.relayConnected) {
        _log(
          "WARN",
          "No relay. Run: node claw-relay.js <your-aria-url>",
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

/* ── Helpers ─────────────────────────────────────────────── */
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
    String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;") +
    "</pre>";
  out.appendChild(e);
  out.scrollTop = out.scrollHeight;
}
