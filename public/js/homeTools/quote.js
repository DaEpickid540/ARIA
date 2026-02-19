// homeTools/quote.js

const QUOTES = [
  "Discipline beats motivation.",
  "Small steps compound into impossible results.",
  "You don’t need permission. You need momentum.",
  "Consistency is a superpower.",
  "Your future self is watching.",
  "Comfort is the enemy of progress.",
  "You can’t lose if you refuse to stop.",
  "Iteration beats perfection — ship the upgrade.",
  "Your habits are the codebase of your life.",
  "Failure is data. Use it.",
  "You’re not stuck — you’re running an outdated build.",
  "Upgrade complete: confidence module online.",
  "Executing protocol: Rise above.",
  "System check: You’re capable of far more than you think.",
];

export function initQuote() {
  const el = document.getElementById("homeQuote");
  if (!el) return;

  const q = QUOTES[Math.floor(Math.random() * QUOTES.length)];
  el.textContent = q;
}
