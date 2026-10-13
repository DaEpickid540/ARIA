// selftest.js — the "Check ARIA" panel: runs every check (models, the PC
// relays, storage, sync, jobs, recent errors, and the test suite if asked)
// and lists what's broken first, each with what to do about it.
// Server: lib/selftest.js, POST /api/selftest, GET /api/selftest/last.

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
const $ = (id) => document.getElementById(id);

const ICON = { ok: "✓", warn: "⚠", fail: "✗", off: "○" };
const ORDER = { fail: 0, warn: 1, ok: 2, off: 3 };
let running = false;

function render(r) {
  const box = $("stResults");
  if (!box) return;
  if (!r?.results) {
    box.innerHTML = `<p class="watchHint">No check has run since ARIA started.</p>`;
    return;
  }
  const when = new Date(r.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const head = r.summary.split("\n")[0];
  const cls = head.startsWith("✗") ? "fail" : head.startsWith("⚠") ? "warn" : "ok";
  // Grouped, and within a group what's broken comes first.
  const groups = [];
  for (const x of r.results) if (!groups.includes(x.group)) groups.push(x.group);
  const worst = (g) => Math.min(...r.results.filter((x) => x.group === g).map((x) => ORDER[x.status]));
  groups.sort((a, b) => worst(a) - worst(b));
  box.innerHTML =
    `<div class="stHead st-${cls}">${esc(head)}</div>
     <p class="watchHint">Checked ${esc(when)} on ${esc(r.where || "this server")} in ${(r.ms / 1000).toFixed(1)}s${r.full ? ", with the test suite" : ""}.</p>` +
    groups
      .map(
        (g) => `<div class="practiceHead">${esc(g)}</div>` +
          r.results
            .filter((x) => x.group === g)
            .sort((a, b) => ORDER[a.status] - ORDER[b.status])
            .map(
              (x) => `<div class="stRow st-${x.status}">
                <span class="stIcon" title="${x.status}">${ICON[x.status] || "?"}</span>
                <div class="stMain"><b>${esc(x.name)}</b> <span class="watchMeta">${esc(x.detail)}</span>
                ${x.fix && x.status !== "ok" ? `<div class="stFix">→ ${esc(x.fix)}</div>` : ""}</div>
              </div>`,
            )
            .join(""),
      )
      .join("");
}

async function run() {
  if (running) return;
  running = true;
  const btn = $("stGo");
  const full = $("stFull").checked;
  btn.disabled = true;
  btn.textContent = full ? "Checking (the tests take a minute or two)…" : "Checking…";
  try {
    const res = await fetch("/api/selftest", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ full }) });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
    render(d);
  } catch (e) {
    const box = $("stResults");
    if (box) box.innerHTML = `<p class="watchErr">✗ The check itself failed: ${esc(e.message)}</p>`;
  } finally {
    running = false;
    if ($("stGo")) {
      $("stGo").disabled = false;
      $("stGo").textContent = "Run checks";
    }
  }
}

export function showSelfTest() {
  const show = window.ARIA_showQuickModal;
  if (!show) return;
  show(
    "Check ARIA",
    `<div class="watchFormRow">
       <button class="memBtn" id="stGo">Run checks</button>
       <label title="Runs npm test on this machine. Takes a minute or two."><input type="checkbox" id="stFull" /> also run the test suite</label>
     </div>
     <p class="watchHint">Pings each model provider, the PC relays, storage, sync and the scheduled jobs, and reads the last day of errors. ○ means not set up, which is fine.</p>
     <div id="stResults"></div>`,
  );
  $("stGo").addEventListener("click", run);
  fetch("/api/selftest/last")
    .then((r) => r.json())
    .then((d) => (d.results ? render(d) : run()))
    .catch(() => run());
}

export function initSelfTest() {
  window.ARIA_showSelfTest = showSelfTest;
  document.getElementById("tool_selftest")?.addEventListener("click", () => {
    document.getElementById("toolsDropdown")?.style.setProperty("display", "none");
    showSelfTest();
  });
}
