// public/js/homepage.js
import { getClientSystemInfo } from "./systemInfo.js";

window.addEventListener("DOMContentLoaded", async () => {
  const sysBox = document.getElementById("systemInfoBox");
  const net = document.getElementById("networkIndicator");

  if (!sysBox) return;

  const info = await getClientSystemInfo();

  sysBox.innerHTML = `
    <div class="sysRow"><strong>OS:</strong> ${info.platform}</div>
    <div class="sysRow"><strong>Browser:</strong> ${info.userAgent}</div>
    <div class="sysRow"><strong>CPU Threads:</strong> ${info.cpuThreads}</div>
    <div class="sysRow"><strong>RAM:</strong> ${info.ram}</div>
    <div class="sysRow"><strong>GPU:</strong> ${info.gpu}</div>
    <div class="sysRow"><strong>Screen:</strong> ${info.screen}</div>
    <div class="sysRow"><strong>Status:</strong> ${info.online}</div>
  `;

  if (net) {
    net.textContent = `Network: ${info.networkType}`;
  }
});
