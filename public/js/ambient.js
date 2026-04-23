// ambient.js — ARIA ambient/idle mode
// When idle for N seconds: dim UI, pulse halo, cycle cryptic status messages.
// Ctrl+. or clicking anywhere wakes ARIA back up.

const IDLE_TIMEOUT_MS = 45_000; // 45s before ambient kicks in
const STATUS_MESSAGES = [
  "NEURAL NET IDLE — AWAITING INPUT",
  "MONITORING SYSTEM CHANNELS...",
  "COGNITIVE PROCESSES SUSPENDED",
  "STANDBY MODE — LOW POWER STATE",
  "SCANNING FOR ANOMALIES...",
  "MEMORY CONSOLIDATION IN PROGRESS",
  "EPSILON SUBROUTINES CYCLING...",
  "ARIA CORE: DORMANT",
  "THREAT ASSESSMENT: NOMINAL",
  "ALL NODES REPORTING STABLE",
  "WATCHING. WAITING. READY.",
  "PROCESSING BACKGROUND TASKS...",
];

let ambientActive = false;
let idleTimer = null;
let statusInterval = null;
let statusIdx = 0;

export function initAmbient() {
  // Build ambient overlay
  const el = document.createElement("div");
  el.id = "ambientOverlay";
  el.innerHTML = `
    <div id="ambientStatus"></div>
    <div id="ambientClock"></div>
    <div id="ambientHint">// tap anywhere or press Ctrl+. to wake //</div>`;
  document.body.appendChild(el);

  // Clock update
  setInterval(() => {
    const el = document.getElementById("ambientClock");
    if (el && ambientActive) {
      el.textContent = new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    }
  }, 1000);

  // Wake on any interaction
  const WAKE_EVENTS = ["mousedown", "touchstart", "keydown", "scroll"];
  WAKE_EVENTS.forEach((evt) =>
    document.addEventListener(evt, wakeFromAmbient, { passive: true }),
  );

  // Start idle timer
  resetIdleTimer();

  // Hook into chat activity to reset idle timer
  const originalSend = window.ARIA_sendMessage;
  document.getElementById("sendBtn")?.addEventListener("click", resetIdleTimer);
  document
    .getElementById("userInput")
    ?.addEventListener("input", resetIdleTimer);

  // Expose globally
  window.ARIA_toggleAmbient = toggleAmbient;
  window.ARIA_isAmbient = () => ambientActive;

  console.log("[ARIA] Ambient mode ready. Idle after 45s.");
}

function resetIdleTimer() {
  if (ambientActive) wakeFromAmbient();
  clearTimeout(idleTimer);
  idleTimer = setTimeout(enterAmbient, IDLE_TIMEOUT_MS);
}

function enterAmbient() {
  // Only activate when in the chat layout
  const layout = document.getElementById("layout");
  if (!layout || layout.style.display === "none") {
    resetIdleTimer();
    return;
  }
  ambientActive = true;
  document.getElementById("ambientOverlay")?.classList.add("active");
  document.getElementById("layout")?.classList.add("ambient-dim");
  window.ARIA_triggerHalo?.("thinking");

  // Cycle status messages
  statusIdx = Math.floor(Math.random() * STATUS_MESSAGES.length);
  const statusEl = document.getElementById("ambientStatus");
  if (statusEl) statusEl.textContent = STATUS_MESSAGES[statusIdx];
  statusInterval = setInterval(() => {
    statusIdx = (statusIdx + 1) % STATUS_MESSAGES.length;
    const el = document.getElementById("ambientStatus");
    if (el) {
      el.style.opacity = "0";
      setTimeout(() => {
        el.textContent = STATUS_MESSAGES[statusIdx];
        el.style.opacity = "1";
      }, 400);
    }
  }, 4000);
}

function wakeFromAmbient() {
  if (!ambientActive) return;
  ambientActive = false;
  document.getElementById("ambientOverlay")?.classList.remove("active");
  document.getElementById("layout")?.classList.remove("ambient-dim");
  window.ARIA_clearHalo?.();
  clearInterval(statusInterval);
  resetIdleTimer();
}

function toggleAmbient() {
  if (ambientActive) wakeFromAmbient();
  else {
    clearTimeout(idleTimer);
    enterAmbient();
  }
}
