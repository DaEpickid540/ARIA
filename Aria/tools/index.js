import notesTool from "./notes.js";
import timerTool from "./timer.js";
import weatherTool from "./weather.js";
import fileTool from "./files.js";
import appTool from "./apps.js";
import systemTool from "./system.js";
import todoTool from "./todo.js";
import newsTool from "./news.js";

export default async function runTools(message) {
  message = message.toLowerCase();

  if (message.startsWith("note") || message.startsWith("save note"))
    return notesTool(message);

  if (message.includes("timer") || message.includes("remind"))
    return timerTool(message);

  if (message.includes("weather")) return weatherTool(message);

  if (message.includes("find file") || message.includes("search file"))
    return fileTool(message);

  if (message.startsWith("open ")) return appTool(message);

  if (message.includes("system info")) return systemTool();

  if (message.startsWith("add task") || message.startsWith("todo"))
    return todoTool(message);

  if (message.includes("news") || message.includes("debrief"))
    return await newsTool(message);

  return null; // no tool matched
}
