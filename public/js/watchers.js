// watchers.js — the Watchers panel: things ARIA checks on her own and alerts
// about ("tell me when…"). The engine is lib/watchers.js; alerts arrive in
// the shared "🔔 Alerts" chat and as a toast (chat.js, briefing stream).
//
// Asking in chat ("tell me when this PR merges") does the same as the form
// here; the panel is for seeing what's running and stopping it.

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

function ago(t) {
  if (!t) return "never";
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 0) return "soon";
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
function until(t) {
  const s = Math.round((t - Date.now()) / 1000);
  if (s <= 60) return "within a minute";
  if (s < 3600) return `in ${Math.round(s / 60)}m`;
  if (s < 86400) return `in ${Math.round(s / 3600)}h`;
  return `in ${Math.round(s / 86400)}d`;
}
function every(min) {
  if (min % 1440 === 0) return `${min / 1440}d`;
  if (min % 60 === 0) return `${min / 60}h`;
  return `${min}m`;
}
const toast = (msg, icon) => window.ARIA_showNotification?.(`${icon ? icon + " " : ""}${msg}`);

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function rowHtml(w) {
  const state = w.active
    ? `<span class="watchState on">watching</span>`
    : `<span class="watchState off">stopped</span>`;
  const what = w.condition ? `when <b>${esc(w.condition)}</b>` : "any change";
  const href = /^https?:\/\//.test(w.link || "") ? w.link : "#";
  const meta = [
    `every ${every(w.everyMin)}`,
    `checked ${ago(w.lastCheck)}`,
    w.active ? `next ${until(w.nextCheck || Date.now())}` : "",
    w.fired ? `fired ${w.fired}×` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const last = w.lastError
    ? `<div class="watchErr">⚠ ${esc(w.lastError)}</div>`
    : w.lastSummary
      ? `<div class="watchLast">${esc(w.lastSummary)}</div>`
      : "";
  return `<div class="watchRow" data-id="${esc(w.id)}">
    <div class="watchMain">
      <div class="watchTitle">${state} <a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(w.label)}</a></div>
      <div class="watchWhat">${what}</div>
      <div class="watchMeta">${esc(meta)}</div>
      ${last}
      ${w.note ? `<div class="watchNote">${esc(w.note)}</div>` : ""}
    </div>
    <div class="watchBtns">
      <button class="memBtn" data-act="check" title="Check now">↻</button>
      <button class="memBtn" data-act="${w.active ? "pause" : "resume"}" title="${w.active ? "Pause" : "Resume"}">${w.active ? "⏸" : "▶"}</button>
      <button class="memBtn" data-act="delete" title="Delete">✕</button>
    </div>
  </div>`;
}

let _list = [];
let _where = "";

function render() {
  const body = document.getElementById("watchersList");
  if (!body) return;
  const where = document.getElementById("watchersWhere");
  if (where) where.textContent = _where ? `Running on ${_where}. Watchers made on another ARIA server are listed there.` : "";
  if (!_list.length) {
    body.innerHTML = `<p class="watchEmpty">Nothing yet. Add one below, or just tell ARIA: <i>"let me know when DaEpickid540/ARIA#8 is merged"</i>.</p>`;
    return;
  }
  // Running ones first, newest first within each group.
  const sorted = [..._list].sort((a, b) => (b.active - a.active) || (b.createdAt - a.createdAt));
  body.innerHTML = sorted.map(rowHtml).join("");
}

async function refresh() {
  try {
    const data = await api("/api/watchers");
    _list = data.watchers || [];
    _where = data.where || "";
  } catch (e) {
    const body = document.getElementById("watchersList");
    if (body) body.innerHTML = `<p class="watchErr">Couldn't load watchers: ${esc(e.message)}</p>`;
    return;
  }
  render();
}

async function onAction(e) {
  const btn = e.target.closest("button[data-act]");
  if (!btn) return;
  const id = btn.closest(".watchRow")?.dataset.id;
  if (!id) return;
  const act = btn.dataset.act;
  btn.disabled = true;
  try {
    if (act === "check") {
      btn.textContent = "…";
      const { result } = await api(`/api/watchers/${encodeURIComponent(id)}/check`, { method: "POST" });
      toast(result.summary || result.status, result.status === "met" ? "🔔" : "↻");
    } else if (act === "pause" || act === "resume") {
      await api(`/api/watchers/${encodeURIComponent(id)}/active`, {
        method: "POST",
        body: JSON.stringify({ active: act === "resume" }),
      });
    } else if (act === "delete") {
      if (!confirm("Stop and delete this watcher?")) return;
      await api(`/api/watchers/${encodeURIComponent(id)}`, { method: "DELETE" });
    }
  } catch (err) {
    toast(err.message, "✗");
  } finally {
    btn.disabled = false;
    refresh();
  }
}

async function onAdd(e) {
  e.preventDefault();
  const form = e.target;
  const target = form.target.value.trim();
  if (!target) return;
  const submit = form.querySelector("button[type=submit]");
  submit.disabled = true;
  submit.textContent = "Checking…";
  try {
    const { watcher, first, alreadyTrue } = await api("/api/watchers", {
      method: "POST",
      body: JSON.stringify({
        target,
        condition: form.condition.value.trim(),
        every: form.every.value,
        repeat: form.repeat.checked,
      }),
    });
    form.reset();
    if (alreadyTrue) toast(`Already true, so not watching: ${first.summary}`, "🔔");
    else toast(`Watching ${watcher.label}. ${first?.summary || ""}`, "👁");
    askForNotifications();
  } catch (err) {
    toast(err.message, "✗");
  } finally {
    submit.disabled = false;
    submit.textContent = "Watch";
    refresh();
  }
}

/** Desktop notifications for alerts that arrive while ARIA is in the background. */
function askForNotifications() {
  try {
    if (typeof Notification !== "undefined" && Notification.permission === "default") Notification.requestPermission();
  } catch {}
}

export function showWatchers() {
  const show = window.ARIA_showQuickModal;
  if (!show) return;
  show(
    "Watchers",
    `<p id="watchersWhere" class="watchHint"></p>
     <div id="watchersList"><p class="watchEmpty">Loading…</p></div>
     <form id="watchForm" class="watchForm" autocomplete="off">
       <input name="target" placeholder="URL, or owner/repo#PR" required maxlength="500" />
       <input name="condition" placeholder="Condition (blank = any change), e.g. price under $50" maxlength="300" />
       <div class="watchFormRow">
         <select name="every" title="How often to check">
           <option value="15m">every 15m</option>
           <option value="30m" selected>every 30m</option>
           <option value="1h">hourly</option>
           <option value="6h">every 6h</option>
           <option value="1d">daily</option>
         </select>
         <label title="Keep alerting each time it's true, instead of once"><input type="checkbox" name="repeat" /> keep going</label>
         <button type="submit" class="memBtn">Watch</button>
       </div>
       <p class="watchHint">Reads page text without running scripts, so pages behind a login (Schoology, email) or built by JavaScript can't be watched. Alerts land in the 🔔 Alerts chat.</p>
     </form>`,
  );
  document.getElementById("watchersList")?.addEventListener("click", onAction);
  document.getElementById("watchForm")?.addEventListener("submit", onAdd);
  refresh();
}

export function initWatchers() {
  window.ARIA_showWatchers = showWatchers;
  document.getElementById("watchersBtn")?.addEventListener("click", showWatchers);
}
