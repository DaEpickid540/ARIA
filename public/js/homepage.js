// public/js/homepage.js

import { initTime } from "./homeTools/time.js";
import { initQuote } from "./homeTools/quote.js";
import { initSystemInfo } from "./homeTools/systemInfo.js";
import { initWeather } from "./homeTools/weather.js";
import { initTasksPreview } from "./homeTools/tasksPreview.js";
import { initRecentChats } from "./homeTools/recentChats.js";
import { initSystemHealth } from "./homeTools/systemHealth.js";
import { initSpeedPreview } from "./homeTools/speedTestPreview.js";
import { initQuickTools } from "./homeTools/quickTools.js";
import { initDailySummary } from "./homeTools/dailySummary.js";
import { initSystemMonitor } from "./homeTools/systemMonitor.js";

export function initHomepage() {
  initTime();
  initQuote();
  initSystemInfo();
  initWeather();
  initTasksPreview();
  initRecentChats();
  initSystemHealth();
  initSpeedPreview();
  initQuickTools();
  initDailySummary();
  initSystemMonitor();
}
