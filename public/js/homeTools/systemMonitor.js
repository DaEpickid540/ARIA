// homeTools/systemMonitor.js

export function initSystemMonitor() {
  const el = document.getElementById("homeSystemMonitor");
  if (!el) return;

  function update() {
    const cpu = (Math.random() * 40 + 10).toFixed(1);
    const ram = (Math.random() * 50 + 20).toFixed(1);

    el.innerHTML = `
      CPU: ${cpu}%<br>
      RAM: ${ram}%
    `;
  }

  update();
  setInterval(update, 2000);
}
