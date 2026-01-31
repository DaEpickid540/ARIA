import fs from "fs";
import path from "path";

export default function fileTool(message) {
  const filename = message.replace(/find file|search file/i, "").trim();
  if (!filename) return "Tell me the file name.";

  function search(dir) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const full = path.join(dir, file);
      if (fs.statSync(full).isDirectory()) {
        const result = search(full);
        if (result) return result;
      } else if (file.toLowerCase().includes(filename.toLowerCase())) {
        return full;
      }
    }
    return null;
  }

  const result = search("C:/");
  return result ? `Found: ${result}` : "Couldn't find that file.";
}
