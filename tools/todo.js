import { isCloud } from "./env.js";
import fs from "fs";

let cloudTodos = [];

export default async function todoTool(message) {
  const task = message.replace(/todo|add|task/gi, "").trim();

  if (!task) return "What task should I add?";

  if (isCloud) {
    cloudTodos.push(task);
    return `Added (cloud): ${task}`;
  }

  const path = "./data/todo.json";
  let todos = [];

  if (fs.existsSync(path)) {
    todos = JSON.parse(fs.readFileSync(path, "utf8"));
  }

  todos.push(task);
  fs.writeFileSync(path, JSON.stringify(todos, null, 2));

  return `Added (local): ${task}`;
}
