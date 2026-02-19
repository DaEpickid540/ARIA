// homeTools/dailySummary.js

export async function initDailySummary() {
  const el = document.getElementById("homeDailySummary");
  if (!el) return;

  try {
    const res = await fetch("/api/loadChats?userId=sarvin");
    const data = await res.json();
    const chats = data.chats || [];

    if (!chats.length) {
      el.textContent = "No activity yet today.";
      return;
    }

    const today = new Date().toDateString();
    let msgCount = 0;

    chats.forEach((chat) => {
      (chat.messages || []).forEach((m) => {
        if (new Date(m.timestamp).toDateString() === today) msgCount++;
      });
    });

    el.textContent =
      msgCount === 0
        ? "No messages yet today."
        : `You exchanged ${msgCount} messages today.`;
  } catch {
    el.textContent = "Unable to compute summary.";
  }
}
