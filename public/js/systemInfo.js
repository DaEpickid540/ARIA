// public/js/systemInfo.js
function translateNetwork(type) {
  switch (type) {
    case "wifi":
      return "Wi‑Fi";
    case "cellular":
      return "Cellular";
    case "ethernet":
      return "Ethernet";
    case "4g":
      return "4G";
    case "5g":
      return "5G";
    case "3g":
      return "3G";
    case "slow-2g":
      return "Very slow";
    default:
      return "Unknown";
  }
}

export async function getClientSystemInfo() {
  const info = {};

  info.userAgent = navigator.userAgent;
  info.platform = navigator.platform;

  info.cpuThreads = navigator.hardwareConcurrency || "Unknown";

  info.ram = navigator.deviceMemory
    ? navigator.deviceMemory + " GB"
    : "Unknown";

  // GPU
  try {
    const canvas = document.createElement("canvas");
    const gl =
      canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
    const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
    info.gpu = debugInfo
      ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
      : "Unknown GPU";
  } catch {
    info.gpu = "Unknown GPU";
  }

  info.screen = `${window.screen.width} x ${window.screen.height}`;

  const conn =
    navigator.connection ||
    navigator.webkitConnection ||
    navigator.mozConnection;

  if (conn) {
    info.networkType = translateNetwork(conn.effectiveType || "unknown");
    info.downlink = conn.downlink || "unknown";
  } else {
    info.networkType = "Unknown";
    info.downlink = "unknown";
  }

  info.online = navigator.onLine ? "Online" : "Offline";

  return info;
}
