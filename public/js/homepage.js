// homepage.js — imports from homeTools.js (same js/ folder)
import {
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
import { initHomeCore } from "./homeCore.js";
import { initRings } from "./rings.js";
import { initPalette } from "./palette.js";

export function initHomepage() {
  const screen = document.getElementById("homepageScreen");
  if (!screen) return;

  screen.style.display = "flex";
  screen.style.opacity = "1";

  // One-time DOM setup — skip on subsequent visits
  if (screen.dataset.inited !== "1") {
    screen.dataset.inited = "1";
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

  // The core (clock, gauges, dock) and Daily Rings: safe to call every visit
  initHomeCore();
  initRings();
  initPalette();

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
