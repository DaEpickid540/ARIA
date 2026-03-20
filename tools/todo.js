// tools/todo.js
let todos = [];

export async function run(input = "") {
  const parts = input.trim().split(" ");
  const cmd = parts[0]?.toLowerCase();
  const text = parts.slice(1).join(" ").trim();

  switch (cmd) {
    case "add":
      if (!text) return "Usage: /todo add <text>";
      todos.push({ text, done: false, created: Date.now() });
      return `✓ Task added (#${todos.length}): "${text}"`;

    case "list":
      if (!todos.length) return "No tasks. Add one with /todo add <text>";
      return todos
        .map((t, i) => `${i + 1}. [${t.done ? "✓" : " "}] ${t.text}`)
        .join("\n");

    case "done": {
      const idx = parseInt(text) - 1;
      if (isNaN(idx) || !todos[idx]) return `Task #${text} not found.`;
      todos[idx].done = true;
      return `✓ Completed: "${todos[idx].text}"`;
    }

    case "undone": {
      const idx = parseInt(text) - 1;
      if (isNaN(idx) || !todos[idx]) return `Task #${text} not found.`;
      todos[idx].done = false;
      return `↩ Marked incomplete: "${todos[idx].text}"`;
    }

    case "delete": {
      const idx = parseInt(text) - 1;
      if (isNaN(idx) || !todos[idx]) return `Task #${text} not found.`;
      const removed = todos.splice(idx, 1)[0];
      return `✓ Deleted: "${removed.text}"`;
    }

    case "clear":
      todos = [];
      return "✓ All tasks cleared.";

    default:
      return "Todo commands:\n  /todo add <text>\n  /todo list\n  /todo done <number>\n  /todo undone <number>\n  /todo delete <number>\n  /todo clear";
  }
}
