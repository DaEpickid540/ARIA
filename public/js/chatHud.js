// The chat's minimap: a thin rail down the left edge of the conversation with
// one tick per message (yours in the accent, ARIA's dim), sized and placed to
// scale, and a bracket showing the part on screen. Click a tick to jump there.
let _done = false;

export function initChatHud() {
  const win = document.getElementById("chatWindow");
  const box = document.getElementById("messages");
  if (_done || !win || !box) return;
  _done = true;

  const rail = document.createElement("div");
  rail.id = "msgRail";
  rail.setAttribute("aria-hidden", "true");
  rail.innerHTML = '<div class="msgRailTicks"></div><div class="msgRailView"></div>';
  win.appendChild(rail);
  const ticks = rail.firstChild;
  const view = rail.lastChild;
  let msgs = [];

  const paintView = () => {
    const total = box.scrollHeight || 1;
    view.style.top = (box.scrollTop / total) * 100 + "%";
    view.style.height = Math.min(100, (box.clientHeight / total) * 100) + "%";
  };
  const paint = () => {
    rail.style.top = box.offsetTop + "px";
    rail.style.height = box.clientHeight + "px";
    msgs = [...box.querySelectorAll(".msg")];
    rail.hidden = !msgs.length;
    const total = box.scrollHeight || 1;
    ticks.innerHTML = msgs
      .map(
        (m, i) =>
          `<i data-i="${i}" class="${m.classList.contains("user") ? "user" : "aria"}" style="top:${(m.offsetTop / total) * 100}%;height:${(m.offsetHeight / total) * 100}%"></i>`,
      )
      .join("");
    paintView();
  };

  let queued = false;
  const queue = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      paint();
    });
  };

  ticks.addEventListener("click", (e) => {
    const m = msgs[e.target.dataset?.i];
    if (m) box.scrollTo({ top: m.offsetTop - 8, behavior: "smooth" });
  });
  box.addEventListener("scroll", paintView, { passive: true });
  new MutationObserver(queue).observe(box, { childList: true, subtree: true, characterData: true });
  new ResizeObserver(queue).observe(box);
  paint();
}
