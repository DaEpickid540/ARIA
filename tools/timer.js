export default async function timerTool(message) {
  const match = message.match(/(\d+)\s*(seconds?|minutes?|hours?)/i);
  if (!match) return "Tell me a time like 'set a 5 minute timer'.";

  const value = parseInt(match[1]);
  const unit = match[2].toLowerCase();

  return `Timer set for ${value} ${unit}. (Timers only run locally, not on Render.)`;
}
