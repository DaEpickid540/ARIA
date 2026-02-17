// tools/timer.js
let timers = [];

export async function run(input = "") {
  const [cmd, value] = input.split(" ");

  if (cmd === "start") {
    const seconds = parseInt(value);
    if (isNaN(seconds)) return "Usage: /timer start <seconds>";

    const ms = seconds * 1000;
    const id = Date.now();
    timers.push(id);

    setTimeout(() => {
      console.log(`Timer ${id} finished.`);
    }, ms);

    return `Timer started for ${seconds} seconds.`;
  }

  if (cmd === "list") {
    return timers.length ? timers.join("\n") : "No timers running.";
  }

  return "Timer commands: start <seconds>, list";
}
