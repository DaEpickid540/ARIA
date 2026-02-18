// homeTools/speedTestPreview.js

export function initSpeedPreview() {
  const el = document.getElementById("homeSpeedPreview");
  if (!el) return;

  el.textContent = "Testing...";

  // Fake speed test
  setTimeout(() => {
    const speed = (Math.random() * 200 + 50).toFixed(1);
    el.textContent = `${speed} Mbps`;
  }, 800);
}
