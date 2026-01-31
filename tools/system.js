// tools/system.js
import os from "os";

export default function systemTool() {
  const cpu = os.cpus()[0].model;
  const cores = os.cpus().length;
  const ram = (os.totalmem() / 1e9).toFixed(2);
  const platform = os.platform();
  const release = os.release();

  return `System info:
- CPU: ${cpu}
- Cores: ${cores}
- RAM: ${ram} GB
- OS: ${platform} ${release}`;
}
