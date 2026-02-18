// public/js/homepage.js
import { getClientSystemInfo } from "./systemInfo.js";

window.addEventListener("DOMContentLoaded", async () => {
  const sys = document.getElementById("homeSystem");
  const net = document.getElementById("networkIndicator");

  if (!sys) return;

  const info = await getClientSystemInfo();

  // System info block
  sys.innerHTML = `
    OS: ${info.platform}<br>
    CPU Threads: ${info.cpuThreads}<br>
    RAM: ${info.ram}<br>
    GPU: ${info.gpu}<br>
    Screen: ${info.screen}
  `;

  // Network indicator
  if (net) {
    net.textContent = `Network: ${info.networkType}`;
  }
});
