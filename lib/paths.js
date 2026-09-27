// lib/paths.js — where ARIA keeps the files it writes
//
// Everything used to live in ./data next to server.js. The desktop app runs
// server.js from inside its install folder (read-only, and wiped on every
// update), so it points ARIA_DATA_DIR at the user's AppData instead. Unset,
// nothing changes: `npm start` and Render keep using ./data.

import path from "path";
import { fileURLToPath } from "url";

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DATA_DIR = process.env.ARIA_DATA_DIR || path.join(ROOT, "data");
