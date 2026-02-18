// homeTools/quickTools.js

export function initQuickTools() {
  const el = document.getElementById("homeQuickTools");
  if (!el) return;

  el.innerHTML = `
    <button class="qtBtn" data-tool="notes">📝 Notes</button>
    <button class="qtBtn" data-tool="todo">📋 To‑Do</button>
    <button class="qtBtn" data-tool="timer">⏱ Timer</button>
    <button class="qtBtn" data-tool="weather">☁ Weather</button>
  `;
}
