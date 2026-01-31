import { isCloud } from "./env.js";
import { exec } from "child_process";

export default async function appTool(message) {
  if (isCloud) return "App launching is disabled on Render.";

  const app = message.replace(/open|launch/gi, "").trim();

  exec(app, () => {});
  return `Launching ${app} locally.`;
}
