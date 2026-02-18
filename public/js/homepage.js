// homepage.js
import { initSystemInfo } from "./homeTools/systemInfo.js";
import { initTime } from "./homeTools/time.js";
import { initQuote } from "./homeTools/quote.js";

export function initHomepage() {
  initSystemInfo();
  initTime();
  initQuote();
}
