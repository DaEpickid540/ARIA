// lib/upgrade-routes.js — the HTTP side of the HUD, reminders, focus,
// search, usage, the Claw flight recorder and backups
// ═══════════════════════════════════════════════════════════════════
//
// server.js owns the state these read (chats, memory, the relay map, the
// model) and passes it in as `deps`, the way it does for lib/keys.js and
// lib/tts.js. Every route here sits behind the same guards as the rest of
// /api (auth.apiGuard is mounted before this).
// ═══════════════════════════════════════════════════════════════════

import * as reminders from "./reminders.js";
import * as focus from "./focus.js";
import * as usage from "./usage.js";
import * as clawHistory from "./claw-history.js";
import * as backup from "./backup.js";
import * as hud from "./hud.js";
import { searchAll, formatHits } from "./search.js";
import { parseAppsText } from "./claw-apps.js";

const fail = (res, e, code = 400) => res.status(code).json({ error: e?.message || String(e) });

/** The snapshot lib/hud.js reads: everything, as plain numbers and lines. */
export function hudSnapshot(deps, now = Date.now()) {
  const sys = deps.system();
  const u = usage.summary({ days: 1, now }).today;
  const tasks = deps.taskStats();
  const st = focus.stats(now);
  return {
    cpu: sys.cpu,
    mem: sys.mem,
    relay: deps.relay(),
    model: deps.model(),
    confirms: deps.confirms(),
    tasks: { running: tasks.runningNow || 0, awaiting: tasks.byStatus?.awaiting_approval || 0, total: tasks.total || 0 },
    watchers: deps.watcherCount(),
    reminders: reminders.upcoming(5),
    focus: { active: focus.active(now), held: focus.heldCount(), todayMin: st.todayMin, streak: st.streak, week: st.week, quiet: focus.quietNow(now), hold: focus.holdReason(now) },
    grades: deps.gradesFocus(),
    cards: deps.cardsDue(),
    practice: deps.practice(),
    usage: { calls: u.calls, fails: u.fails, failRate: u.failRate, avgMs: u.avgMs, tokens: u.inTok + u.outTok },
    claw: clawHistory.stats(now),
  };
}

export function mountUpgradeRoutes(app, deps) {
  /* ── HUD ─────────────────────────────────────────────────── */
  app.get("/api/hud", (_req, res) => {
    const now = Date.now();
    const s = hudSnapshot(deps, now);
    const list = hud.priorities(s, now);
    res.set("Cache-Control", "no-store");
    res.json({
      ...s,
      now,
      greeting: hud.greeting(now),
      owner: deps.ownerName(),
      host: deps.system().host,
      uptimeSec: deps.system().uptimeSec,
      history: hud.history(),
      trend: { cpu: hud.trend("cpu"), mem: hud.trend("mem") },
      priorities: list,
      state: hud.overall(list),
    });
  });

  app.get("/api/hud/report", (_req, res) => res.json({ text: hud.statusReport(hudSnapshot(deps)) }));

  /* ── reminders ───────────────────────────────────────────── */
  app.get("/api/reminders", (_req, res) => {
    const now = Date.now();
    res.json({ reminders: reminders.list().map((r) => ({ ...r, when: reminders.fmtWhen(r.at, now), repeats: reminders.describeRepeat(r.repeat) })) });
  });
  app.post("/api/reminders", (req, res) => {
    try {
      const r = reminders.add({ when: req.body?.when, text: req.body?.text });
      res.json({ ok: true, reminder: r, text: `"${r.text}" ${reminders.fmtWhen(r.at)}${r.repeat ? `, then ${reminders.describeRepeat(r.repeat)}` : ""}` });
    } catch (e) {
      fail(res, e);
    }
  });
  app.post("/api/reminders/:id/snooze", (req, res) => {
    // A one-off that has rung is gone from the list; the toast sends its text.
    const r = reminders.snooze(reminders.find(req.params.id) ? req.params.id : { text: req.body?.text }, req.body?.minutes);
    if (!r) return fail(res, new Error("No such reminder."), 404);
    res.json({ ok: true, reminder: r, text: `Snoozed: ${reminders.fmtWhen(r.at)}` });
  });
  app.delete("/api/reminders/:id", (req, res) => (reminders.remove(req.params.id) ? res.json({ ok: true }) : fail(res, new Error("No such reminder."), 404)));

  /* ── focus + quiet hours ─────────────────────────────────── */
  const focusState = () => ({ active: focus.active(), stats: focus.stats(), sessions: focus.sessions(12), settings: focus.settings(), held: focus.heldCount(), hold: focus.holdReason(), canClose: !!deps.relay().connected });
  app.get("/api/focus", (_req, res) => res.json(focusState()));
  app.post("/api/focus/start", async (req, res) => {
    try {
      const s = await focus.start({ minutes: req.body?.minutes, goal: req.body?.goal });
      res.json({ ok: true, ...focusState(), closed: s.closed });
    } catch (e) {
      fail(res, e);
    }
  });
  app.post("/api/focus/stop", (req, res) => {
    const s = focus.stop({ completed: !!req.body?.completed });
    focus.tick(); // hand back anything that was held
    res.json({ ok: true, session: s, ...focusState() });
  });
  app.post("/api/focus/settings", (req, res) => {
    focus.setSettings(req.body || {});
    focus.tick();
    res.json({ ok: true, ...focusState() });
  });

  /* ── search ──────────────────────────────────────────────── */
  app.get("/api/search", (req, res) => {
    const q = String(req.query.q || "").slice(0, 200);
    if (q.trim().length < 2) return res.json({ q, hits: [] });
    const kinds = req.query.kinds ? String(req.query.kinds).split(",") : null;
    res.json({ q, hits: searchAll(q, deps.searchSources(), { limit: Number(req.query.limit) || 30, kinds }) });
  });

  /* ── usage ───────────────────────────────────────────────── */
  app.get("/api/usage", (req, res) => res.json(usage.summary({ days: Number(req.query.days) || 7 })));

  /* ── Claw: what's open, and the flight recorder ──────────── */
  app.get("/api/claw/apps", async (_req, res) => {
    try {
      const out = await deps.clawRun("apps");
      if (/^ERROR/i.test(out)) return res.json({ ok: false, error: out.replace(/^ERROR:\s*/i, "") });
      res.json({ ok: true, apps: parseAppsText(out), text: out });
    } catch (e) {
      res.json({ ok: false, error: e.message });
    }
  });
  app.post("/api/claw/apps/close", async (req, res) => {
    const app_ = String(req.body?.app || "").trim();
    if (!app_) return fail(res, new Error("Which app?"));
    try {
      const out = await deps.clawRun(`close: ${app_}`);
      res.json({ ok: !/^ERROR/i.test(out), output: out });
    } catch (e) {
      res.json({ ok: false, error: e.message });
    }
  });
  app.get("/api/claw/history", (req, res) => res.json({ entries: clawHistory.list(Number(req.query.limit) || 100), stats: clawHistory.stats() }));
  app.delete("/api/claw/history", (_req, res) => {
    clawHistory.clear();
    res.json({ ok: true });
  });
  // Chosen entries → a routine (checked like any other routine before it's saved).
  app.post("/api/claw/history/routine", (req, res) => {
    try {
      const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
      const steps = clawHistory.stepsOf(ids, deps.clawInputOf);
      if (!steps.length) throw new Error("None of those can be a routine step (pick commands that ran).");
      const r = deps.saveRoutine({ name: req.body?.name, description: req.body?.description || "Saved from the Claw history", steps });
      res.json({ ok: true, routine: r });
    } catch (e) {
      fail(res, e);
    }
  });

  /* ── backup ──────────────────────────────────────────────── */
  app.get("/api/backup", (_req, res) => res.json({ snapshots: backup.listSnapshots(), keep: backup.KEEP_DAILY }));
  app.post("/api/backup", (_req, res) => {
    try {
      deps.flushAll();
      res.json({ ok: true, snapshot: backup.writeSnapshot(), snapshots: backup.listSnapshots() });
    } catch (e) {
      fail(res, e, 500);
    }
  });
  app.get("/api/backup/download", (req, res) => {
    try {
      deps.flushAll();
      const doc = req.query.name ? backup.readSnapshot(req.query.name) : backup.bundle();
      const name = req.query.name ? String(req.query.name) : `aria-backup-${new Date().toISOString().slice(0, 10)}.json`;
      res.setHeader("Content-Disposition", `attachment; filename="${name.replace(/[^\w.-]/g, "")}"`);
      res.type("application/json").send(JSON.stringify(doc));
    } catch (e) {
      fail(res, e, 404);
    }
  });
  // Overwrites ARIA's data, so it's held to the same switch as PC control.
  app.post("/api/backup/restore", (req, res) => {
    if (!deps.dangerousAllowed()) return fail(res, new Error(deps.dangerousMsg), 403);
    try {
      const doc = req.body?.name ? backup.readSnapshot(req.body.name) : req.body?.backup;
      const out = backup.restore(doc, { only: Array.isArray(req.body?.only) ? req.body.only.map(String) : null });
      res.json({ ok: true, ...out, note: "Restart ARIA to load the restored data." });
    } catch (e) {
      fail(res, e);
    }
  });
}

/**
 * The tools these features add, for server.js's serverTool().
 * @returns {Promise<string>|string|undefined} undefined = not one of ours.
 */
export function upgradeTool(key, input, deps) {
  if (/^(remind(er)?s?)(\s+(list|cancel|remove|delete|stop|clear))?$/.test(key)) return reminders.runReminderTool(key, input);
  if (/^focus(\s+(start|stop|end|cancel|status|summary|apps|quiet))?$/.test(key)) return focus.runFocusTool(key, input);
  if (key === "find" || key === "recall") {
    const q = String(input || "").trim();
    if (q.length < 2) return "Find what? e.g. find | kiosk pathfinding";
    return formatHits(q, searchAll(q, deps.searchSources(), { limit: 8 }));
  }
  if (key === "usage") return usage.runUsageTool(key, input);
  if (key === "status" || key === "status report" || key === "sitrep") return hud.statusReport(hudSnapshot(deps));
  return undefined;
}
