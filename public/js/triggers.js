// triggers.js — the Triggers panel: "when I'm in X (after Y), do Z" and
// "at 7:30 on weekdays, tell me…". The engine is lib/triggers.js; the Claw
// relay says which app is in front. What fires lands in the 🔔 Alerts chat.

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
const toast = (msg) => window.ARIA_showNotification?.(msg);

async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: { "Content-Type": "application/json", ...(opts.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function ago(t) {
  if (!t) return "never";
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

let _state = { triggers: [], context: null, relay: false, where: "" };

function rowHtml(r) {
  const state = r.active ? `<span class="watchState on">on</span>` : `<span class="watchState off">off</span>`;
  const what = r.then.kind === "say" ? `say “${esc(r.then.text)}”` : `ask ARIA: “${esc(r.then.text)}”`;
  const meta = [r.nag ? `nag every ${r.cooldownMin}m` : r.when.at == null ? `at most every ${r.cooldownMin}m` : "", `fired ${r.fired || 0}× · last ${ago(r.lastFired)}`]
    .filter(Boolean)
    .join(" · ");
  return `<div class="watchRow" data-id="${esc(r.id)}">
    <div class="watchMain">
      <div class="watchTitle">${state} ${esc(r.description)}</div>
      <div class="watchWhat">→ ${what}</div>
      <div class="watchMeta">${esc(meta)}</div>
    </div>
    <div class="watchBtns">
      <button class="memBtn" data-act="${r.active ? "off" : "on"}" title="${r.active ? "Turn off" : "Turn on"}">${r.active ? "⏸" : "▶"}</button>
      <button class="memBtn" data-act="delete" title="Delete">✕</button>
    </div>
  </div>`;
}

function render() {
  const list = document.getElementById("triggersList");
  if (!list) return;
  const ctx = document.getElementById("triggersContext");
  if (ctx) {
    const c = _state.context;
    ctx.textContent = !_state.relay
      ? "PC control is off, so app triggers can't see what's in front. Clock triggers still work."
      : c
        ? `In front right now: ${c.app || "?"}${c.title ? ` — ${c.title}` : ""}${c.idleSec > 600 ? " (idle)" : ""}`
        : "The PC reports which app is in front only while an app trigger's time window is open. Window titles are sent only when they contain a trigger's words.";
  }
  const where = document.getElementById("triggersWhere");
  if (where) where.textContent = _state.where ? `Running on ${_state.where}.` : "";
  list.innerHTML = _state.triggers.length
    ? _state.triggers.map(rowHtml).join("")
    : `<p class="watchEmpty">None yet. Add one below, or tell ARIA: <i>"if I'm in VS Code after 11pm, tell me to sleep"</i>.</p>`;
}

async function refresh() {
  try {
    _state = await api("/api/triggers");
  } catch (e) {
    const list = document.getElementById("triggersList");
    if (list) list.innerHTML = `<p class="watchErr">Couldn't load triggers: ${esc(e.message)}</p>`;
    return;
  }
  render();
}

async function onAction(e) {
  const btn = e.target.closest("button[data-act]");
  const id = btn?.closest(".watchRow")?.dataset.id;
  if (!id) return;
  btn.disabled = true;
  try {
    if (btn.dataset.act === "delete") {
      if (!confirm("Delete this trigger?")) return;
      await api(`/api/triggers/${encodeURIComponent(id)}`, { method: "DELETE" });
    } else {
      await api(`/api/triggers/${encodeURIComponent(id)}/active`, { method: "POST", body: JSON.stringify({ active: btn.dataset.act === "on" }) });
    }
  } catch (err) {
    toast(`✗ ${err.message}`);
  } finally {
    btn.disabled = false;
    refresh();
  }
}

function syncForm(form) {
  const clock = form.kind.value === "clock";
  for (const el of form.querySelectorAll(".trigApp")) el.hidden = clock;
  for (const el of form.querySelectorAll(".trigAt")) el.hidden = !clock;
}

async function onAdd(e) {
  e.preventDefault();
  const f = e.target;
  const clock = f.kind.value === "clock";
  const body = {
    when: clock
      ? { at: f.at.value, days: f.days.value }
      : { app: f.app.value.trim(), from: f.from.value || null, to: f.to.value || null, days: f.days.value },
    then: { kind: f.action.value, text: f.text.value.trim() },
    nag: !clock && f.nag.checked,
    cooldown: f.cooldown.value,
  };
  try {
    const { trigger } = await api("/api/triggers", { method: "POST", body: JSON.stringify(body) });
    toast(`✓ Set: ${trigger.description}`);
    f.text.value = "";
    try {
      if (typeof Notification !== "undefined" && Notification.permission === "default") Notification.requestPermission();
    } catch {}
  } catch (err) {
    toast(`✗ ${err.message}`);
  } finally {
    refresh();
  }
}

export function showTriggers() {
  const show = window.ARIA_showQuickModal;
  if (!show) return;
  show(
    "Triggers",
    `<p id="triggersWhere" class="watchHint"></p>
     <p id="triggersContext" class="watchHint"></p>
     <div id="triggersList"><p class="watchEmpty">Loading…</p></div>
     <form id="triggerForm" class="watchForm" autocomplete="off">
       <div class="watchFormRow">
         <select name="kind" title="What sets it off">
           <option value="app">When an app or site is in front</option>
           <option value="clock">At a time of day</option>
         </select>
         <select name="days" title="Which days">
           <option value="">every day</option>
           <option value="weekdays">weekdays</option>
           <option value="weekends">weekends</option>
         </select>
       </div>
       <div class="watchFormRow trigApp">
         <input name="app" placeholder="App or site in the window title, e.g. Visual Studio Code, Schoology" maxlength="80" />
         <label>after <input name="from" type="time" /></label>
         <label>before <input name="to" type="time" /></label>
       </div>
       <div class="watchFormRow trigAt" hidden>
         <label>at <input name="at" type="time" value="07:30" /></label>
       </div>
       <div class="watchFormRow">
         <select name="action" title="What happens">
           <option value="say">Say</option>
           <option value="ask">Ask ARIA</option>
         </select>
         <input name="text" placeholder="It's late — commit and go to bed. / What's due today?" required maxlength="500" style="flex:1" />
       </div>
       <div class="watchFormRow">
         <label class="trigApp" title="Repeat every cooldown while it stays true"><input type="checkbox" name="nag" /> keep nagging</label>
         <select name="cooldown" class="trigApp" title="At most this often">
           <option value="15m">at most every 15m</option>
           <option value="30m">at most every 30m</option>
           <option value="60m" selected>at most hourly</option>
           <option value="240m">at most every 4h</option>
         </select>
         <button type="submit" class="memBtn">Add</button>
       </div>
       <p class="watchHint">"Ask ARIA" answers with read-only tools (no PC control). Fired triggers land in the 🔔 Alerts chat.</p>
     </form>`,
  );
  const form = document.getElementById("triggerForm");
  form?.kind.addEventListener("change", () => syncForm(form));
  form?.addEventListener("submit", onAdd);
  document.getElementById("triggersList")?.addEventListener("click", onAction);
  refresh();
}

export function initTriggers() {
  window.ARIA_showTriggers = showTriggers;
  document.getElementById("triggersBtn")?.addEventListener("click", showTriggers);
}
