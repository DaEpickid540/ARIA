// homeTools/weather.js

export async function initWeather() {
  const mainEl = document.getElementById("homeWeatherMain");
  const detailsEl = document.getElementById("homeWeatherDetails");
  if (!mainEl || !detailsEl) return;

  try {
    const res = await fetch("/api/weather?lat=41.0&lon=-81.0");
    const data = await res.json();
    const w = data.weather;

    if (!w) {
      mainEl.textContent = "Unavailable";
      detailsEl.textContent = "Weather API error.";
      return;
    }

    mainEl.textContent = `${w.temperature}°C, wind ${w.windspeed} km/h`;
    detailsEl.textContent = `Direction ${w.winddirection}°, code ${w.weathercode}`;
  } catch {
    mainEl.textContent = "Unavailable";
    detailsEl.textContent = "Weather API error.";
  }
}
