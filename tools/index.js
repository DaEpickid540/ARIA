// tools/index.js
import * as calc from "./calc.js";
import * as time from "./time.js";
import * as notes from "./notes.js";
import * as todo from "./todo.js";
import * as weather from "./weather.js";
import * as system from "./system.js";
import * as search from "./search.js";
import * as news from "./news.js";
import * as timer from "./timer.js";
import * as files from "./files.js";

export const tools = {
  calc,
  time,
  notes,
  todo,
  weather,
  system,
  search,
  news,
  timer,
  files,
};

export async function runToolServer(toolName, input) {
  const tool = tools[toolName];
  if (!tool || typeof tool.run !== "function") {
    return `Unknown tool: ${toolName}`;
  }

  try {
    return await tool.run(input);
  } catch (err) {
    return `Tool error: ${err.message}`;
  }
}
