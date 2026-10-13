// arena.js — the Arena panel: contenders answer side by side as they
// stream in, read each other and push back, then the judge's verdict.
// Past bouts and which model wins most are underneath. Server: lib/arena.js,
// POST /api/arena (one JSON event per line).

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
const md = (t) => (window.ARIA_renderMarkdown ? window.ARIA_renderMarkdown(String(t || "")) : esc(t).replace(/\n/g, "<br>"));
const $ = (id) => document.getElementById(id);

let running = null; // AbortController of the bout in progress
let bout = null; // { contenders: Map(name → col), verdict }

function colHtml(c) {
  return `<div class="arenaCol" data-name="${esc(c.name)}">
    <div class="arenaHead"><b>${esc(c.name.split(" (")[0])}</b><span class="watchHint">${esc(c.label)}</span></div>
    <div class="arenaSteps watchHint">thinking…</div>
    <div class="arenaAnswer"></div>
    <details class="arenaRebuttal" hidden><summary>After reading the others</summary><div></div></details>
  </div>`;
}
const col = (name) => [...document.querySelectorAll(".arenaCol")].find((c) => c.dataset.name === name);

function onEvent(e) {
  const stage = $("arenaStage");
  if (!stage) return;
  if (e.type === "lineup") {
    stage.innerHTML = `<p class="watchHint">${e.sameModel ? `Only one model is set up (${esc(e.contenders[0].label)}), so it competes against itself with different approaches. Add more provider keys for a real contest. ` : ""}Judge: ${esc(e.judge)}.</p>
      <div class="arenaCols">${e.contenders.map(colHtml).join("")}</div><div id="arenaVerdict"></div>`;
  } else if (e.type === "step") {
    const c = col(e.name);
    if (c) c.querySelector(".arenaSteps").textContent = e.msg.replace(/^.*? › /, "");
    else if (e.name === "Judge") $("arenaVerdict").innerHTML = `<p class="watchHint">${esc(e.msg)}</p>`;
  } else if (e.type === "answer") {
    const c = col(e.name);
    if (!c) return;
    c.querySelector(".arenaSteps").textContent = e.ok ? `answered in ${Math.round(e.ms / 1000)}s` : "failed";
    c.querySelector(".arenaAnswer").innerHTML = md(e.text);
  } else if (e.type === "rebuttal") {
    const c = col(e.name);
    if (!c || !e.text) return;
    const d = c.querySelector(".arenaRebuttal");
    d.hidden = false;
    d.open = true;
    d.querySelector("div").innerHTML = md(e.text);
  } else if (e.type === "verdict") {
    showVerdict(e.verdict, e.error, e.judge);
  } else if (e.type === "error") {
    stage.insertAdjacentHTML("beforeend", `<p class="watchErr">✗ ${esc(e.error)}</p>`);
  }
}

function showVerdict(v, error, judge) {
  const box = $("arenaVerdict");
  if (!box) return;
  if (!v) {
    box.innerHTML = `<p class="watchErr">No verdict: ${esc(error || "the judge didn't answer")}. Compare the answers yourself.</p>`;
    return;
  }
  for (const c of document.querySelectorAll(".arenaCol")) c.classList.toggle("winner", c.dataset.name === v.winner);
  box.innerHTML = `<div class="arenaVerdict">
    <div class="practiceHead">Verdict${judge ? ` · ${esc(judge)}` : ""}</div>
    <p><b>${v.winner === "tie" ? "A tie." : `🏆 ${esc(v.winner)}`}</b> ${esc(v.why)}</p>
    ${v.answer ? `<p>Answer: <b>${esc(v.answer)}</b></p>` : ""}
    ${v.mistakes?.length ? `<ul class="arenaMistakes">${v.mistakes.map((m) => `<li>${esc(m)}</li>`).join("")}</ul>` : ""}
    ${v.scores
      .map(
        (s) => `<div class="arenaScore"><span>${esc(s.name.split(" (")[0])}</span><i style="width:${(s.total / 40) * 100}%"></i><b>${s.total}/40</b>
          <small class="watchHint">correct ${s.correctness} · complete ${s.completeness} · clear ${s.clarity}${s.notes ? ` — ${esc(s.notes)}` : ""}</small></div>`,
      )
      .join("")}
  </div>`;
}

async function start(e) {
  e.preventDefault();
  const q = $("arenaQ").value.trim();
  if (!q || running) return;
  running = new AbortController();
  const btn = $("arenaGo");
  btn.textContent = "Stop";
  $("arenaStage").innerHTML = `<p class="watchHint">Setting up the contenders…</p>`;
  try {
    const res = await fetch("/api/arena", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: q, count: Number($("arenaCount").value) || 2, rebuttal: $("arenaRebut").checked }),
      signal: running.signal,
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line) onEvent(JSON.parse(line));
      }
    }
  } catch (err) {
    if (err.name !== "AbortError") $("arenaStage").insertAdjacentHTML("beforeend", `<p class="watchErr">✗ ${esc(err.message)}</p>`);
  } finally {
    running = null;
    if ($("arenaGo")) $("arenaGo").textContent = "Start";
    loadHistory();
  }
}

async function loadHistory() {
  const box = $("arenaHistory");
  if (!box) return;
  let d;
  try {
    d = await fetch("/api/arena").then((r) => r.json());
  } catch {
    return;
  }
  $("arenaModels").textContent = d.models.length ? `Models available: ${d.models.join(", ")}` : "No AI provider is set up yet.";
  const tally = d.tally.length
    ? `<div class="practiceHead">Who wins most</div>${d.tally.map((t) => `<div class="watchMeta">${esc(t.label)}: ${t.wins}/${t.plays} (${t.rate}%)</div>`).join("")}`
    : "";
  box.innerHTML =
    tally +
    (d.history.length
      ? `<div class="practiceHead">Past bouts</div>` +
        d.history
          .map(
            (b, i) => `<div class="watchRow"><div class="watchMain"><a href="#" data-bout="${i}" class="watchTitle">${esc(b.question.slice(0, 90))}</a>
              <div class="watchMeta">${b.verdict ? (b.verdict.winner === "tie" ? "tie" : `🏆 ${esc(b.verdict.winner)}`) : "no verdict"} · ${new Date(b.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</div></div></div>`,
          )
          .join("")
      : "");
  box.onclick = (e) => {
    const a = e.target.closest("[data-bout]");
    if (!a) return;
    e.preventDefault();
    const b = d.history[Number(a.dataset.bout)];
    $("arenaQ").value = b.question;
    onEvent({ type: "lineup", contenders: b.contenders, judge: b.judge, sameModel: b.sameModel });
    for (const c of b.contenders) {
      onEvent({ type: "answer", name: c.name, text: c.answer, ok: c.ok, ms: 0 });
      if (c.rebuttal) onEvent({ type: "rebuttal", name: c.name, text: c.rebuttal });
      const s = col(c.name)?.querySelector(".arenaSteps");
      if (s) s.textContent = "";
    }
    showVerdict(b.verdict, "no verdict was given", b.judge);
  };
}

export function showArena() {
  const show = window.ARIA_showQuickModal;
  if (!show) return;
  show(
    "Arena",
    `<form id="arenaForm" class="watchForm" autocomplete="off">
       <textarea id="arenaQ" rows="3" placeholder="A hard question, a homework problem, or code to check. They answer separately, push back on each other, and a judge picks the best." required maxlength="6000"></textarea>
       <div class="watchFormRow">
         <select id="arenaCount"><option value="2">2 contenders</option><option value="3">3 contenders</option></select>
         <label><input type="checkbox" id="arenaRebut" checked /> rebuttal round</label>
         <button type="submit" class="memBtn" id="arenaGo">Start</button>
       </div>
       <p class="watchHint" id="arenaModels"></p>
     </form>
     <div id="arenaStage"></div>
     <div id="arenaHistory"></div>`,
  );
  $("arenaForm").addEventListener("submit", (e) => {
    if (running) {
      e.preventDefault();
      running.abort();
      return;
    }
    start(e);
  });
  loadHistory();
}

export function initArena() {
  window.ARIA_showArena = showArena;
  document.getElementById("tool_arena")?.addEventListener("click", () => {
    document.getElementById("toolsDropdown")?.style.setProperty("display", "none");
    showArena();
  });
}
