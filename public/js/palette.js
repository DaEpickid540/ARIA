// palette.js — the command palette: Ctrl+K (or the search pill on the home
// screen), type a few letters, Enter.
//
// One box that reaches everything:
//   - every panel in the Tools menu (read from the menu itself, so a new
//     tool shows up here without being listed twice)
//   - the home screen's dock tools, navigation, chat actions, Claw
//   - your chats, by title
//   - today's open Daily Rings ("check in: Read")
//   - ">" then text  → run it on the PC with Claw (Auto mode)
//   - "?" then text  → ask ARIA (also what Enter does when nothing matches)
// Matching is in paletteCore.js.

import { rank, parseQuery, highlight } from "./paletteCore.js";

const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const RECENT_KEY = "aria_palette_recent";
const MAX_RECENT = 6;

const onHome = () => {
  const h = $("homepageScreen");
  return !!h && h.style.display !== "none";
};
const locked = () => {
  const l = $("lockScreen");
  return !!l && l.style.display !== "none";
};

/* ── getting somewhere before acting ─────────────────────────── */
const modules = async () => {
  await window.ARIA_loadChatModules?.();
};
const consoleUp = async () => {
  await window.ARIA_enterConsole?.();
};
const goHome = () => {
  if (!onHome()) $("goHomeBtn")?.click();
};

/* ── the commands ────────────────────────────────────────────── */
function staticCommands() {
  const c = (id, label, icon, group, run, keywords = []) => ({ id, label, icon, group, run, keywords });
  return [
    c("nav.console", "Enter ARIA console", "bi-box-arrow-in-right", "Go to", consoleUp, ["chat", "open console"]),
    c("nav.home", "Home screen", "bi-house", "Go to", goHome, ["dashboard", "hud"]),
    c("nav.settings", "Settings", "bi-gear", "Go to", async () => {
      await modules();
      window.ARIA_openSettings?.();
    }, ["preferences", "options", "theme", "voice", "keys"]),
    c("nav.lock", "Lock ARIA", "bi-lock", "Go to", () => $("goLockBtn")?.click(), ["sign out", "log out"]),

    c("chat.new", "New chat", "bi-plus-lg", "Chat", async () => {
      await consoleUp();
      $("newChatBtn")?.click();
    }),
    c("chat.export", "Export this chat", "bi-download", "Chat", async () => {
      await consoleUp();
      window.ARIA_exportChat?.();
    }, ["save", "download"]),
    c("chat.starred", "Starred messages", "bi-star", "Chat", async () => {
      await consoleUp();
      window.ARIA_showStarred?.();
    }, ["favorites", "pinned"]),
    c("chat.commands", "All slash commands", "bi-command", "Chat", async () => {
      await consoleUp();
      $("commandsBtn")?.click();
    }, ["help", "/"]),
    c("chat.ambient", "Toggle ambient mode", "bi-moon", "Chat", async () => {
      await consoleUp();
      window.ARIA_toggleAmbient?.();
    }),
    c("chat.memory", "Memory (what ARIA knows)", "bi-hdd", "Chat", async () => {
      await modules();
      window.ARIA_showMemoryUI?.();
    }, ["facts", "rag"]),
    c("chat.skills", "Skills", "bi-puzzle", "Chat", async () => {
      await modules();
      window.ARIA_showSkillsUI?.();
    }),
    c("chat.bg", "Background tasks", "bi-gear-wide-connected", "Chat", async () => {
      await consoleUp();
      $("bgTasksListBtn")?.click();
    }),
    c("chat.shortcuts", "Keyboard shortcuts", "bi-keyboard", "Chat", async () => {
      await modules();
      $("shortcutsOverlay")?.classList.add("active");
    }, ["help", "keys"]),

    c("tool.rings", "Daily Rings", "bi-bullseye", "Tools", () => window.ARIA_showRings?.(), ["habits", "streaks"]),

    c("claw.open", "Open Claw (PC control)", "bi-robot", "Claw", async () => {
      await modules();
      if (window.ARIA_openClaw) window.ARIA_openClaw();
      else window.ARIA_toggleClaw?.();
    }, ["relay", "remote", "control"]),
    c("claw.screen", "Claw: see the PC screen", "bi-display", "Claw", async () => {
      await modules();
      if (window.ARIA_openClaw) window.ARIA_openClaw("screen");
      else window.ARIA_toggleClaw?.();
    }, ["screenshot", "pov", "watch"]),
    c("claw.kill", "Claw: emergency stop", "bi-octagon", "Claw", async () => {
      await modules();
      window.ARIA_killClaw?.();
    }, ["kill switch", "halt", "abort"]),
  ];
}

// Tools → menu: every entry becomes a command. "tool_commands" and the wake
// toggle's live label are handled so they read well in a list.
function toolCommands() {
  const skip = new Set(["tool_rings", "tool_commands"]);
  return [...document.querySelectorAll("#toolsDropdown .toolDropItem[id]")]
    .filter((b) => !skip.has(b.id))
    .map((b) => ({
      id: "menu." + b.id,
      label: b.textContent.replace(/\s+/g, " ").trim(),
      icon: b.querySelector("i")?.className.match(/bi-[\w-]+/)?.[0] || "bi-tools",
      group: "Tools",
      keywords: [b.id.replace(/^tool_/, ""), b.title || ""],
      run: async () => {
        await consoleUp();
        b.click();
      },
    }));
}

function dockCommands() {
  return [...document.querySelectorAll("#hudDock .hudDockBtn")].map((b) => ({
    id: "dock." + b.dataset.panel,
    label: b.dataset.label,
    icon: b.querySelector("i")?.className.match(/bi-[\w-]+/)?.[0] || "bi-tools",
    group: "Home tools",
    keywords: ["home", "dock"],
    run: () => {
      goHome();
      if (!b.classList.contains("active")) b.click();
    },
  }));
}

/* ── things fetched when the palette opens ───────────────────── */
let _chats = [];
let _rings = [];

async function loadLive() {
  const uid = encodeURIComponent(window.ARIA_userId || "sarvin");
  const [chats, rings] = await Promise.all([
    fetch(`/api/loadChats?userId=${uid}`).then((r) => r.json()).catch(() => ({})),
    fetch("/api/habits").then((r) => r.json()).catch(() => ({})),
  ]);
  _chats = (chats.chats || []).slice(0, 60).map((ch) => ({
    id: "c." + ch.id,
    label: ch.title || "Untitled",
    icon: "bi-chat-left-text",
    group: "Chats",
    hint: "chat",
    noRecent: true,
    boost: -5, // a command with the same letters wins over a chat title
    run: async () => {
      await consoleUp();
      window.ARIA_loadChat?.(ch.id);
    },
  }));
  _rings = (rings.habits || [])
    .filter((h) => !h.done)
    .map((h) => ({
      id: "ring." + h.id,
      label: `Check in: ${h.name}${h.target > 1 ? ` (${h.count}/${h.target})` : ""}`,
      icon: "bi-check2-circle",
      group: "Daily Rings",
      noRecent: true,
      keywords: ["ring", "habit", "done"],
      run: async () => {
        await fetch(`/api/habits/${encodeURIComponent(h.id)}/check`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ amount: 1 }),
        }).catch(() => {});
        window.ARIA_refreshRings?.();
        window.ARIA_showNotification?.(`◎ ${h.name} checked in`);
      },
    }));
  if (isOpen()) render();
}

/* ── free text ───────────────────────────────────────────────── */
async function askAria(text) {
  await consoleUp();
  const input = $("userInput");
  if (!input) return;
  input.value = text;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  $("sendBtn")?.click();
}

async function clawRun(text) {
  await modules();
  if (window.ARIA_clawRun) window.ARIA_clawRun(text, "auto");
  else window.ARIA_toggleClaw?.();
}

/* ── recents ─────────────────────────────────────────────────── */
function recentIds() {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
function remember(id) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...recentIds().filter((x) => x !== id)].slice(0, MAX_RECENT)));
  } catch {}
}

/* ── the box ─────────────────────────────────────────────────── */
let _rows = []; // what's on screen: [{ item, idx }]
let _sel = 0;

const isOpen = () => $("ariaPalette")?.classList.contains("open");

function build() {
  if ($("ariaPalette")) return;
  const el = document.createElement("div");
  el.id = "ariaPalette";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  el.setAttribute("aria-label", "Command palette");
  el.innerHTML = `
    <div id="paletteBox">
      <div id="paletteInputRow">
        <i class="bi bi-search" aria-hidden="true"></i>
        <input id="paletteInput" type="text" autocomplete="off" spellcheck="false"
          placeholder="Search tools, chats, actions…" aria-label="Search" aria-controls="paletteList" />
        <span id="paletteMode"></span>
      </div>
      <div id="paletteList" role="listbox"></div>
      <div id="paletteFoot">
        <span><kbd>↑</kbd> <kbd>↓</kbd> move</span>
        <span><kbd>Enter</kbd> run</span>
        <span><kbd>&gt;</kbd> run on the PC with Claw</span>
        <span><kbd>?</kbd> ask ARIA</span>
        <span><kbd>Esc</kbd> close</span>
      </div>
    </div>`;
  document.body.appendChild(el);

  el.addEventListener("pointerdown", (e) => {
    if (e.target === el) close();
  });
  const input = $("paletteInput");
  input.addEventListener("input", () => {
    _sel = 0;
    render();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || (e.key === "Tab" && !e.shiftKey)) {
      e.preventDefault();
      move(1);
    } else if (e.key === "ArrowUp" || (e.key === "Tab" && e.shiftKey)) {
      e.preventDefault();
      move(-1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      runSelected();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  });
  const list = $("paletteList");
  list.addEventListener("pointermove", (e) => {
    const row = e.target.closest(".palItem");
    if (!row || +row.dataset.i === _sel) return;
    _sel = +row.dataset.i;
    paintSel();
  });
  list.addEventListener("click", (e) => {
    const row = e.target.closest(".palItem");
    if (!row) return;
    _sel = +row.dataset.i;
    runSelected();
  });
}

const GROUP_ORDER = ["Go to", "Chat", "Tools", "Claw", "Home tools", "Daily Rings", "Chats"];
function allItems() {
  const items = [...staticCommands(), ...toolCommands(), ...dockCommands(), ..._rings, ..._chats];
  // Keep each group together (the sort is stable, so order inside a group holds).
  return items.sort((x, y) => GROUP_ORDER.indexOf(x.group) - GROUP_ORDER.indexOf(y.group));
}

function render() {
  const list = $("paletteList");
  const modeEl = $("paletteMode");
  if (!list) return;
  const { mode, text } = parseQuery($("paletteInput").value);
  modeEl.textContent = mode === "claw" ? "CLAW" : mode === "ask" ? "ASK ARIA" : "";

  if (mode !== "search") {
    const item =
      mode === "claw"
        ? { id: "free.claw", label: text ? `Run on the PC: ${text}` : "Type what Claw should do on your PC…", icon: "bi-robot", noRecent: true, run: () => text && clawRun(text) }
        : { id: "free.ask", label: text ? `Ask ARIA: ${text}` : "Type a question for ARIA…", icon: "bi-chat-dots", noRecent: true, run: () => text && askAria(text) };
    _rows = [{ item, idx: [] }];
  } else if (!text) {
    // Nothing typed: what you used last, then everything by group.
    const items = allItems().filter((i) => i.group !== "Chats");
    const byId = new Map(items.map((i) => [i.id, i]));
    const recent = recentIds().map((id) => byId.get(id)).filter(Boolean).map((i) => ({ ...i, group: "Recent" }));
    _rows = [...recent, ...items, ..._chats.slice(0, 8)].map((item) => ({ item, idx: [] }));
  } else {
    _rows = rank(allItems(), text, 30).map((m) => ({ item: { ...m.item, group: "" }, idx: m.idx }));
    // Whatever was typed can always go to ARIA as a question.
    _rows.push({ item: { id: "free.ask", label: `Ask ARIA: ${text}`, icon: "bi-chat-dots", group: _rows.length ? "Or" : "", noRecent: true, run: () => askAria(text) }, idx: [] });
  }
  _sel = Math.max(0, Math.min(_sel, _rows.length - 1));

  let html = "";
  let group = null;
  _rows.forEach(({ item, idx }, i) => {
    if (item.group && item.group !== group) {
      group = item.group;
      html += `<div class="palGroup">${esc(group)}</div>`;
    }
    html += `<div class="palItem" role="option" data-i="${i}">
      <i class="bi ${esc(item.icon || "bi-dot")}" aria-hidden="true"></i>
      <span class="palLabel">${highlight(item.label, idx)}</span>
      ${item.hint ? `<span class="palHint">${esc(item.hint)}</span>` : ""}
    </div>`;
  });
  list.innerHTML = html || `<div class="palEmpty">Nothing matches.</div>`;
  paintSel();
}

function paintSel() {
  const list = $("paletteList");
  list.querySelectorAll(".palItem").forEach((r) => {
    const on = +r.dataset.i === _sel;
    r.classList.toggle("sel", on);
    r.setAttribute("aria-selected", on ? "true" : "false");
    if (on) r.scrollIntoView({ block: "nearest" });
  });
}

function move(d) {
  if (!_rows.length) return;
  _sel = (_sel + d + _rows.length) % _rows.length;
  paintSel();
}

async function runSelected() {
  const row = _rows[_sel];
  if (!row) return;
  const { item } = row;
  // The two "type something…" placeholders do nothing until there's text.
  if (item.id?.startsWith("free.") && !parseQuery($("paletteInput").value).text) return;
  close();
  if (!item.noRecent) remember(item.id);
  try {
    await item.run();
  } catch (e) {
    console.warn("[ARIA] palette command failed:", e);
    window.ARIA_showNotification?.("That didn't work: " + e.message);
  }
}

let _returnFocus = null;

export function openPalette(prefill = "") {
  if (locked()) return;
  build();
  _returnFocus = document.activeElement;
  const input = $("paletteInput");
  input.value = prefill;
  _sel = 0;
  $("ariaPalette").classList.add("open");
  render();
  input.focus();
  loadLive();
}

function close() {
  $("ariaPalette")?.classList.remove("open");
  _returnFocus?.focus?.({ preventScroll: true });
  _returnFocus = null;
}

let _inited = false;
export function initPalette() {
  if (_inited) return;
  _inited = true;
  window.ARIA_openPalette = openPalette;
  // Capture phase, so Ctrl+K works even with the cursor in the chat box.
  document.addEventListener(
    "keydown",
    (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "k") {
        if (locked()) return;
        e.preventDefault();
        e.stopPropagation();
        isOpen() ? close() : openPalette();
      }
    },
    true,
  );
}
