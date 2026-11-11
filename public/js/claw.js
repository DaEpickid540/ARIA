// claw.js — ARIA Claw Control Panel
// Tabs: CONTROL | SCREEN | CONFIG
// No chat terminal — pure control surface
//
// Things that make it quicker to live with:
//   - ↑ / ↓ in the input walks your command history (kept between visits)
//   - "!dir" runs in Shell without switching mode; /shell /type /key /mouse
//     /auto do the same for the other modes; /help lists them
//   - ★ on a command you ran pins it as a one-click button (right-click to unpin)
//   - click a log entry's label to copy it, ↻ to run it again, ⧉ copies the log
//   - mode, tab, sliders and the watch interval are remembered
//   - Screen tab: wide view, save the picture, live coordinates, and ⌨ Keys
//     to type on the PC from here; watching pauses while the panel is closed
//   - Ctrl+Shift+X is the kill switch from anywhere; Esc denies a permission

export function initClaw() {
  _buildKillSwitch();
  _buildPanel();
  _buildConfirmDialog();
  _startStatusPoll();

  window.ARIA_toggleClaw = toggleClaw;
  window.ARIA_openClaw = openClaw;
  window.ARIA_closeClaw = closeClaw;
  window.ARIA_clawRun = (text, mode = "auto") => {
    openClaw("control");
    if (text) _runCommand(String(text), mode);
  };
  window.ARIA_killClaw = killClaw;
  window.ARIA_resumeClaw = resumeClaw;
  window.ARIA_clawConfirm = showConfirmDialog;
  window.ARIA_handleClawConfirm = showConfirmDialog;

  document
    .getElementById("sidebarClawBtn")
    ?.addEventListener("click", toggleClaw);

  // The kill switch has to work wherever the cursor is, text boxes included.
  document.addEventListener(
    "keydown",
    (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "x") {
        e.preventDefault();
        killClaw();
      }
    },
    true,
  );

  console.log("[ARIA] Claw ready.");
}

/* ═══════════════════════════════════════════════════════════
   KILL SWITCH
═══════════════════════════════════════════════════════════ */
function _buildKillSwitch() {
  const btn = document.createElement("button");
  btn.id = "clawKillSwitch";
  btn.innerHTML = "⬡<br>KILL";
  btn.title = "Emergency stop — halt ALL Claw actions immediately (Ctrl+Shift+X)";
  btn.addEventListener("click", () => {
    btn.classList.contains("killed") ? resumeClaw() : killClaw();
  });
  document.body.appendChild(btn);
}

async function killClaw() {
  if (_autoJob) _stopAuto();
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
let _activeMode = "auto";
let _activeTab = "control";
let _screenWatch = false;
let _screenTimer = null;
let _screenInterval = 4000;
let _screenGrid = false; // show ARIA's click grid on the POV picture
let _watchPaused = false; // watching, but on hold while the panel is closed
let _povKeys = false; // ⌨ Keys: keystrokes on the picture go to the PC

/* ── remembered between visits (this browser only) ───────────── */
const PREFS_KEY = "aria_claw_prefs";
const HISTORY_KEY = "aria_claw_history";
const PINS_KEY = "aria_claw_pins";
const MAX_HISTORY = 60;
const MAX_PINS = 8;
const MAX_LOG = 400;

function _read(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key) || "null");
    return v ?? fallback;
  } catch {
    return fallback;
  }
}
function _write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}
let _prefs = _read(PREFS_KEY, {});
if (!_prefs || typeof _prefs !== "object" || Array.isArray(_prefs)) _prefs = {};
function _setPref(k, v) {
  _prefs[k] = v;
  _write(PREFS_KEY, _prefs);
}

let _history = _read(HISTORY_KEY, []);
if (!Array.isArray(_history)) _history = [];
let _histPos = -1; // -1 = not browsing; otherwise an index from the newest
let _histDraft = "";
function _remember(input) {
  if (_history[0] !== input) {
    _history.unshift(input);
    _history = _history.slice(0, MAX_HISTORY);
    _write(HISTORY_KEY, _history);
  }
  _histPos = -1;
}

let _pins = _read(PINS_KEY, []);
if (!Array.isArray(_pins)) _pins = [];
const MODE_ICON = { auto: "🧠", shell: "💻", type: "⌨", hotkey: "⌘", mouse: "🖱", line: "⚡" };

function _renderPins() {
  const row = document.getElementById("clawPinRow");
  if (!row) return;
  row.style.display = _pins.length ? "flex" : "none";
  row.innerHTML =
    `<span class="clawModeLabel">PINNED</span>` +
    _pins
      .map(
        (p, i) =>
          `<button class="clawPinBtn" data-pin="${i}" title="${_esc(p.input)}\n(${_esc(p.mode)} — right-click to unpin)">${MODE_ICON[p.mode] || "⚡"} ${_esc(
            p.input.length > 22 ? p.input.slice(0, 21) + "…" : p.input,
          )}</button>`,
      )
      .join("");
}
function _togglePin(input, mode) {
  const at = _pins.findIndex((p) => p.input === input && p.mode === mode);
  if (at >= 0) _pins.splice(at, 1);
  else {
    if (_pins.length >= MAX_PINS) {
      _log("SYSTEM", `Only ${MAX_PINS} pins fit. Right-click one to unpin it first.`, "info");
      return;
    }
    _pins.push({ input, mode });
  }
  _write(PINS_KEY, _pins);
  _renderPins();
}

// "!dir" → shell; "/key ctrl+t" → hotkey. Anything else runs in the mode
// the pills show.
const PREFIX_MODE = { shell: "shell", sh: "shell", ps: "shell", type: "type", key: "hotkey", hotkey: "hotkey", mouse: "mouse", auto: "auto", ai: "auto" };
function _splitPrefix(v, mode) {
  if (v.startsWith("!") && v.length > 1) return { input: v.slice(1).trim(), mode: "shell" };
  const m = v.match(/^\/(\w+)\s+([\s\S]+)$/);
  if (m && PREFIX_MODE[m[1].toLowerCase()]) return { input: m[2].trim(), mode: PREFIX_MODE[m[1].toLowerCase()] };
  return { input: v, mode };
}
const CLAW_HELP_TEXT = [
  "!<command>        run in Shell without switching mode",
  "/shell /type /key /mouse /auto <text>   run once in that mode",
  "↑ / ↓             walk your command history",
  "★ on a command    pin it as a button (right-click the pin to remove)",
  "label of an entry copy it      ↻ run it again      ⧉ copy the whole log",
  "Ctrl+L            clear the log",
  "Ctrl+Shift+X      kill switch, from anywhere",
  "Screen tab        click / drag / scroll the picture; ⌨ Keys types on the PC",
].join("\n");
const _shotUrl = () => "/api/claw/screenshot" + (_screenGrid ? "?grid=1" : "");

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
        <button class="clawHdrBtn" id="clawWideBtn" title="Wide panel (more room for the screen)">⤢</button>
        <button class="clawHdrBtn" id="clawCloseBtn" title="Close (Esc)">✕</button>
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
        <button class="clawModeBtn active" data-mode="auto"   title="Auto: ARIA picks the mode for every step and switches as it goes (PowerShell → mouse → keyboard…)">🧠 Auto</button>
        <button class="clawModeBtn"        data-mode="shell"  title="Direct shell command">💻 Shell</button>
        <button class="clawModeBtn"        data-mode="type"   title="Type text into active window">⌨ Type</button>
        <button class="clawModeBtn"        data-mode="hotkey" title="Keyboard shortcut e.g. ctrl+t">⌘ Key</button>
        <button class="clawModeBtn"        data-mode="mouse"  title="Mouse: move X Y | click F7 (grid cell) | pos | scroll up 3">🖱 Mouse</button>
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

      <!-- Pinned commands (★ on a command you ran) -->
      <div id="clawPinRow" style="display:none"></div>

      <!-- Output log -->
      <div id="clawOutput"></div>

      <!-- Input row -->
      <div id="clawInputRow">
        <span class="clawPrompt">▶</span>
        <input id="clawInput" type="text"
          placeholder="describe what ARIA should do on your PC...  (/help)"
          autocomplete="off" spellcheck="false"/>
        <button id="clawRunBtn" title="Run (Enter)">⚡</button>
        <button id="clawCopyBtn" title="Copy the whole log">⧉</button>
        <button id="clawClearBtn" title="Clear log (Ctrl+L)">🗑</button>
      </div>
    </div>

    <!-- ═══ TAB: SCREEN ═══ -->
    <div class="clawTabContent" id="clawTab-screen" style="display:none">
      <div id="clawScreenControls">
        <button id="clawScreenSnapBtn" class="clawHdrBtn">📸 Snapshot</button>
        <button id="clawScreenWatchBtn" class="clawHdrBtn">▶ Start Watch</button>
        <button id="clawScreenGridBtn" class="clawHdrBtn" title="Show the grid ARIA clicks by (it's only in this picture, never on your screen)">▦ Grid</button>
        <button id="clawScreenKeysBtn" class="clawHdrBtn" title="Send what you type to the PC while the picture has focus (click the picture first)">⌨ Keys</button>
        <button id="clawScreenSaveBtn" class="clawHdrBtn" title="Save this picture">⬇</button>
        <span id="clawScreenStatus" class="clawScreenStatusText">Idle</span>
      </div>
      <div id="clawScreenIntervalRow">
        <span class="clawCfgLabel">Refresh every</span>
        <input type="range" id="clawScreenIntervalSlider" min="1" max="15" value="4" step="1"/>
        <span id="clawScreenIntervalVal">4s</span>
      </div>
      <div id="clawPovFrame" tabindex="0">
        <div id="clawPovEmpty">No screenshot yet<br><span>Click Snapshot or Start Watch, then click, drag or scroll on the picture to control the PC. ⌨ Keys sends your typing too.</span></div>
        <img id="clawPovImg" style="display:none" alt="ARIA POV"/>
        <div id="clawPovCoords"></div>
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
          <span class="clawCfgLabel">Mouse glide speed</span>
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
          <span class="clawCfgLabel">Max steps per Auto task</span>
          <input type="range" id="cfgMaxSteps" min="1" max="25" value="8" step="1"/>
          <span id="cfgMaxStepsVal" class="clawCfgVal">8</span>
        </label>
      </div>

      <div class="clawCfgSection">
        <div class="clawCfgTitle">RELAY</div>
        <div id="clawSetupGuideBlock" class="clawCfgGuide">
          <div class="clawCfgTitle" style="margin-bottom:8px">CONNECT YOUR PC</div>
          <code id="clawSetupCmd">node claw-relay.js https://aria-69jr.onrender.com --key=&lt;key&gt; --background</code>
          <button id="clawSetupCopy" class="clawHdrBtn" type="button">⧉ Copy command</button>
          <p>No npm install. Node.js only. Works on Win / Mac / Linux.</p>
          <p><code>--background</code> runs it hidden (no window); <code>--stop</code> stops it; <code>--startup</code> also starts it hidden at every Windows login.</p>
          <p>Kill switch ⬡ always visible bottom-right.</p>
        </div>
      </div>
    </div>`;

  document.body.appendChild(panel);

  // ── Tab switching ──
  panel.querySelectorAll(".clawTab").forEach((btn) => {
    btn.addEventListener("click", () => _switchTab(btn.dataset.tab));
  });

  document.getElementById("clawCloseBtn").addEventListener("click", closeClaw);
  document.getElementById("clawWideBtn").addEventListener("click", () => _setWide(!panel.classList.contains("clawWide")));

  // ── Mode buttons ──
  const HINTS = {
    auto: "e.g. open Spotify and click Liked Songs — ARIA picks the modes",
    shell: "dir  /  Get-Process  /  echo hello",
    type: "Hello World!  (types into active window)",
    hotkey: "ctrl+t  /  alt+tab  /  ctrl+shift+n  /  win+d",
    mouse: "move 500 300  |  click F7  |  pos  |  scroll down 3",
  };
  const setMode = (mode, { save = true } = {}) => {
    if (!HINTS[mode]) return;
    _activeMode = mode;
    panel.querySelectorAll(".clawModeBtn").forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
    document.getElementById("clawInput").placeholder = HINTS[mode] + "   (/help)";
    if (save) _setPref("mode", mode);
  };
  panel.querySelectorAll(".clawModeBtn").forEach((btn) => {
    btn.addEventListener("click", () => {
      setMode(btn.dataset.mode);
      document.getElementById("clawInput").focus();
    });
  });

  // ── Pinned commands ──
  const pinRow = document.getElementById("clawPinRow");
  pinRow.addEventListener("click", (e) => {
    const p = _pins[e.target.closest("[data-pin]")?.dataset.pin];
    if (p) _runCommand(p.input, p.mode);
  });
  pinRow.addEventListener("contextmenu", (e) => {
    const p = _pins[e.target.closest("[data-pin]")?.dataset.pin];
    if (!p) return;
    e.preventDefault();
    _togglePin(p.input, p.mode);
  });
  _renderPins();

  // ── Log entries: copy, run again, pin ──
  document.getElementById("clawOutput").addEventListener("click", (e) => {
    const entry = e.target.closest(".clawEntry");
    if (!entry) return;
    const text = entry.querySelector(".clawEntryText")?.textContent || "";
    if (e.target.closest(".clawEntryRerun")) return _runCommand(entry.dataset.input, entry.dataset.mode);
    if (e.target.closest(".clawEntryPin")) return _togglePin(entry.dataset.input, entry.dataset.mode);
    if (e.target.closest(".clawEntryLabel")) {
      navigator.clipboard?.writeText(text).then(() => {
        entry.classList.add("copied");
        setTimeout(() => entry.classList.remove("copied"), 700);
      }).catch(() => {});
    }
  });

  // ── Quick actions ──
  panel.querySelectorAll(".clawQuickBtn[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => _runCommand(btn.dataset.action, "line"));
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
    _setPref("typeDelay", v);
  });

  const cfgMouseSpeed = document.getElementById("cfgMouseSpeed");
  const cfgMouseSpeedVal = document.getElementById("cfgMouseSpeedVal");
  cfgMouseSpeed?.addEventListener("input", () => {
    const v = Number(cfgMouseSpeed.value);
    if (cfgMouseSpeedVal) cfgMouseSpeedVal.textContent = `${v}×`;
    _pushRelayConfig({ mouseSpeed: v });
    _setPref("mouseSpeed", v);
  });

  document.getElementById("cfgMonitorIdx")?.addEventListener("change", (e) => {
    _pushRelayConfig({ monitorIdx: Number(e.target.value) });
    _setPref("monitorIdx", Number(e.target.value));
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
    _setPref("visualizer", _visualizerMode);
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
      _setPref(id, Number(el.value));
    });
  });

  // ── Run / input ──
  document.getElementById("clawRunBtn").addEventListener("click", () => {
    if (_autoJob) _stopAuto();
    else _runFromInput();
  });
  const clawInput = document.getElementById("clawInput");
  const clearLog = () => {
    document.getElementById("clawOutput").innerHTML = "";
  };
  clawInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") return _runFromInput();
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "l") {
      e.preventDefault();
      return clearLog();
    }
    // ↑ / ↓: older / newer commands. What you were typing comes back at the end.
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      if (!_history.length) return;
      e.preventDefault();
      if (_histPos === -1) _histDraft = clawInput.value;
      _histPos = e.key === "ArrowUp" ? Math.min(_history.length - 1, _histPos + 1) : Math.max(-1, _histPos - 1);
      clawInput.value = _histPos === -1 ? _histDraft : _history[_histPos];
      clawInput.setSelectionRange(clawInput.value.length, clawInput.value.length);
    }
  });
  document.getElementById("clawClearBtn").addEventListener("click", clearLog);
  document.getElementById("clawCopyBtn").addEventListener("click", (e) => {
    const text = [...document.querySelectorAll("#clawOutput .clawEntry")]
      .map((el) => `[${el.dataset.time || ""}] ${el.querySelector(".clawEntryLabel")?.textContent || ""}: ${el.querySelector(".clawEntryText")?.textContent || ""}`)
      .join("\n");
    const btn = e.currentTarget;
    navigator.clipboard?.writeText(text).then(() => {
      btn.textContent = "✓";
      setTimeout(() => (btn.textContent = "⧉"), 900);
    }).catch(() => {});
  });

  // ── Setup command: this server's address, one click to copy ──
  const setupCmd = document.getElementById("clawSetupCmd");
  if (setupCmd && /^https?:/.test(location.origin))
    setupCmd.textContent = `node claw-relay.js ${location.origin} --key=<key> --background`;
  document.getElementById("clawSetupCopy")?.addEventListener("click", (e) => {
    const btn = e.currentTarget;
    navigator.clipboard?.writeText(setupCmd.textContent).then(() => {
      btn.textContent = "✓ Copied";
      setTimeout(() => (btn.textContent = "⧉ Copy command"), 1200);
    }).catch(() => {});
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
  document.getElementById("clawScreenGridBtn").addEventListener("click", (e) => {
    _screenGrid = !_screenGrid;
    e.currentTarget.classList.toggle("active", _screenGrid);
    _setPref("grid", _screenGrid);
    // Redraw the frame on screen with (or without) the grid.
    if (_lastShotTs)
      fetch(_shotUrl())
        .then((r) => r.json())
        .then((d) => d.ok && _showScreenshot(d.image || d.b64, d.ts, d.bounds))
        .catch(() => {});
  });
  document
    .getElementById("clawScreenIntervalSlider")
    .addEventListener("input", (e) => {
      _screenInterval = parseInt(e.target.value) * 1000;
      document.getElementById(
        "clawScreenIntervalVal",
      ).textContent = `${e.target.value}s`;
      _setPref("interval", parseInt(e.target.value));
      // restart watch with new interval if active
      if (_screenWatch) {
        _stopScreenWatch();
        _startScreenWatch();
      }
    });

  _bindPovControls();

  document.getElementById("clawScreenKeysBtn").addEventListener("click", (e) => {
    _povKeys = !_povKeys;
    e.currentTarget.classList.toggle("active", _povKeys);
    document.getElementById("clawPovFrame").classList.toggle("keysOn", _povKeys);
    _setScreenStatus(_povKeys ? "Keys on: click the picture, then type" : _screenWatch ? "Watching..." : "Idle");
    if (_povKeys) document.getElementById("clawPovFrame").focus();
  });
  document.getElementById("clawScreenSaveBtn").addEventListener("click", () => {
    const img = document.getElementById("clawPovImg");
    if (!img?.src || img.style.display === "none") return _setScreenStatus("Nothing to save yet");
    const a = document.createElement("a");
    a.href = img.src;
    a.download = `aria-screen-${new Date(_lastShotTs || Date.now()).toISOString().replace(/[:.]/g, "-").slice(0, 19)}.png`;
    a.click();
  });
  // How old the picture is, so a stale frame doesn't pass for live.
  setInterval(_paintStamp, 1000);

  // ── Put things back the way they were left ──
  // Setting the value and firing its event runs the control's own handler,
  // so the label updates and the relay hears about speed and monitor again.
  const restore = (id, key) => {
    const el = document.getElementById(id);
    if (!el || _prefs[key] == null) return;
    el.value = String(_prefs[key]);
    el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input"));
  };
  if (_prefs.mode) setMode(_prefs.mode, { save: false });
  restore("cfgConfidence", "cfgConfidence");
  restore("cfgMaxSteps", "cfgMaxSteps");
  restore("cfgTypeDelay", "typeDelay");
  restore("cfgMouseSpeed", "mouseSpeed");
  restore("cfgMonitorIdx", "monitorIdx");
  restore("clawScreenIntervalSlider", "interval");
  if (_prefs.visualizer && vizCb) {
    vizCb.checked = true;
    _visualizerMode = true;
  }
  if (_prefs.grid) {
    _screenGrid = true;
    document.getElementById("clawScreenGridBtn").classList.add("active");
  }
  if (_prefs.wide) _setWide(true, { save: false });
  if (_prefs.tab) _switchTab(_prefs.tab, { save: false });

  _log("SYSTEM", "ARIA Claw ready. Connect relay → full PC control. /help for shortcuts.", "info");
}

function _setWide(on, { save = true } = {}) {
  const panel = document.getElementById("clawPanel");
  panel?.classList.toggle("clawWide", on);
  const btn = document.getElementById("clawWideBtn");
  if (btn) {
    btn.classList.toggle("active", on);
    btn.title = on ? "Back to the narrow panel" : "Wide panel (more room for the screen)";
  }
  if (save) _setPref("wide", on);
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
      const d = await fetch(_shotUrl())
        .then((r) => r.json())
        .catch(() => ({}));
      if (d.ok && (d.b64 || d.image) && d.ts > since) {
        clearInterval(poll);
        _showScreenshot(d.image || d.b64, d.ts, d.bounds);
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
    fetch(_shotUrl())
      .then((r) => r.json())
      .then((d) => {
        if (d.ok && (d.b64 || d.image)) _showScreenshot(d.image || d.b64, d.ts, d.bounds);
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

// The panel closed (or the tab went to the background) while watching:
// stop asking the relay for pictures nobody's looking at, and pick up again
// when it's back.
function _pauseScreenWatch() {
  if (!_screenWatch || _watchPaused) return;
  _watchPaused = true;
  clearInterval(_screenTimer);
  _screenTimer = null;
  _setScreenStatus("Paused while hidden");
}
function _resumeScreenWatch() {
  if (!_watchPaused) return;
  _watchPaused = false;
  if (_screenWatch && !_screenTimer) _startScreenWatch();
}
function _syncWatch() {
  const open = document.getElementById("clawPanel")?.classList.contains("open");
  if (open && !document.hidden && _activeTab === "screen") _resumeScreenWatch();
  else _pauseScreenWatch();
}

function _stopScreenWatch() {
  _screenWatch = false;
  _watchPaused = false;
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
  if (img) {
    img.src = String(b64).startsWith("data:") ? b64 : "data:image/png;base64," + b64;
    img.style.display = "block";
  }
  if (empty) empty.style.display = "none";
  _paintStamp();
}

// "10:51:16 PM · 4s ago", and marked stale once it's well past the interval.
function _paintStamp() {
  const stamp = document.getElementById("clawPovTimestamp");
  if (!stamp || !_lastShotTs) return;
  if (_activeTab !== "screen" || !document.getElementById("clawPanel")?.classList.contains("open")) return;
  const age = Math.max(0, Math.round((Date.now() - _lastShotTs) / 1000));
  const ago = age < 2 ? "now" : age < 60 ? `${age}s ago` : age < 3600 ? `${Math.floor(age / 60)}m ago` : `${Math.floor(age / 3600)}h ago`;
  stamp.textContent = `${new Date(_lastShotTs).toLocaleTimeString()} · ${ago}`;
  stamp.classList.toggle("stale", age * 1000 > Math.max(15000, _screenInterval * 3));
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

  // Where the pointer is on the real screen, as you move over the picture.
  const coords = document.getElementById("clawPovCoords");
  img.addEventListener("pointermove", (e) => {
    const p = _povToScreen(img, e.clientX, e.clientY);
    if (coords) coords.textContent = p ? `x ${p.x}  y ${p.y}` : "";
  });
  img.addEventListener("pointerleave", () => {
    if (coords) coords.textContent = "";
  });
  img.addEventListener("pointerdown", () => document.getElementById("clawPovFrame")?.focus({ preventScroll: true }));

  // ⌨ Keys: with the picture focused, what you type goes to the PC. Letters
  // are batched into one "type"; Enter, arrows and Ctrl/Alt combos go as
  // hotkeys. Off by default, so the panel's own shortcuts keep working.
  const frame = document.getElementById("clawPovFrame");
  const NAMED = {
    Enter: "enter", Tab: "tab", Escape: "esc", Backspace: "backspace", Delete: "del", " ": "space",
    ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right",
    Home: "home", End: "end", PageUp: "pgup", PageDown: "pgdn",
  };
  let typed = "", typeTimer = null;
  const send = async (input, mode) => {
    _log("POV", `${mode}: ${input}`, "viz");
    try {
      const d = await fetch("/api/claw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input, mode }),
      }).then((r) => r.json());
      if (d.error) _log("ERROR", d.error, "error");
      if (d.confirm) showConfirmDialog(d.confirm);
    } catch (e) {
      _log("ERROR", "Network: " + e.message, "error");
    }
    _povRefreshSoon(600);
  };
  const flush = () => {
    clearTimeout(typeTimer);
    typeTimer = null;
    if (!typed) return Promise.resolve();
    const text = typed;
    typed = "";
    return send(text, "type");
  };
  frame?.addEventListener("keydown", (e) => {
    if (!_povKeys || !_clawEnabled) return;
    if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;
    // Leave the kill switch and the browser's own tab/window keys alone.
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "x") return;
    const named = NAMED[e.key] || (/^F\d{1,2}$/.test(e.key) ? e.key.toLowerCase() : null);
    const combo = e.ctrlKey || e.altKey || e.metaKey;
    if (!named && !combo && e.key.length !== 1) return;
    e.preventDefault();
    e.stopPropagation();
    if (!combo && !named) {
      typed += e.key;
      clearTimeout(typeTimer);
      typeTimer = setTimeout(flush, 450);
      return;
    }
    if (!combo && e.key === " ") {
      typed += " ";
      clearTimeout(typeTimer);
      typeTimer = setTimeout(flush, 450);
      return;
    }
    const mods = [e.ctrlKey && "ctrl", e.altKey && "alt", e.shiftKey && (combo || named) && "shift", e.metaKey && "win"].filter(Boolean);
    const key = named || e.key.toLowerCase();
    flush().then(() => send([...mods, key].join("+"), "hotkey"));
  });
  frame?.addEventListener("blur", flush);

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
  // Esc is "no". There is deliberately no key for "yes".
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Escape" || !_confirmCurrent) return;
      e.preventDefault();
      e.stopPropagation();
      _answerConfirm(false);
    },
    true,
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
  document.getElementById("clawConfirmDeny")?.focus();
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
  if (/^\/(help|\?)$/i.test(v)) return _log("HELP", CLAW_HELP_TEXT, "info");
  _remember(v);
  const { input, mode } = _splitPrefix(v, _activeMode);
  if (input) _runCommand(input, mode);
}

async function _runCommand(input, mode) {
  if (!_clawEnabled) {
    _log("BLOCKED", "Claw is OFF. Toggle ON to execute.", "error");
    return;
  }
  if (_autoJob && mode === "auto") {
    _log("BUSY", "Still working on the last task — ⏹ to stop it first.", "error");
    return;
  }
  _log("YOU", input, "user", { input, mode });
  _setStatus("● RUNNING", "var(--red-neon, #ff2222)");
  const started = performance.now();
  const panel = document.getElementById("clawPanel");
  const vizMode = panel?._getViz?.() || false;
  let following = false;

  try {
    const res = await fetch("/api/claw", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input,
        mode,
        maxSteps: Number(document.getElementById("cfgMaxSteps")?.value) || 8,
      }),
    });
    const data = await res.json();
    if (data.error) {
      _log("ERROR", data.error, "error");
    } else if (data.jobId) {
      following = true;
      _followAuto(data.jobId);
    } else {
      if (data.output) _log("ARIA", data.output, "output", { took: performance.now() - started });
      if (data.confirm) showConfirmDialog(data.confirm);
      if (vizMode && data.queued?.length) {
        data.queued.forEach((q) => _log("EXEC", q, "viz"));
      }
      if (!data.relayConnected) {
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
    if (!following) _setStatus("● READY", "");
  }
}

/* ── AUTO: follow a task as it runs ────────────────────────────
   The server picks the mode for every step (lib/claw-auto.js); here each
   step is logged under its mode and that mode's pill lights up, so you can
   watch it switch from PowerShell to the mouse and back. */
let _autoJob = null; // { id, after, timer }
const AUTO_LABEL = {
  shell: "💻 PS",
  app: "🚀 APP",
  type: "⌨ TYPE",
  hotkey: "⌘ KEY",
  mouse: "🖱 MOUSE",
  look: "👁 LOOK",
  wait: "⏳ WAIT",
};
const AUTO_PILL = { shell: "shell", app: "shell", type: "type", hotkey: "hotkey", mouse: "mouse", look: "mouse" };

function _autoPill(mode) {
  document.querySelectorAll(".clawModeBtn").forEach((b) => {
    b.classList.toggle("autoLive", !!mode && b.dataset.mode === AUTO_PILL[mode]);
  });
}

function _followAuto(id) {
  const btn = document.getElementById("clawRunBtn");
  if (btn) {
    btn.textContent = "⏹";
    btn.title = "Stop this task";
  }
  _autoJob = { id, after: -1, timer: null, steps: 0, started: performance.now() };
  const job = _autoJob;
  const maxSteps = Number(document.getElementById("cfgMaxSteps")?.value) || 8;
  const tick = async () => {
    if (_autoJob !== job) return;
    try {
      const d = await fetch(`/api/claw/auto/${encodeURIComponent(id)}?after=${job.after}`).then((r) => r.json());
      if (d.error) throw new Error(d.error);
      for (const e of d.log || []) {
        job.after = Math.max(job.after, e.i);
        if (AUTO_LABEL[e.mode]) {
          _autoPill(e.mode);
          job.steps++;
          _setStatus(`● STEP ${job.steps}/${maxSteps}`, "var(--red-neon, #ff2222)");
          _log(AUTO_LABEL[e.mode], e.text, "viz");
        } else if (e.mode === "confirm") {
          _log("⚠ CONFIRM", e.text, "error");
          if (e.confirm) showConfirmDialog(e.confirm);
        } else if (e.mode === "say" || e.mode === "done") {
          _log(e.label === "DONE" ? "✓ DONE" : "ARIA", e.text, "output", e.mode === "done" ? { took: performance.now() - job.started } : {});
        } else if (e.mode === "result") {
          _log("↳", e.text, "info");
        } else {
          _log(e.label || "ERROR", e.text, "error");
        }
      }
      if (d.status && d.status !== "running") return _endAuto();
    } catch (e) {
      _log("ERROR", "Lost track of the task: " + e.message, "error");
      return _endAuto();
    }
    job.timer = setTimeout(tick, 700);
  };
  tick();
}

function _endAuto() {
  if (_autoJob) clearTimeout(_autoJob.timer);
  _autoJob = null;
  _autoPill(null);
  const btn = document.getElementById("clawRunBtn");
  if (btn) {
    btn.textContent = "⚡";
    btn.title = "";
  }
  _setStatus("● READY", "");
}

function _stopAuto() {
  const job = _autoJob;
  if (!job) return;
  _log("SYSTEM", "Stopping after the current step…", "info");
  fetch(`/api/claw/auto/${encodeURIComponent(job.id)}/stop`, { method: "POST" }).catch(() => {});
}

/* ═══════════════════════════════════════════════════════════
   PANEL TOGGLE
═══════════════════════════════════════════════════════════ */
function toggleClaw() {
  document.getElementById("clawPanel")?.classList.contains("open") ? closeClaw() : openClaw();
}

/** Opens the panel, optionally on a tab ("control" | "screen" | "config"). */
function openClaw(tab) {
  const panel = document.getElementById("clawPanel");
  if (!panel) return;
  panel.classList.add("open");
  if (tab) _switchTab(tab);
  if (_activeTab === "control") document.getElementById("clawInput")?.focus();
  _syncWatch();
}

function closeClaw() {
  document.getElementById("clawPanel")?.classList.remove("open");
  _syncWatch();
}

document.addEventListener("visibilitychange", _syncWatch);

function _switchTab(name, { save = true } = {}) {
  if (!document.getElementById(`clawTab-${name}`)) return;
  _activeTab = name;
  if (save) _setPref("tab", name);
  document.querySelectorAll(".clawTab").forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === name);
  });
  document.querySelectorAll(".clawTabContent").forEach((c) => {
    c.style.display = c.id === `clawTab-${name}` ? "flex" : "none";
  });
  _syncWatch();
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

/**
 * One line in the log. `extra.input`/`extra.mode` (a command you ran) add
 * the ↻ and ★ buttons; `extra.took` (ms) shows how long it took.
 */
function _log(label, text, type = "output", extra = {}) {
  const out = document.getElementById("clawOutput");
  if (!out) return;
  // Only follow the log down if you were already at the bottom, so reading
  // back through a long task isn't yanked away by the next step.
  const atBottom = out.scrollHeight - out.scrollTop - out.clientHeight < 40;
  const now = new Date();
  const time = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const e = document.createElement("div");
  e.className = "clawEntry clawEntry-" + type;
  e.dataset.time = time;
  const took = extra.took != null ? ` · ${extra.took < 1000 ? Math.round(extra.took) + "ms" : (extra.took / 1000).toFixed(1) + "s"}` : "";
  let tools = "";
  if (extra.input != null) {
    e.dataset.input = extra.input;
    e.dataset.mode = extra.mode || "auto";
    tools =
      `<span class="clawEntryTools">` +
      `<button class="clawEntryRerun" title="Run again">↻</button>` +
      `<button class="clawEntryPin" title="Pin as a button">★</button>` +
      `</span>`;
  }
  e.innerHTML =
    `<span class="clawEntryLabel" title="${time}${took} — click to copy">${label}</span>` +
    `<pre class="clawEntryText">${_esc(text)}</pre>` +
    (took ? `<span class="clawEntryTook">${took.slice(3)}</span>` : "") +
    tools;
  out.appendChild(e);
  while (out.children.length > MAX_LOG) out.firstElementChild.remove();
  if (atBottom || type === "user") out.scrollTop = out.scrollHeight;
}

function _esc(t) {
  return String(t)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
