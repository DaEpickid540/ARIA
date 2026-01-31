import axios from "axios";

export default async function weatherTool(message) {
  const cityMatch = message.match(/in\s+([a-zA-Z\s]+)/i);
  const city = cityMatch ? cityMatch[1].trim() : "Mason";

  const key = process.env.WEATHER_KEY;
  if (!key) return "Weather API key missing.";

  const url = `https://api.openweathermap.org/data/2.5/weather?q=${city}&appid=${key}&units=metric`;

  try {
    const res = await axios.get(url);
    const w = res.data.weather[0].description;
    const t = res.data.main.temp;

    return `Weather in ${city}: ${w}, ${t}°C`;
  } catch {
    return "Couldn't fetch weather.";
  }
}
