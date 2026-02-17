// tools/weather.js
export async function run() {
  // Deerfield, OH approx
  const lat = 41.0337;
  const lon = -81.042;

  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`;

  const res = await fetch(url);
  const data = await res.json();

  const w = data.current_weather;
  if (!w) return "Weather data unavailable.";

  return `Weather: ${w.temperature}°C, wind ${w.windspeed} km/h`;
}
