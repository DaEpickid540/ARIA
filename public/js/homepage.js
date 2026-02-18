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
    CPU: ${info.cpuModel}<br>
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

// TIME
const timeBox = document.getElementById("homeTime");
function updateTime() {
  const now = new Date();
  timeBox.textContent = now.toLocaleTimeString();
}
setInterval(updateTime, 1000);
updateTime();

// QUOTES
const quotes = [
  "Discipline beats motivation.",
  "Small steps compound into impossible results.",
  "You don’t need permission. You need momentum.",
  "Consistency is a superpower.",
  "Your future self is watching.",
  "Comfort is the enemy of progress.",
  "You can’t lose if you refuse to stop.",
  "Iteration beats perfection — ship the upgrade.",
  "Your habits are the codebase of your life.",
  "Failure is data. Use it.",
  "You’re not stuck — you’re running an outdated build.",
  "Upgrade complete: confidence module online.",
  "Executing protocol: Rise above.",
  "System check: You’re capable of far more than you think.",
];

const quoteBox = document.getElementById("homeQuote");
quoteBox.textContent = quotes[Math.floor(Math.random() * quotes.length)];
