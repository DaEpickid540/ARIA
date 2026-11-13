// Small behaviours for the chat view's chrome. The sidebar: the Workspace section folds (and
// remembers it), and the Chats label shows how many chats there are.
const KEY = "aria_sb_workspace";
let _done = false;

export function initSidebarHud() {
  if (_done) return;
  _done = true;

  const fold = document.getElementById("sbWorkspaceFold");
  const box = document.getElementById("sbWorkspace");
  if (fold && box) {
    let open = true;
    try {
      open = localStorage.getItem(KEY) !== "0";
    } catch {}
    const set = () => {
      fold.setAttribute("aria-expanded", String(open));
      box.hidden = !open;
    };
    set();
    fold.addEventListener("click", () => {
      open = !open;
      set();
      try {
        localStorage.setItem(KEY, open ? "1" : "0");
      } catch {}
    });
  }

  // The send cluster's Kill bubble presses Claw's own kill switch (claw.js
  // builds it when the chat modules load) and mirrors its state.
  const kill = document.getElementById("clusterKillBtn");
  if (kill) {
    const real = () => document.getElementById("clawKillSwitch");
    const paint = () => {
      const on = !!real()?.classList.contains("killed");
      kill.classList.toggle("killed", on);
      kill.querySelector("span").textContent = on ? "Resume" : "Kill";
    };
    kill.addEventListener("click", () => {
      if (real()) real().click();
      else window.ARIA_killClaw?.();
    });
    let watched = null;
    const watch = () => {
      const el = real();
      if (!el || el === watched) return;
      watched = el;
      new MutationObserver(paint).observe(el, { attributes: true, attributeFilter: ["class"] });
      paint();
    };
    watch();
    new MutationObserver(watch).observe(document.body, { childList: true });
  }

  // The send cluster is a rotary dial: drag any bubble and the ring turns
  // about Send, then springs home when you let go. A plain click still
  // presses the bubble; a drag does not.
  const cluster = document.getElementById("sendCluster");
  if (cluster) {
    let press = null;
    let rot = 0;
    let dragged = false;
    const angle = (e) => {
      const r = cluster.getBoundingClientRect();
      return (Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180) / Math.PI;
    };
    cluster.addEventListener("pointerdown", (e) => {
      dragged = false;
      const btn = e.target.closest(".voiceBtn");
      if (!btn || e.button) return;
      press = { x: e.clientX, y: e.clientY, a: 0, btn, on: false };
    });
    window.addEventListener("pointermove", (e) => {
      if (!press) return;
      if (!press.on) {
        if (Math.hypot(e.clientX - press.x, e.clientY - press.y) < 6) return;
        press.on = true;
        press.a = angle(e);
        cluster.classList.add("dialing");
        // Hold-to-talk started on the press; a drag is not a hold.
        press.btn.dispatchEvent(new MouseEvent("mouseleave"));
      }
      const a = angle(e);
      let d = a - press.a;
      if (d > 180) d -= 360;
      else if (d < -180) d += 360;
      press.a = a;
      rot += d;
      cluster.style.setProperty("--rot", rot.toFixed(1) + "deg");
    });
    const release = () => {
      if (!press) return;
      if (press.on) {
        dragged = true;
        const back = Math.min(1.4, 0.3 + (Math.abs(rot) / 360) * 0.8);
        cluster.style.setProperty("--dial-back", back.toFixed(2) + "s");
        cluster.classList.remove("dialing");
        rot = 0;
        cluster.style.setProperty("--rot", "0deg");
      }
      press = null;
    };
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    cluster.addEventListener(
      "click",
      (e) => {
        if (!dragged) return;
        dragged = false;
        e.preventDefault();
        e.stopPropagation();
      },
      true,
    );
  }

  const list = document.getElementById("chatList");
  const count = document.getElementById("sbChatCount");
  if (list && count) {
    const paint = () => {
      const n = list.querySelectorAll(".chatItem").length;
      count.textContent = n ? String(n).padStart(2, "0") : "";
    };
    new MutationObserver(paint).observe(list, { childList: true, subtree: true });
    paint();
  }
}
