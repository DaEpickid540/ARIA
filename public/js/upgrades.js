// upgrades.js — the panels for reminders, focus, usage, the Claw log and
// backups; reminder toasts with Snooze; and the Claw panel's APPS row
// ═══════════════════════════════════════════════════════════════════
//
// These open from the HUD as well as the console, so they don't use the
// console's quick modal (chat.js, loaded only once you enter it): this file
// has its own small overlay and loads at unlock.
// ═══════════════════════════════════════════════════════════════════

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const $ = (id) => document.getElementById(id);

async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: { "Content-Type": "application/json", ...(opts.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}
const post = (path, body = {}) => api(path, { method: "POST", body: JSON.stringify(body) });

/** A short notice. The console's toast when it's loaded, ours otherwise. */
export function toast(msg, icon = "✓") {
  if (window.ARIA_showToast) return window.ARIA_showToast(msg, icon);
  let el = $("upToast");
  if (!el) {
    el = Object.assign(document.createElement("div"), { id: "upToast" });
    el.setAttribute("role", "status");
    document.body.appendChild(el);
  }
  el.textContent = `${icon} ${msg}`;
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), 2600);
}

const ago = (at) => {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(at).toLocaleDateString([], { month: "short", day: "numeric" });
};
const kTok = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
const bytes = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/* ── the overlay ─────────────────────────────────────────────── */

let _current = null; // the open panel's name
let _refresh = null; // its "draw again"
let _tick = null;

function overlay() {
  let o = $("upOverlay");
  if (o) return o;
  o = document.createElement("div");
  o.id = "upOverlay";
  o.className = "upOverlay";
  o.innerHTML = `<div class="upPanel" role="dialog" aria-modal="true" aria-labelledby="upTitle">
      <div class="upHead"><h2 id="upTitle"></h2><button class="upClose" type="button" aria-label="Close">✕</button></div>
      <div class="upBody" id="upBody"></div>
    </div>`;
  document.body.appendChild(o);
  o.addEventListener("click", (e) => {
    if (e.target === o || e.target.closest(".upClose")) closePanel();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && o.classList.contains("open")) {
      e.stopPropagation();
      closePanel();
    }
  }, true);
  return o;
}

export function closePanel() {
  $("upOverlay")?.classList.remove("open");
  clearInterval(_tick);
  _current = _refresh = null;
}

const PANELS = {
  reminders: { title: "Reminders", draw: drawReminders },
  focus: { title: "Focus", draw: drawFocus, every: 1000 },
  usage: { title: "Model usage", draw: drawUsage },
  history: { title: "Claw log", draw: drawHistory },
  backup: { title: "Backup", draw: drawBackup },
};

export async function openPanel(name) {
  const p = PANELS[name];
  if (!p) return;
  const o = overlay();
  _current = name;
  $("upTitle").textContent = p.title;
  const body = $("upBody");
  body.innerHTML = `<p class="upHint">Loading…</p>`;
  body.onclick = body.onsubmit = body.onchange = null;
  o.classList.add("open");
  clearInterval(_tick);
  _refresh = async () => {
    if (_current !== name) return;
    try {
      await p.draw(body);
    } catch (e) {
      body.innerHTML = `<p class="upErr">Couldn't load: ${esc(e.message)}</p>`;
    }
  };
  await _refresh();
  o.querySelector(".upClose")?.focus({ preventScroll: true });
  body.querySelector("[data-autofocus]")?.focus();
}

/* ── reminders ───────────────────────────────────────────────── */

async function drawReminders(body) {
  const { reminders } = await api("/api/reminders");
  body.innerHTML = `
    <p class="upHint">ARIA keeps the clock, so these ring even when this page is closed. You can also just say it: <i>"remind me at 5 to call mom"</i>.</p>
    <form class="upForm" data-form="remind" autocomplete="off">
      <input name="when" placeholder="When: in 20m · 5pm · tomorrow 8am · every weekday 7am" required maxlength="60" data-autofocus />
      <input name="text" placeholder="What" required maxlength="300" />
      <button type="submit" class="upBtn primary">Add</button>
    </form>
    <div class="upList">${
      reminders.length
        ? reminders
            .map(
              (r) => `<div class="upRow">
                <i class="bi bi-${r.repeat ? "arrow-repeat" : "alarm"}" aria-hidden="true"></i>
                <div class="upRowMain"><b>${esc(r.text)}</b><span>${esc(r.when)}${r.repeats ? ` · ${esc(r.repeats)}` : ""}</span></div>
                <button class="upBtn" data-del="${esc(r.id)}" title="Cancel this reminder">Cancel</button>
              </div>`,
            )
            .join("")
        : `<p class="upEmpty">No reminders set.</p>`
    }</div>`;
  body.onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      const d = await post("/api/reminders", { when: f.when.value, text: f.text.value });
      toast(d.text, "⏰");
      _refresh?.();
    } catch (err) {
      toast(err.message, "✗");
    }
  };
  body.onclick = async (e) => {
    const id = e.target.closest("[data-del]")?.dataset.del;
    if (!id) return;
    await api(`/api/reminders/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {});
    _refresh?.();
  };
}

/* ── focus ───────────────────────────────────────────────────── */

let _focus = null;
let _focusAt = 0;

function focusClock() {
  const el = $("upFocusClock");
  const a = _focus?.active;
  if (!el || !a) return;
  const left = Math.max(0, a.leftMs - (Date.now() - _focusAt));
  el.textContent = `${String(Math.floor(left / 60000)).padStart(2, "0")}:${String(Math.floor((left % 60000) / 1000)).padStart(2, "0")}`;
  if (left <= 0) _refresh?.();
}

async function drawFocus(body) {
  _focus = await api("/api/focus");
  _focusAt = Date.now();
  const { active, stats, settings, sessions, held, canClose } = _focus;
  const peak = Math.max(30, ...stats.week.map((d) => d.minutes));
  body.innerHTML = `
    ${
      active
        ? `<div class="upFocusNow">
             <div id="upFocusClock" class="upFocusClock">--:--</div>
             <div class="upRowMain"><b>${esc(active.goal || "Focus block")}</b><span>${active.minutes} min block${active.closed?.length ? ` · closed ${esc(active.closed.join(", "))}` : ""}${held ? ` · ${held} alert${held === 1 ? "" : "s"} held` : ""}</span></div>
             <button class="upBtn" data-act="stop">Stop</button>
           </div>`
        : `<form class="upForm" data-form="start" autocomplete="off">
             <input name="goal" placeholder="What are you working on? (optional)" maxlength="120" data-autofocus />
             <input name="minutes" type="number" min="1" max="240" value="25" title="Minutes" style="max-width:86px" />
             <button type="submit" class="upBtn primary">Start</button>
           </form>`
    }
    <div class="upStats">
      <div><b>${stats.todayMin}</b><span>min today</span></div>
      <div><b>${stats.weekMin}</b><span>min this week</span></div>
      <div><b>${stats.streak}</b><span>day streak</span></div>
    </div>
    <div class="upBars" aria-label="Minutes focused, last 7 days">${stats.week
      .map((d) => `<div title="${esc(d.day)}: ${d.minutes} min"><i style="height:${Math.round((d.minutes / peak) * 100)}%"></i><span>${esc(new Date(d.day + "T12:00:00").toLocaleDateString([], { weekday: "narrow" }))}</span></div>`)
      .join("")}</div>

    <h3 class="upSub">When a block starts</h3>
    <form class="upForm upFormCol" data-form="settings" autocomplete="off">
      <label>Close these apps <input name="apps" value="${esc(settings.apps.join(", "))}" placeholder="Discord, Spotify, Steam" maxlength="300" /></label>
      <p class="upHint">${canClose ? "They're asked to close (an app with unsaved work can still ask to save)." : "PC control is off right now, so a block won't close anything."}</p>
      <label class="upCheck"><input type="checkbox" name="holdAlerts" ${settings.holdAlerts ? "checked" : ""} /> Hold ARIA's alerts until the block ends</label>
      <h3 class="upSub">Quiet hours</h3>
      <label class="upCheck"><input type="checkbox" name="quiet" ${settings.quiet.enabled ? "checked" : ""} /> Hold alerts from
        <input name="from" type="number" min="0" max="23" value="${settings.quiet.from}" class="upHour" aria-label="From hour" />:00 to
        <input name="to" type="number" min="0" max="23" value="${settings.quiet.to}" class="upHour" aria-label="To hour" />:00</label>
      <p class="upHint">Held alerts arrive together afterwards. Reminders you set still ring.</p>
      <div><button type="submit" class="upBtn">Save</button></div>
    </form>
    ${
      sessions.length
        ? `<h3 class="upSub">Recent blocks</h3><div class="upList">${sessions
            .map((s) => `<div class="upRow"><i class="bi bi-${s.completed ? "check2-circle" : "stop-circle"}" aria-hidden="true"></i><div class="upRowMain"><b>${esc(s.goal || "Focus block")}</b><span>${s.minutes} of ${s.planned} min · ${esc(ago(s.endedAt))}</span></div></div>`)
            .join("")}</div>`
        : ""
    }`;
  focusClock();
  clearInterval(_tick);
  if (active) _tick = setInterval(focusClock, 1000);
  body.onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      if (f.dataset.form === "start") {
        const d = await post("/api/focus/start", { minutes: f.minutes.value, goal: f.goal.value });
        toast(`Focus started${d.closed?.length ? ` · closed ${d.closed.join(", ")}` : ""}`, "🎯");
      } else {
        await post("/api/focus/settings", {
          apps: f.apps.value.split(","),
          holdAlerts: f.holdAlerts.checked,
          quiet: { enabled: f.quiet.checked, from: f.from.value, to: f.to.value },
        });
        toast("Saved");
      }
      _refresh?.();
    } catch (err) {
      toast(err.message, "✗");
    }
  };
  body.onclick = async (e) => {
    if (e.target.closest('[data-act="stop"]')) {
      await post("/api/focus/stop").catch(() => {});
      _refresh?.();
    }
  };
}

/* ── usage ───────────────────────────────────────────────────── */

let _usageDays = 7;
async function drawUsage(body) {
  const u = await api(`/api/usage?days=${_usageDays}`);
  const peak = Math.max(1, ...u.series.map((d) => d.calls));
  const cell = (e) => `<td>${e.calls}</td><td class="${e.failRate >= 30 ? "bad" : ""}">${e.fails ? `${e.fails} (${e.failRate}%)` : "—"}</td><td>${e.avgMs != null ? (e.avgMs / 1000).toFixed(1) + "s" : "—"}</td><td>${kTok(e.inTok)} / ${kTok(e.outTok)}</td>`;
  body.innerHTML = `
    <div class="upTabs" role="group" aria-label="Period">${[1, 7, 30].map((d) => `<button class="upBtn ${d === _usageDays ? "primary" : ""}" data-days="${d}">${d === 1 ? "Today" : d + " days"}</button>`).join("")}</div>
    <div class="upStats">
      <div><b>${u.total.calls}</b><span>model calls</span></div>
      <div><b class="${u.total.failRate >= 30 ? "bad" : ""}">${u.total.failRate}%</b><span>failed</span></div>
      <div><b>${u.total.avgMs != null ? (u.total.avgMs / 1000).toFixed(1) + "s" : "—"}</b><span>avg reply</span></div>
      <div><b>${kTok(u.total.inTok + u.total.outTok)}</b><span>tokens (est.)</span></div>
    </div>
    ${
      _usageDays > 1
        ? `<div class="upBars upBarsWide" aria-label="Calls per day">${u.series
            .map((d) => `<div title="${esc(d.day)}: ${d.calls} calls, ${d.fails} failed"><i style="height:${Math.round((d.calls / peak) * 100)}%"><em style="height:${d.calls ? Math.round((d.fails / d.calls) * 100) : 0}%"></em></i>${u.series.length <= 7 ? `<span>${esc(d.day.slice(5))}</span>` : ""}</div>`)
            .join("")}</div>`
        : ""
    }
    ${
      u.models.length
        ? `<table class="upTable"><thead><tr><th>Model</th><th>Calls</th><th>Failed</th><th>Avg</th><th>Tokens in / out</th></tr></thead><tbody>${u.models
            .map((m) => `<tr><th><b>${esc(m.provider)}</b> ${esc(m.model === "default" ? "" : m.model)}</th>${cell(m)}</tr>`)
            .join("")}</tbody></table>`
        : `<p class="upEmpty">No model calls in this period.</p>`
    }
    ${
      u.recentFailures.length
        ? `<h3 class="upSub">Recent failures</h3><div class="upList">${u.recentFailures.map((f) => `<div class="upRow"><i class="bi bi-exclamation-triangle" aria-hidden="true"></i><div class="upRowMain"><b>${esc(f.key)}</b><span>${esc(f.error)} · ${esc(ago(f.at))}</span></div></div>`).join("")}</div>`
        : ""
    }
    <p class="upHint">Counts every call the server makes (chat, briefing, watchers, Claw). Tokens are estimated at 4 characters each.</p>`;
  body.onclick = (e) => {
    const d = e.target.closest("[data-days]")?.dataset.days;
    if (!d) return;
    _usageDays = Number(d);
    _refresh?.();
  };
}

/* ── Claw log ────────────────────────────────────────────────── */

async function drawHistory(body) {
  const { entries, stats } = await api("/api/claw/history?limit=150");
  body.innerHTML = `
    <p class="upHint">Every command sent to your PC, whoever asked: chat, the Claw panel, Auto, a routine or a text. ${stats.today} today${stats.failed ? `, ${stats.failed} failed` : ""}. Tick a run that worked to keep it as a routine.</p>
    <form class="upForm" data-form="routine" autocomplete="off">
      <input name="name" placeholder="Routine name for the ticked steps" maxlength="40" required />
      <button type="submit" class="upBtn primary">Save as routine</button>
      <button type="button" class="upBtn" data-act="clear">Clear log</button>
    </form>
    <div class="upList upLog">${
      entries.length
        ? entries
            .map(
              (e) => `<label class="upRow ${e.failed ? "failed" : ""}">
                <input type="checkbox" value="${esc(e.id)}" ${e.failed || e.type === "screenshot" || e.type === "wait" ? "disabled" : ""} />
                <div class="upRowMain"><b>${esc(e.summary)}${e.count > 1 ? ` ×${e.count}` : ""}</b><span>${esc(e.result ?? "no answer yet")}</span></div>
                <small>${esc(ago(e.at))}${e.ms != null ? ` · ${e.ms < 1000 ? e.ms + "ms" : (e.ms / 1000).toFixed(1) + "s"}` : ""}</small>
              </label>`,
            )
            .join("")
        : `<p class="upEmpty">Nothing yet. Commands appear here as Claw runs them.</p>`
    }</div>`;
  body.onsubmit = async (e) => {
    e.preventDefault();
    // Listed newest first; the routine wants them in the order they ran.
    const ids = [...body.querySelectorAll('.upLog input[type="checkbox"]:checked')].map((c) => c.value);
    if (!ids.length) return toast("Tick the steps to keep first", "✗");
    try {
      const d = await post("/api/claw/history/routine", { name: e.target.name.value, ids });
      toast(`Saved routine "${d.routine.name}" (${d.routine.steps.length} steps)`, "🤖");
      e.target.reset();
      body.querySelectorAll(".upLog input:checked").forEach((c) => (c.checked = false));
    } catch (err) {
      toast(err.message, "✗");
    }
  };
  body.onclick = async (e) => {
    if (!e.target.closest('[data-act="clear"]')) return;
    if (!confirm("Clear the Claw log? This can't be undone.")) return;
    await api("/api/claw/history", { method: "DELETE" }).catch(() => {});
    _refresh?.();
  };
}

/* ── backup ──────────────────────────────────────────────────── */

async function drawBackup(body) {
  const { snapshots, keep } = await api("/api/backup");
  body.innerHTML = `
    <p class="upHint">A backup is one file with everything ARIA holds: chats, memory, grades, flashcards, routines, reminders. One is saved every day (the last ${keep} are kept). Sign-in data and keys are never included.</p>
    <div class="upBtnRow">
      <button class="upBtn primary" data-act="now">Back up now</button>
      <a class="upBtn" href="/api/backup/download" download>Download a backup</a>
      <label class="upBtn">Restore from a file… <input type="file" accept="application/json,.json" data-act="file" hidden /></label>
    </div>
    <div class="upList">${
      snapshots.length
        ? snapshots
            .map(
              (s) => `<div class="upRow">
                <i class="bi bi-${s.safety ? "life-preserver" : "archive"}" aria-hidden="true"></i>
                <div class="upRowMain"><b>${esc(s.name.replace(/^aria-|\.json$/g, ""))}</b><span>${s.safety ? "What was there before a restore · " : ""}${esc(new Date(s.at).toLocaleString())} · ${esc(bytes(s.bytes))}</span></div>
                <a class="upBtn" href="/api/backup/download?name=${encodeURIComponent(s.name)}" download title="Download this backup">⤓</a>
                <button class="upBtn" data-restore="${esc(s.name)}">Restore</button>
              </div>`,
            )
            .join("")
        : `<p class="upEmpty">No backups yet. The first daily one is made a minute after ARIA starts.</p>`
    }</div>`;
  const restore = async (payload, label) => {
    if (!confirm(`Restore from ${label}?\n\nThis replaces ARIA's current data with the backup's. What's there now is saved first, so you can undo it from this list.`)) return;
    try {
      const d = await post("/api/backup/restore", payload);
      toast(`Restored ${d.restored.length} files. ${d.note}`, "🛟");
      _refresh?.();
    } catch (err) {
      toast(err.message, "✗");
    }
  };
  body.onclick = async (e) => {
    if (e.target.closest('[data-act="now"]')) {
      try {
        const d = await post("/api/backup");
        toast(`Backed up ${d.snapshot.files} files`, "🛟");
        _refresh?.();
      } catch (err) {
        toast(err.message, "✗");
      }
      return;
    }
    const name = e.target.closest("[data-restore]")?.dataset.restore;
    if (name) restore({ name }, name);
  };
  body.onchange = async (e) => {
    if (e.target.dataset?.act !== "file" || !e.target.files?.[0]) return;
    const file = e.target.files[0];
    try {
      restore({ backup: JSON.parse(await file.text()) }, file.name);
    } catch {
      toast("That file isn't an ARIA backup", "✗");
    }
    e.target.value = "";
  };
}

/* ── reminder toasts ─────────────────────────────────────────── */

function chime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [880, 1174.7].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      o.connect(g);
      g.connect(ctx.destination);
      const t = ctx.currentTime + i * 0.16;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      o.start(t);
      o.stop(t + 0.55);
    });
    setTimeout(() => ctx.close().catch(() => {}), 1200);
  } catch {}
}

/** A reminder that has rung: stays until dismissed, with Snooze. */
function reminderCard(alert) {
  let stack = $("upReminders");
  if (!stack) {
    stack = Object.assign(document.createElement("div"), { id: "upReminders" });
    stack.setAttribute("role", "alert");
    document.body.appendChild(stack);
  }
  const r = alert.reminder;
  const card = document.createElement("div");
  card.className = "upReminder";
  card.innerHTML = `<i class="bi bi-alarm" aria-hidden="true"></i>
    <div class="upRowMain"><b></b><span></span></div>
    <button class="upBtn" data-snooze="10">Snooze 10m</button>
    <button class="upBtn" data-snooze="60">1h</button>
    <button class="upBtn primary" data-done>Done</button>`;
  card.querySelector("b").textContent = r.text;
  card.querySelector("span").textContent = alert.text || (r.repeat ? "Repeats" : "Reminder");
  card.addEventListener("click", async (e) => {
    const mins = e.target.closest("[data-snooze]")?.dataset.snooze;
    if (mins) {
      try {
        const d = await post(`/api/reminders/${encodeURIComponent(r.id)}/snooze`, { minutes: Number(mins), text: r.text });
        toast(d.text, "⏰");
      } catch (err) {
        toast(err.message, "✗");
      }
      card.remove();
    } else if (e.target.closest("[data-done]")) card.remove();
  });
  stack.appendChild(card);
  chime();
}

function listenForAlerts() {
  if (!("EventSource" in window)) return;
  const es = new EventSource("/api/briefing/subscribe");
  es.onmessage = (e) => {
    let data;
    try {
      data = JSON.parse(e.data);
    } catch {
      return;
    }
    if (data.type !== "alert") return;
    if (data.reminder) return reminderCard(data);
    // In the console chat.js announces alerts; on the home screen nobody else does.
    if (!document.getElementById("ariaToast") && !window.ARIA_loadChat) toast(data.title || "Alert", data.icon || "🔔");
  };
}

/* ── the Claw panel's APPS row ───────────────────────────────── */

async function refreshApps(row) {
  const list = row.querySelector(".clawApps");
  list.innerHTML = `<span class="clawAppsNote">Looking…</span>`;
  try {
    const d = await api("/api/claw/apps");
    if (!d.ok) throw new Error(d.error || "No answer");
    list.innerHTML = d.apps.length
      ? d.apps.map((a) => `<button class="clawAppChip" data-app="${esc(a.label)}" title="${esc(a.title || a.label)} — click twice to close">${esc(a.label)}</button>`).join("")
      : `<span class="clawAppsNote">Nothing with a window is open.</span>`;
  } catch (e) {
    list.innerHTML = `<span class="clawAppsNote">${esc(e.message)}</span>`;
  }
}

function addAppsRow() {
  if ($("clawAppsRow")) return true;
  const quick = $("clawQuickRow");
  if (!quick) return false;
  const row = document.createElement("div");
  row.id = "clawAppsRow";
  row.innerHTML = `<span class="clawModeLabel">APPS</span><div class="clawApps"><span class="clawAppsNote">Press ↻ to see what's open</span></div><button class="clawQuickBtn" data-apps-refresh title="List the apps open on the PC">↻</button>`;
  quick.after(row);
  row.addEventListener("click", async (e) => {
    if (e.target.closest("[data-apps-refresh]")) return refreshApps(row);
    const chip = e.target.closest(".clawAppChip");
    if (!chip) return;
    // First click arms it, the second closes: one stray click shouldn't end an app.
    if (!chip.classList.contains("armed")) {
      row.querySelectorAll(".clawAppChip.armed").forEach((c) => c.classList.remove("armed"));
      chip.classList.add("armed");
      chip.textContent = `Close ${chip.dataset.app}?`;
      setTimeout(() => {
        if (!chip.isConnected) return;
        chip.classList.remove("armed");
        chip.textContent = chip.dataset.app;
      }, 4000);
      return;
    }
    chip.disabled = true;
    chip.textContent = "Closing…";
    try {
      const d = await post("/api/claw/apps/close", { app: chip.dataset.app });
      toast(d.output || d.error || "Done", d.ok ? "✓" : "✗");
    } catch (err) {
      toast(err.message, "✗");
    }
    refreshApps(row);
  });
  return true;
}

/* ── init ────────────────────────────────────────────────────── */

let _inited = false;
export function initUpgrades() {
  if (_inited) return;
  _inited = true;
  window.ARIA_openPanel = openPanel;
  listenForAlerts();
  // Tools menu entries (index.html).
  for (const [id, name] of [["tool_reminders", "reminders"], ["tool_focus", "focus"], ["tool_usage", "usage"], ["tool_clawlog", "history"], ["tool_backup", "backup"]])
    $(id)?.addEventListener("click", () => {
      $("toolsDropdown")?.style.setProperty("display", "none");
      openPanel(name);
    });
  // The Claw panel is built when the console loads; add the row once it exists.
  if (!addAppsRow()) {
    const mo = new MutationObserver(() => {
      if ($("clawQuickRow")) {
        addAppsRow();
        mo.disconnect();
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }
}
