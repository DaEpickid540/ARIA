import notesTool from "./notes.js";
import timerTool from "./timer.js";
import weatherTool from "./weather.js";
import fileTool from "./files.js";
import appTool from "./apps.js";
import systemTool from "./system.js";
import todoTool from "./todo.js";
import newsTool from "./news.js";
import webSearchTool from "./websearch.js";
import calculatorTool from "./calculator.js";
import calculatorTool from "./evs.js";

export default async function runTool(message) {
  message = message.toLowerCase();

  if (message.includes("note")) return notesTool(message);
  if (message.includes("timer")) return timerTool(message);
  if (message.includes("weather")) return weatherTool(message);
  if (message.includes("file")) return fileTool(message);
  if (message.includes("open") || message.includes("launch"))
    return appTool(message);
  if (message.includes("system")) return systemTool(message);
  if (message.includes("todo") || message.includes("task"))
    return todoTool(message);
  if (message.includes("news")) return newsTool(message);
  if (message.includes("search") || message.includes("google"))
    return webSearchTool(message);
  if (message.includes("calculate") || message.includes("what is"))
    return calculatorTool(message);

  return null;
}
