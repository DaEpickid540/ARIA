window.addEventListener("DOMContentLoaded", () => {
  const homeTime = document.getElementById("homeTime");
  const homeSystem = document.getElementById("homeSystem");

  if (homeTime) {
    const updateTime = () => {
      const now = new Date();
      homeTime.textContent = now.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
    };
    updateTime();
    setInterval(updateTime, 1000);
  }

  if (homeSystem) {
    homeSystem.innerHTML = `
      <div>GPU: RX 6700 XT</div>
      <div>Plan: T-Mobile Essentials</div>
      <div>Scout Rank: Star Scout</div>
      <div>Merit Badges Left: 2</div>
    `;
  }
});
