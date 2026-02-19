// homeTools/tasksPreview.js

export function initTasksPreview() {
  const el = document.getElementById("homeTasksList");
  if (!el) return;

  const tasks = JSON.parse(localStorage.getItem("aria_tasks") || "[]");

  if (!tasks.length) {
    el.textContent = "No tasks yet.";
    return;
  }

  const ul = document.createElement("ul");
  ul.style.paddingLeft = "18px";

  tasks.slice(0, 5).forEach((t) => {
    const li = document.createElement("li");
    li.textContent = t;
    ul.appendChild(li);
  });

  el.innerHTML = "";
  el.appendChild(ul);
}
