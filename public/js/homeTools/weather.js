// homeTools/weather.js

export function initWeather() {
  const main = document.getElementById("homeWeatherMain");
  const details = document.getElementById("homeWeatherDetails");

  if (!main || !details) return;

  // Placeholder weather (you can replace with real API later)
  main.textContent = "Loading...";
  details.textContent = "";

  // Fake weather for now
  setTimeout(() => {
    main.textContent = "32°F — Cloudy";
    details.textContent = "Feels like 28°F • Wind 6mph";
  }, 500);
}
