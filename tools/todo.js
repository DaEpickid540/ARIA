// tools/todo.js
let todos = [];

export async function run(input = "") {
  const [cmd, ...rest] = input.split(" ");
  const text = rest.join(" ").trim();

  switch (cmd) {
    case "add":
      if (!text) return "Usage: /todo add <text>";
      todos.push({ text, done: false });
      return `Added task: ${text}`;

    case "list":
      if (todos.length === 0) return "No tasks.";
      return todos
        .map((t, i) => `${i + 1}. [${t.done ? "x" : " "}] ${t.text}`)
        .join("\n");

    case "done": {
      const index = parseInt(text) - 1;
      if (!todos[index]) return "Invalid task number.";
      todos[index].done = true;
      return `Completed: ${todos[index].text}`;
    }

    case "delete": {
      const idx = parseInt(text) - 1;
      if (!todos[idx]) return "Invalid task number.";
      const removed = todos.splice(idx, 1);
      return `Deleted: ${removed[0].text}`;
    }

    default:
      return "Todo commands: add <text>, list, done <number>, delete <number>";
  }
}
