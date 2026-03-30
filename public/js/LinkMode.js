// linkMode.js — ARIA Link Mode: device mesh network with file transfer
// Place in public/js/. Handles BT, WiFi (WebRTC), and server relay transfer.

/* ─────────────────────────────────────────────
   DEVICE REGISTRY
   Each connected device: { id, name, type, method, connected, lastSeen }
───────────────────────────────────────────── */
const SELF_ID =
  localStorage.getItem("aria_device_id") ||
  (() => {
    const id = "device_" + Math.random().toString(36).slice(2, 10);
    localStorage.setItem("aria_device_id", id);
    return id;
  })();

const SELF_NAME =
  localStorage.getItem("aria_device_name") ||
  (() => {
    const ua = navigator.userAgent;
    const isMobile = /Android|iPhone|iPad/.test(ua);
    const name = isMobile ? "Mobile" : "Desktop";
    localStorage.setItem("aria_device_name", name);
    return name;
  })();

let devices = []; // remote devices
let canvas, ctx; // for the network graph
let animFrame;
let peerConnections = {}; // WebRTC peers keyed by device id
let btDevice = null; // Web Bluetooth device
let serverPollTimer = null;

/* ─────────────────────────────────────────────
   OPEN / CLOSE
───────────────────────────────────────────── */
export function openLinkMode() {
  const overlay = document.getElementById("linkModeOverlay");
  if (!overlay) return;
  overlay.style.display = "flex";
  initCanvas();
  registerWithServer();
  startServerPoll();
  drawGraph();
}

export function closeLinkMode() {
  const overlay = document.getElementById("linkModeOverlay");
  if (overlay) overlay.style.display = "none";
  if (animFrame) cancelAnimationFrame(animFrame);
  if (serverPollTimer) clearInterval(serverPollTimer);
}

window.ARIA_openLinkMode = openLinkMode;
window.ARIA_closeLinkMode = closeLinkMode;

document
  .getElementById("linkModeCloseBtn")
  ?.addEventListener("click", closeLinkMode);

/* ─────────────────────────────────────────────
   CANVAS GRAPH (SmartThings-style)
───────────────────────────────────────────── */
function initCanvas() {
  canvas = document.getElementById("linkModeCanvas");
  if (!canvas) return;
  ctx = canvas.getContext("2d");
  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);
}

function resizeCanvas() {
  if (!canvas) return;
  const parent = canvas.parentElement;
  canvas.width = parent?.clientWidth || 600;
  canvas.height = 260;
}

function drawGraph() {
  if (!ctx || !canvas) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const allDevices = [
    { id: SELF_ID, name: SELF_NAME + " (You)", connected: true, type: "self" },
    ...devices,
  ];

  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const r = Math.min(cx, cy) - 50;

  // Position devices in a circle around self (self at center)
  const positions = {};
  positions[SELF_ID] = { x: cx, y: cy };
  allDevices.slice(1).forEach((d, i) => {
    const angle = (i / Math.max(allDevices.length - 1, 1)) * Math.PI * 2;
    positions[d.id] = {
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle),
    };
  });

  // Draw lines from self to each device
  const now = Date.now();
  allDevices.slice(1).forEach((d) => {
    const sp = positions[SELF_ID];
    const dp = positions[d.id];
    if (!sp || !dp) return;
    const pulse = (Math.sin(now / 600 + d.id.charCodeAt(0)) + 1) / 2;
    ctx.beginPath();
    ctx.moveTo(sp.x, sp.y);
    ctx.lineTo(dp.x, dp.y);
    ctx.strokeStyle = d.connected
      ? `rgba(255,${Math.floor(pulse * 80)},0,${0.4 + pulse * 0.5})`
      : "rgba(80,20,20,0.4)";
    ctx.lineWidth = d.connected ? 1.5 : 0.7;
    ctx.setLineDash(d.connected ? [] : [4, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  });

  // Draw nodes
  allDevices.forEach((d) => {
    const pos = positions[d.id];
    if (!pos) return;

    const isSelf = d.type === "self";
    const glow = ctx.createRadialGradient(
      pos.x,
      pos.y,
      0,
      pos.x,
      pos.y,
      isSelf ? 22 : 16,
    );
    const col = isSelf ? "#ff0000" : d.connected ? "#ff4400" : "#440000";
    glow.addColorStop(0, col + "cc");
    glow.addColorStop(1, col + "00");

    ctx.beginPath();
    ctx.arc(pos.x, pos.y, isSelf ? 22 : 15, 0, Math.PI * 2);
    ctx.fillStyle = glow;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(pos.x, pos.y, isSelf ? 14 : 9, 0, Math.PI * 2);
    ctx.fillStyle = isSelf ? "#ff2200" : d.connected ? "#ff4400" : "#330000";
    ctx.strokeStyle = isSelf ? "#ff4400" : "#ff2200";
    ctx.lineWidth = 1.5;
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#ffffff";
    ctx.font = `${isSelf ? 9 : 8}px 'Share Tech Mono', monospace`;
    ctx.textAlign = "center";
    ctx.fillText(
      d.name?.slice(0, 12) || "Device",
      pos.x,
      pos.y + (isSelf ? 30 : 25),
    );
    ctx.fillStyle = d.connected ? "#00ff88" : "#ff4444";
    ctx.fillText(d.connected ? "●" : "○", pos.x, pos.y + (isSelf ? 40 : 34));
  });

  animFrame = requestAnimationFrame(drawGraph);
}

/* ─────────────────────────────────────────────
   SERVER RELAY (register + poll for devices)
───────────────────────────────────────────── */
async function registerWithServer() {
  try {
    await fetch("/api/link/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: SELF_ID,
        name: SELF_NAME,
        ua: navigator.userAgent,
      }),
    });
  } catch {}
}

async function pollDevices() {
  try {
    const res = await fetch("/api/link/devices");
    const data = await res.json();
    devices = (data.devices || []).filter((d) => d.id !== SELF_ID);
    renderDeviceList();
  } catch {}
}

function startServerPoll() {
  pollDevices();
  serverPollTimer = setInterval(pollDevices, 4000);
}

function renderDeviceList() {
  const list = document.getElementById("linkModeDevices");
  if (!list) return;
  if (!devices.length) {
    list.innerHTML = `<div class="linkDeviceEmpty">No other devices found. Open ARIA on another device to see it here.</div>`;
    return;
  }
  list.innerHTML = devices
    .map(
      (d) => `
    <div class="linkDeviceItem" data-id="${d.id}">
      <div class="linkDeviceIcon">${d.ua?.includes("Mobile") || d.ua?.includes("Android") ? "📱" : "💻"}</div>
      <div class="linkDeviceInfo">
        <div class="linkDeviceName">${d.name || "Device"}</div>
        <div class="linkDeviceMeta">${d.id}</div>
      </div>
      <div class="linkDeviceActions">
        <button class="linkDevBtn" onclick="window.ARIA_sendFileToDevice('${d.id}')">📤 Send</button>
        <button class="linkDevBtn" onclick="window.ARIA_requestFiles('${d.id}')">📥 Pull</button>
      </div>
    </div>`,
    )
    .join("");
}

/* ─────────────────────────────────────────────
   FILE TRANSFER — Via Server Relay
───────────────────────────────────────────── */
document.getElementById("linkServerBtn")?.addEventListener("click", () => {
  if (!devices.length) {
    alert("No devices connected. Open ARIA on another device first.");
    return;
  }
  const target = devices[0];
  sendFileViaServer(target.id);
});

async function sendFileViaServer(targetId) {
  const input = Object.assign(document.createElement("input"), {
    type: "file",
  });
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    fd.append("from", SELF_ID);
    fd.append("to", targetId);
    fd.append("name", file.name);
    try {
      const res = await fetch("/api/link/transfer", {
        method: "POST",
        body: fd,
      });
      const d = await res.json();
      alert(
        d.success
          ? `Sent "${file.name}" to device.`
          : "Transfer failed: " + d.error,
      );
    } catch (e) {
      alert("Error: " + e.message);
    }
  };
  input.click();
}

window.ARIA_sendFileToDevice = sendFileViaServer;
window.ARIA_requestFiles = async (fromId) => {
  try {
    const res = await fetch(`/api/link/incoming?deviceId=${SELF_ID}`);
    const data = await res.json();
    if (!data.files?.length) {
      alert("No incoming files.");
      return;
    }
    data.files.forEach((f) => {
      const a = Object.assign(document.createElement("a"), {
        href: f.url,
        download: f.name,
      });
      a.click();
    });
  } catch (e) {
    alert("Error: " + e.message);
  }
};

/* ─────────────────────────────────────────────
   BLUETOOTH MANAGER
───────────────────────────────────────────── */
document
  .getElementById("linkBtScanBtn")
  ?.addEventListener("click", scanBluetooth);

export async function scanBluetooth() {
  if (!navigator.bluetooth) {
    alert(
      "Web Bluetooth is not available in this browser.\nUse Chrome on desktop or Android.",
    );
    return;
  }
  try {
    btDevice = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: ["battery_service", "device_information"],
    });
    const statusEl = document.getElementById("homeLinkStatus");
    if (statusEl)
      statusEl.textContent = `BT: ${btDevice.name || "Device"} connected`;

    // Try connecting to GATT server
    if (btDevice.gatt) {
      const server = await btDevice.gatt.connect();
      window.ARIA_btServer = server;
    }

    const devItem = {
      id: btDevice.id || "bt_" + Date.now(),
      name: btDevice.name || "BT Device",
      connected: true,
      method: "bluetooth",
    };
    devices = devices.filter((d) => d.method !== "bluetooth");
    devices.push(devItem);
    renderDeviceList();
    alert(`Connected to ${btDevice.name || "Bluetooth device"}`);
  } catch (e) {
    if (e.message !== "User cancelled the requestDevice() chooser.")
      alert("BT Error: " + e.message);
  }
}

/* ─────────────────────────────────────────────
   WIFI / WebRTC P2P Transfer
───────────────────────────────────────────── */
document.getElementById("linkWifiBtn")?.addEventListener("click", async () => {
  alert(
    "WebRTC P2P: Share your device ID with another ARIA user:\n\n" +
      SELF_ID +
      "\n\nThey can enter it to establish a direct connection.",
  );
});

/* ─────────────────────────────────────────────
   SEND FILE (top-level button)
───────────────────────────────────────────── */
document.getElementById("linkSendFileBtn")?.addEventListener("click", () => {
  if (!devices.length) {
    alert("No devices connected.");
    return;
  }
  if (devices.length === 1) {
    sendFileViaServer(devices[0].id);
    return;
  }
  const names = devices.map((d, i) => `${i + 1}. ${d.name}`).join("\n");
  const choice = prompt(`Choose device:\n${names}\n\nEnter number:`, "1");
  const idx = parseInt(choice) - 1;
  if (idx >= 0 && idx < devices.length) sendFileViaServer(devices[idx].id);
});

/* ─────────────────────────────────────────────
   HOME TOOLS in chat sidebar
   Triggered by tool_hometools in the dropdown
───────────────────────────────────────────── */
export function showHomeToolsInSidebar() {
  const existing = document.getElementById("homeToolsSidebar");
  if (existing) {
    existing.remove();
    return;
  }

  const panel = document.createElement("div");
  panel.id = "homeToolsSidebar";
  panel.innerHTML = `
    <div id="homeToolsSidebarHeader">
      <span>\xf0\x9f\x8f\xa0 HOME TOOLS</span>
      <button onclick="document.getElementById('homeToolsSidebar').remove()">✕</button>
    </div>
    <div id="homeToolsSidebarBody">
      <div class="htWidget"><div class="htWidgetLabel">System Time</div><div id="ht_time" class="htWidgetValue">—</div></div>
      <div class="htWidget"><div class="htWidgetLabel">Weather</div><div id="ht_weather" class="htWidgetValue">Loading…</div></div>
      <div class="htWidget"><div class="htWidgetLabel">System</div><div id="ht_system" class="htWidgetValue">—</div></div>
      <div class="htWidget"><div class="htWidgetLabel">Network</div><div id="ht_network" class="htWidgetValue">—</div></div>
      <div class="htWidget" style="cursor:pointer" onclick="window.ARIA_openLinkMode?.()">
        <div class="htWidgetLabel">\xf0\x9f\x94\x97 Link Mode</div>
        <div id="ht_link" class="htWidgetValue">${devices.length} device${devices.length !== 1 ? "s" : ""} nearby</div>
      </div>
      <div class="htWidget">
        <div class="htWidgetLabel">\xf0\x9f\x93\xb5 Bluetooth</div>
        <div class="htWidgetValue"><button class="homeToolBtn" onclick="window.ARIA_scanBluetooth?.()">Scan</button></div>
      </div>
    </div>`;

  document.getElementById("sidebar")?.appendChild(panel);

  // Populate
  const timeEl = document.getElementById("ht_time");
  if (timeEl) {
    const t = () => (timeEl.textContent = new Date().toLocaleTimeString());
    t();
    setInterval(t, 1000);
  }

  fetch("/api/weather?lat=39.3601&lon=-84.3097")
    .then((r) => r.json())
    .then((d) => {
      const el = document.getElementById("ht_weather");
      if (el && d.weather)
        el.textContent = `${d.weather.temperature}°C · Wind ${d.weather.windspeed}km/h`;
    })
    .catch(() => {});

  const sysEl = document.getElementById("ht_system");
  if (sysEl)
    sysEl.textContent = `${navigator.hardwareConcurrency || "?"}c · ~${navigator.deviceMemory || "?"}GB`;

  const netEl = document.getElementById("ht_network");
  if (netEl) {
    const conn = navigator.connection;
    netEl.textContent = conn
      ? `${conn.effectiveType?.toUpperCase()} · ${conn.downlink || "?"}Mbps`
      : navigator.onLine
        ? "Online"
        : "Offline";
  }
}
window.ARIA_showHomeToolsInSidebar = showHomeToolsInSidebar;
window.ARIA_scanBluetooth = scanBluetooth;
