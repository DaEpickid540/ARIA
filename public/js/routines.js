// routines.js — the Routines panel (it replaces the old Macros modal).
// A routine is Claw steps with blanks that ARIA was taught (lib/routines.js):
// record what ARIA does on the PC, or just describe it, and ARIA writes a
// reusable version; run it once or "for each" item. Anything risky asks for
// your OK first, for the whole run at once.

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

let _routines = [];
let _recorded = null; // steps from the last recording, waiting to be taught
let _draft = null; // a routine the model wrote, waiting to be saved

function legacyMacros() {
  try {
    return JSON.parse(localStorage.getItem("aria_macros") || "{}");
  } catch {
    return {};
  }
}

function routineHtml(r) {
  const params = r.params.map((p) => p.name).join(", ");
  return `<div class="watchRow" data-name="${esc(r.name)}">
    <div class="watchMain">
      <div class="watchTitle"><b>${esc(r.name)}</b>${params ? ` <span class="watchMeta">(${esc(params)})</span>` : ""}${r.untrusted ? ` <span class="watchState off" title="Taught in a chat that read web pages: every run asks first. Check the steps and click Trust to stop that.">asks every run</span> <button class="memBtn" data-act="trust">Trust</button>` : ""}</div>
      <div class="watchWhat">${esc(r.description || "")}</div>
      <details class="routineSteps"><summary class="watchMeta">${r.steps.length} step${r.steps.length === 1 ? "" : "s"} · run ${r.runs || 0}×</summary>
        <ol>${r.steps.map((s) => `<li><code>${esc(s)}</code></li>`).join("")}</ol>
      </details>
      <div class="routineRun" hidden></div>
    </div>
    <div class="watchBtns">
      <button class="memBtn" data-act="run" title="Run">▶</button>
      <button class="memBtn" data-act="delete" title="Delete">✕</button>
    </div>
  </div>`;
}

function runFormHtml(r) {
  const one = r.params.length === 1;
  const fields = r.params
    .map((p) => `<label class="debriefRow">${esc(p.name)}${p.desc ? ` <span class="watchMeta">${esc(p.desc)}</span>` : ""}
      <input name="p_${esc(p.name)}" placeholder="${esc(p.desc || p.name)}" style="flex:1;min-width:160px" /></label>`)
    .join("");
  return `<form class="watchForm routineRunForm">
    ${fields}
    ${one ? `<label class="debriefRow"><input type="checkbox" name="many" /> one run per line:</label>
      <textarea name="each" rows="3" hidden placeholder="one ${esc(r.params[0].name)} per line (up to 20)"></textarea>` : ""}
    <div class="watchFormRow"><button type="submit" class="memBtn">Run</button><span class="watchHint routineOut"></span></div>
  </form>`;
}

function render() {
  const list = document.getElementById("routinesList");
  if (!list) return;
  list.innerHTML = _routines.length
    ? _routines.map(routineHtml).join("")
    : `<p class="watchEmpty">No routines yet. Record ARIA doing something on the PC and teach it, or describe one below.</p>`;
  const legacy = Object.entries(legacyMacros());
  const old = document.getElementById("routinesLegacy");
  if (old)
    old.innerHTML = legacy.length
      ? `<p class="watchHint">Recordings saved in this browser (from the old Macros panel) — teach one to make it a routine:</p>` +
        legacy
          .map(([n, m]) => `<div class="watchRow"><div class="watchMain"><span class="watchTitle">${esc(n)}</span> <span class="watchMeta">${(m.steps || []).length} steps</span></div>
            <div class="watchBtns"><button class="memBtn" data-legacy="${esc(n)}">Teach</button></div></div>`)
          .join("")
      : "";
  renderTeach();
}

function renderTeach() {
  const box = document.getElementById("routineTeach");
  if (!box) return;
  if (_draft) {
    box.innerHTML = `<p class="watchHint">ARIA wrote this routine. Check the steps, then save it.</p>
      <div class="watchTitle"><b>${esc(_draft.name)}</b> <span class="watchMeta">(${esc(_draft.params.map((p) => p.name).join(", ") || "no blanks")})</span></div>
      <div class="watchWhat">${esc(_draft.description)}</div>
      <ol>${_draft.steps.map((s) => `<li><code>${esc(s)}</code></li>`).join("")}</ol>
      <div class="watchFormRow"><button class="memBtn" id="draftSave">Save routine</button><button class="memBtn" id="draftDrop">Discard</button></div>`;
    return;
  }
  box.innerHTML = `<form id="teachForm" class="watchForm" autocomplete="off">
      ${_recorded ? `<p class="watchHint">Recorded ${_recorded.length} step${_recorded.length === 1 ? "" : "s"}. Say what the routine should do with them (what changes each time):</p>` : `<p class="watchHint">Or describe a routine and ARIA writes the steps:</p>`}
      <input name="name" placeholder="Name, e.g. backup-file" maxlength="40" />
      <input name="description" placeholder="${_recorded ? "e.g. do this for any file I give you" : "e.g. copy a file into D:\\Backup, then open that folder"}" maxlength="300" ${_recorded ? "" : "required"} />
      <div class="watchFormRow"><button type="submit" class="memBtn">Teach</button>${_recorded ? `<button type="button" class="memBtn" id="recDrop">Forget recording</button>` : ""}</div>
    </form>`;
}

async function refresh() {
  try {
    _routines = (await api("/api/routines")).routines || [];
  } catch (e) {
    toast(`✗ ${e.message}`);
  }
  render();
}

async function teach(body) {
  const btn = document.querySelector("#teachForm button[type=submit]");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "ARIA is writing it…";
  }
  try {
    _draft = (await api("/api/routines/teach", { method: "POST", body: JSON.stringify(body) })).routine;
  } catch (e) {
    toast(`✗ ${e.message}`);
  }
  renderTeach();
}

async function runRoutine(row, form) {
  const r = _routines.find((x) => x.name === row.dataset.name);
  const out = form.querySelector(".routineOut");
  const values = {};
  for (const p of r.params) values[p.name] = form[`p_${p.name}`]?.value.trim() || "";
  const many = form.many?.checked;
  const each = many ? form.each.value.split("\n").map((s) => s.trim()).filter(Boolean) : null;
  out.textContent = "Running…";
  try {
    const res = await api(`/api/routines/${encodeURIComponent(r.name)}/run`, {
      method: "POST",
      body: JSON.stringify(many ? { each } : { values }),
    });
    if (res.confirm) {
      out.innerHTML = "";
      const box = document.createElement("div");
      box.className = "routineConfirm";
      box.innerHTML = `<p class="watchErr">Needs your OK — ${esc(res.confirm.reason)}:</p><pre>${esc(res.confirm.action)}</pre>
        <div class="watchFormRow"><button class="memBtn" data-ok="1">Run it</button><button class="memBtn" data-ok="0">Cancel</button></div>`;
      out.after(box);
      box.addEventListener("click", async (e) => {
        const b = e.target.closest("button[data-ok]");
        if (!b) return;
        box.querySelectorAll("button").forEach((x) => (x.disabled = true));
        const d = await api("/api/confirm", { method: "POST", body: JSON.stringify({ id: res.confirm.id, approved: b.dataset.ok === "1" }) }).catch((err) => ({ ok: false, error: err.message }));
        box.remove();
        out.textContent = d.ok ? (d.output || d.message || "Done.") : `✗ ${d.error}`;
        refresh();
      });
      return;
    }
    out.textContent = res.output || "Done.";
    if (/runs in the background/.test(res.output || "")) toast("Running in the background — the result will be in 🔔 Alerts.");
    refresh();
  } catch (e) {
    out.textContent = `✗ ${e.message}`;
  }
}

async function onClick(e) {
  const t = e.target;
  if (t.id === "recStart") {
    await api("/api/claw/macro/record", { method: "POST", body: JSON.stringify({ chatId: window.ARIA_currentChatId?.() || null }) }).catch(() => {});
    t.textContent = "⏺ Recording… ask ARIA to do it";
    t.disabled = true;
    toast("Recording: now ask ARIA to do the task on your PC.");
    return;
  }
  if (t.id === "recStop") {
    const { steps = [] } = await api("/api/claw/macro/stop", { method: "POST" }).catch(() => ({}));
    _recorded = steps.length ? steps : null;
    if (!steps.length) toast("Nothing was recorded — ARIA didn't run any PC steps.");
    document.getElementById("recStart").disabled = false;
    document.getElementById("recStart").textContent = "⏺ Record";
    renderTeach();
    return;
  }
  if (t.id === "recDrop") {
    _recorded = null;
    renderTeach();
    return;
  }
  if (t.id === "draftDrop") {
    _draft = null;
    renderTeach();
    return;
  }
  if (t.id === "draftSave") {
    try {
      await api("/api/routines", { method: "POST", body: JSON.stringify(_draft) });
      toast(`✓ Saved ${_draft.name}. Run it here, or ask ARIA: "run ${_draft.name}…"`);
      _draft = null;
      _recorded = null;
    } catch (err) {
      toast(`✗ ${err.message}`);
    }
    refresh();
    return;
  }
  if (t.dataset.legacy) {
    _recorded = legacyMacros()[t.dataset.legacy]?.steps || null;
    renderTeach();
    document.querySelector("#teachForm input[name=name]")?.setAttribute("value", t.dataset.legacy);
    return;
  }
  const btn = t.closest("button[data-act]");
  const row = btn?.closest(".watchRow");
  if (!row) return;
  if (btn.dataset.act === "trust") {
    const r = _routines.find((x) => x.name === row.dataset.name);
    row.querySelector("details")?.setAttribute("open", "");
    if (!confirm(`Trust "${r.name}"? Its steps:\n\n${r.steps.join("\n")}\n\nAfter this, runs only ask first when a step is destructive.`)) return;
    const { untrusted, ...clean } = r;
    await api("/api/routines", { method: "POST", body: JSON.stringify(clean) }).catch((err) => toast(`✗ ${err.message}`));
    refresh();
    return;
  }
  if (btn.dataset.act === "delete") {
    if (!confirm(`Delete the routine "${row.dataset.name}"?`)) return;
    await api(`/api/routines/${encodeURIComponent(row.dataset.name)}`, { method: "DELETE" }).catch((err) => toast(`✗ ${err.message}`));
    refresh();
  } else if (btn.dataset.act === "run") {
    const box = row.querySelector(".routineRun");
    const r = _routines.find((x) => x.name === row.dataset.name);
    box.hidden = !box.hidden;
    if (!box.hidden) {
      box.innerHTML = runFormHtml(r);
      const f = box.querySelector("form");
      f.many?.addEventListener("change", () => {
        f.each.hidden = !f.many.checked;
        for (const i of f.querySelectorAll("input[name^=p_]")) i.closest("label").hidden = f.many.checked;
      });
      f.addEventListener("submit", (ev) => {
        ev.preventDefault();
        runRoutine(row, f);
      });
    }
  }
}

function onSubmit(e) {
  if (e.target.id !== "teachForm") return;
  e.preventDefault();
  const f = e.target;
  teach({ name: f.name.value.trim(), description: f.description.value.trim(), steps: _recorded || [] });
}

export function showRoutines() {
  const show = window.ARIA_showQuickModal;
  if (!show) return;
  show(
    "Routines",
    `<div id="routinesPanel"><p class="watchHint">Things ARIA learned to do on your PC, with blanks for what changes. Ask in chat — <i>"run backup-file for each file in my Downloads"</i> — or run them here. Anything risky asks first.</p>
     <div class="watchFormRow">
       <button class="memBtn" id="recStart">⏺ Record</button>
       <button class="memBtn" id="recStop">⏹ Stop</button>
     </div>
     <div id="routineTeach"></div>
     <div id="routinesList"><p class="watchEmpty">Loading…</p></div>
     <div id="routinesLegacy"></div></div>`,
  );
  // On a wrapper made fresh each time: the modal body is shared by every
  // panel, and listeners on it would pile up.
  const body = document.getElementById("routinesPanel");
  body?.addEventListener("click", onClick);
  body?.addEventListener("submit", onSubmit);
  refresh();
}

export function initRoutines() {
  // The sidebar's Macros button calls this name.
  window.ARIA_showMacros = showRoutines;
  window.ARIA_showRoutines = showRoutines;
}
