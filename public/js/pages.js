// pages.js

export function initPages() {
  const chatWindow = document.getElementById("chatWindow");
  const weatherPage = document.getElementById("weatherPage");
  const newsPage = document.getElementById("newsPage");
  const systemPage = document.getElementById("systemPage");
  const toolsPage = document.getElementById("toolsPage");

  const btnWeather = document.getElementById("openWeatherPageBtn");
  const btnNews = document.getElementById("openNewsPageBtn");
  const btnSystem = document.getElementById("openSystemPageBtn");
  const btnTools = document.getElementById("openToolsPageBtn");

  function showOnly(target) {
    [chatWindow, weatherPage, newsPage, systemPage, toolsPage].forEach((el) => {
      if (!el) return;
      el.style.display = el === target ? "block" : "none";
    });
  }

  // Default: chat window
  showOnly(chatWindow);

  /* WEATHER PAGE */
  btnWeather?.addEventListener("click", async () => {
    showOnly(weatherPage);
    await loadWeatherPage();
  });

  /* NEWS PAGE */
  btnNews?.addEventListener("click", async () => {
    showOnly(newsPage);
    await loadNewsPage();
  });

  /* SYSTEM PAGE */
  btnSystem?.addEventListener("click", () => {
    showOnly(systemPage);
    loadSystemPage();
  });

  /* TOOLS PAGE */
  btnTools?.addEventListener("click", () => {
    showOnly(toolsPage);
    loadToolsPage();
  });
}

/* ---------------- WEATHER PAGE ---------------- */

async function loadWeatherPage() {
  const el = document.getElementById("weatherPageContent");
  if (!el) return;

  el.textContent = "Loading weather...";

  try {
    const res = await fetch("/api/weather?lat=41.0&lon=-81.0");
    const data = await res.json();
    const w = data.weather;

    if (!w) {
      el.textContent = "Weather unavailable.";
      return;
    }

    el.innerHTML = `
      <p><strong>Temperature:</strong> ${w.temperature}°C</p>
      <p><strong>Wind:</strong> ${w.windspeed} km/h (dir ${w.winddirection}°)</p>
      <p><strong>Weather Code:</strong> ${w.weathercode}</p>
    `;
  } catch {
    el.textContent = "Weather API error.";
  }
}

/* ---------------- NEWS PAGE ---------------- */

async function loadNewsPage() {
  const el = document.getElementById("newsPageContent");
  if (!el) return;

  el.textContent = "Loading news...";

  try {
    const res = await fetch("/api/news");
    const data = await res.json();
    const articles = data.articles || [];

    if (!articles.length) {
      el.textContent = "No news available.";
      return;
    }

    const list = document.createElement("ul");
    list.style.paddingLeft = "18px";

    articles.slice(0, 15).forEach((a) => {
      const li = document.createElement("li");
      const link = document.createElement("a");
      link.href = a.link || a.url || "#";
      link.target = "_blank";
      link.textContent = a.title || "Untitled article";
      li.appendChild(link);
      list.appendChild(li);
    });

    el.innerHTML = "";
    el.appendChild(list);
  } catch {
    el.textContent = "News API error.";
  }
}

/* ---------------- SYSTEM PAGE ---------------- */

function loadSystemPage() {
  const el = document.getElementById("systemPageContent");
  if (!el) return;

  const online = navigator.onLine;
  const mem = navigator.deviceMemory || "?";
  const cores = navigator.hardwareConcurrency || "?";

  el.innerHTML = `
    <p><strong>Platform:</strong> ${navigator.platform}</p>
    <p><strong>User Agent:</strong> ${navigator.userAgent}</p>
    <p><strong>Language:</strong> ${navigator.language}</p>
    <p><strong>Cores:</strong> ${cores}</p>
    <p><strong>Memory:</strong> ~${mem}GB</p>
    <p><strong>Network:</strong> ${online ? "Online" : "Offline"}</p>
  `;
}

/* ---------------- TOOLS PAGE ---------------- */

function loadToolsPage() {
  const el = document.getElementById("toolsPageContent");
  if (!el) return;

  el.innerHTML = `
    <p>Quick commands you can use in chat:</p>
    <ul>
      <li><code>/calc 2+2*5</code> — calculator</li>
      <li><code>/time</code> — current server time</li>
      <li><code>/task add [text]</code> — add a task</li>
      <li><code>/task list</code> — show tasks</li>
    </ul>
  `;
}
