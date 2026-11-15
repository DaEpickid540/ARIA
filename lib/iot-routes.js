// iot-routes.js — a registry for small devices that poll ARIA
//
// Any ESP32 project can register here — smartwatch, sensor node,
// speaker, light controller, etc. Provides command queue +
// telemetry + key-value state per device.
//
// Endpoints:
//   POST /api/devices/register   — { deviceId, name, type, capabilities[] }
//   POST /api/devices/heartbeat  — { deviceId, telemetry{} }
//   POST /api/devices/state      — { deviceId, key, value }   (device → server)
//   GET  /api/devices/queue      — ?deviceId=...               (device polls)
//   POST /api/devices/command    — { deviceId, command{} }     (server queues)
//   GET  /api/devices/list       — see all devices
//   POST /api/devices/unregister — { deviceId }
//
// Moved out of server.js unchanged. Everything is in memory: a device
// re-registers after a server restart (its heartbeat is told to).

/** Adds the routes to `app`. Returns the device map, for /api/health. */
export function mountIotRoutes(app) {
  const iotDevices = new Map(); // deviceId → { name, type, capabilities, telemetry, state, lastSeen }
  const iotQueue = new Map(); // deviceId → [commands]
  let iotCmdSeq = 0;
  function nextIotCmdId() {
    return `iot_${++iotCmdSeq}_${Date.now().toString(36)}`;
  }

  app.post("/api/devices/register", (req, res) => {
    const {
      deviceId,
      name,
      type,
      capabilities = [],
      firmware,
      project,
    } = req.body;
    if (!deviceId) return res.status(400).json({ error: "deviceId required" });
    const existing = iotDevices.get(deviceId);
    iotDevices.set(deviceId, {
      deviceId,
      name: name || deviceId,
      type: type || "esp32",
      capabilities: Array.isArray(capabilities) ? capabilities : [],
      firmware,
      project,
      state: existing?.state || {},
      telemetry: existing?.telemetry || {},
      registeredAt: existing?.registeredAt || Date.now(),
      lastSeen: Date.now(),
    });
    if (!iotQueue.has(deviceId)) iotQueue.set(deviceId, []);
    console.log(
      `[IOT] Device registered: ${deviceId} (${type}/${name}) caps:[${capabilities.join(
        ",",
      )}]`,
    );
    res.json({ ok: true, deviceId });
  });

  app.post("/api/devices/heartbeat", (req, res) => {
    const { deviceId, telemetry = {} } = req.body;
    if (!deviceId) return res.status(400).json({ error: "deviceId required" });
    if (!iotDevices.has(deviceId))
      return res.json({ ok: false, needsRegister: true });
    const dev = iotDevices.get(deviceId);
    dev.lastSeen = Date.now();
    Object.assign(dev.telemetry, telemetry);
    res.json({ ok: true });
  });

  app.post("/api/devices/state", (req, res) => {
    const { deviceId, key, value } = req.body;
    if (!deviceId || !key)
      return res.status(400).json({ error: "deviceId + key required" });
    const dev = iotDevices.get(deviceId);
    if (!dev) return res.json({ ok: false });
    dev.state[key] = value;
    dev.lastSeen = Date.now();
    res.json({ ok: true });
  });

  app.get("/api/devices/queue", (req, res) => {
    const deviceId = req.query.deviceId;
    if (!deviceId) return res.status(400).json({ error: "deviceId required" });
    if (iotDevices.has(deviceId)) iotDevices.get(deviceId).lastSeen = Date.now();
    const q = iotQueue.get(deviceId) || [];
    iotQueue.set(deviceId, []);
    res.json({ commands: q });
  });

  app.post("/api/devices/command", (req, res) => {
    const { deviceId, command } = req.body;
    if (!deviceId || !command)
      return res.status(400).json({ error: "deviceId + command required" });
    if (!iotQueue.has(deviceId)) iotQueue.set(deviceId, []);
    iotQueue.get(deviceId).push({ ...command, id: nextIotCmdId() });
    res.json({ ok: true });
  });

  app.get("/api/devices/list", (_, res) => {
    const now = Date.now();
    const devices = [...iotDevices.values()].map((d) => ({
      ...d,
      online: now - d.lastSeen < 20000,
    }));
    res.json({ devices });
  });

  app.post("/api/devices/unregister", (req, res) => {
    const { deviceId } = req.body;
    iotDevices.delete(deviceId);
    iotQueue.delete(deviceId);
    res.json({ ok: true });
  });

  return { iotDevices };
}
