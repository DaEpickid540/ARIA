// homeTools/speedTestPreview.js

export function initSpeedPreview() {
  const el = document.getElementById("homeSpeedPreview");
  if (!el) return;

  el.textContent = "Testing...";

  setTimeout(() => {
    const speed = (Math.random() * 200 + 50).toFixed(1);
    el.textContent = `${speed} Mbps (simulated)`;
  }, 800);
}
