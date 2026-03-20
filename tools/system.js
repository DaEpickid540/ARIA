// tools/system.js
import os from "os";
export async function run() {
  const cpus = os.cpus();
  const totalMem = (os.totalmem() / 1024 ** 3).toFixed(1);
  const freeMem = (os.freemem() / 1024 ** 3).toFixed(1);
  const uptime = (os.uptime() / 3600).toFixed(1);
  return `Server System Info:
OS:     ${os.type()} ${os.release()} (${os.arch()})
CPU:    ${cpus[0]?.model || "Unknown"} × ${cpus.length} cores
RAM:    ${freeMem} GB free / ${totalMem} GB total
Uptime: ${uptime} hours
Host:   ${os.hostname()}`;
}
