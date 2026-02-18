// homeTools/tasksPreview.js

export function initTasksPreview() {
  const el = document.getElementById("homeTasksPreview");
  if (!el) return;

  // Placeholder tasks
  const tasks = [
    "Finish math homework",
    "Review chemistry notes",
    "Practice piano",
    "Scout meeting prep",
  ];

  el.innerHTML = tasks
    .slice(0, 3)
    .map((t) => `<div class="taskItem">• ${t}</div>`)
    .join("");
}
