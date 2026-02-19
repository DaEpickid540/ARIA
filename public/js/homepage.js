// homepage.js

import { initTime } from "./homeTools/time.js";
import { initWeather } from "./homeTools/weather.js";
import { initSystemInfo } from "./homeTools/systemInfo.js";
import { initQuote } from "./homeTools/quote.js";
import { initTasksPreview } from "./homeTools/tasksPreview.js";
import { initRecentChats } from "./homeTools/recentChats.js";
import { initSystemHealth } from "./homeTools/systemHealth.js";
import { initSpeedPreview } from "./homeTools/speedTestPreview.js";
import { initQuickTools } from "./homeTools/quickTools.js";
import { initDailySummary } from "./homeTools/dailySummary.js";
import { initSystemMonitor } from "./homeTools/systemMonitor.js";

export function initHomepage() {
  const screen = document.getElementById("homepageScreen");
  const enterBtn = document.getElementById("enterConsoleBtn");

  if (!screen || !enterBtn) return;

  // Show homepage
  screen.style.display = "flex";
  screen.style.opacity = 1;

  // Initialize all widgets
  initTime();
  initWeather();
  initSystemInfo();
  initQuote();
  initTasksPreview();
  initRecentChats();
  initSystemHealth();
  initSpeedPreview();
  initQuickTools();
  initDailySummary();
  initSystemMonitor();

  // Enter ARIA → fade out homepage
  enterBtn.addEventListener("click", () => {
    enterBtn.classList.add("enterToChat");

    setTimeout(() => {
      screen.style.opacity = 0;
      setTimeout(() => {
        screen.style.display = "none";
      }, 400);
    }, 600);
  });
}
