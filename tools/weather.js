// tools/weather.js
const WMO_CODES = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Foggy",
  48: "Rime fog",
  51: "Light drizzle",
  53: "Drizzle",
  55: "Heavy drizzle",
  61: "Light rain",
  63: "Rain",
  65: "Heavy rain",
  71: "Light snow",
  73: "Snow",
  75: "Heavy snow",
  80: "Light showers",
  81: "Showers",
  82: "Heavy showers",
  95: "Thunderstorm",
  96: "Thunderstorm w/ hail",
  99: "Thunderstorm w/ heavy hail",
};

export async function run(input = "") {
  // Default: Mason OH. User can pass "lat,lon" or a city hint
  let lat = 39.3601,
    lon = -84.3097,
    label = "Mason, OH";

  const trimmed = input.trim();
  if (trimmed) {
    const parts = trimmed.split(",");
    if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      lat = parseFloat(parts[0]);
      lon = parseFloat(parts[1]);
      label = trimmed;
    }
  }

  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&hourly=relative_humidity_2m&timezone=auto`;
    const res = await fetch(url);
    const data = await res.json();
    const w = data.current_weather;
    if (!w) return "Weather data unavailable.";

    const desc = WMO_CODES[w.weathercode] || `Code ${w.weathercode}`;
    const f = ((w.temperature * 9) / 5 + 32).toFixed(1);
    return `Weather for ${label}: ${desc}\nTemp: ${w.temperature}°C (${f}°F) | Wind: ${w.windspeed} km/h`;
  } catch (e) {
    return `Weather error: ${e.message}`;
  }
}
