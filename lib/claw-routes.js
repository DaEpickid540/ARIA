// claw-routes.js — the HTTP side of Claw
//
// What the relays call (register, heartbeat, queue, result), what the Claw
// panel calls (run a command, AUTO tasks, kill and resume, status, record and
// replay a macro), and the approve / deny endpoint. The rules themselves are in lib/claw-core.js.
//
// Moved out of server.js. The few things these routes need from the rest of
// the server are passed in, so this file never imports server.js:
//   gridScreenshot(b64, deviceId)   a screenshot with the click grid drawn on
//   captureScreen(deviceId, opts)   ask a relay for a screenshot
//   callAI(messages, provider, model, opts)
//   getActiveModel()                what the model switcher last picked
//   runRoutineNowOrLater(name, runs, deviceId)

import crypto from "crypto";
import * as auth from "./auth.js";
import * as triggers from "./triggers.js";
import * as clawGrid from "./claw-grid.js";
import * as clawAuto from "./claw-auto.js";
import * as clawHistory from "./claw-history.js";
import {
  clawQueue, clawRelays, isKilled, setKilled, nextClawId, gridFor, _parseChatClawInput, CLAW_HELP,
  liveClawRelays, pickRelay, queueClaw, pendingClawResults, awaitClawResult, clawWaitMs,
  clawConfirmReason, describeClaw, pendingConfirms, CONFIRM_TTL_MS, createConfirm, publicConfirm,
  truncateOut, withCell, pendingScreenshotResolvers, startMacro, stopMacro,
} from "./claw-core.js";

/** Adds the routes to `app`. Returns the maps /api/health/details counts. */
export function mountClawRoutes(app, { gridScreenshot, captureScreen, callAI, getActiveModel, runRoutineNowOrLater, startCliJob }) {
  app.post("/api/claw/relay/register", (req, res) => {
    const { deviceId, platform, hostname, relayType, browser, arch } = req.body;
    if (!deviceId) return res.json({ error: "No deviceId" });
    const inferredType =
      relayType ||
      (deviceId.startsWith("esp32")
        ? "esp32"
        : deviceId.startsWith("electron")
        ? "electron"
        : "node");
    clawRelays.set(deviceId, {
      platform,
      hostname,
      browser,
      arch,
      relayType: inferredType,
      lastSeen: Date.now(),
    });
    if (!clawQueue.has(deviceId)) clawQueue.set(deviceId, []);
    console.log(
      `[CLAW] Relay connected: ${deviceId} (${inferredType} / ${platform})`,
    );
    res.json({ ok: true, killed: isKilled() });
  });

  // Relay heartbeat — keeps relay marked as live; stores telemetry from device
  app.post("/api/claw/relay/heartbeat", (req, res) => {
    const { deviceId, ble, uptimeMs, rssi, freeHeap, ssid } = req.body;
    if (!deviceId) return res.json({ error: "no_device_id" });
    if (!clawRelays.has(deviceId)) {
      // Tell the client to re-register; server might have restarted
      return res.json({
        ok: false,
        needsRegister: true,
        error: "unknown_device",
      });
    }
    const relay = clawRelays.get(deviceId);
    relay.lastSeen = Date.now();
    if (ble !== undefined) relay.ble = ble;
    if (uptimeMs !== undefined) relay.uptimeMs = uptimeMs;
    if (rssi !== undefined) relay.rssi = rssi;
    if (freeHeap !== undefined) relay.freeHeap = freeHeap;
    if (ssid !== undefined) relay.ssid = ssid;
    res.json({ ok: true, killed: isKilled(), ...contextRequest() });
  });

  // What's in front on the PC, for app triggers (lib/triggers.js). Only sent
  // while wantContext is true; only from a registered relay.
  app.post("/api/claw/relay/context", (req, res) => {
    const { deviceId, app: fgApp, title, idleSec } = req.body || {};
    if (!deviceId || !clawRelays.has(deviceId)) return res.status(404).json({ error: "unknown_device" });
    triggers.reportContext({ app: fgApp, title, idleSec, device: deviceId }).catch(() => {});
    res.json({ ok: true, ...contextRequest() });
  });

  /**
   * What the relay is asked to report: nothing unless an app rule's window is
   * open (or opens within minutes), and then the window title only when it
   * contains one of the rules' words. The app's name is always sent.
   */
  function contextRequest() {
    const want = triggers.wantsContext();
    return want ? { wantContext: true, contextMatch: triggers.contextMatchWords() } : { wantContext: false };
  }

  // Relay unregisters on Ctrl+C
  app.post("/api/claw/relay/unregister", (req, res) => {
    clawRelays.delete(req.body.deviceId);
    clawQueue.delete(req.body.deviceId);
    res.json({ ok: true });
  });

  // Relay reports result of executed command
  app.post("/api/claw/relay/result", (req, res) => {
    const { screenshot, fname, bounds, monitors, deviceId, cmdId, result } = req.body;
    if (screenshot && deviceId) {
      // Store latest screenshot per device for POV feed
      if (!global.clawScreenshots) global.clawScreenshots = new Map();
      global.clawScreenshots.set(deviceId, {
        b64: screenshot,
        fname: fname || "",
        bounds: bounds || null,
        monitors: Array.isArray(monitors) ? monitors.slice(0, 16) : [],
        ts: Date.now(),
      });
      // Resolve the pipeline waiting on this screenshot. The node relay names
      // the command; the screen watcher can't know which command triggered the
      // capture (and posts under its own deviceId, which is why matching on
      // deviceId never fired for the ESP32), so it takes the oldest waiter.
      const key =
        cmdId && pendingScreenshotResolvers.has(cmdId)
          ? cmdId
          : pendingScreenshotResolvers.keys().next().value;
      const entry = key && pendingScreenshotResolvers.get(key);
      if (entry) {
        clearTimeout(entry.timer);
        entry.resolve(screenshot);
        pendingScreenshotResolvers.delete(key);
      }
    }
    if (cmdId) clawHistory.result(cmdId, screenshot ? "screenshot" : result);
    const waiter = cmdId && pendingClawResults.get(cmdId);
    if (waiter) {
      clearTimeout(waiter.timer);
      pendingClawResults.delete(cmdId);
      waiter.resolve(String(result ?? "ok"));
    }
    res.json({ ok: true });
  });

  // Latest screenshot for POV feed in claw panel
  // ?grid=1: the same picture with the grid ARIA clicks by (lib/claw-grid.js),
  // so you can see what it sees; that grid becomes the one "click: F7" uses.
  app.get("/api/claw/screenshot", async (req, res) => {
    const shots = global.clawScreenshots;
    if (!shots || shots.size === 0) return res.json({ ok: false });
    // Return most recent across all devices
    let latest = null;
    let latestId = null;
    for (const [id, v] of shots) {
      if (!latest || v.ts > latest.ts) [latest, latestId] = [v, id];
    }
    if (req.query.grid) {
      const g = await gridScreenshot(latest.b64, latestId);
      return res.json({ ok: true, image: g.image, grid: g.spec, ts: latest.ts, bounds: latest.bounds });
    }
    res.json({ ok: true, b64: latest.b64, ts: latest.ts, bounds: latest.bounds });
  });

  // Relay live config (pushed from claw panel sliders, returned in every queue poll)
  let relayConfig = { typeDelay: 25, mouseSpeed: 1, monitorIdx: -1 };

  // POST /api/claw/config — claw panel sliders push updates here
  app.post("/api/claw/config", (req, res) => {
    const { typeDelay, mouseSpeed, monitorIdx } = req.body;
    if (typeDelay != null) relayConfig.typeDelay = Number(typeDelay);
    if (mouseSpeed != null) relayConfig.mouseSpeed = Number(mouseSpeed);
    if (monitorIdx != null) relayConfig.monitorIdx = Number(monitorIdx);
    res.json({ ok: true, config: relayConfig });
  });

  // Relay polls this for pending commands
  app.get("/api/claw/queue", (req, res) => {
    const { deviceId } = req.query;
    if (!deviceId) return res.json({ commands: [] });
    const q = clawQueue.get(deviceId) || [];
    clawQueue.set(deviceId, []); // clear after sending
    res.json({ commands: q, killed: isKilled(), config: relayConfig });
  });

  // Kill switch — clears all queues, locks relay
  app.post("/api/claw/kill", (req, res) => {
    setKilled(true);
    for (const [k] of clawQueue) clawQueue.set(k, []);
    console.log("[CLAW] ⬡ KILL SWITCH ACTIVATED");
    res.json({ ok: true });
  });

  // Resume after kill
  app.post("/api/claw/resume", (req, res) => {
    setKilled(false);
    console.log("[CLAW] Resumed");
    res.json({ ok: true });
  });

  // Status — used by claw.js UI to show relay connection
  app.get("/api/claw/status", (req, res) => {
    const relays = [...clawRelays.entries()]
      .filter(([, v]) => Date.now() - v.lastSeen < 20000)
      .map(([id, v]) => ({
        id,
        platform: v.platform,
        hostname: v.hostname,
        relayType: v.relayType || "node",
        browser: v.browser,
      }));
    res.json({
      killed: isKilled(),
      relays,
      disabled: !auth.dangerousAllowed(),
      // Approvals raised where no dialog could show (background tasks)
      // surface through the panel's status poll.
      pendingConfirms: [...pendingConfirms.values()]
        .filter((v) => Date.now() - v.created <= CONFIRM_TTL_MS)
        .map(publicConfirm),
    });
  });

  // Manual dispatch from Claw panel (AI task or direct mode)
  app.post("/api/claw", async (req, res) => {
    const { input, mode = "ai" } = req.body;
    if (!input) return res.json({ error: "No input." });
    if (isKilled())
      return res.json({
        error: "Claw is killed. Click RESUME in the Claw panel.",
      });

    if (!auth.dangerousAllowed())
      return res.json({ error: auth.DANGEROUS_DISABLED_MSG });
    // Prefer ESP32 if available, otherwise the PC relay (never the screen watcher)
    const tid = pickRelay({ preferEsp32: true });

    // AUTO (and the old "ai" mode): a model picks the mode for each step,
    // runs it, looks at the result and carries on (lib/claw-auto.js). The
    // panel follows along through /api/claw/auto/:id.
    if (mode === "auto" || mode === "ai") {
      if (!tid)
        return res.json({
          error: process.env.ARIA_DESKTOP
            ? 'PC control is off. Turn it on in the Claw panel ("Turn on PC control").'
            : "No relay connected. Run claw-relay.js on your machine, or turn on PC control.",
        });
      const job = startClawAuto(input, { maxSteps: req.body.maxSteps, deviceId: tid });
      return res.json({ jobId: job.id, output: "Working on it…", relayConnected: true });
    }

    // Direct modes: shell, type, hotkey, mouse
    if (!tid)
      return res.json({
        error: process.env.ARIA_DESKTOP
          ? 'PC control is off. Turn it on in the Claw panel ("Turn on PC control").'
          : "No relay connected. Run claw-relay.js on your machine, or flash and pair the ESP32 relay.",
      });
    // Mouse mode takes "move X Y | click F7 | scroll up 3 | pos"; "line" is
    // raw Claw syntax (the quick buttons); the rest are "<mode>: <input>".
    const line =
      mode === "line"
        ? input.trim()
        : mode === "mouse"
        ? input.trim().replace(
            /^(move|click|right_click|double_click|scroll|drag)\s+/i,
            (_, verb) => verb.toLowerCase() + ": ",
          )
        : mode + ": " + input;
    const cmd = _parseChatClawInput(line, tid);
    if (cmd.type === "unknown")
      return res.json({ error: cmd.hint ? `Can't run "${cmd.raw}": ${cmd.hint}.` : `Unknown command "${cmd.raw}". Valid: ${CLAW_HELP}` });
    const why = clawConfirmReason(cmd);
    if (why) {
      const c = createConfirm("claw", { cmd, deviceId: tid }, describeClaw(cmd), why);
      return res.json({ output: `Needs your OK — ${why}.`, confirm: publicConfirm(c), relayConnected: true });
    }
    queueClaw(tid, cmd);
    // Wait briefly for what it did, so the panel shows a result, not "queued".
    const out = cmd.type === "screenshot" ? null : await awaitClawResult(cmd.id, Math.min(clawWaitMs(cmd) || 0, 8000));
    return res.json({
      output: out == null ? "Queued: " + cmd.type : `${describeClaw(cmd)} → ${truncateOut(withCell(cmd, out), 1500)}`,
      queued: [cmd.type],
      relayConnected: true,
    });
  });

  /* ── Claw AUTO jobs (lib/claw-auto.js) ─────────────────────────
     One job per task typed in the panel. The panel polls the log; the kill
     switch or the panel's stop button ends it between steps. */
  const clawAutoJobs = new Map(); // id → { id, task, status, log, stop, created }

  function startClawAuto(task, { maxSteps, deviceId }) {
    for (const [k, j] of clawAutoJobs) if (Date.now() - j.created > 60 * 60_000) clawAutoJobs.delete(k);
    const job = { id: "auto_" + crypto.randomBytes(5).toString("hex"), task, status: "running", log: [], stop: false, created: Date.now() };
    clawAutoJobs.set(job.id, job);
    const push = (e) => job.log.push({ ...e, i: job.log.length, ts: Date.now() });
    const relay = () => (liveClawRelays().some(([k]) => k === deviceId) ? deviceId : pickRelay());
    const info = clawRelays.get(deviceId) || {};
    const provider = getActiveModel().provider;
    const model = getActiveModel().model;

    clawAuto
      .runAuto(
        task,
        {
          // With a screenshot in the messages callAI goes to callVision, which
          // finds a provider that can see (Groq → Cloudflare → OpenRouter).
          ai: (msgs) => callAI(msgs, provider, model, {}),
          parse: (line) => _parseChatClawInput(line, relay()),
          stopped: () => job.stop || isKilled() || !auth.dangerousAllowed(),
          needsOk: (cmd, { looked }) =>
            clawConfirmReason(cmd) ||
            // After a look at the screen, text on it could be steering the
            // model: shell commands then wait for the owner.
            (looked && cmd.type === "shell" ? "it looked at your screen first, and anything on a screen could be steering it" : null),
          askOk: (cmd, reason) => {
            const c = createConfirm("claw", { cmd, deviceId: relay() }, describeClaw(cmd), reason);
            push({ label: "CONFIRM", text: `Waiting for your OK: ${c.summary}`, mode: "confirm", confirm: publicConfirm(c) });
            return waitForConfirm(c.id);
          },
          exec: async (cmd) => {
            const tid = relay();
            if (!tid) return { text: "ERROR: the relay disconnected" };
            if (cmd.type === "screenshot") {
              const b64 = await captureScreen(tid, { cmd, ms: 15000 });
              if (!b64) return { text: "ERROR: no screenshot came back within 15s" };
              const shot = await gridScreenshot(b64, tid);
              const s = shot.spec;
              return { image: shot.image, text: s ? `screenshot attached — grid ${s.cols}×${s.rows}, A1 at ${s.x},${s.y}. ${shot.note}` : "screenshot attached (no grid)" };
            }
            queueClaw(tid, cmd);
            const out = await awaitClawResult(cmd.id, clawWaitMs(cmd) || 10000);
            return { text: out == null ? "no result back in time (it may still be running)" : withCell(cmd, out) };
          },
          log: push,
        },
        {
          maxSteps,
          system: clawAuto.autoSystem({ platform: info.platform, hostname: info.hostname, relayType: info.relayType, maxSteps: clawAutoMax(maxSteps) }),
        },
      )
      .then((r) => {
        job.status = r.status;
        push({ label: r.status === "done" ? "DONE" : r.status.toUpperCase(), text: `${r.say} (${r.steps} step${r.steps === 1 ? "" : "s"})`, mode: r.status === "done" ? "done" : "error" });
      })
      .catch((e) => {
        job.status = "error";
        push({ label: "ERROR", text: e.message, mode: "error" });
      });
    return job;
  }
  const clawAutoMax = (n) => Math.max(1, Math.min(clawAuto.MAX_STEPS, Math.round(Number(n) || clawAuto.DEFAULT_MAX_STEPS)));

  app.get("/api/claw/auto/:id", (req, res) => {
    const job = clawAutoJobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: "No such task (finished over an hour ago?)." });
    const after = Number(req.query.after ?? -1);
    res.json({ id: job.id, status: job.status, log: job.log.filter((e) => e.i > after) });
  });

  app.post("/api/claw/auto/:id/stop", (req, res) => {
    const job = clawAutoJobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: "No such task." });
    job.stop = true;
    res.json({ ok: true });
  });

  // id → resolve({ approved, output }): an AUTO task waiting on an approval.
  const confirmWaiters = new Map();
  function waitForConfirm(id) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        confirmWaiters.delete(id);
        resolve({ approved: false, output: "no answer in time" });
      }, CONFIRM_TTL_MS);
      confirmWaiters.set(id, (r) => {
        clearTimeout(timer);
        confirmWaiters.delete(id);
        resolve(r);
      });
    });
  }

  // Approve or deny a held claw command. The client
  // only sends the id — what runs is exactly what was proposed.
  async function resolveConfirm(req, res) {
    // An AUTO task may be waiting on this one: tell it how it went.
    const waiter = confirmWaiters.get(req.body?.id);
    if (waiter) {
      const json = res.json.bind(res);
      res.json = (r) => {
        waiter({ approved: !!req.body?.approved && r?.ok !== false && r?.message !== "Cancelled.", output: r?.output || r?.error || r?.message });
        return json(r);
      };
    }
    const { id, approved } = req.body || {};
    const c = id && pendingConfirms.get(id);
    if (!c) return res.json({ ok: false, error: "No such pending action (expired or already handled)." });
    pendingConfirms.delete(id);
    if (!approved) return res.json({ ok: true, message: "Cancelled." });
    if (Date.now() - c.created > CONFIRM_TTL_MS)
      return res.json({ ok: false, error: "That approval expired — ask ARIA again." });
    if (!auth.dangerousAllowed()) return res.json({ ok: false, error: auth.DANGEROUS_DISABLED_MSG });

    if (isKilled()) return res.json({ ok: false, error: "Claw is killed. Click RESUME first." });
    if (c.kind === "cli") {
      const out = startCliJob(c.payload);
      return res.json({ ok: out.ok, queued: `${c.payload.agent} ${c.payload.mode}`, output: out.message, error: out.error });
    }
    if (c.kind === "routine") {
      const out = await runRoutineNowOrLater(c.payload.name, c.payload.runs, c.payload.deviceId);
      return res.json({ ok: !out.error, queued: `routine ${c.payload.name}`, output: truncateOut(out.text, 3000), error: out.error });
    }
    const live = liveClawRelays().map(([k]) => k);
    const tid = live.includes(c.payload.deviceId) ? c.payload.deviceId : pickRelay();
    if (!tid) return res.json({ ok: false, error: "No relay connected." });
    const cmd = { ...c.payload.cmd, id: nextClawId() };
    queueClaw(tid, cmd);
    const out = await awaitClawResult(cmd.id, clawWaitMs(cmd) || 1000);
    res.json({
      ok: true,
      queued: cmd.type,
      output: out == null ? "Queued — no result yet." : truncateOut(out, 2000),
    });
  }
  app.post("/api/confirm", resolveConfirm);
  app.post("/api/claw/confirm", resolveConfirm); // older clients

  app.get("/api/confirm/pending", (_req, res) => {
    for (const [k, v] of pendingConfirms)
      if (Date.now() - v.created > CONFIRM_TTL_MS) pendingConfirms.delete(k);
    res.json({ pending: [...pendingConfirms.values()].map(publicConfirm) });
  });

  /* ── Macros: record sequences of claw commands and replay them ── */
  app.post("/api/claw/macro/record", (req, res) => {
    // A recording belongs to one chat: steps ARIA takes in any other don't go in.
    if (typeof req.body?.chatId !== "string" || !req.body.chatId)
      return res.status(400).json({ error: "Open the chat to record in first." });
    startMacro(req.body.chatId);
    console.log("[MACRO] Recording started");
    res.json({ ok: true });
  });

  app.post("/api/claw/macro/stop", (_, res) => {
    const steps = stopMacro();
    console.log(`[MACRO] Recording stopped (${steps.length} steps)`);
    res.json({ ok: true, steps });
  });

  app.post("/api/claw/macro/run", (req, res) => {
    const { steps, deviceId } = req.body;
    if (!Array.isArray(steps) || !steps.length)
      return res.status(400).json({ error: "steps array required" });

    if (!auth.dangerousAllowed())
      return res.status(403).json({ error: auth.DANGEROUS_DISABLED_MSG });
    if (isKilled()) return res.status(409).json({ error: "Claw is killed. Click RESUME first." });
    // Replayed blindly, so it gets no exemption from the rules chat follows:
    // anything that would need an OK there is refused here. Routines
    // (/api/routines) ask for that OK instead.
    const risky = steps.map((st) => clawConfirmReason({ ...st })).filter(Boolean);
    if (risky.length)
      return res.status(409).json({ error: `This recording has a step that needs your OK (${risky[0]}). Teach it as a routine in the Routines panel, which asks first.` });
    const tid = deviceId || pickRelay();
    if (!tid) return res.status(503).json({ error: "No relay connected" });

    // Queue all steps with small delays between them. Through queueClaw, so a
    // replayed recording is in the Claw log like any other command.
    steps.forEach((step, i) => {
      queueClaw(tid, { ...step, id: `macro_${Date.now()}_${i}` });
      // Insert a short wait between steps so they don't pile up
      if (i < steps.length - 1) queueClaw(tid, { type: "wait", ms: 150, id: `macro_wait_${i}` });
    });
    console.log(`[MACRO] Queued ${steps.length} steps to relay ${tid}`);
    res.json({ ok: true, queued: steps.length });
  });

  return { clawAutoJobs, confirmWaiters };
}
