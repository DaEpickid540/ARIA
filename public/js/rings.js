// rings.js — Daily Rings: the things you want to do every day.
//
// Three views of the same list (lib/habits.js on the server):
//   - the DAILY RINGS card on the home screen: click a ring to check in,
//     click a closed one to take the last check-in back
//   - the inner ring of the home core, which fills as they close
//   - the Daily Rings panel (Tools → Daily Rings, or Manage on the card):
//     the last 7 days, streaks, rename, change the target, remove
// ARIA can check in for you too: "I read today" → ACTION: rings done | Read.

import { setCoreRings } from "./homeCore.js";

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
const toast = (msg) => window.ARIA_showNotification?.(msg);
const $ = (id) => document.getElementById(id);

async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: { "Content-Type": "application/json", ...(opts.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}
const post = (path, body) => api(path, { method: "POST", body: JSON.stringify(body || {}) });

let _summary = { habits: [], total: 0, done: 0, percent: 0, perfectStreak: 0 };

/** "Water x8", "8x Water" or "Water 8/day" → { name: "Water", target: 8 }. */
export function parseRing(text) {
  let name = String(text || "").trim();
  let target = 1;
  const m =
    name.match(/^(.*?)[\s,]+x\s*(\d{1,2})$/i) ||
    name.match(/^(.*?)[\s,]+(\d{1,2})\s*x$/i) ||
    name.match(/^(.*?)[\s,]+(\d{1,2})\s*(?:\/|per|a)\s*day$/i);
  const lead = name.match(/^(\d{1,2})\s*x\s+(.*)$/i);
  if (m) {
    name = m[1].trim();
    target = +m[2];
  } else if (lead) {
    name = lead[2].trim();
    target = +lead[1];
  }
  return { name, target: Math.max(1, target) };
}

// A small ring that fills with the day's count.
function dot(h, size = 22) {
  const r = size / 2 - 2.5;
  const c = size / 2;
  return `<svg class="ringDotSvg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
    <circle class="ringDotTrack" cx="${c}" cy="${c}" r="${r}"/>
    ${h.fill > 0 ? `<circle class="ringDotFill" cx="${c}" cy="${c}" r="${r}" pathLength="100"
      stroke-dasharray="${Math.round(h.fill * 100)} 100" transform="rotate(-90 ${c} ${c})"/>` : ""}
    ${h.done ? `<path class="ringDotCheck" transform="translate(${c} ${c}) scale(${size / 22})" d="M-3.2 0.2 l2.3 2.4 l4.2 -4.8"/>` : ""}
  </svg>`;
}

const addForm = (id) => `
  <form id="${id}" class="ringAddForm" autocomplete="off">
    <input name="ring" class="hwField" maxlength="46" placeholder="Add a ring…  (Read, Water x8)" aria-label="New ring" />
    <button class="hwToolBtn" type="submit" title="Add">+</button>
  </form>`;

/* ── the home card ───────────────────────────────────────────── */
function renderCard() {
  const el = $("homeRings");
  if (!el) return;
  const s = _summary;
  el.innerHTML =
    (s.total
      ? s.habits
          .map(
            (h) => `<button type="button" class="ringRow${h.done ? " done" : ""}" data-ring="${esc(h.id)}"
                title="${h.done ? "Closed — click to take the last check-in back" : "Click to check in"}">
              ${dot(h)}
              <span class="ringName">${esc(h.name)}</span>
              ${h.target > 1 ? `<span class="ringCount">${h.count}/${h.target}</span>` : ""}
              ${h.streak ? `<span class="ringStreak" title="${h.streak} day streak"><i class="bi bi-fire" aria-hidden="true"></i>${h.streak}</span>` : ""}
            </button>`,
          )
          .join("") +
        (s.perfectStreak > 1 ? `<div class="ringFoot">Every ring closed ${s.perfectStreak} days running</div>` : "")
      : `<span class="hwEmpty">Things you want to do every day. Close them all to keep the streak.</span>`) +
    addForm("homeRingAdd");
}

function render() {
  renderCard();
  setCoreRings(_summary);
  if ($("ringsBody")) renderPanel();
}

async function refresh() {
  try {
    _summary = await api("/api/habits");
  } catch {
    const el = $("homeRings");
    if (el && !_summary.total) el.innerHTML = `<span class="hwEmpty">Unable to load.</span>`;
    return;
  }
  render();
}

async function act(fn) {
  try {
    const before = _summary;
    _summary = await fn();
    render();
    if (_summary.total && _summary.done === _summary.total && before.done < before.total)
      toast("◎ All rings closed for today");
  } catch (e) {
    toast(e.message);
  }
}

function checkIn(id) {
  const h = _summary.habits.find((x) => x.id === id);
  if (!h) return;
  // Open: one more. Closed: take the last one back (so a slip is one click).
  return act(() => post(`/api/habits/${encodeURIComponent(id)}/check`, { amount: h.done ? -1 : 1 }));
}

function onAdd(e) {
  e.preventDefault();
  const input = e.target.elements.ring;
  const { name, target } = parseRing(input.value);
  if (!name) return;
  input.value = "";
  act(() => post("/api/habits", { name, target }));
}

/* ── the panel ───────────────────────────────────────────────── */
const DAY_LETTER = (key) => "SMTWTFS"[new Date(key + "T12:00:00").getDay()];

function renderPanel() {
  const body = $("ringsBody");
  if (!body) return;
  const s = _summary;
  body.innerHTML = `
    ${
      s.total
        ? `<div class="watchHint ringsHead">${s.done}/${s.total} closed today · ${s.percent}% of the day's rings${
            s.perfectStreak ? ` · every ring closed ${s.perfectStreak} day${s.perfectStreak === 1 ? "" : "s"} running` : ""
          }</div>` +
          s.habits
            .map(
              (h) => `<div class="watchRow ringPanelRow" data-id="${esc(h.id)}">
                <button type="button" class="ringPanelDot${h.done ? " done" : ""}" data-ring="${esc(h.id)}" title="${h.done ? "Take the last check-in back" : "Check in"}">${dot(h, 34)}</button>
                <div class="watchMain">
                  <b>${esc(h.name)}</b>
                  <span class="watchHint">${h.count}/${h.target} today · streak ${h.streak} · best ${h.best}</span>
                  <div class="ringWeek">${h.week
                    .map((d) => `<span class="ringWeekDay${d.fill >= 1 ? " full" : d.fill > 0 ? " part" : ""}" title="${esc(d.day)}">${DAY_LETTER(d.day)}</span>`)
                    .join("")}</div>
                </div>
                <label class="ringTarget" title="Times a day">×<input type="number" min="1" max="99" value="${h.target}" data-target="${esc(h.id)}" aria-label="Times a day for ${esc(h.name)}" /></label>
                <button class="memBtn" data-rename="${esc(h.id)}" title="Rename">✎</button>
                <button class="memBtn" data-del="${esc(h.id)}" title="Remove this ring">✕</button>
              </div>`,
            )
            .join("")
        : `<p class="watchEmpty">No rings yet. Add the few things you want to do every day: <i>Read</i>, <i>Stretch</i>, <i>Water x8</i>. In chat or by text, <i>"I read today"</i> checks one off.</p>`
    }
    ${addForm("ringPanelAdd")}`;
}

function onPanelClick(e) {
  const ring = e.target.closest("[data-ring]");
  if (ring) return checkIn(ring.dataset.ring);
  const del = e.target.closest("[data-del]");
  if (del) {
    const h = _summary.habits.find((x) => x.id === del.dataset.del);
    if (h && confirm(`Remove the ring "${h.name}" and its history?`))
      act(() => api(`/api/habits/${encodeURIComponent(h.id)}`, { method: "DELETE" }));
    return;
  }
  const ren = e.target.closest("[data-rename]");
  if (ren) {
    const h = _summary.habits.find((x) => x.id === ren.dataset.rename);
    const name = h && prompt("Rename this ring", h.name);
    if (name && name.trim() && name.trim() !== h.name) act(() => post(`/api/habits/${encodeURIComponent(h.id)}`, { name }));
  }
}

function onPanelChange(e) {
  const t = e.target.closest("[data-target]");
  if (t) act(() => post(`/api/habits/${encodeURIComponent(t.dataset.target)}`, { target: Number(t.value) || 1 }));
}

export async function showRings() {
  // The quick modal lives in chat.js; from the home screen it may not be loaded yet.
  if (!window.ARIA_showQuickModal) await window.ARIA_loadChatModules?.();
  const show = window.ARIA_showQuickModal;
  if (!show) return;
  show("Daily Rings", `<div id="ringsBody"><p class="watchEmpty">Loading…</p></div>`);
  const body = $("ringsBody");
  body.addEventListener("click", onPanelClick);
  body.addEventListener("change", onPanelChange);
  body.addEventListener("submit", onAdd);
  renderPanel();
  refresh();
}

let _inited = false;
export function initRings() {
  if (!_inited) {
    _inited = true;
    window.ARIA_showRings = showRings;
    window.ARIA_refreshRings = refresh;
    const card = $("homeRings");
    card?.addEventListener("click", (e) => {
      const row = e.target.closest("[data-ring]");
      if (row) checkIn(row.dataset.ring);
    });
    card?.addEventListener("submit", onAdd);
    $("homeRingsManage")?.addEventListener("click", showRings);
    $("hudRingsBtn")?.addEventListener("click", showRings);
    $("tool_rings")?.addEventListener("click", () => {
      $("toolsDropdown")?.style.setProperty("display", "none");
      showRings();
    });
    // A check-in made in chat or by text shows up when you come back.
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) refresh();
    });
  }
  refresh();
}
