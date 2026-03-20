// tools/timer.js
const activeTimers = new Map();
let timerIdCounter = 1;

export async function run(input = "") {
  const parts = input.trim().split(" ");
  const cmd = parts[0]?.toLowerCase();

  if (cmd === "start") {
    const secs = parseInt(parts[1]);
    if (isNaN(secs) || secs <= 0) return "Usage: /timer start <seconds>";
    if (secs > 3600) return "Max timer duration is 3600 seconds (1 hour).";

    const id = timerIdCounter++;
    const timeout = setTimeout(() => {
      activeTimers.delete(id);
      console.log(`[TIMER #${id}] Done!`);
    }, secs * 1000);

    activeTimers.set(id, { secs, ends: Date.now() + secs * 1000, timeout });
    return `✓ Timer #${id} started for ${secs} second${secs !== 1 ? "s" : ""}.`;
  }

  if (cmd === "list") {
    if (!activeTimers.size) return "No active timers.";
    const now = Date.now();
    return Array.from(activeTimers.entries())
      .map(([id, t]) => {
        const remaining = Math.max(0, Math.ceil((t.ends - now) / 1000));
        return `Timer #${id}: ${remaining}s remaining`;
      })
      .join("\n");
  }

  if (cmd === "cancel") {
    const id = parseInt(parts[1]);
    const t = activeTimers.get(id);
    if (!t) return `Timer #${id} not found.`;
    clearTimeout(t.timeout);
    activeTimers.delete(id);
    return `✓ Timer #${id} cancelled.`;
  }

  return "Timer commands:\n  /timer start <seconds>\n  /timer list\n  /timer cancel <id>";
}
