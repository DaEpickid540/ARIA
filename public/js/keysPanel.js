// keysPanel.js — Settings ▸ Keys: see which API keys are set, add or clear one
//
// Talks to /api/keys (lib/keys.js). The server never sends a key back, only
// whether it is set and its last four characters, so this page can't leak
// one either. Rendered each time the tab is opened, so it reflects keys
// added elsewhere (the .env file, the desktop app's menu).

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

async function load() {
  const list = document.getElementById("keysList");
  if (!list) return;
  let data;
  try {
    data = await fetch("/api/keys").then((r) => r.json());
  } catch {
    list.textContent = "Couldn't reach the server.";
    return;
  }

  const groups = new Map();
  for (const k of data.keys || []) {
    if (!groups.has(k.group)) groups.set(k.group, []);
    groups.get(k.group).push(k);
  }

  list.innerHTML =
    (data.editable ? "" : `<p class="settingsHint keysReadOnly">${esc(data.reason)}</p>`) +
    [...groups]
      .map(
        ([group, keys]) => `
      <div class="keysGroup">
        <div class="keysGroupTitle">${esc(group)}</div>
        ${keys.map((k) => row(k, data.editable)).join("")}
      </div>`,
      )
      .join("");

  const byName = new Map((data.keys || []).map((k) => [k.name, k]));
  list.querySelectorAll(".keyRow").forEach((el) => wire(el, byName.get(el.dataset.name)));
}

function row(k, editable) {
  const status = k.set
    ? `<span class="keyStatus keySet" title="Set">${k.secret ? "Set " : ""}${esc(k.preview)}</span>`
    : `<span class="keyStatus">Not set</span>`;
  return `
    <div class="keyRow" data-name="${esc(k.name)}">
      <div class="keyHead">
        <span class="keyLabel">${esc(k.label)}</span>
        ${status}
        ${k.url ? `<a class="keyGet" href="${esc(k.url)}" target="_blank" rel="noopener">Get a key <i class="bi bi-box-arrow-up-right" aria-hidden="true"></i></a>` : ""}
      </div>
      ${k.hint ? `<div class="keyHint">${esc(k.hint)}</div>` : ""}
      ${
        editable
          ? `<div class="keyEdit">
              <input class="keyInput" type="${k.secret ? "password" : "text"}" autocomplete="off" spellcheck="false"
                placeholder="${k.set ? "Replace…" : "Paste key"}" aria-label="${esc(k.label)}" />
              <button type="button" class="primaryBtn keySave">Save</button>
              ${k.set ? `<button type="button" class="secondaryBtn keyClear" title="Remove this key">Clear</button>` : ""}
            </div>
            <div class="keyMsg" role="status"></div>`
          : ""
      }
    </div>`;
}

function wire(el, k) {
  const name = el.dataset.name;
  const input = el.querySelector(".keyInput");
  const msg = el.querySelector(".keyMsg");
  // Plain settings (not secrets) start with their value, so adding a second
  // owner ID means typing ",<id>", not retyping the first.
  if (input && k && !k.secret && k.set) input.value = k.preview;

  const save = async (value) => {
    if (msg) msg.textContent = "Saving…";
    try {
      const r = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, value }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) throw new Error(d.error || `HTTP ${r.status}`);
      await load(); // redraw with the new status
      window.ARIA_showNotification?.(value ? "Key saved — it works from the next message." : "Key removed.");
    } catch (e) {
      if (msg) msg.textContent = e.message;
    }
  };

  el.querySelector(".keySave")?.addEventListener("click", () => {
    const v = input?.value.trim();
    if (!v) {
      if (msg) msg.textContent = "Paste a key first.";
      return;
    }
    save(v);
  });
  input?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") el.querySelector(".keySave")?.click();
  });
  el.querySelector(".keyClear")?.addEventListener("click", () => save(""));
}

export function initKeysPanel() {
  document
    .querySelector('.settingsTab[data-tab="keys"]')
    ?.addEventListener("click", () => load());
}
