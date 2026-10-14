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

// The panel's ON/OFF switch. In the desktop app it is also the app's PC
// control switch, so OFF stops the relay and ON starts it again.
// { remote: false } only updates the buttons (the state came from elsewhere).
function _setClawEnabled(on, { remote = true } = {}) {
  _clawEnabled = !!on;
  const btn = document.getElementById("clawToggleBtn");
  if (btn) {
    btn.textContent = _clawEnabled ? "ON" : "OFF";
    btn.classList.toggle("clawBtnOff", !_clawEnabled);
  }
  const cb = document.getElementById("cfgEnabled");
  if (cb) cb.checked = _clawEnabled;
  if (!remote) return;
  // Not kill/resume in the desktop app: a kill outlives the relay, so turning
  // PC control back on from the tray would still find the Claw killed.
  if (window.ariaDesktop) window.ariaDesktop.setClaw(_clawEnabled).catch(() => {});
  else fetch(_clawEnabled ? "/api/claw/resume" : "/api/claw/kill", { method: "POST" }).catch(() => {});
}
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
        <div id="clawPovEmpty">No screenshot yet<br><span>Click Snapshot or Start Watch, then click, drag or scroll on the picture to control the PC</span></div>
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
          <select id="cfgMonitorIdx" style="flex:1;background:var(--bg-inset);border:1px solid var(--border);color:var(--text);font-family:var(--font-mono-stack);font-size:10px;padding:3px">
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
    _setClawEnabled(!_clawEnabled);
    _log("SYSTEM", _clawEnabled ? "Claw enabled." : "Claw disabled.", "info");
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
    _setClawEnabled(e.target.checked);
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

  _bindPovControls();

  _log("SYSTEM", "ARIA Claw ready. Connect relay → full PC control.", "info");
}

/* ═══════════════════════════════════════════════════════════
   SCREEN / POV TAB
═══════════════════════════════════════════════════════════ */
async function _takeSnapshot({ quiet = false } = {}) {
  if (!quiet) _setScreenStatus("Requesting snapshot...");
  // Compare against the last frame's server timestamp, not the browser clock.
  const since = _lastShotTs;
  try {
    const q = await fetch("/api/claw", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: "now", mode: "screenshot" }),
    }).then((r) => r.json());
    if (q.error) {
      _setScreenStatus(q.error);
      return;
    }
    // Poll for result
    let attempts = 0;
    const poll = setInterval(async () => {
      attempts++;
      const d = await fetch("/api/claw/screenshot")
        .then((r) => r.json())
        .catch(() => ({}));
      if (d.ok && d.b64 && d.ts > since) {
        clearInterval(poll);
        _showScreenshot(d.b64, d.ts, d.bounds);
        if (!quiet) _setScreenStatus("Snapshot taken");
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
        if (d.ok && d.b64) _showScreenshot(d.b64, d.ts, d.bounds);
      })
      .catch(() => {});
    // Also request a fresh one from relay
    fetch("/api/claw", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: "now", mode: "screenshot" }),
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

function _showScreenshot(b64, ts, bounds) {
  _povBounds = bounds || null;
  if (ts) _lastShotTs = ts;
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

/* ── POV remote control ──────────────────────────────────────
   The screenshot doubles as a trackpad for the PC: click, right-click,
   double-click, drag and scroll on the image and it happens on the screen.
   The relay reports where the capture sits on the desktop (bounds), so a
   point on the image maps back to real click coordinates. */
let _povBounds = null; // { x, y, w, h } of the captured area, or null
let _lastShotTs = 0; // server timestamp of the frame on screen

// Image point → desktop coordinates. object-fit: contain letterboxes the
// image, so work out where the picture actually sits inside the element.
function _povToScreen(img, clientX, clientY) {
  const r = img.getBoundingClientRect();
  const nw = img.naturalWidth, nh = img.naturalHeight;
  if (!nw || !nh || !r.width || !r.height) return null;
  const scale = Math.min(r.width / nw, r.height / nh);
  const dw = nw * scale, dh = nh * scale;
  const left = r.left + (r.width - dw) / 2, top = r.top + (r.height - dh) / 2;
  const ix = (clientX - left) / scale, iy = (clientY - top) / scale;
  if (ix < 0 || iy < 0 || ix > nw || iy > nh) return null;
  const b = _povBounds || { x: 0, y: 0, w: nw, h: nh };
  return {
    x: Math.round(b.x + (ix * b.w) / nw),
    y: Math.round(b.y + (iy * b.h) / nh),
  };
}

// Sends one mouse command straight to the relay (no model in the loop).
async function _povSend(input) {
  if (!_clawEnabled) {
    _log("BLOCKED", "Claw is OFF. Toggle ON to execute.", "error");
    return;
  }
  _log("POV", input, "viz");
  try {
    const d = await fetch("/api/claw", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input, mode: "mouse" }),
    }).then((r) => r.json());
    if (d.error) _log("ERROR", d.error, "error");
  } catch (e) {
    _log("ERROR", "Network: " + e.message, "error");
  }
}

// After an action, grab a fresh frame so the view keeps up.
let _povRefreshTimer = null;
function _povRefreshSoon(ms = 700) {
  clearTimeout(_povRefreshTimer);
  _povRefreshTimer = setTimeout(() => _takeSnapshot({ quiet: true }), ms);
}

function _bindPovControls() {
  const img = document.getElementById("clawPovImg");
  if (!img) return;
  img.draggable = false;
  img.style.cursor = "crosshair";
  img.title = "Click, drag, right-click or scroll to control the PC";

  let down = null; // { x, y, sx, sy } while the button is held
  let clickTimer = null;

  img.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const p = _povToScreen(img, e.clientX, e.clientY);
    if (!p) return;
    e.preventDefault();
    img.setPointerCapture?.(e.pointerId);
    down = { cx: e.clientX, cy: e.clientY, ...p };
  });

  img.addEventListener("pointerup", (e) => {
    if (!down || e.button !== 0) return;
    const start = down;
    down = null;
    const moved = Math.hypot(e.clientX - start.cx, e.clientY - start.cy) > 6;
    if (moved) {
      const end = _povToScreen(img, e.clientX, e.clientY);
      if (!end) return;
      _povSend(`drag ${start.x} ${start.y} to ${end.x} ${end.y}`).then(() => _povRefreshSoon(900));
      return;
    }
    // Hold single clicks briefly so a double-click sends one double_click.
    if (clickTimer) {
      clearTimeout(clickTimer);
      clickTimer = null;
      _povSend(`double_click ${start.x} ${start.y}`).then(() => _povRefreshSoon());
      return;
    }
    clickTimer = setTimeout(() => {
      clickTimer = null;
      _povSend(`click ${start.x} ${start.y}`).then(() => _povRefreshSoon());
    }, 250);
  });

  img.addEventListener("pointercancel", () => (down = null));

  img.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    const p = _povToScreen(img, e.clientX, e.clientY);
    if (p) _povSend(`right_click ${p.x} ${p.y}`).then(() => _povRefreshSoon());
  });

  // Wheel: accumulate a burst, then move there and scroll once.
  let wheelAcc = 0, wheelTimer = null, wheelAt = null;
  img.addEventListener(
    "wheel",
    (e) => {
      const p = _povToScreen(img, e.clientX, e.clientY);
      if (!p) return;
      e.preventDefault();
      wheelAcc += e.deltaY;
      wheelAt = p;
      clearTimeout(wheelTimer);
      wheelTimer = setTimeout(async () => {
        const notches = Math.max(1, Math.min(15, Math.round(Math.abs(wheelAcc) / 100)));
        const dir = wheelAcc < 0 ? "up" : "down";
        wheelAcc = 0;
        await _povSend(`move ${wheelAt.x} ${wheelAt.y}`);
        await _povSend(`scroll ${dir} ${notches}`);
        _povRefreshSoon();
      }, 150);
    },
    { passive: false },
  );
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

  document.getElementById("clawConfirmDeny").addEventListener("click", () =>
    _answerConfirm(false),
  );
  document.getElementById("clawConfirmAllow").addEventListener("click", () =>
    _answerConfirm(true),
  );
}

// Approvals are held on the server by id (see resolveConfirm in server.js);
// the dialog only ever says yes or no to that id.
const _confirmQueue = [];
const _confirmSeen = new Set();
let _confirmCurrent = null;

async function _answerConfirm(approved) {
  const dlg = document.getElementById("clawConfirmOverlay");
  const c = _confirmCurrent;
  _confirmCurrent = null;
  dlg.style.display = "none";
  if (c) {
    _log("CONFIRM", approved ? "Approved: " + c.action : "Denied.", approved ? "output" : "error");
    try {
      const r = await fetch("/api/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: c.id, approved }),
      }).then((x) => x.json());
      if (r.error) _log("CONFIRM", r.error, "error");
      else if (r.output || r.message) _log("RESULT", r.output || r.message, "output");
    } catch (e) {
      _log("CONFIRM", "Failed: " + e.message, "error");
    }
  }
  if (_confirmResolve) {
    _confirmResolve(approved);
    _confirmResolve = null;
  }
  _showNextConfirm();
}

function _showNextConfirm() {
  if (_confirmCurrent || !_confirmQueue.length) return;
  _confirmCurrent = _confirmQueue.shift();
  const c = _confirmCurrent;
  const dlg = document.getElementById("clawConfirmOverlay");
  document.getElementById("clawConfirmBody").textContent =
    c.reason || c.description || "ARIA wants to run a sensitive action:";
  document.getElementById("clawConfirmAction").textContent = c.action;
  dlg.style.display = "flex";
  _log("⚠ CONFIRM", "Action: " + c.action, "error");
}

/** Accepts a server confirm ({id, kind, action, reason}). */
function showConfirmDialog(c) {
  if (!c?.id || _confirmSeen.has(c.id)) return Promise.resolve(false);
  _confirmSeen.add(c.id);
  _confirmQueue.push(c);
  _showNextConfirm();
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
      // The tray and ARIA menu flip PC control too; keep the ON/OFF switch in step.
      if (window.ariaDesktop) {
        const on = await window.ariaDesktop.getClaw();
        if (on !== _clawEnabled) _setClawEnabled(on, { remote: false });
      }
      // Approvals raised from a text or a background task have no chat
      // reply to ride on, so they arrive here.
      for (const c of d.pendingConfirms || []) showConfirmDialog(c);
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

      if (d.disabled) {
        if (dot) {
          dot.textContent = "⬡";
          dot.className = "clawDotOff";
          dot.title = "Disabled";
        }
        if (nameEl)
          nameEl.textContent = "Disabled — set ARIA_OWNER_UID or ARIA_ACCESS_KEY on the server";
        if (platEl) platEl.textContent = "";
      } else if (d.relays?.length) {
        const relay =
          d.relays.find((r) => r.relayType !== "screenwatcher") || d.relays[0];
        if (dot) {
          dot.textContent = "●";
          dot.className = "clawDotOn";
          dot.title = "Relay connected";
        }
        if (nameEl)
          nameEl.innerHTML = `<strong>${_esc(
            relay.hostname || relay.id,
          )}</strong> <span style="opacity:.45;font-size:9px">${
            { esp32: "📟 ESP32", electron: "🖥 Electron", node: "⬡ Node" }[
              relay.relayType
            ] || "⬡ Node"
          }</span>`;
        if (platEl) platEl.textContent = relay.platform || "";
      } else {
        if (dot) {
          dot.textContent = "⬡";
          dot.className = "clawDotOff";
          dot.title = "No relay";
        }
        if (nameEl && window.ariaDesktop) {
          // The desktop app runs the relay itself; it only needs switching on.
          if (!nameEl.querySelector(".clawDesktopOn")) {
            nameEl.innerHTML =
              'PC control is off — <button type="button" class="clawDesktopOn">Turn on PC control</button>';
            nameEl.querySelector(".clawDesktopOn").addEventListener("click", async (e) => {
              e.currentTarget.disabled = true;
              e.currentTarget.textContent = "Starting…";
              _setClawEnabled(true, { remote: false });
              await window.ariaDesktop.setClaw(true);
              setTimeout(poll, 1500); // the relay registers within a second or so
            });
          }
        } else if (nameEl)
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
          window.ariaDesktop
            ? "PC control is off. Turn it on with the ON switch above."
            : "No relay connected. Start claw-relay.js on your machine.",
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
