// homeTools/dailySummary.js

export function initDailySummary() {
  const el = document.getElementById("homeDailySummary");
  if (!el) return;

  const summary = [
    "You studied 2 hours today.",
    "You completed 3 tasks.",
    "You slept 7.5 hours.",
    "Your productivity is trending up.",
  ];

  el.innerHTML = summary
    .slice(0, 2)
    .map((s) => `<div class="summaryItem">${s}</div>`)
    .join("");
}
