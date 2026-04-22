// shortcuts.js — ARIA keyboard shortcut system
// Ctrl+K → commands, Ctrl+/ → settings, Ctrl+Shift+N → new chat,
// Ctrl+E → export chat, Ctrl+. → ambient mode toggle,
// Ctrl+Shift+A → ARIA Claw panel, Esc → close panels

export function initShortcuts() {
  const SHORTCUTS = [
    { keys: "Ctrl+K",       desc: "Open commands modal" },
    { keys: "Ctrl+/",       desc: "Open settings" },
    { keys: "Ctrl+Shift+N", desc: "New chat" },
    { keys: "Ctrl+E",       desc: "Export current chat" },
    { keys: "Ctrl+.",       desc: "Toggle ambient mode" },
    { keys: "Ctrl+Shift+A", desc: "ARIA Claw panel" },
    { keys: "Ctrl+?",       desc: "Show this help" },
  ];

  document.addEventListener("keydown", (e) => {
    const ctrl  = e.ctrlKey || e.metaKey;
    const shift = e.shiftKey;
    const key   = e.key;

    // Don't fire when typing in input fields (except Escape)
    const inInput = ["INPUT","TEXTAREA","SELECT"].includes(document.activeElement?.tagName);

    if (key === "Escape") {
      // Close any open panel
      document.getElementById("shortcutsOverlay")?.classList.remove("active");
      document.getElementById("clawPanel")?.classList.remove("open");
      document.getElementById("settingsOverlay")?.classList.remove("active");
      document.getElementById("commandsModal") && (document.getElementById("commandsModal").style.display = "none");
      return;
    }

    if (inInput) return;

    if (ctrl && key === "k") {
      e.preventDefault();
      document.getElementById("commandsBtn")?.click();
    }
    if (ctrl && key === "/") {
      e.preventDefault();
      window.ARIA_openSettings?.();
    }
    if (ctrl && shift && key === "N") {
      e.preventDefault();
      document.getElementById("newChatBtn")?.click();
    }
    if (ctrl && key === "e") {
      e.preventDefault();
      window.ARIA_exportChat?.();
    }
    if (ctrl && key === ".") {
      e.preventDefault();
      window.ARIA_toggleAmbient?.();
    }
    if (ctrl && shift && key === "A") {
      e.preventDefault();
      window.ARIA_toggleClaw?.();
    }
    if (ctrl && key === "?") {
      e.preventDefault();
      showShortcutsHelp(SHORTCUTS);
    }
  });

  // Build shortcuts overlay
  const overlay = document.createElement("div");
  overlay.id = "shortcutsOverlay";
  overlay.innerHTML = `
    <div id="shortcutsPanel">
      <div id="shortcutsHeader">
        <span>⌨ KEYBOARD SHORTCUTS</span>
        <button onclick="document.getElementById('shortcutsOverlay').classList.remove('active')">✕</button>
      </div>
      <div id="shortcutsList">
        ${SHORTCUTS.map(s => `
          <div class="shortcutRow">
            <kbd class="shortcutKey">${s.keys}</kbd>
            <span class="shortcutDesc">${s.desc}</span>
          </div>`).join("")}
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.classList.remove("active");
  });

  console.log("[ARIA] Keyboard shortcuts active. Ctrl+? for help.");
}

function showShortcutsHelp(shortcuts) {
  document.getElementById("shortcutsOverlay")?.classList.add("active");
}
