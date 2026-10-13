// grades.js — the Grades panel: each class against its line (90% = an A,
// unless you set another), and what the next assignment needs. The maths is
// lib/grades.js; telling ARIA "I got 41/50 on the bio quiz" does the same
// as the score form here.

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

let _data = { classes: [], target: 90 };
let _open = null; // the class whose forms are showing

function catOptions(c) {
  return (c.categories || []).map((k) => `<option value="${esc(k.name)}">${esc(k.name)} (${k.weight}%)</option>`).join("");
}

function classHtml(c) {
  const pct = c.pct == null ? "—" : `${c.pct}%`;
  const state = c.margin == null ? "" : c.margin < 0 ? "below" : c.margin < 2 ? "close" : "safe";
  const bar = c.pct == null ? 0 : Math.max(0, Math.min(100, c.pct));
  const cats = (c.categories || [])
    .map((k) => `${esc(k.name)} ${k.weight}%: ${k.possible ? `${k.earned}/${k.possible}` : "—"}`)
    .join(" · ");
  const next = c.next
    ? `<div class="gradeNext">Next: <b>${esc(c.next.title)}</b> (${c.next.points} pts${c.next.due ? `, due ${esc(c.next.due)}` : ""}) <button class="memBtn gradeTiny" data-act="drop" data-title="${esc(c.next.title)}" title="Remove from upcoming">✕</button>
         ${c.need ? `<div class="gradeNeed ${c.need.already ? "safe" : c.need.possible ? "" : "below"}">${esc(c.need.line)}</div>` : ""}</div>`
    : `<div class="watchHint">No upcoming assignment. Add one to see what it needs.</div>`;
  const open = _open === c.id;
  return `<div class="gradeRow ${state}" data-id="${esc(c.id)}">
    <div class="gradeHead">
      <span class="gradeName">${esc(c.name)}</span>
      <span class="gradePct">${pct}</span>
      <span class="watchHint">line ${c.target}%${c.margin != null ? ` · ${c.margin >= 0 ? "+" : ""}${c.margin}` : ""}</span>
      <span class="watchBtns">
        <button class="memBtn" data-act="toggle" title="Add a score or an assignment">${open ? "−" : "+"}</button>
        <button class="memBtn" data-act="delete" title="Delete class">✕</button>
      </span>
    </div>
    <div class="gradeBar"><i style="width:${bar}%"></i><b style="left:${Math.min(100, c.target)}%"></b></div>
    ${cats ? `<div class="watchMeta">${cats}</div>` : ""}
    ${next}
    ${
      open
        ? `<form class="watchForm" data-form="score" autocomplete="off">
             <div class="watchFormRow">
               <input name="title" placeholder="What (e.g. Quiz 3)" maxlength="80" />
               <input name="earned" type="number" step="any" min="0" placeholder="got" required style="width:70px" />
               <span>/</span>
               <input name="possible" type="number" step="any" min="0.1" placeholder="out of" required style="width:70px" />
               ${c.categories?.length ? `<select name="category">${catOptions(c)}</select>` : ""}
               <button type="submit" class="memBtn">Add score</button>
             </div>
           </form>
           <form class="watchForm" data-form="upcoming" autocomplete="off">
             <div class="watchFormRow">
               <input name="title" placeholder="Coming up (e.g. Unit 4 Test)" required maxlength="80" />
               <input name="points" type="number" step="any" min="0.1" placeholder="pts" required style="width:70px" />
               ${c.categories?.length ? `<select name="category">${catOptions(c)}</select>` : ""}
               <input name="due" type="date" />
               <button type="submit" class="memBtn">Add upcoming</button>
             </div>
           </form>`
        : ""
    }
  </div>`;
}

function render() {
  const list = document.getElementById("gradesList");
  if (!list) return;
  const where = document.getElementById("gradesWhere");
  if (where) where.textContent = _data.where ? `Stored on ${_data.where}.` : "";
  const t = document.getElementById("gradesTarget");
  if (t && document.activeElement !== t) t.value = _data.target;
  if (!_data.classes.length) {
    list.innerHTML = `<p class="watchEmpty">No classes yet. Add one below, or tell ARIA: <i>"add Bio to my grades: tests 50, quizzes 30, homework 20"</i>.</p>`;
    return;
  }
  // Riskiest first, ungraded last (the same order ARIA uses).
  const sorted = [..._data.classes].sort((a, b) => (a.margin ?? Infinity) - (b.margin ?? Infinity));
  list.innerHTML = sorted.map(classHtml).join("");
}

async function refresh() {
  try {
    _data = await api("/api/grades");
  } catch (e) {
    const list = document.getElementById("gradesList");
    if (list) list.innerHTML = `<p class="watchErr">Couldn't load grades: ${esc(e.message)}</p>`;
    return;
  }
  render();
}

async function onClick(e) {
  const btn = e.target.closest("button[data-act]");
  if (!btn) return;
  const id = btn.closest(".gradeRow")?.dataset.id;
  if (!id) return;
  const act = btn.dataset.act;
  if (act === "toggle") {
    _open = _open === id ? null : id;
    return render();
  }
  try {
    if (act === "delete") {
      if (!confirm("Delete this class and its grades?")) return;
      await api(`/api/grades/${encodeURIComponent(id)}`, { method: "DELETE" });
    } else if (act === "drop") {
      await api(`/api/grades/${encodeURIComponent(id)}/upcoming/${encodeURIComponent(btn.dataset.title)}`, { method: "DELETE" });
    }
  } catch (err) {
    toast(err.message, "✗");
  }
  refresh();
}

async function onSubmit(e) {
  const form = e.target.closest("form[data-form]");
  if (!form) return;
  e.preventDefault();
  const id = form.closest(".gradeRow")?.dataset.id;
  const f = Object.fromEntries(new FormData(form));
  try {
    if (form.dataset.form === "score") {
      const { pct } = await api(`/api/grades/${encodeURIComponent(id)}/score`, { method: "POST", body: JSON.stringify(f) });
      toast(`Recorded. Now ${pct}%.`, "📝");
    } else {
      await api(`/api/grades/${encodeURIComponent(id)}/upcoming`, { method: "POST", body: JSON.stringify(f) });
    }
  } catch (err) {
    return toast(err.message, "✗");
  }
  refresh();
}

async function onAddClass(e) {
  e.preventDefault();
  const form = e.target;
  try {
    await api("/api/grades/class", {
      method: "POST",
      body: JSON.stringify({ name: form.name.value.trim(), weights: form.weights.value.trim(), target: form.target.value }),
    });
    form.reset();
  } catch (err) {
    return toast(err.message, "✗");
  }
  refresh();
}

async function onTarget(e) {
  try {
    await api("/api/grades/target", { method: "POST", body: JSON.stringify({ target: e.target.value }) });
  } catch (err) {
    toast(err.message, "✗");
  }
  refresh();
}

export function showGrades() {
  const show = window.ARIA_showQuickModal;
  if (!show) return;
  show(
    "Grades",
    `<p class="watchHint">The class closest to its line is first. ARIA uses this for "what do I need on the test?", "what should I study?" and the morning briefing. <span id="gradesWhere"></span></p>
     <div class="watchFormRow"><label>A line for every class: <input id="gradesTarget" type="number" min="50" max="100" step="0.5" style="width:70px" />%</label></div>
     <div id="gradesList"><p class="watchEmpty">Loading…</p></div>
     <form id="gradeClassForm" class="watchForm" autocomplete="off">
       <div class="watchFormRow">
         <input name="name" placeholder="Class (e.g. AP Bio)" required maxlength="60" />
         <input name="target" type="number" min="50" max="100" step="0.5" placeholder="line %" style="width:80px" title="Leave blank to use the line above" />
       </div>
       <input name="weights" placeholder="Weights, if it has them: Tests 50, Quizzes 30, Homework 20 (blank = total points)" maxlength="300" />
       <div class="watchFormRow"><button type="submit" class="memBtn">Add class</button></div>
     </form>`,
  );
  const list = document.getElementById("gradesList");
  list?.addEventListener("click", onClick);
  list?.addEventListener("submit", onSubmit);
  document.getElementById("gradeClassForm")?.addEventListener("submit", onAddClass);
  document.getElementById("gradesTarget")?.addEventListener("change", onTarget);
  refresh();
}

export function initGrades() {
  window.ARIA_showGrades = showGrades;
  document.getElementById("tool_grades")?.addEventListener("click", () => {
    document.getElementById("toolsDropdown")?.style.setProperty("display", "none");
    showGrades();
  });
}
