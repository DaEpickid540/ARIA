// homeTools/systemInfo.js
import { getClientSystemInfo } from "../systemInfo.js";

export async function initSystemInfo() {
  const sys = document.getElementById("homeSystem");
  const net = document.getElementById("networkIndicator");

  if (!sys) return;

  const info = await getClientSystemInfo();

  sys.innerHTML = `
    OS: ${info.platform}<br>
    CPU: ${info.cpuModel}<br>
    CPU Threads: ${info.cpuThreads}<br>
    RAM: ${info.ram}<br>
    GPU: ${info.gpu}<br>
    Screen: ${info.screen}
  `;

  if (net) {
    net.textContent = `Network: ${info.networkType}`;
  }
}
