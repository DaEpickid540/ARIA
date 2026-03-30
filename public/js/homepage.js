// homepage.js — imports from homeTools.js (same js/ folder)
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
  initBluetooth,
} from "./hometools.js";

export function initHomepage() {
  const screen = document.getElementById("homepageScreen");
  if (!screen) return;
  if (screen.dataset.inited === "1") {
    screen.style.display = "flex";
    screen.style.opacity = "1";
    return;
  }
  screen.dataset.inited = "1";
  screen.style.display = "flex";
  screen.style.opacity = "1";

  // Sync tools — run immediately
  initTime();
  initQuote();
  initTasksPreview();
  initSystemInfo();
  initSystemHealth();
  initSystemMonitor();
  initNetworkInfo();
  initQuickTools();
  initBluetooth();

  // Async tools — fire and forget
  initWeather();
  initSpeedPreview();
  initRecentChats();
  initDailySummary();
  initUSBDevices();
  initBgTasksPreview();
  initMemoryFacts();
}
