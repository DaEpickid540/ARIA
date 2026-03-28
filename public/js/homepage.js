// homepage.js — imports from unified homeTools.js (same js/ folder)
import {
  initTime,
  initWeather,
  initSystemInfo,
  initQuote,
  initTasksPreview,
  initRecentChats,
  initSystemHealth,
  initSpeedPreview,
  initQuickTools,
  initDailySummary,
  initSystemMonitor,
  initUSBDevices,
  initNetworkInfo,
  initBgTasksPreview,
  initMemoryFacts,
} from "./homeTools.js";

export function initHomepage() {
  const screen = document.getElementById("homepageScreen");
  if (!screen) return;
  if (screen.dataset.inited === "1") {
    screen.style.display = "flex";
    screen.style.opacity = 1;
    return;
  }
  screen.dataset.inited = "1";
  screen.style.display = "flex";
  screen.style.opacity = 1;

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
  initUSBDevices();
  initNetworkInfo();
  initBgTasksPreview();
  initMemoryFacts();
}
