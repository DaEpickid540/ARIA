// homeTools/systemHealth.js

export function initSystemHealth() {
  const scoreEl = document.getElementById("homeHealthScore");
  const detailsEl = document.getElementById("homeHealthDetails");
  if (!scoreEl || !detailsEl) return;

  const online = navigator.onLine;
  const mem = navigator.deviceMemory || 8;
  const cores = navigator.hardwareConcurrency || 4;

  let score = 80;
  if (!online) score -= 20;
  if (mem < 4) score -= 15;
  if (cores < 4) score -= 10;

  score = Math.max(0, Math.min(100, score));

  scoreEl.textContent = `${score}/100`;
  detailsEl.textContent = `Cores: ${cores}, RAM: ~${mem}GB, Network: ${
    online ? "Online" : "Offline"
  }`;
}
