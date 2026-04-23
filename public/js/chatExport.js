// chatExport.js — export current chat as .md or .txt

export function initChatExport() {
  window.ARIA_exportChat = exportCurrentChat;
  window.ARIA_exportAllChats = exportAllChats;
}

function getCurrentChatData() {
  // Read from localStorage directly (safe cross-module access)
  try {
    const saved = localStorage.getItem("aria_chats");
    const chats = saved ? JSON.parse(saved) : [];
    // Find active chat by checking which one chat.js has selected
    // We expose it via a global set by chat.js
    const activeId = window.ARIA_currentChatId;
    return activeId
      ? chats.find((c) => c.id === activeId) || chats[0]
      : chats[0];
  } catch {
    return null;
  }
}

function formatChatAsMarkdown(chat) {
  if (!chat) return "No chat data.";
  const date = new Date(chat.createdAt || Date.now()).toLocaleString();
  const lines = [
    `# ${chat.title || "ARIA Chat"}`,
    `**Exported:** ${new Date().toLocaleString()}`,
    `**Created:** ${date}`,
    `**Messages:** ${chat.messages?.length || 0}`,
    "",
    "---",
    "",
  ];

  for (const msg of chat.messages || []) {
    const role = msg.role === "user" ? "**YOU**" : "**ARIA**";
    const time = msg.timestamp
      ? new Date(msg.timestamp).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })
      : "";
    lines.push(`### ${role} ${time ? `_(${time})_` : ""}`);
    if (msg.type === "image" && msg.imageUrl) {
      lines.push(`![Generated image](${msg.imageUrl})`);
    } else {
      lines.push(msg.content || "");
    }
    lines.push("");
  }
  return lines.join("\n");
}

function downloadText(content, filename) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportCurrentChat() {
  const chat = getCurrentChatData();
  if (!chat) {
    window.ARIA_showNotification?.("No chat to export.");
    return;
  }
  const md = formatChatAsMarkdown(chat);
  const safeName = (chat.title || "aria-chat")
    .replace(/[^a-z0-9]/gi, "-")
    .toLowerCase();
  downloadText(md, `${safeName}.md`);
  window.ARIA_showNotification?.("Chat exported ✓");
}

export function exportAllChats() {
  try {
    const saved = localStorage.getItem("aria_chats");
    const chats = saved ? JSON.parse(saved) : [];
    if (!chats.length) {
      window.ARIA_showNotification?.("No chats to export.");
      return;
    }
    const all = chats.map(formatChatAsMarkdown).join("\n\n---\n\n");
    downloadText(all, `aria-all-chats-${Date.now()}.md`);
    window.ARIA_showNotification?.(`${chats.length} chats exported ✓`);
  } catch (e) {
    window.ARIA_showNotification?.("Export failed: " + e.message);
  }
}
