// tools/notes.js
let notes = [];

export async function run(input = "") {
  const [cmd, ...rest] = input.split(" ");
  const text = rest.join(" ").trim();

  switch (cmd) {
    case "add":
      if (!text) return "Usage: /notes add <text>";
      notes.push(text);
      return `Added note: ${text}`;

    case "list":
      if (notes.length === 0) return "No notes.";
      return notes.map((n, i) => `${i + 1}. ${n}`).join("\n");

    case "delete": {
      const index = parseInt(text) - 1;
      if (isNaN(index) || !notes[index]) return "Invalid note number.";
      const removed = notes.splice(index, 1);
      return `Deleted: ${removed}`;
    }

    default:
      return "Notes commands: add <text>, list, delete <number>";
  }
}
