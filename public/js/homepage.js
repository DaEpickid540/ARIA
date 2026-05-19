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
  initPomodoro,
  initScratchpad,
  initLatencyMonitor,
  initCryptoPrices,
  initWorldClocks,
  initDictionary,
  initClipboardHistory,
  initColorPicker,
  initTextStats,
  initPasswordGen,
} from "./homeTools.js";

export function initHomepage() {
  const screen = document.getElementById("homepageScreen");
  if (!screen) return;

  screen.style.display = "flex";
  screen.style.opacity = "1";

  // One-time DOM setup — skip on subsequent visits
  if (screen.dataset.inited !== "1") {
    screen.dataset.inited = "1";
    initTime();
    initQuote();
    initTasksPreview();
    initSystemInfo();
    initSystemHealth();
    initSystemMonitor();
    initNetworkInfo();
    initQuickTools();
    initBluetooth();
    // New tools (Mark 1.2)
    initPomodoro();
    initScratchpad();
    initWorldClocks();
    initDictionary();
    initClipboardHistory();
    initColorPicker();
    initTextStats();
    initPasswordGen();
  }

  // Async / live-data tools — always refresh on every visit
  initWeather();
  initSpeedPreview();
  initRecentChats();
  initDailySummary();
  initUSBDevices();
  initBgTasksPreview();
  initMemoryFacts();
  // New live tools
  initLatencyMonitor();
  initCryptoPrices();
}
