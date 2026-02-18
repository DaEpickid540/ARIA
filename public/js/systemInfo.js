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
      return "Very Slow";
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

  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl");
    const debug = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = debug
      ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)
      : "Unknown GPU";

    info.gpu = renderer;

    // Extract CPU model if present
    const cpuMatch = renderer.match(
      /Intel.*?Graphics|AMD.*?Graphics|Apple.*?GPU/i,
    );
    info.cpuModel = cpuMatch ? cpuMatch[0] : "Unknown CPU";
  } catch {
    info.gpu = "Unknown GPU";
    info.cpuModel = "Unknown CPU";
  }

  info.screen = `${window.screen.width} x ${window.screen.height}`;

  const conn = navigator.connection;
  info.networkType = conn ? translateNetwork(conn.effectiveType) : "Unknown";

  return info;
}
