// screenfix.js — "Fix my screen": ARIA takes a screenshot through Claw,
// reads the error on it, and proposes steps (server: lib/screen-fix.js).
// The steps always wait for your OK here; after they run, "Check again"
// looks once more to see if it worked.

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

async function api(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.text || data.error || `HTTP ${res.status}`);
  return data;
}

/** The diagnosis text is markdown-ish: bold, `code` and numbered lines. */
function fmt(text) {
  return esc(text)
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(/\n/g, "<br>");
}

function setBusy(on, label) {
  const btn = document.getElementById("screenLook");
  if (!btn) return;
  btn.disabled = on;
  btn.textContent = on ? label : "Look at my screen";
}

async function look({ verify = false } = {}) {
  const out = document.getElementById("screenOut");
  const note = document.getElementById("screenNote")?.value.trim() || "";
  setBusy(true, verify ? "Looking again…" : "Taking a screenshot…");
  out.innerHTML = `<p class="watchHint">ARIA is looking at your screen. This takes a few seconds.</p>`;
  try {
    const d = await api("/api/screen/fix", { note, verify });
    out.innerHTML = `<div class="screenDiag">${fmt(d.text)}</div>` + (d.seenBy ? `<p class="watchHint">Screenshot read by ${esc(d.seenBy)}.</p>` : "");
    if (d.confirm) {
      const box = document.createElement("div");
      box.className = "routineConfirm";
      box.innerHTML = `<p class="watchErr">Run the fix? — ${esc(d.confirm.reason)}</p>
        <div class="watchFormRow"><button class="memBtn" data-ok="1">Run fix</button><button class="memBtn" data-ok="0">No</button></div>`;
      out.appendChild(box);
      box.addEventListener("click", async (e) => {
        const b = e.target.closest("button[data-ok]");
        if (!b) return;
        box.querySelectorAll("button").forEach((x) => (x.disabled = true));
        const ok = b.dataset.ok === "1";
        let r;
        try {
          r = await fetch("/api/confirm", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: d.confirm.id, approved: ok }),
          }).then((x) => x.json());
        } catch (err) {
          r = { ok: false, error: err.message };
        }
        box.innerHTML = r.ok
          ? `<p class="watchHint">${ok ? fmt(r.output || "Done.") : "Cancelled."}</p>` +
            (ok ? `<div class="watchFormRow"><button class="memBtn" id="screenVerify">Check again</button></div>` : "")
          : `<p class="watchErr">✗ ${esc(r.error)}</p>`;
        document.getElementById("screenVerify")?.addEventListener("click", () => look({ verify: true }));
      });
    }
  } catch (e) {
    out.innerHTML = `<p class="watchErr">✗ ${esc(e.message)}</p>`;
  } finally {
    setBusy(false);
  }
}

export function showScreenFix() {
  const show = window.ARIA_showQuickModal;
  if (!show) return;
  show(
    "Fix my screen",
    `<div id="screenPanel">
       <p class="watchHint">Put the error on screen, then let ARIA look. It reads what's wrong and suggests a fix; nothing runs until you say so. The screenshot is read by a vision model on this PC if Ollama has one, otherwise by OpenRouter's free model in the cloud.</p>
       <form id="screenForm" class="watchForm" autocomplete="off">
         <input id="screenNote" placeholder="What's wrong? (optional) e.g. VS Code won't build" maxlength="500" />
         <div class="watchFormRow"><button type="submit" class="memBtn" id="screenLook">Look at my screen</button></div>
       </form>
       <div id="screenOut"></div>
     </div>`,
  );
  document.getElementById("screenForm")?.addEventListener("submit", (e) => {
    e.preventDefault();
    look();
  });
}

export function initScreenFix() {
  window.ARIA_showScreenFix = showScreenFix;
  document.getElementById("tool_screenfix")?.addEventListener("click", () => {
    document.getElementById("toolsDropdown")?.style.setProperty("display", "none");
    showScreenFix();
  });
}
