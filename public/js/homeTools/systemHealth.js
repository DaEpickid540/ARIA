// homeTools/systemHealth.js

export function initSystemHealth() {
  const el = document.getElementById("homeSystemHealth");
  if (!el) return;

  // Placeholder score
  const score = Math.floor(Math.random() * 20) + 80;

  el.textContent = `System Health: ${score}%`;
}
