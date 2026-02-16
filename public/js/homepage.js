window.addEventListener("DOMContentLoaded", () => {
  const homeTime = document.getElementById("homeTime");
  const homeWeatherMain = document.getElementById("homeWeatherMain");
  const homeWeatherDetails = document.getElementById("homeWeatherDetails");
  const homeSystem = document.getElementById("homeSystem");
  const homeQuote = document.getElementById("homeQuote");
  const ariaIntroBtn = document.getElementById("ariaIntroBtn");
  const enterConsoleBtn = document.getElementById("enterConsoleBtn");

  /* -------------------------
     CLOCK
  ------------------------- */
  function updateClock() {
    const now = new Date();
    homeTime.textContent = now.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  updateClock();
  setInterval(updateClock, 1000);

  /* -------------------------
     WEATHER (Open-Meteo)
  ------------------------- */
  async function loadWeather() {
    try {
      // Deerfield, OH coordinates
      const lat = 41.0337;
      const lon = -81.042;

      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&hourly=relativehumidity_2m,windspeed_10m`;

      const res = await fetch(url);
      const data = await res.json();

      const w = data.current_weather;
      const humidity = data.hourly.relativehumidity_2m[0];
      const wind = data.hourly.windspeed_10m[0];

      homeWeatherMain.textContent = `${w.temperature}°F — ${w.weathercode === 0 ? "Clear" : "Cloudy"}`;
      homeWeatherDetails.textContent = `Wind: ${wind} mph • Humidity: ${humidity}%`;
    } catch (err) {
      homeWeatherMain.textContent = "Weather unavailable";
      homeWeatherDetails.textContent = "";
    }
  }
  loadWeather();

  /* -------------------------
     SYSTEM INFO (static for now)
  ------------------------- */
  homeSystem.innerHTML = `
    GPU: RX 6700 XT<br>
    Plan: T-Mobile Essentials<br>
    Scout Rank: Star Scout<br>
    Merit Badges Left: 2
  `;

  /* -------------------------
     RANDOM QUOTE
  ------------------------- */
  const quotes = [
    "Discipline beats motivation.",
    "Small steps still move you forward.",
    "Your future self is watching.",
    "You don’t need permission to be great.",
    "Every expert was once a beginner.",
    "Consistency is the real superpower.",
    "You’re closer than you think.",
  ];
  homeQuote.textContent = quotes[Math.floor(Math.random() * quotes.length)];

  /* -------------------------
     ARIA INTRO BUTTON
  ------------------------- */
  ariaIntroBtn.addEventListener("click", () => {
    alert(
      "Hello — I'm ARIA.\n\nA modular cyberpunk AI system with:\n• Personality presets\n• Voice control\n• Real-time speech recognition\n• Multi-provider AI routing\n• A fully reactive UI\n\nNice to meet you.",
    );
  });

  /* -------------------------
     ENTER CONSOLE
  ------------------------- */
  enterConsoleBtn.addEventListener("click", () => {
    document.getElementById("homepageScreen").style.display = "none";
  });
});
