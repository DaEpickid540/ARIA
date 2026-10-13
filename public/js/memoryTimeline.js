// memoryTimeline.js — what ARIA has learned about you, as a timeline:
// when each fact was learned, from which chat and which line, with a way
// to correct or forget it. Facts that disagree ("name is Sam" / "name is
// Sammy") are shown first so you can keep the right one.
// Server side: lib/memory-timeline.js and /api/memory/*.

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
const toast = (msg, icon) => window.ARIA_showNotification?.(`${icon ? icon + " " : ""}${msg}`);
const $ = (id) => document.getElementById(id);

async function api(path, body) {
  const res = await fetch(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {});
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

let _entries = [];
let _conflicts = [];
let _cat = "all";
let _q = "";
let _editing = null; // index being corrected

function dayLabel(t) {
  if (!t) return "Before the timeline (date unknown)";
  const d = new Date(t);
  const today = new Date();
  const days = Math.round((new Date(today.toDateString()) - new Date(d.toDateString())) / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return d.toLocaleDateString([], { weekday: "long" });
  return d.toLocaleDateString([], { month: "long", day: "numeric", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

const SOURCE = { chat: "learned in chat", manual: "added by you", unknown: "" };

function entryHtml(e) {
  if (_editing === e.index) {
    return `<div class="tlItem" data-index="${e.index}">
      <form class="tlEdit" data-index="${e.index}"><input name="fact" value="${esc(e.fact)}" maxlength="300" />
      <button type="submit" class="memBtn">Save</button><button type="button" class="memBtn" data-act="cancel">Cancel</button></form></div>`;
  }
  const time = e.at ? new Date(e.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
  const from = [
    time,
    SOURCE[e.source] || "",
    e.quote ? `from “${esc(e.quote.length > 120 ? e.quote.slice(0, 120) + "…" : e.quote)}”` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return `<div class="tlItem" data-index="${e.index}">
    <span class="tlDot"></span>
    <div class="watchMain">
      <div class="tlFact"><span class="tlCat">${esc(e.category)}</span> ${esc(e.fact)}</div>
      ${from ? `<div class="watchMeta">${from}${e.chatId ? ` · <a href="#" data-chat="${esc(e.chatId)}">open chat</a>` : ""}</div>` : ""}
      ${e.was ? `<div class="watchHint">corrected — was “${esc(e.was)}”</div>` : ""}
    </div>
    <div class="watchBtns">
      <button class="memBtn" data-act="edit" title="Correct it">✎</button>
      <button class="memBtn" data-act="forget" title="Forget it">✕</button>
    </div>
  </div>`;
}

function render() {
  const body = $("tlBody");
  if (!body) return;
  const cats = _entries.reduce((m, e) => m.set(e.category, (m.get(e.category) || 0) + 1), new Map());
  $("tlCats").innerHTML = [["all", _entries.length], ...[...cats.entries()].sort((a, b) => b[1] - a[1])]
    .map(([c, n]) => `<button class="tlChip ${c === _cat ? "on" : ""}" data-cat="${esc(c)}">${esc(c)} ${n}</button>`)
    .join("");
  const q = _q.toLowerCase();
  const shown = _entries.filter((e) => (_cat === "all" || e.category === _cat) && (!q || e.fact.toLowerCase().includes(q) || e.quote.toLowerCase().includes(q)));
  const conflictHtml = _conflicts.length
    ? `<div class="tlConflicts"><b>These disagree. Keep the right one:</b>${_conflicts
        .map(
          (c) => `<div class="tlConflict">${c.facts
            .map((f) => `<button class="memBtn" data-keep="${f.index}" data-subject="${esc(c.subject)}" title="Keep this and forget the others">✓ ${esc(f.fact)}</button>`)
            .join("")}</div>`,
        )
        .join("")}</div>`
    : "";
  if (!shown.length) {
    body.innerHTML = conflictHtml + `<p class="watchEmpty">${_entries.length ? "Nothing matches." : "ARIA hasn't learned anything about you yet. Facts appear here as you chat."}</p>`;
    return;
  }
  let html = conflictHtml;
  let last = null;
  for (const e of shown) {
    const label = dayLabel(e.at);
    if (label !== last) {
      html += `<div class="tlDay">${esc(label)}</div>`;
      last = label;
    }
    html += entryHtml(e);
  }
  body.innerHTML = html;
  $("tlBody").querySelector(".tlEdit input")?.focus();
}

async function refresh() {
  try {
    const d = await api("/api/memory/timeline");
    _entries = d.entries;
    _conflicts = d.conflicts;
  } catch (e) {
    const body = $("tlBody");
    if (body) body.innerHTML = `<p class="watchErr">Couldn't load memory: ${esc(e.message)}</p>`;
    return;
  }
  render();
}

const factAt = (i) => _entries.find((e) => e.index === i)?.fact;

async function onClick(ev) {
  const chip = ev.target.closest("[data-cat]");
  if (chip) {
    _cat = chip.dataset.cat;
    return render();
  }
  const link = ev.target.closest("a[data-chat]");
  if (link) {
    ev.preventDefault();
    document.getElementById("ariaQuickModal")?.style.setProperty("display", "none");
    return window.ARIA_loadChat?.(link.dataset.chat);
  }
  const keep = ev.target.closest("[data-keep]");
  if (keep) {
    const c = _conflicts.find((x) => x.subject === keep.dataset.subject);
    // Forget the others, highest index first so the rest don't shift.
    const drop = c.facts.filter((f) => String(f.index) !== keep.dataset.keep).sort((a, b) => b.index - a.index);
    try {
      for (const f of drop) await api("/api/memory/forget", { index: f.index, expect: f.fact });
      toast(`Kept: ${c.facts.find((f) => String(f.index) === keep.dataset.keep).fact}`, "🧠");
    } catch (e) {
      toast(e.message, "✗");
    }
    return refresh();
  }
  const btn = ev.target.closest("button[data-act]");
  if (!btn) return;
  const index = Number(btn.closest("[data-index]")?.dataset.index);
  if (btn.dataset.act === "edit") {
    _editing = index;
    return render();
  }
  if (btn.dataset.act === "cancel") {
    _editing = null;
    return render();
  }
  if (btn.dataset.act === "forget") {
    const fact = factAt(index);
    if (!confirm(`Forget this?\n\n${fact}`)) return;
    try {
      await api("/api/memory/forget", { index, expect: fact });
    } catch (e) {
      toast(e.message, "✗");
    }
    refresh();
  }
}

async function onSubmit(ev) {
  const form = ev.target.closest("form.tlEdit");
  if (!form) return;
  ev.preventDefault();
  const index = Number(form.dataset.index);
  try {
    await api("/api/memory/edit", { index, fact: form.fact.value, expect: factAt(index) });
    _editing = null;
    toast("Corrected.", "🧠");
  } catch (e) {
    return toast(e.message, "✗");
  }
  refresh();
}

export function showMemoryTimeline() {
  const show = window.ARIA_showQuickModal;
  if (!show) return;
  _editing = null;
  show(
    "What ARIA knows about you",
    `<p class="watchHint">Everything ARIA has learned, newest first, with where it came from. Correct anything that's wrong (✎) or make her forget it (✕).</p>
     <div class="watchFormRow"><input id="tlSearch" placeholder="Search…" style="flex:1" /></div>
     <div id="tlCats" class="tlCats"></div>
     <div id="tlBody"><p class="watchEmpty">Loading…</p></div>`,
  );
  const body = $("tlBody");
  body.addEventListener("click", onClick);
  body.addEventListener("submit", onSubmit);
  $("tlCats").addEventListener("click", onClick);
  $("tlSearch").addEventListener("input", (e) => {
    _q = e.target.value;
    render();
  });
  _q = "";
  refresh();
}

export function initMemoryTimeline() {
  window.ARIA_showMemoryTimeline = showMemoryTimeline;
}
