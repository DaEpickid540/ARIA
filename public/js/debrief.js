// debrief.js — the Evening debrief panel: when ARIA writes the nightly
// look-back (server: lib/debrief.js), and whether it (and alerts) also go
// out as texts through aria-voice-hook.js. Opened from the Tools menu.

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const toast = (msg) => window.ARIA_showNotification?.(msg);

async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: { "Content-Type": "application/json", ...(opts.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function hourLabel(h) {
  const am = h < 12;
  const h12 = h % 12 || 12;
  return `${h12}:00 ${am ? "AM" : "PM"}`;
}

function hookStatus(seenAt) {
  // The hook talks to one server; texts still reach it from the other
  // through chat sync, so "not here" isn't "nowhere".
  if (!seenAt) return "The texting hook (aria-voice-hook.js) isn't connected to this server. If it runs against your other ARIA server, texts still go out from there.";
  const mins = Math.round((Date.now() - seenAt) / 60000);
  return mins <= 2
    ? "Texting hook connected to this server ✓ — texts go to the conversation that last unlocked with the password."
    : `Texting hook last checked in with this server ${mins < 120 ? `${mins} min` : `${Math.round(mins / 60)} h`} ago.`;
}

/** "America/New_York" → "ET"-ish short name, from the browser. */
function tzShort(tz) {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" })
      .formatToParts(new Date())
      .find((p) => p.type === "timeZoneName")?.value || tz;
  } catch {
    return tz || "";
  }
}

function render(cfg) {
  const hours = Array.from({ length: 24 }, (_, h) =>
    `<option value="${h}"${h === cfg.debrief.hour ? " selected" : ""}>${hourLabel(h)} ${esc(tzShort(cfg.tz))}</option>`).join("");
  return `
    <p class="watchHint">Each night ARIA looks back over your todos, background tasks, chats and alerts, and checks tomorrow's calendar: what got done, what slipped, what to start with. It lands in the 🌅 Daily briefings chat.</p>
    <form id="debriefForm" class="watchForm">
      <label class="debriefRow"><input type="checkbox" name="enabled"${cfg.debrief.enabled ? " checked" : ""}/> Write an evening debrief at
        <select name="hour">${hours}</select></label>
      <label class="debriefRow"><input type="checkbox" name="textDebrief"${cfg.text.debrief ? " checked" : ""}/> Text the nightly one to me too</label>
      <label class="debriefRow"><input type="checkbox" name="textAlerts"${cfg.text.alerts ? " checked" : ""}/> Text me watcher alerts as they happen</label>
      <p class="watchHint">${esc(hookStatus(cfg.hookSeenAt))}</p>
      <p class="watchHint">These settings, and the todo list it reads, belong to ${esc(cfg.where || "this server")}.</p>
      <div class="watchFormRow">
        <button type="button" class="memBtn" id="debriefNow">Write one now</button>
        <span id="debriefSaved" class="watchHint"></span>
      </div>
    </form>`;
}

async function save(form) {
  const body = {
    debrief: { enabled: form.enabled.checked, hour: Number(form.hour.value) },
    text: { debrief: form.textDebrief.checked, alerts: form.textAlerts.checked },
  };
  try {
    await api("/api/debrief/config", { method: "POST", body: JSON.stringify(body) });
    const s = document.getElementById("debriefSaved");
    if (s) s.textContent = "Saved ✓";
  } catch (e) {
    toast(`Couldn't save: ${e.message}`);
  }
}

export async function showDebrief() {
  const show = window.ARIA_showQuickModal;
  if (!show) return;
  let cfg;
  try {
    cfg = await api("/api/debrief/config");
  } catch (e) {
    toast(`Couldn't load debrief settings: ${e.message}`);
    return;
  }
  show("Evening debrief", render(cfg));
  const form = document.getElementById("debriefForm");
  form?.addEventListener("change", () => save(form));
  document.getElementById("debriefNow")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = "Writing…";
    try {
      await api("/api/debrief/trigger", { method: "POST" });
      // Filed in the briefings chat; open it.
      window.ARIA_resyncChats?.();
      setTimeout(() => window.ARIA_loadChat?.("chat_briefings"), 600);
      document.getElementById("ariaQuickModal")?.style.setProperty("display", "none");
    } catch (err) {
      toast(`Debrief failed: ${err.message}`);
    } finally {
      btn.disabled = false;
      btn.textContent = "Write one now";
    }
  });
}

export function initDebrief() {
  window.ARIA_showDebrief = showDebrief;
  document.getElementById("tool_debrief")?.addEventListener("click", () => {
    document.getElementById("toolsDropdown")?.style.setProperty("display", "none");
    showDebrief();
  });
}
