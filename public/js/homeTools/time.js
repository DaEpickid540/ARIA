// homeTools/time.js

export function initTime() {
  const el = document.getElementById("homeTime");
  if (!el) return;

  function update() {
    const now = new Date();
    el.textContent = now.toLocaleString([], {
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  update();
  setInterval(update, 1000);
}
