import { isCloud } from "./env.js";
import fs from "fs";

let cloudNotes = [];

export default async function notesTool(message) {
  const content = message.replace(/note|notes|remember/gi, "").trim();

  if (!content) return "What would you like me to save as a note?";

  if (isCloud) {
    cloudNotes.push(content);
    return `Saved (cloud): "${content}"`;
  }

  // Local mode: save to notes.json
  const path = "./data/notes.json";
  let notes = [];

  if (fs.existsSync(path)) {
    notes = JSON.parse(fs.readFileSync(path, "utf8"));
  }

  notes.push(content);
  fs.writeFileSync(path, JSON.stringify(notes, null, 2));

  return `Saved (local): "${content}"`;
}
