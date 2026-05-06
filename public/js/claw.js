// claw.js — ARIA Claw Control Panel
// Tabs: CONTROL | SCREEN | CONFIG
// No chat terminal — pure control surface

export function initClaw() {
  _buildKillSwitch();
  _buildPanel();
  _buildConfirmDialog();
  _startStatusPoll();

  window.ARIA_toggleClaw = toggleClaw;
  window.ARIA_killClaw = killClaw;
  window.ARIA_resumeClaw = resumeClaw;
  window.ARIA_clawConfirm = showConfirmDialog;
  window.ARIA_handleClawConfirm = showConfirmDialog;

  document
    .getElementById("sidebarClawBtn")
    ?.addEventListener("click", toggleClaw);

  console.log("[ARIA] Claw ready.");
}

/* ═══════════════════════════════════════════════════════════
   KILL SWITCH
═══════════════════════════════════════════════════════════ */
function _buildKillSwitch() {
  const btn = document.createElement("button");
  btn.id = "clawKillSwitch";
  btn.innerHTML = "⬡<br>KILL";
  btn.title = "Emergency stop — halt ALL Claw actions immediately";
  btn.addEventListener("click", () => {
    btn.classList.contains("killed") ? resumeClaw() : killClaw();
  });
  document.body.appendChild(btn);
}

async function killClaw() {
  document.getElementById("clawKillSwitch")?.classList.add("killed");
  const ks = document.getElementById("clawKillSwitch");
  if (ks) ks.innerHTML = "⬡<br>RESUME";
  _setStatus("● KILLED", "#ff4444");
  _log("⬡ KILL", "All actions halted.", "error");
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

/* ═══════════════════════════════════════════════════════════
   MAIN PANEL
═══════════════════════════════════════════════════════════ */
let _clawEnabled = true;
let _activeMode = "ai";
let _activeTab = "control";
let _screenWatch = false;
let _screenTimer = null;
let _screenInterval = 4000;

function _buildPanel() {
  const panel = document.createElement("div");
  panel.id = "clawPanel";
  panel.innerHTML = `
    <!-- ── Header ── -->
    <div id="clawHeader">
      <div id="clawHeaderLeft">
        <span id="clawRelayDot" class="clawDotOff" title="Relay status">⬡</span>
        <span id="clawTitle">🦾 CLAW</span>
      </div>
      <div id="clawHeaderRight">
        <span id="clawStatus">● READY</span>
        <button class="clawHdrBtn clawOnOff" id="clawToggleBtn" title="Enable / disable Claw">ON</button>
        <button class="clawHdrBtn" onclick="document.getElementById('clawPanel').classList.remove('open')">✕</button>
      </div>
    </div>

    <!-- ── Relay bar ── -->
    <div id="clawRelayBar">
      <span id="clawRelayName">No relay — <span class="clawSetupLinkInline">setup guide</span></span>
      <span id="clawRelayPlatform"></span>
    </div>

    <!-- ── Tab bar ── -->
    <div id="clawTabBar">
      <button class="clawTab active" data-tab="control">⚡ CONTROL</button>
      <button class="clawTab"        data-tab="screen" >📷 SCREEN</button>
      <button class="clawTab"        data-tab="config" >⚙ CONFIG</button>
    </div>

    <!-- ═══ TAB: CONTROL ═══ -->
    <div class="clawTabContent" id="clawTab-control">
      <!-- Mode pills -->
      <div id="clawModeRow">
        <span class="clawModeLabel">MODE</span>
        <button class="clawModeBtn active" data-mode="ai"     title="AI plans steps automatically">🤖 AI</button>
        <button class="clawModeBtn"        data-mode="shell"  title="Direct shell command">💻 Shell</button>
        <button class="clawModeBtn"        data-mode="type"   title="Type text into active window">⌨ Type</button>
        <button class="clawModeBtn"        data-mode="hotkey" title="Keyboard shortcut e.g. ctrl+t">⌘ Key</button>
        <button class="clawModeBtn"        data-mode="mouse"  title="Mouse: move X Y | click X Y | scroll up 3">🖱 Mouse</button>
      </div>

      <!-- Quick actions -->
      <div id="clawQuickRow">
        <span class="clawModeLabel">QUICK</span>
        <button class="clawQuickBtn" data-action="screenshot"        title="Take screenshot">📸</button>
        <button class="clawQuickBtn" data-action="open: File Explorer" title="File Explorer">📁</button>
        <button class="clawQuickBtn" data-action="hotkey: alt+tab"   title="Alt+Tab">⇥</button>
        <button class="clawQuickBtn" data-action="hotkey: ctrl+z"    title="Undo">↩</button>
        <button class="clawQuickBtn" data-action="hotkey: win+d"     title="Show desktop">🖥</button>
        <button class="clawQuickBtn" data-action="shell: clip"       title="Clipboard">📋</button>
        <button class="clawQuickBtn clawQuickDanger" id="clawQuickKill" title="Kill switch">⬡</button>
      </div>

      <!-- Output log -->
      <div id="clawOutput"></div>

      <!-- Input row -->
      <div id="clawInputRow">
        <span class="clawPrompt">▶</span>
        <input id="clawInput" type="text"
          placeholder="describe what ARIA should do on your PC..."
          autocomplete="off" spellcheck="false"/>
        <button id="clawRunBtn">⚡</button>
        <button id="clawClearBtn" title="Clear log">🗑</button>
      </div>
    </div>

    <!-- ═══ TAB: SCREEN ═══ -->
    <div class="clawTabContent" id="clawTab-screen" style="display:none">
      <div id="clawScreenControls">
        <button id="clawScreenSnapBtn" class="clawHdrBtn">📸 Snapshot</button>
        <button id="clawScreenWatchBtn" class="clawHdrBtn">▶ Start Watch</button>
        <span id="clawScreenStatus" class="clawScreenStatusText">Idle</span>
      </div>
      <div id="clawScreenIntervalRow">
        <span class="clawCfgLabel">Refresh every</span>
        <input type="range" id="clawScreenIntervalSlider" min="1" max="15" value="4" step="1"/>
        <span id="clawScreenIntervalVal">4s</span>
      </div>
      <div id="clawPovFrame">
        <div id="clawPovEmpty">No screenshot yet<br><span>Click Snapshot or Start Watch</span></div>
        <img id="clawPovImg" style="display:none" alt="ARIA POV"/>
        <div id="clawPovTimestamp"></div>
      </div>
    </div>

    <!-- ═══ TAB: CONFIG ═══ -->
    <div class="clawTabContent" id="clawTab-config" style="display:none">
      <div class="clawCfgSection">
        <div class="clawCfgTitle">SPEED &amp; CONTROL</div>
        <label class="clawCfgRow">
          <span class="clawCfgLabel">Typing speed (delay per char)</span>
          <input type="range" id="cfgTypeDelay" min="0" max="200" value="25" step="5"/>
          <span id="cfgTypeDelayVal" class="clawCfgVal">25ms</span>
        </label>
        <label class="clawCfgRow">
          <span class="clawCfgLabel">Mouse speed</span>
          <input type="range" id="cfgMouseSpeed" min="1" max="10" value="1" step="1"/>
          <span id="cfgMouseSpeedVal" class="clawCfgVal">1×</span>
        </label>
        <label class="clawCfgRow">
          <span class="clawCfgLabel">Screenshot monitor</span>
          <select id="cfgMonitorIdx" style="flex:1;background:#0a0000;border:1px solid #1e0000;color:#cc4444;font-family:'Share Tech Mono',monospace;font-size:10px;padding:3px">
            <option value="-1">All monitors combined</option>
            <option value="0">Primary (0)</option>
            <option value="1">Secondary (1)</option>
            <option value="2">Third (2)</option>
          </select>
        </label>
      </div>

      <div class="clawCfgSection">
        <div class="clawCfgTitle">EXECUTION</div>
        <label class="clawCfgRow">
          <span class="clawCfgLabel">Enabled</span>
          <div class="clawToggleWrap">
            <input type="checkbox" id="cfgEnabled" checked/>
            <span class="clawToggleSlider"></span>
          </div>
        </label>
        <label class="clawCfgRow">
          <span class="clawCfgLabel">Visualizer (log each step)</span>
          <div class="clawToggleWrap">
            <input type="checkbox" id="cfgVisualizer"/>
            <span class="clawToggleSlider"></span>
          </div>
        </label>
        <label class="clawCfgRow">
          <span class="clawCfgLabel">Confirm before shell cmds</span>
          <div class="clawToggleWrap">
            <input type="checkbox" id="cfgConfirmShell" checked/>
            <span class="clawToggleSlider"></span>
          </div>
        </label>
      </div>

      <div class="clawCfgSection">
        <div class="clawCfgTitle">PERFORMANCE</div>
        <label class="clawCfgRow">
          <span class="clawCfgLabel">AI confidence threshold</span>
          <input type="range" id="cfgConfidence" min="0" max="100" value="70" step="5"/>
          <span id="cfgConfidenceVal" class="clawCfgVal">70%</span>
        </label>
        <label class="clawCfgRow">
          <span class="clawCfgLabel">Max steps per task</span>
          <input type="range" id="cfgMaxSteps" min="1" max="20" value="8" step="1"/>
          <span id="cfgMaxStepsVal" class="clawCfgVal">8</span>
        </label>
      </div>

      <div class="clawCfgSection">
        <div class="clawCfgTitle">RELAY</div>
        <div id="clawSetupGuideBlock" class="clawCfgGuide">
          <div class="clawCfgTitle" style="margin-bottom:8px">CONNECT YOUR PC</div>
          <code>node claw-relay.js https://aria-69jr.onrender.com</code>
          <p>No npm install. Node.js only. Works on Win / Mac / Linux.</p>
          <p>Kill switch ⬡ always visible bottom-right.</p>
        </div>
      </div>
    </div>`;

  document.body.appendChild(panel);

  // ── Tab switching ──
  panel.querySelectorAll(".clawTab").forEach((btn) => {
    btn.addEventListener("click", () => {
      _activeTab = btn.dataset.tab;
      panel
        .querySelectorAll(".clawTab")
        .forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      panel
        .querySelectorAll(".clawTabContent")
        .forEach((c) => (c.style.display = "none"));
      document.getElementById(`clawTab-${_activeTab}`).style.display = "flex";
    });
  });

  // ── Mode buttons ──
  const HINTS = {
    ai: "describe what ARIA should do on your PC...",
    shell: "dir  /  Get-Process  /  echo hello",
    type: "Hello World!  (types into active window)",
    hotkey: "ctrl+t  /  alt+tab  /  ctrl+shift+n  /  win+d",
    mouse: "move 500 300  |  click 500 300  |  scroll down 3",
  };
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

  // ── Quick actions ──
  panel.querySelectorAll(".clawQuickBtn[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => _runCommand(btn.dataset.action, "ai"));
  });
  document.getElementById("clawQuickKill").addEventListener("click", killClaw);

  // ── Enable/disable toggle ──
  document.getElementById("clawToggleBtn").addEventListener("click", () => {
    _clawEnabled = !_clawEnabled;
    const btn = document.getElementById("clawToggleBtn");
    btn.textContent = _clawEnabled ? "ON" : "OFF";
    btn.classList.toggle("clawBtnOff", !_clawEnabled);
    _log("SYSTEM", _clawEnabled ? "Claw enabled." : "Claw disabled.", "info");
    if (!_clawEnabled)
      fetch("/api/claw/kill", { method: "POST" }).catch(() => {});
    else fetch("/api/claw/resume", { method: "POST" }).catch(() => {});
    // Keep config checkbox in sync
    const cb = document.getElementById("cfgEnabled");
    if (cb) cb.checked = _clawEnabled;
  });

  // ── Speed & monitor config — push to server live ──
  function _pushRelayConfig(patch) {
    fetch("/api/claw/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).catch(() => {});
  }

  const cfgTypeDelay = document.getElementById("cfgTypeDelay");
  const cfgTypeDelayVal = document.getElementById("cfgTypeDelayVal");
  cfgTypeDelay?.addEventListener("input", () => {
    const v = Number(cfgTypeDelay.value);
    if (cfgTypeDelayVal)
      cfgTypeDelayVal.textContent = v === 0 ? "instant" : `${v}ms`;
    _pushRelayConfig({ typeDelay: v });
  });

  const cfgMouseSpeed = document.getElementById("cfgMouseSpeed");
  const cfgMouseSpeedVal = document.getElementById("cfgMouseSpeedVal");
  cfgMouseSpeed?.addEventListener("input", () => {
    const v = Number(cfgMouseSpeed.value);
    if (cfgMouseSpeedVal) cfgMouseSpeedVal.textContent = `${v}×`;
    _pushRelayConfig({ mouseSpeed: v });
  });

  document.getElementById("cfgMonitorIdx")?.addEventListener("change", (e) => {
    _pushRelayConfig({ monitorIdx: Number(e.target.value) });
  });

  // ── Config toggles ──
  document.getElementById("cfgEnabled")?.addEventListener("change", (e) => {
    _clawEnabled = e.target.checked;
    const btn = document.getElementById("clawToggleBtn");
    if (btn) {
      btn.textContent = _clawEnabled ? "ON" : "OFF";
      btn.classList.toggle("clawBtnOff", !_clawEnabled);
    }
    if (!_clawEnabled)
      fetch("/api/claw/kill", { method: "POST" }).catch(() => {});
    else fetch("/api/claw/resume", { method: "POST" }).catch(() => {});
  });

  const vizCb = document.getElementById("cfgVisualizer");
  let _visualizerMode = false;
  vizCb?.addEventListener("change", (e) => {
    _visualizerMode = e.target.checked;
  });
  // expose so _runFromInput can read it
  panel._getViz = () => _visualizerMode;

  // ── Config sliders ──
  const sliders = [
    ["cfgConfidence", "cfgConfidenceVal", (v) => `${v}%`],
    ["cfgMaxSteps", "cfgMaxStepsVal", (v) => v],
  ];
  sliders.forEach(([id, valId, fmt]) => {
    const el = document.getElementById(id);
    const vl = document.getElementById(valId);
    el?.addEventListener("input", () => {
      if (vl) vl.textContent = fmt(el.value);
    });
  });

  // ── Run / input ──
  document
    .getElementById("clawRunBtn")
    .addEventListener("click", _runFromInput);
  document.getElementById("clawInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") _runFromInput();
  });
  document.getElementById("clawClearBtn").addEventListener("click", () => {
    document.getElementById("clawOutput").innerHTML = "";
  });

  // ── Setup guide delegation ──
  document.getElementById("clawRelayBar").addEventListener("click", (e) => {
    if (e.target.classList.contains("clawSetupLinkInline")) {
      _switchTab("config");
    }
  });

  // ── Screen tab ──
  document
    .getElementById("clawScreenSnapBtn")
    .addEventListener("click", _takeSnapshot);
  document
    .getElementById("clawScreenWatchBtn")
    .addEventListener("click", _toggleScreenWatch);
  document
    .getElementById("clawScreenIntervalSlider")
    .addEventListener("input", (e) => {
      _screenInterval = parseInt(e.target.value) * 1000;
      document.getElementById(
        "clawScreenIntervalVal",
      ).textContent = `${e.target.value}s`;
      // restart watch with new interval if active
      if (_screenWatch) {
        _stopScreenWatch();
        _startScreenWatch();
      }
    });

  _log("SYSTEM", "ARIA Claw ready. Connect relay → full PC control.", "info");
}

/* ═══════════════════════════════════════════════════════════
   SCREEN / POV TAB
═══════════════════════════════════════════════════════════ */
async function _takeSnapshot() {
  _setScreenStatus("Requesting snapshot...");
  try {
    await fetch("/api/claw", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: "take a screenshot", mode: "ai" }),
    });
    // Poll for result
    let attempts = 0;
    const poll = setInterval(async () => {
      attempts++;
      const d = await fetch("/api/claw/screenshot")
        .then((r) => r.json())
        .catch(() => ({}));
      if (d.ok && d.b64) {
        clearInterval(poll);
        _showScreenshot(d.b64, d.ts);
        _setScreenStatus("Snapshot taken");
      } else if (attempts > 10) {
        clearInterval(poll);
        _setScreenStatus("No response from relay");
      }
    }, 800);
  } catch (e) {
    _setScreenStatus("Error: " + e.message);
  }
}

function _startScreenWatch() {
  _screenWatch = true;
  const btn = document.getElementById("clawScreenWatchBtn");
  if (btn) {
    btn.textContent = "⏹ Stop Watch";
    btn.classList.add("active");
  }
  _setScreenStatus("Watching...");
  _takeSnapshot();
  _screenTimer = setInterval(() => {
    fetch("/api/claw/screenshot")
      .then((r) => r.json())
      .then((d) => {
        if (d.ok && d.b64) _showScreenshot(d.b64, d.ts);
      })
      .catch(() => {});
    // Also request a fresh one from relay
    fetch("/api/claw", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: "take a screenshot", mode: "ai" }),
    }).catch(() => {});
  }, _screenInterval);
}

function _stopScreenWatch() {
  _screenWatch = false;
  clearInterval(_screenTimer);
  _screenTimer = null;
  const btn = document.getElementById("clawScreenWatchBtn");
  if (btn) {
    btn.textContent = "▶ Start Watch";
    btn.classList.remove("active");
  }
  _setScreenStatus("Idle");
}

function _toggleScreenWatch() {
  _screenWatch ? _stopScreenWatch() : _startScreenWatch();
}

function _showScreenshot(b64, ts) {
  const img = document.getElementById("clawPovImg");
  const empty = document.getElementById("clawPovEmpty");
  const stamp = document.getElementById("clawPovTimestamp");
  if (img) {
    img.src = "data:image/png;base64," + b64;
    img.style.display = "block";
  }
  if (empty) empty.style.display = "none";
  if (stamp && ts) {
    const d = new Date(ts);
    stamp.textContent = d.toLocaleTimeString();
  }
}

function _setScreenStatus(msg) {
  const el = document.getElementById("clawScreenStatus");
  if (el) el.textContent = msg;
}

/* ═══════════════════════════════════════════════════════════
   CONFIRM DIALOG
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
  document.getElementById("clawConfirmAllow").addEventListener("click", () => {
    const action = document.getElementById("clawConfirmAction").dataset.action;
    dlg.style.display = "none";
    _log("CONFIRM", "Action APPROVED.", "output");
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
  document.getElementById("clawPanel")?.classList.add("open");
  _log("⚠ CONFIRM", "Action: " + action, "error");
  return new Promise((r) => {
    _confirmResolve = r;
  });
}

/* ═══════════════════════════════════════════════════════════
   STATUS POLL
═══════════════════════════════════════════════════════════ */
function _startStatusPoll() {
  async function poll() {
    try {
      const d = await fetch("/api/claw/status").then((r) => r.json());
      const dot = document.getElementById("clawRelayDot");
      const nameEl = document.getElementById("clawRelayName");
      const platEl = document.getElementById("clawRelayPlatform");
      const killBtn = document.getElementById("clawKillSwitch");

      if (d.killed) {
        killBtn?.classList.add("killed");
        if (killBtn) killBtn.innerHTML = "⬡<br>RESUME";
      } else {
        killBtn?.classList.remove("killed");
        if (killBtn) killBtn.innerHTML = "⬡<br>KILL";
      }

      if (d.relays?.length) {
        const relay = d.relays[0];
        if (dot) {
          dot.textContent = "●";
          dot.className = "clawDotOn";
          dot.title = "Relay connected";
        }
        if (nameEl)
          nameEl.innerHTML = `<strong>${relay.hostname || relay.id}</strong>`;
        if (platEl) platEl.textContent = relay.platform || "";
      } else {
        if (dot) {
          dot.textContent = "⬡";
          dot.className = "clawDotOff";
          dot.title = "No relay";
        }
        if (nameEl)
          nameEl.innerHTML =
            'No relay — <span class="clawSetupLinkInline" style="text-decoration:underline;cursor:pointer">setup guide</span>';
        if (platEl) platEl.textContent = "";
      }
    } catch {}
  }
  poll();
  setInterval(poll, 4000);
}

/* ═══════════════════════════════════════════════════════════
   COMMAND EXECUTION
═══════════════════════════════════════════════════════════ */
async function _runFromInput() {
  const v = document.getElementById("clawInput")?.value.trim();
  if (!v) return;
  document.getElementById("clawInput").value = "";
  _runCommand(v, _activeMode);
}

async function _runCommand(input, mode) {
  if (!_clawEnabled) {
    _log("BLOCKED", "Claw is OFF. Toggle ON to execute.", "error");
    return;
  }
  _log("YOU", input, "user");
  _setStatus("● RUNNING", "var(--red-neon, #ff2222)");
  const panel = document.getElementById("clawPanel");
  const vizMode = panel?._getViz?.() || false;

  try {
    const res = await fetch("/api/claw", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input, mode }),
    });
    const data = await res.json();
    if (data.error) {
      _log("ERROR", data.error, "error");
    } else {
      if (data.output) _log("ARIA", data.output, "output");
      if (vizMode && data.queued?.length) {
        data.queued.forEach((q) => _log("EXEC", q, "viz"));
      }
      if (!data.relayConnected && mode !== "ai") {
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

function _switchTab(name) {
  _activeTab = name;
  document.querySelectorAll(".clawTab").forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === name);
  });
  document.querySelectorAll(".clawTabContent").forEach((c) => {
    c.style.display = c.id === `clawTab-${name}` ? "flex" : "none";
  });
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
    `<span class="clawEntryLabel">${label}</span>` +
    `<pre class="clawEntryText">${_esc(text)}</pre>`;
  out.appendChild(e);
  out.scrollTop = out.scrollHeight;
}

function _esc(t) {
  return String(t)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
