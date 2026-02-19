// homeTools/systemInfo.js

export function initSystemInfo() {
  const sysEl = document.getElementById("homeSystem");
  const netEl = document.getElementById("networkIndicator");
  if (!sysEl || !netEl) return;

  const ua = navigator.userAgent;
  const online = navigator.onLine;

  sysEl.textContent = ua;
  netEl.textContent = online ? "Network: ONLINE" : "Network: OFFLINE";
  netEl.style.color = online ? "#4cff4c" : "#ff4b4b";

  window.addEventListener("online", () => {
    netEl.textContent = "Network: ONLINE";
    netEl.style.color = "#4cff4c";
  });

  window.addEventListener("offline", () => {
    netEl.textContent = "Network: OFFLINE";
    netEl.style.color = "#ff4b4b";
  });
}
