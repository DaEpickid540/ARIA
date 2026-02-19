// homeTools/systemMonitor.js

export function initSystemMonitor() {
  const el = document.getElementById("homeSystemMonitor");
  if (!el) return;

  const info = [];

  info.push(`Platform: ${navigator.platform}`);
  info.push(`User Agent: ${navigator.userAgent}`);
  info.push(`Language: ${navigator.language}`);
  info.push(`Cores: ${navigator.hardwareConcurrency || "?"}`);
  info.push(`Memory: ~${navigator.deviceMemory || "?"}GB`);

  el.innerHTML = info.join("<br>");
}
