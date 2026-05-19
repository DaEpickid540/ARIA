// taskPanel.js — Cowork/Copilot-style task dashboard (Mark 1.4)
// ═══════════════════════════════════════════════════════════════════
//
// Renders:
//   • List of all tasks (running, queued, scheduled, done, error)
//   • Per-task expanded view with steps, live progress, output
//   • Create-task form with auto-execute toggle, schedule picker
//   • Live updates via SSE — no polling
//
// Mount with: initTaskPanel()  — wires the existing #bgTasksModal
//
// ═══════════════════════════════════════════════════════════════════

let _eventSource = null;
let _reconnectDelay = 1000;
let _cachedTasks = new Map();
let _expandedTaskId = null;

const STATUS_META = {
  planning:           { icon: "🧠", color: "#888ee0", label: "Planning"   },
  awaiting_approval:  { icon: "⏸",  color: "#ffc107", label: "Awaiting approval" },
  running:            { icon: "⚙",  color: "#4cff4c", label: "Running"    },
  paused:             { icon: "⏸",  color: "#ffaa44", label: "Paused"     },
  scheduled:          { icon: "⏰", color: "#80c0ff", label: "Scheduled"  },
  done:               { icon: "✓",  color: "#4cff4c", label: "Done"       },
  error:              { icon: "✗",  color: "#ff4444", label: "Error"      },
  cancelled:          { icon: "—",  color: "#888888", label: "Cancelled"  },
};

function fmtTime(ts) {
  if (!ts) return "—";
  const ms = Date.now() - ts;
  if (ms < 60_000) return Math.floor(ms / 1000) + "s ago";
  if (ms < 3_600_000) return Math.floor(ms / 60_000) + "m ago";
  if (ms < 86_400_000) return Math.floor(ms / 3_600_000) + "h ago";
  return new Date(ts).toLocaleDateString();
}

function fmtDuration(ms) {
  if (!ms) return "—";
  if (ms < 1000) return ms + "ms";
  if (ms < 60_000) return (ms / 1000).toFixed(1) + "s";
  return Math.floor(ms / 60_000) + "m " + Math.floor((ms % 60_000) / 1000) + "s";
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}

// ── SSE connection ────────────────────────────────────────────
function connectSSE() {
  try {
    _eventSource?.close();
  } catch {}
  _eventSource = new EventSource("/api/tasks/subscribe");
  _eventSource.onopen = () => {
    _reconnectDelay = 1000;
  };
  _eventSource.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data.type === "snapshot") {
        _cachedTasks.clear();
        data.tasks.forEach((t) => _cachedTasks.set(t.id, t));
      } else if (data.type === "created" || data.type === "updated") {
        _cachedTasks.set(data.task.id, data.task);
        maybeShowToast(data.task);
      } else if (data.type === "deleted") {
        _cachedTasks.delete(data.id);
      }
      renderTaskList();
      if (_expandedTaskId && _cachedTasks.has(_expandedTaskId)) {
        renderTaskDetail(_cachedTasks.get(_expandedTaskId));
      }
    } catch {}
  };
  _eventSource.onerror = () => {
    try { _eventSource.close(); } catch {}
    _eventSource = null;
    setTimeout(connectSSE, _reconnectDelay);
    _reconnectDelay = Math.min(_reconnectDelay * 1.5, 20000);
  };
}

// ── Toast notifications ───────────────────────────────────────
const _toastedTasks = new Map(); // id → lastStatus we toasted
function maybeShowToast(task) {
  const last = _toastedTasks.get(task.id);
  if (last === task.status) return;
  _toastedTasks.set(task.id, task.status);
  // Only toast meaningful transitions
  if (task.status === "done") showToast(`✓ Task done: ${task.title}`, "ok");
  else if (task.status === "error") showToast(`✗ Task failed: ${task.title}`, "err");
  else if (task.status === "awaiting_approval")
    showToast(`📋 Plan ready: ${task.title}`, "info");
}

function showToast(text, kind = "info") {
  let host = document.getElementById("taskToastHost");
  if (!host) {
    host = document.createElement("div");
    host.id = "taskToastHost";
    document.body.appendChild(host);
  }
  const el = document.createElement("div");
  el.className = `taskToast taskToast-${kind}`;
  el.innerHTML = `<span class="taskToastText">${esc(text)}</span>`;
  el.addEventListener("click", () => {
    document.getElementById("bgTasksModal")?.style.setProperty("display", "flex");
    el.remove();
  });
  host.appendChild(el);
  setTimeout(() => el.classList.add("show"), 10);
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 300);
  }, 6000);
}

// ── Rendering ─────────────────────────────────────────────────
function renderTaskList() {
  const listEl = document.getElementById("bgTasksList");
  if (!listEl) return;

  const tasks = [..._cachedTasks.values()].sort(
    (a, b) => b.updated - a.updated,
  );

  if (!tasks.length) {
    listEl.innerHTML = `
      <div class="tpEmpty">
        <div class="tpEmptyIcon">⚙</div>
        <div class="tpEmptyTitle">No background tasks yet</div>
        <div class="tpEmptyHint">Use the form below to create one.</div>
      </div>`;
    return;
  }

  listEl.innerHTML = tasks
    .map((t) => {
      const meta = STATUS_META[t.status] || STATUS_META.error;
      const progress = t.steps?.length
        ? `${t.steps.filter((s) => s.status === "done").length}/${t.steps.length}`
        : "—";
      const isExpanded = _expandedTaskId === t.id;
      return `
        <div class="tpTaskCard ${isExpanded ? "expanded" : ""}" data-id="${t.id}">
          <div class="tpTaskRow" data-toggle="${t.id}">
            <span class="tpStatusBadge" style="color:${meta.color};border-color:${meta.color}">
              ${meta.icon} ${meta.label}
            </span>
            <div class="tpTaskMain">
              <div class="tpTaskTitle">${esc(t.title)}</div>
              <div class="tpTaskMeta">${progress} steps · ${fmtTime(t.updated)}${t.schedule?.cron ? " · ⏰ " + esc(t.schedule.cron) : ""}</div>
            </div>
            <div class="tpTaskActions">
              ${renderTaskActions(t)}
            </div>
          </div>
          ${isExpanded ? `<div class="tpTaskDetail" id="tpDetail_${t.id}"></div>` : ""}
        </div>`;
    })
    .join("");

  // Wire row clicks
  listEl.querySelectorAll("[data-toggle]").forEach((row) => {
    row.addEventListener("click", (e) => {
      if (e.target.closest(".tpTaskActions")) return;
      const id = row.dataset.toggle;
      _expandedTaskId = _expandedTaskId === id ? null : id;
      renderTaskList();
      if (_expandedTaskId && _cachedTasks.has(_expandedTaskId)) {
        renderTaskDetail(_cachedTasks.get(_expandedTaskId));
      }
    });
  });
  // Wire action buttons
  listEl.querySelectorAll("[data-action]").forEach((btn) =>
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = btn.dataset.taskId;
      const action = btn.dataset.action;
      btn.disabled = true;
      try {
        if (action === "delete") {
          if (!confirm("Delete this task?")) return;
          await fetch(`/api/tasks/${id}`, { method: "DELETE" });
        } else {
          await fetch(`/api/tasks/${id}/${action}`, { method: "POST" });
        }
      } finally {
        btn.disabled = false;
      }
    }),
  );
}

function renderTaskActions(t) {
  const btns = [];
  if (t.status === "running")
    btns.push(`<button class="tpBtn" data-action="pause" data-task-id="${t.id}" title="Pause">⏸</button>`);
  if (t.status === "paused")
    btns.push(`<button class="tpBtn" data-action="resume" data-task-id="${t.id}" title="Resume">▶</button>`);
  if (t.status === "awaiting_approval")
    btns.push(`<button class="tpBtn tpBtnPrimary" data-action="approve" data-task-id="${t.id}">▶ Approve</button>`);
  if (["running", "paused", "planning", "awaiting_approval", "scheduled"].includes(t.status))
    btns.push(`<button class="tpBtn" data-action="cancel" data-task-id="${t.id}" title="Cancel">✕</button>`);
  btns.push(`<button class="tpBtn tpBtnDel" data-action="delete" data-task-id="${t.id}" title="Delete">🗑</button>`);
  return btns.join("");
}

function renderTaskDetail(t) {
  const el = document.getElementById(`tpDetail_${t.id}`);
  if (!el) return;
  const stepsHtml = (t.steps || [])
    .map((s, i) => {
      const sm = STATUS_META[s.status] || STATUS_META.error;
      const dur =
        s.startedAt && s.completedAt ? fmtDuration(s.completedAt - s.startedAt) : "";
      return `
        <div class="tpStep tpStep-${s.status}">
          <div class="tpStepHeader">
            <span class="tpStepIcon" style="color:${sm.color}">${sm.icon}</span>
            <span class="tpStepNum">${i + 1}.</span>
            <span class="tpStepTitle">${esc(s.title)}</span>
            ${dur ? `<span class="tpStepDur">${dur}</span>` : ""}
          </div>
          ${s.description ? `<div class="tpStepDesc">${esc(s.description)}</div>` : ""}
          ${
            s.output
              ? `<details class="tpStepOutput"><summary>Output</summary><pre>${esc(String(s.output).slice(0, 5000))}${String(s.output).length > 5000 ? "\n…(truncated)" : ""}</pre></details>`
              : ""
          }
        </div>`;
    })
    .join("");

  const logHtml = (t.log || [])
    .slice(-12)
    .map(
      (l) =>
        `<div class="tpLogLine"><span class="tpLogTime">${new Date(l.ts).toLocaleTimeString()}</span> ${esc(l.msg)}</div>`,
    )
    .join("");

  el.innerHTML = `
    <div class="tpDetailDesc"><em>Description:</em> ${esc(t.description)}</div>
    ${t.error ? `<div class="tpDetailError">❌ ${esc(t.error)}</div>` : ""}
    ${t.note ? `<div class="tpDetailNote">${esc(t.note)}</div>` : ""}
    ${t.steps?.length ? `<div class="tpStepsContainer">${stepsHtml}</div>` : "<div class='tpHint'>No steps yet — planning in progress.</div>"}
    ${t.result && t.status === "done" ? `<details class="tpFinalResult" open><summary>Final result</summary><pre>${esc(String(t.result).slice(0, 8000))}</pre></details>` : ""}
    ${logHtml ? `<details class="tpLog"><summary>Activity log</summary>${logHtml}</details>` : ""}
  `;
}

// ── Create-task form ──────────────────────────────────────────
function wireCreateForm() {
  const form = document.getElementById("tpCreateForm");
  if (!form || form.dataset.wired) return;
  form.dataset.wired = "1";

  const submitBtn = form.querySelector(".tpSubmitBtn");
  submitBtn.addEventListener("click", async () => {
    const desc = form.querySelector("textarea").value.trim();
    if (!desc) return;
    const autoExec = form.querySelector(".tpAutoExec").checked;
    const scheduleType = form.querySelector(".tpScheduleType").value;
    const personality = form.querySelector(".tpPersonality").value;

    let schedule = null;
    if (scheduleType === "once") {
      const dt = form.querySelector(".tpScheduleAt").value;
      if (dt) schedule = { runAt: new Date(dt).getTime() };
    } else if (scheduleType === "cron") {
      const cronStr = form.querySelector(".tpScheduleCron").value.trim();
      if (cronStr) {
        schedule = { cron: cronStr, nextRun: Date.now() + 30_000 };
      }
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Creating…";
    try {
      const res = await fetch("/api/tasks/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: desc,
          autoExecute: autoExec,
          personality,
          schedule,
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      form.querySelector("textarea").value = "";
      _expandedTaskId = data.task.id;
    } catch (e) {
      alert("Failed to create task: " + e.message);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Create Task";
    }
  });

  // Toggle schedule field visibility
  const schSel = form.querySelector(".tpScheduleType");
  schSel.addEventListener("change", () => {
    form.querySelector(".tpScheduleOnceRow").style.display =
      schSel.value === "once" ? "flex" : "none";
    form.querySelector(".tpScheduleCronRow").style.display =
      schSel.value === "cron" ? "flex" : "none";
  });
}

// ── Initial mount ─────────────────────────────────────────────
export function initTaskPanel() {
  const modal = document.getElementById("bgTasksModal");
  if (!modal) return;

  const panel = modal.querySelector("#bgTasksPanel");
  if (panel && !panel.dataset.upgraded) {
    panel.dataset.upgraded = "1";
    panel.innerHTML = `
      <div id="bgTasksHeader">
        <h2>BACKGROUND TASKS</h2>
        <button id="bgTasksCloseBtn">✕</button>
      </div>
      <div class="tpBody">
        <div id="bgTasksList" class="tpList"></div>
        <div id="tpCreateForm" class="tpCreateForm">
          <div class="tpCreateHeader">+ New Task</div>
          <textarea placeholder="Describe what you want ARIA to do…&#10;&#10;Examples:&#10;• Research the top 5 open-source LLMs and summarize tradeoffs&#10;• Write a 500-word post about my ESP32 smartwatch&#10;• Every weekday at 9am, summarize my unread emails"></textarea>
          <div class="tpCreateRow">
            <label class="tpCheck">
              <input type="checkbox" class="tpAutoExec" checked>
              <span>Auto-execute (uncheck to review plan first)</span>
            </label>
          </div>
          <div class="tpCreateRow">
            <label class="tpFieldLabel">Personality:</label>
            <select class="tpPersonality">
              <option value="hacker">Hacker</option>
              <option value="study">Study</option>
              <option value="math">Math</option>
              <option value="programming">Programming</option>
            </select>
            <label class="tpFieldLabel">Schedule:</label>
            <select class="tpScheduleType">
              <option value="now">Run now</option>
              <option value="once">Run once at…</option>
              <option value="cron">Recurring (cron)</option>
            </select>
          </div>
          <div class="tpCreateRow tpScheduleOnceRow" style="display:none">
            <label class="tpFieldLabel">When:</label>
            <input type="datetime-local" class="tpScheduleAt">
          </div>
          <div class="tpCreateRow tpScheduleCronRow" style="display:none">
            <label class="tpFieldLabel">Cron:</label>
            <input type="text" class="tpScheduleCron" placeholder="0 9 * * 1-5  (weekdays at 9am)">
          </div>
          <button class="tpSubmitBtn">Create Task</button>
        </div>
      </div>
    `;
    // Re-wire the close button since we replaced the markup
    document.getElementById("bgTasksCloseBtn").addEventListener("click", () => {
      modal.style.display = "none";
    });
  }

  wireCreateForm();
  connectSSE();
}

// Auto-init when DOM is ready (idempotent)
if (typeof window !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => setTimeout(initTaskPanel, 500));
  } else {
    setTimeout(initTaskPanel, 500);
  }
}
