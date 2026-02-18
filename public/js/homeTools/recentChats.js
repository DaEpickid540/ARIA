// homeTools/recentChats.js

export function initRecentChats() {
  const el = document.getElementById("homeRecentChats");
  if (!el) return;

  // Placeholder recent chats
  const chats = [
    "Homework help",
    "Project planning",
    "Daily summary",
    "Random Q&A",
  ];

  el.innerHTML = chats
    .slice(0, 3)
    .map((c) => `<div class="chatItem">• ${c}</div>`)
    .join("");
}
