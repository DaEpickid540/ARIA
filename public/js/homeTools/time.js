// homeTools/time.js

export function initTime() {
  const timeBox = document.getElementById("homeTime");
  if (!timeBox) return;

  function updateTime() {
    timeBox.textContent = new Date().toLocaleTimeString();
  }

  updateTime();
  setInterval(updateTime, 1000);
}
