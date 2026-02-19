// homeTools/recentChats.js

export async function initRecentChats() {
  const el = document.getElementById("homeRecentChats");
  if (!el) return;

  try {
    const res = await fetch("/api/loadChats?userId=sarvin");
    const data = await res.json();
    const chats = data.chats || [];

    if (!chats.length) {
      el.textContent = "No chats yet.";
      return;
    }

    const ul = document.createElement("ul");
    ul.style.paddingLeft = "18px";

    chats.slice(0, 5).forEach((chat) => {
      const li = document.createElement("li");
      li.textContent = chat.title || "Untitled chat";
      ul.appendChild(li);
    });

    el.innerHTML = "";
    el.appendChild(ul);
  } catch {
    el.textContent = "Unable to load chats.";
  }
}
