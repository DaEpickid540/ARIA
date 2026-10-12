// accountsPanel.js — Settings ▸ Accounts: pairing codes and paired accounts
//
// "Make a pairing code" asks the server (lib/owners.js) for a code, shows it
// big with a countdown, and watches until some Google account redeems it on
// the lock screen. Paired accounts are shared by every ARIA server through
// Firestore, so the list is the same on the PC and on Render.

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

let _watch = null; // interval while a code is on screen

function stopWatch() {
  clearInterval(_watch);
  _watch = null;
}

function idleBox() {
  const box = document.getElementById("pairBox");
  if (!box) return;
  stopWatch();
  box.innerHTML = `<button type="button" class="primaryBtn" id="pairNewBtn">
      <i class="bi bi-plus-lg" aria-hidden="true"></i> Make a pairing code
    </button>`;
  box.querySelector("#pairNewBtn").addEventListener("click", makeCode);
}

async function makeCode() {
  const box = document.getElementById("pairBox");
  if (!box) return;
  box.innerHTML = `<p class="settingsHint">Making a code…</p>`;
  let d;
  try {
    const r = await fetch("/api/pair/code", { method: "POST" });
    d = await r.json();
    if (!r.ok || !d.ok) throw new Error(d.error || `HTTP ${r.status}`);
  } catch (e) {
    box.innerHTML = `<p class="settingsHint pairErr">Couldn't make a code: ${esc(e.message)}</p>`;
    setTimeout(idleBox, 4000);
    return;
  }

  box.innerHTML = `
    <div class="pairCode">
      <div class="pairCodeValue" aria-label="Pairing code">${esc(d.formatted)}</div>
      <div class="pairCodeMeta">
        <span id="pairCountdown"></span>
        <button type="button" class="secondaryBtn" id="pairCopyBtn"><i class="bi bi-clipboard" aria-hidden="true"></i> Copy</button>
        <button type="button" class="secondaryBtn" id="pairCancelBtn">Cancel</button>
      </div>
      <p class="settingsHint">On the other device, sign in with Google on ARIA's lock screen and enter this code.</p>
    </div>`;
  box.querySelector("#pairCancelBtn").addEventListener("click", idleBox);
  box.querySelector("#pairCopyBtn").addEventListener("click", async (e) => {
    try {
      await navigator.clipboard.writeText(d.formatted);
      e.currentTarget.innerHTML = `<i class="bi bi-check2" aria-hidden="true"></i> Copied`;
    } catch {}
  });

  const countdown = box.querySelector("#pairCountdown");
  const tick = () => {
    const left = Math.max(0, d.expiresAt - Date.now());
    const m = Math.floor(left / 60000);
    const s = String(Math.floor((left % 60000) / 1000)).padStart(2, "0");
    if (countdown) countdown.textContent = left ? `Expires in ${m}:${s}` : "Expired";
    return left;
  };
  tick();

  stopWatch();
  let n = 0;
  _watch = setInterval(async () => {
    if (!tick()) {
      stopWatch();
      box.innerHTML = `<p class="settingsHint">That code expired.</p>`;
      setTimeout(idleBox, 2500);
      return;
    }
    if (++n % 2) return; // ask the server every 2 s, tick every 1 s
    try {
      const s = await fetch(`/api/pair/code/${encodeURIComponent(d.code)}`).then((r) => r.json());
      if (s.status !== "claimed") return;
      stopWatch();
      box.innerHTML = `<p class="pairDone"><i class="bi bi-check-circle" aria-hidden="true"></i> Paired with ${esc(s.email || "a new account")}.</p>`;
      loadOwners();
      setTimeout(idleBox, 5000);
    } catch {}
  }, 1000);
}

async function loadOwners() {
  const list = document.getElementById("ownersList");
  if (!list) return;
  let d;
  try {
    d = await fetch("/api/pair/owners").then((r) => r.json());
  } catch {
    list.textContent = "Couldn't reach the server.";
    return;
  }
  const rows = (d.owners || []).map(
    (o) => `
      <div class="ownerRow" data-uid="${esc(o.uid)}">
        <i class="bi bi-person-circle" aria-hidden="true"></i>
        <div class="ownerWho">
          <div class="ownerEmail">${esc(o.email || o.uid)}</div>
          <div class="ownerMeta">Paired ${o.addedAt ? new Date(o.addedAt).toLocaleDateString() : ""}</div>
        </div>
        <button type="button" class="secondaryBtn ownerRemove" title="Remove this account">Remove</button>
      </div>`,
  );
  const env = (d.fromEnv || []).map(
    (who) => `
      <div class="ownerRow">
        <i class="bi bi-gear" aria-hidden="true"></i>
        <div class="ownerWho">
          <div class="ownerEmail">${esc(who)}</div>
          <div class="ownerMeta">Set in Keys (ARIA_OWNER_UID / ARIA_OWNER_EMAILS)</div>
        </div>
      </div>`,
  );
  list.innerHTML =
    (rows.length || env.length ? rows.join("") + env.join("") : `<p class="settingsHint">No accounts yet. Make a pairing code above.</p>`) +
    `<p class="settingsHint ownerScope">${
      d.shared
        ? "Shared with every ARIA server through Firebase: an account paired here works on Render too."
        : "Only this server knows these accounts. Add the Firebase service account under Keys to share them with Render."
    }</p>`;

  list.querySelectorAll(".ownerRemove").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const row = btn.closest(".ownerRow");
      const email = row.querySelector(".ownerEmail")?.textContent;
      if (!confirm(`Remove ${email}? It won't be able to sign in to ARIA until it's paired again.`)) return;
      btn.disabled = true;
      await fetch(`/api/pair/owners/${encodeURIComponent(row.dataset.uid)}`, { method: "DELETE" }).catch(() => {});
      loadOwners();
    }),
  );
}

export function initAccountsPanel() {
  document.querySelector('.settingsTab[data-tab="accounts"]')?.addEventListener("click", () => {
    loadOwners();
    if (!_watch) idleBox();
  });
  document.getElementById("pairNewBtn")?.addEventListener("click", makeCode);
}
