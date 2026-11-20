// journal.js — Journal & Mood: one entry a day, how it went and a few lines.
//
// The panel (Tools → Journal, or "journal" in the command palette):
//   - five mood faces for today, and a note (#words become tags)
//   - the last 14 days as a strip of bars, the streak, the 7-day average
//   - past entries, searchable; click one to read or edit it
// ARIA can write one too: "today was a 4, finished the essay" →
// ACTION: journal log | 4 | finished the essay (lib/journal.js).

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

export const MOODS = [
  null,
  { word: "rough", icon: "bi-emoji-frown" },
  { word: "low", icon: "bi-emoji-expressionless" },
  { word: "okay", icon: "bi-emoji-neutral" },
  { word: "good", icon: "bi-emoji-smile" },
  { word: "great", icon: "bi-emoji-laughing" },
];

let _s = null; // the last summary from the server
let _day = null; // the day being edited (date key); null = today
let _draft = { mood: null, note: "" };
let _q = "";

const fmtDay = (key) =>
  new Date(key + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

function editing() {
  return _day || _s?.day;
}

function loadDraft(entry) {
  _draft = { mood: entry?.mood ?? null, note: entry?.note || "" };
}

function moodButtons() {
  return MOODS.slice(1)
    .map(
      (m, i) => `<button type="button" class="jMood${_draft.mood === i + 1 ? " on" : ""}" data-mood="${i + 1}"
        title="${i + 1} — ${m.word}" aria-pressed="${_draft.mood === i + 1}" aria-label="Mood ${i + 1}, ${m.word}">
        <i class="bi ${m.icon}" aria-hidden="true"></i><span>${m.word}</span></button>`,
    )
    .join("");
}

function stripBars() {
  return (_s?.strip || [])
    .map((d) => {
      const h = d.mood ? 20 + d.mood * 16 : d.wrote ? 10 : 4;
      return `<button type="button" class="jBar${d.mood ? " m" + d.mood : d.wrote ? " note" : ""}${d.day === editing() ? " sel" : ""}"
        data-day="${esc(d.day)}" style="--h:${h}%" title="${esc(fmtDay(d.day))}${d.mood ? ` · ${d.mood}/5 ${MOODS[d.mood].word}` : d.wrote ? " · note only" : " · nothing written"}"
        aria-label="${esc(fmtDay(d.day))}"></button>`;
    })
    .join("");
}

function statsLine() {
  const s = _s;
  if (!s?.total) return "Write a line a day. The strip below fills in as you go.";
  const bits = [`Streak ${s.streak} day${s.streak === 1 ? "" : "s"} · best ${s.best}`];
  if (s.average7 != null) bits.push(`7-day mood ${s.average7}/5${s.trend ? ` (${s.trend === "up" ? "↑ up" : s.trend === "down" ? "↓ down" : "steady"} on last week)` : ""}`);
  return bits.join(" · ");
}

function entryList() {
  const list = _s?.recent || [];
  if (!list.length) return `<p class="watchEmpty">${_q ? `No entries mention “${esc(_q)}”.` : "No entries yet."}</p>`;
  return list
    .map(
      (e) => `<button type="button" class="jEntry" data-day="${esc(e.day)}">
        <span class="jEntryMood${e.mood ? " m" + e.mood : ""}">${e.mood ? `<i class="bi ${MOODS[e.mood].icon}" aria-hidden="true"></i>` : "–"}</span>
        <span class="jEntryMain"><b>${esc(fmtDay(e.day))}</b><span class="watchHint">${esc(e.note.replace(/\s+/g, " ").slice(0, 140)) || "(no note)"}</span></span>
      </button>`,
    )
    .join("");
}

function render() {
  const body = $("journalBody");
  if (!body || !_s) return;
  const day = editing();
  const isToday = day === _s.day;
  const saved = isToday ? _s.today : (_s.recent || []).find((e) => e.day === day) || null;
  body.innerHTML = `
    <div class="watchHint jStats">${esc(statsLine())}</div>
    <div class="jStrip" role="group" aria-label="Last 14 days">${stripBars()}</div>
    <div class="jHead">
      <b>${isToday ? "Today" : esc(fmtDay(day))}</b>
      ${isToday ? "" : `<button type="button" class="memBtn" data-today title="Back to today">Today</button>`}
      ${saved ? `<button type="button" class="memBtn" data-del="${esc(day)}" title="Delete this entry">✕</button>` : ""}
    </div>
    <div class="jMoods" role="group" aria-label="Mood">${moodButtons()}</div>
    <form id="journalForm" autocomplete="off">
      <textarea id="journalNote" class="hwField jNote" maxlength="2000" rows="4"
        placeholder="How did it go? A few words is plenty. #tags work.">${esc(_draft.note)}</textarea>
      <div class="jActions">
        ${_s.tags?.length ? `<span class="jTags">${_s.tags.map((t) => `<button type="button" class="jTag" data-tag="${esc(t.tag)}">#${esc(t.tag)}<small>${t.n}</small></button>`).join("")}</span>` : "<span></span>"}
        <button type="submit" class="hwToolBtn jSave">${saved ? "Update" : "Save"}</button>
      </div>
    </form>
    <div class="jListHead">
      <b>Entries</b>
      <input id="journalSearch" class="hwField" type="search" placeholder="Search…" value="${esc(_q)}" aria-label="Search entries" />
    </div>
    <div class="jList">${entryList()}</div>`;
}

async function refresh() {
  try {
    _s = await api("/api/journal" + (_q ? `?q=${encodeURIComponent(_q)}` : ""));
  } catch (e) {
    const body = $("journalBody");
    if (body && !_s) body.innerHTML = `<p class="watchEmpty">Unable to load the journal (${esc(e.message)}).</p>`;
    return;
  }
  render();
}

async function openDay(day) {
  if (!_s) return;
  _day = day === _s.day ? null : day;
  let entry = day === _s.day ? _s.today : null;
  if (day !== _s.day) {
    try {
      entry = await api(`/api/journal/${encodeURIComponent(day)}`);
    } catch {
      entry = null; // a blank day: start an entry for it
    }
  }
  loadDraft(entry);
  render();
  $("journalNote")?.focus();
}

async function save() {
  const day = editing();
  const note = $("journalNote")?.value ?? _draft.note;
  if (_draft.mood == null && !note.trim()) return toast("Pick a mood or write something first.");
  try {
    _s = await api("/api/journal", { method: "POST", body: JSON.stringify({ day, mood: _draft.mood, note }) });
    if (_q) _s.recent = (await api(`/api/journal?q=${encodeURIComponent(_q)}`)).recent;
    toast(day === _s.day ? `Journal saved · streak ${_s.streak}` : `Saved ${fmtDay(day)}`);
    _draft.note = note;
    render();
  } catch (e) {
    toast(e.message);
  }
}

function onClick(e) {
  const mood = e.target.closest("[data-mood]");
  if (mood) {
    const m = +mood.dataset.mood;
    _draft.note = $("journalNote")?.value ?? _draft.note;
    _draft.mood = _draft.mood === m ? null : m;
    return render();
  }
  if (e.target.closest("[data-today]")) return openDay(_s.day);
  const del = e.target.closest("[data-del]");
  if (del) {
    const day = del.dataset.del;
    if (!confirm(`Delete the entry for ${fmtDay(day)}? This can't be undone.`)) return;
    return api(`/api/journal/${encodeURIComponent(day)}`, { method: "DELETE" })
      .then((s) => {
        _s = s;
        _day = null;
        loadDraft(_s.today);
        render();
      })
      .catch((err) => toast(err.message));
  }
  const tag = e.target.closest("[data-tag]");
  if (tag) {
    const ta = $("journalNote");
    if (ta && !new RegExp(`#${tag.dataset.tag}\\b`, "i").test(ta.value)) {
      ta.value = (ta.value.trimEnd() + " #" + tag.dataset.tag).trimStart();
      _draft.note = ta.value;
    }
    return ta?.focus();
  }
  const day = e.target.closest("[data-day]");
  if (day) return openDay(day.dataset.day);
}

let _searchTimer = 0;
function onInput(e) {
  if (e.target.id === "journalNote") _draft.note = e.target.value;
  if (e.target.id === "journalSearch") {
    clearTimeout(_searchTimer);
    _searchTimer = setTimeout(async () => {
      _q = e.target.value.trim();
      await refresh();
      const s = $("journalSearch");
      if (s) {
        s.focus();
        s.setSelectionRange(s.value.length, s.value.length);
      }
    }, 250);
  }
}

function onKey(e) {
  // Ctrl/Cmd+Enter saves from the note.
  if (e.target.id === "journalNote" && e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    save();
  }
}

export async function showJournal() {
  if (!window.ARIA_showQuickModal) await window.ARIA_loadChatModules?.();
  const show = window.ARIA_showQuickModal;
  if (!show) return;
  show("Journal", `<div id="journalBody" class="journalBody"><p class="watchEmpty">Loading…</p></div>`);
  const body = $("journalBody");
  body.addEventListener("click", onClick);
  body.addEventListener("input", onInput);
  body.addEventListener("keydown", onKey);
  body.addEventListener("submit", (e) => {
    e.preventDefault();
    save();
  });
  _day = null;
  _q = "";
  await refresh();
  loadDraft(_s?.today);
  render();
}

let _inited = false;
export function initJournal() {
  if (_inited) return;
  _inited = true;
  window.ARIA_showJournal = showJournal;
  $("tool_journal")?.addEventListener("click", () => {
    $("toolsDropdown")?.style.setProperty("display", "none");
    showJournal();
  });
}
