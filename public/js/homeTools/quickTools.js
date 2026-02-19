// homeTools/quickTools.js

export function initQuickTools() {
  const el = document.getElementById("homeQuickTools");
  if (!el) return;

  el.innerHTML = `
    <button class="secondaryBtn" style="margin-right:6px;" data-qt="clear">
      Clear Chats
    </button>
    <button class="secondaryBtn" data-qt="export">
      Export Chats
    </button>
  `;

  el.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      const action = btn.dataset.qt;

      if (action === "clear") {
        localStorage.removeItem("aria_chats");
        alert("Local chats cleared.");
      }

      if (action === "export") {
        const chats = localStorage.getItem("aria_chats") || "[]";
        navigator.clipboard
          .writeText(chats)
          .then(() => alert("Chats copied to clipboard."))
          .catch(() => alert("Unable to copy chats."));
      }
    });
  });
}
