// tools/system.js
import os from "os";

export async function run() {
  const cpus = os.cpus();
  const totalMem = (os.totalmem() / 1024 / 1024 / 1024).toFixed(1);
  const freeMem = (os.freemem() / 1024 / 1024 / 1024).toFixed(1);

  return `
Server OS: ${os.type()} ${os.release()}
CPU: ${cpus[0].model}
Cores: ${cpus.length}
RAM: ${freeMem} GB free / ${totalMem} GB total
Uptime: ${(os.uptime() / 3600).toFixed(1)} hours
Host: ${os.hostname()}
  `.trim();
}
