// tools/notes.js
let notes = [];

export async function run(input = "") {
  const parts = input.trim().split(" ");
  const cmd = parts[0]?.toLowerCase();
  const text = parts.slice(1).join(" ").trim();

  switch (cmd) {
    case "add":
      if (!text) return "Usage: /notes add <text>";
      notes.push({ text, created: new Date().toLocaleTimeString() });
      return `✓ Note saved (#${notes.length}): "${text}"`;

    case "list":
      if (!notes.length) return "No notes saved.";
      return notes
        .map((n, i) => `${i + 1}. ${n.text}  [${n.created}]`)
        .join("\n");

    case "delete": {
      const idx = parseInt(text) - 1;
      if (isNaN(idx) || !notes[idx])
        return `Note #${text} not found. Use /notes list to see notes.`;
      const removed = notes.splice(idx, 1)[0];
      return `✓ Deleted: "${removed.text}"`;
    }

    case "clear":
      notes = [];
      return "✓ All notes cleared.";

    default:
      return "Notes commands:\n  /notes add <text>\n  /notes list\n  /notes delete <number>\n  /notes clear";
  }
}
