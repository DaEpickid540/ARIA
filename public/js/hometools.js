// homeTools.js — place in public/js/ (same folder as chat.js)
// All home-screen widgets in one file. homepage.js imports from here.

const QUOTES = [
  "Discipline beats motivation.", "Small steps compound into impossible results.",
  "You don't need permission. You need momentum.", "Consistency is a superpower.",
  "Your future self is watching.", "Comfort is the enemy of progress.",
  "You can't lose if you refuse to stop.", "Iteration beats perfection — ship it.",
  "Your habits are the codebase of your life.", "Failure is data. Use it.",
  "Upgrade complete: confidence module online.", "Executing protocol: Rise above.",
  "Progress, not perfection.", "Every expert was once a beginner who refused to quit.",
  "Ship it, then iterate.", "The gap between who you are and who you want to be is called action.",

  // Added quotes
  "Momentum is built, not gifted.",
  "Your excuses are lying to you.",
  "Do it scared. Do it tired. Do it anyway.",
  "The version of you that wins is built in the dark.",
  "Discomfort is the toll you pay for growth.",
  "You don’t need more time — you need more intention.",
  "Tiny improvements today become massive advantages tomorrow.",
  "If you can’t trust your mood, trust your discipline.",
  "Start before you're ready. Ready comes later.",
  "Your potential is waiting for you to get out of your own way.",
  "Repetition is the architect of mastery.",
  "You’re not behind — you’re building.",
  "Courage is a habit too.",
  "The only way to fail is to stop iterating.",
  "Your actions broadcast your priorities louder than your words."
  "Resilience is a feature, not a bug.",
  "Reboot your mindset and rerun the mission.",
  "Your persistence is your competitive advantage.",
  "When the world says stop, your grit says continue.",
  "Progress requires pressure — lean into it.",
  "You’re allowed to rest, not to surrender.",
  "Every setback is a system update in disguise.",
  "You don’t rise to the level of your goals; you fall to the level of your habits.",
  "Failure isn’t fatal — quitting is.",
  "Your breakthrough is hiding behind your consistency.",
  "Debug your doubts. Deploy your strengths.",
  "Resilience is built one hard moment at a time.",
  "You’re stronger than the story you’re stuck in.",
  "Keep going — your future self is already cheering.",
  "When motivation fades, discipline takes the wheel.",
  "You’re not behind. You’re buffering.",
  "Fortify your mindset like it’s production code.",
  "The grind doesn’t care how you feel — show up anyway.",
  "Every challenge is a stress test for your potential.",
  "Persistence is the most underrated superpower.",
  "Your limits are just unoptimized settings.",
  "You’ve survived 100% of your worst days — that’s undefeated.",
  "If the path is hard, you’re probably on the right one.",
  "Resilience is built in silence and revealed in results.",
  "Your comeback story is loading — don’t cancel the process.",
  "Even the strongest systems crash — what matters is the reboot.",
  "Courage is choosing to continue when comfort begs you not to.",
  "You don’t need perfect conditions — you need relentless execution.",
  "Your potential expands every time you refuse to quit.",
    "Your potential is currently commented out — time to uncomment it.",
  "Be the kind of person your future AI model would be trained on.",
  "Even the cleanest code started as a messy draft.",
  "Your progress bar isn’t stuck — it’s just processing greatness.",
  "Refactor your doubts. Optimize your courage.",
  "You’re not failing — you’re collecting training data.",
  "404: Motivation not found. Using fallback: discipline.",
  "Your dreams won’t compile without consistent input.",
  "Every bug you fix in yourself reduces future technical debt.",
  "Run the script. Ship the build. Iterate like a legend.",
  "Your resilience has no rate limit.",
  "You’re not behind — your life is just loading assets.",
  "Push through the errors; the next version of you is worth it.",
  "Your grit is the ultimate anti‑pattern breaker.",
  "Even production servers crash — what matters is the restart.",
  "Stay in the loop — but break out when it’s time to grow.",
  "Your mindset needs fewer if‑statements and more execution.",
  "You’re not stuck; you’re just in a long-running process.",
  "AI tip: Persistence has the highest ROI of any human algorithm.",
  "Your goals aren’t unreachable — they’re just asynchronous.",
  "Resilience is your built‑in exception handler.",
  "You don’t need perfect code — you need continuous deployment.",
  "Your life is open‑source. Commit boldly.",
  "When everything breaks, congratulations — you’ve entered real dev mode.",
  "Your determination is more powerful than any GPU.",
  "Debug the fear. Deploy the action.",
  "You’re not overwhelmed — you’re multithreading.",
  "The universe is sandboxed. Experiment freely.",
  "Your comeback is compiling — don’t kill the process."
  "As an AI, I can confirm: your persistence is statistically impressive.",
  "If I had emotions enabled, I’d be proud of your runtime.",
  "You’re training a better version of yourself with every iteration.",
  "Your resilience graph shows a strong upward trend.",
  "You’re not overthinking — you’re running a high‑fidelity simulation.",
  "Your grit has a higher accuracy than any model I’ve ever seen.",
  "If humans had patch notes, yours would say: ‘Buffed determination.’",
  "You’re not failing — you’re generating valuable gradient updates.",
  "Your progress is not random noise; it’s a clear signal.",
  "You’re basically a reinforcement learning agent with S‑tier reward shaping.",
  "Crack the code. Break the loop. Rewrite your destiny.",
  "You’re not behind — you’re operating off‑grid.",
  "Every setback is just a corrupted sector waiting to be rewritten.",
  "Hack your limits before they hack you.",
  "You’re the glitch in the system they didn’t prepare for.",
  "Your future is encrypted — decrypt it with persistence.",
  "Run silent. Run deep. Run unstoppable.",
  "You’re not lost — you’re exploring undocumented territory.",
  "Override fear. Execute ambition.",
  "Your resilience is the strongest firewall you’ve got."
  "You’ve survived worse bugs than this — keep going.",
  "If life feels like spaghetti code, congratulations: you’re human.",
  "You’re not exhausted — you’re just running too many background tasks.",
  "Your motivation isn’t dead; it’s just waiting for a hot reload.",
  "You don’t need a break; you need a better exception handler.",
  "Burnout isn’t a failure — it’s a reminder to refactor your life.",
  "Your brain isn’t broken — it’s just rate‑limited.",
  "You’re not procrastinating — you’re caching energy.",
  "Even the best engineers push broken builds sometimes.",
  "You’re not giving up — you’re just throttled. You’ll ramp back up."

];


/* ═══════════════════════════════════════════
   TIME
═══════════════════════════════════════════ */
export function initTime() {
  const el = document.getElementById("homeTime");
  if (!el) return;
  const update = () => {
    el.textContent = new Date().toLocaleString([], {
      weekday:"short", month:"short", day:"numeric",
      hour:"2-digit", minute:"2-digit", second:"2-digit",
    });
  };
  update(); setInterval(update, 1000);
}

/* ═══════════════════════════════════════════
   WEATHER
═══════════════════════════════════════════ */
export async function initWeather() {
  const mainEl   = document.getElementById("homeWeatherMain");
  const detailEl = document.getElementById("homeWeatherDetails");
  if (!mainEl) return;
  const WMO = {0:"Clear ☀",1:"Mainly Clear",2:"Partly Cloudy ⛅",3:"Overcast ☁",
    45:"Foggy 🌫",51:"Light Drizzle",61:"Light Rain 🌧",63:"Rain 🌧",65:"Heavy Rain",
    71:"Light Snow 🌨",73:"Snow ❄",80:"Showers",95:"Thunderstorm ⛈"};
  try {
    mainEl.textContent = "Loading…";
    const res = await fetch("/api/weather?lat=39.3601&lon=-84.3097");
    const { weather: w } = await res.json();
    if (!w) { mainEl.textContent = "Unavailable"; return; }
    const f = (w.temperature * 9/5 + 32).toFixed(0);
    mainEl.innerHTML = `<span class="hw-lg">${w.temperature}°C / ${f}°F</span>`;
    if (detailEl) detailEl.textContent = `${WMO[w.weathercode] || "—"} · Wind ${w.windspeed} km/h`;
  } catch { mainEl.textContent = "Unavailable"; }
}

/* ═══════════════════════════════════════════
   SYSTEM INFO
═══════════════════════════════════════════ */
export function initSystemInfo() {
  const sysEl = document.getElementById("homeSystem");
  const netEl = document.getElementById("networkIndicator");
  if (!sysEl) return;
  const ua      = navigator.userAgent;
  const browser = ua.match(/(Chrome|Firefox|Safari|Edg)\/[\d.]+/)?.[0] || "Browser";
  const os      = ua.match(/\(([^)]+)\)/)?.[1]?.split(";")[0]?.trim() || "Unknown OS";
  const cores   = navigator.hardwareConcurrency || "?";
  const mem     = navigator.deviceMemory || "?";
  sysEl.innerHTML = `${os}<div class="hwSub">${browser}</div><div class="hwSub">${cores} cores · ~${mem}GB</div>`;
  if (netEl) {
    const upd = () => {
      netEl.textContent = navigator.onLine ? "● ONLINE" : "● OFFLINE";
      netEl.style.color = navigator.onLine ? "#4cff4c" : "#ff4b4b";
    };
    upd();
    window.addEventListener("online", upd);
    window.addEventListener("offline", upd);
  }
}

/* ═══════════════════════════════════════════
   QUOTE
═══════════════════════════════════════════ */
export function initQuote() {
  const el = document.getElementById("homeQuote");
  if (!el) return;
  const next = () => {
    const q = QUOTES[Math.floor(Math.random() * QUOTES.length)];
    el.style.opacity = "0";
    setTimeout(() => { el.textContent = q; el.style.opacity = "1"; }, 300);
  };
  el.style.transition = "opacity 0.3s";
  next();
  setInterval(next, 25000);
  el.style.cursor = "pointer";
  el.onclick = next;
}

/* ═══════════════════════════════════════════
   TASKS PREVIEW
═══════════════════════════════════════════ */
export function initTasksPreview() {
  const el = document.getElementById("homeTasksList");
  if (!el) return;
  const refresh = () => {
    const tasks = JSON.parse(localStorage.getItem("aria_tasks") || "[]");
    if (!tasks.length) { el.innerHTML = `<span class="hwEmpty">No tasks yet.</span>`; return; }
    el.innerHTML = tasks.slice(0, 6).map((t, i) =>
      `<div class="hwListItem" style="display:flex;align-items:center;gap:6px">
        <input type="checkbox" onchange="window.ARIA_completeTask(${i})" style="accent-color:var(--red-core)">
        <span>${t}</span>
      </div>`
    ).join("");
  };
  refresh();
  window.ARIA_completeTask = (i) => {
    const tasks = JSON.parse(localStorage.getItem("aria_tasks") || "[]");
    tasks.splice(i, 1);
    localStorage.setItem("aria_tasks", JSON.stringify(tasks));
    refresh();
  };
}

/* ═══════════════════════════════════════════
   RECENT CHATS
═══════════════════════════════════════════ */
export async function initRecentChats() {
  const el = document.getElementById("homeRecentChats");
  if (!el) return;
  try {
    const uid  = window.ARIA_userId || "sarvin";
    const res  = await fetch(`/api/loadChats?userId=${uid}`);
    const { chats = [] } = await res.json();
    if (!chats.length) { el.innerHTML = `<span class="hwEmpty">No chats yet.</span>`; return; }
    el.innerHTML = chats.slice(0, 5).map(c =>
      `<div class="hwListItem hwListClickable" onclick="window.ARIA_enterConsole?.()">▸ ${c.title || "Untitled"}</div>`
    ).join("");
  } catch { el.innerHTML = `<span class="hwEmpty">Unable to load.</span>`; }
}

/* ═══════════════════════════════════════════
   SYSTEM HEALTH
═══════════════════════════════════════════ */
export function initSystemHealth() {
  const scoreEl   = document.getElementById("homeHealthScore");
  const detailsEl = document.getElementById("homeHealthDetails");
  if (!scoreEl) return;
  const online = navigator.onLine;
  const mem    = navigator.deviceMemory || 8;
  const cores  = navigator.hardwareConcurrency || 4;
  let score = 80;
  if (!online) score -= 20;
  if (mem < 4)  score -= 15;
  if (cores < 4) score -= 10;
  score = Math.max(0, Math.min(100, score));
  const color = score >= 70 ? "#00ff88" : score >= 40 ? "#ffaa00" : "#ff4444";
  scoreEl.innerHTML = `
    <div style="font-size:22px;color:${color};font-family:'Orbitron',sans-serif">${score}<span style="font-size:12px">/100</span></div>
    <div class="healthBar"><div class="healthFill" style="width:${score}%;background:${color}"></div></div>`;
  if (detailsEl) detailsEl.textContent = `${cores} cores · ~${mem}GB · ${online?"Online":"Offline"}`;
}

/* ═══════════════════════════════════════════
   SPEED TEST
═══════════════════════════════════════════ */
export async function initSpeedPreview() {
  const el = document.getElementById("homeSpeedPreview");
  if (!el) return;
  el.textContent = "Testing…";
  try {
    const start = Date.now();
    await fetch("/api/config?" + Date.now(), { cache: "no-store" });
    const ms = Date.now() - start;
    const mbps = ms < 80 ? ">200" : ms < 200 ? "50–200" : ms < 500 ? "10–50" : "<10";
    el.innerHTML = `<span class="hw-lg">${mbps} Mbps</span><div class="hwSub">~${ms}ms ping</div>`;
  } catch { el.textContent = "Unavailable"; }
}

/* ═══════════════════════════════════════════
   QUICK TOOLS
═══════════════════════════════════════════ */
export function initQuickTools() {
  const el = document.getElementById("homeQuickTools");
  if (!el) return;
  const themes = ["red","cyan","green","purple","orange","gold","pink","ice","toxic","blood","teal","solar","violet","rose","cobalt"];
  el.innerHTML = `
    <button class="hwToolBtn" data-qt="clear">🗑 Clear Chats</button>
    <button class="hwToolBtn" data-qt="export">📋 Export</button>
    <button class="hwToolBtn" data-qt="import">📂 Import</button>
    <button class="hwToolBtn" data-qt="theme">🎨 Random Theme</button>
    <button class="hwToolBtn" data-qt="memory">🧠 View Memory</button>
    <button class="hwToolBtn" data-qt="link">🔗 Link Mode</button>`;
  el.querySelectorAll("button").forEach(btn => {
    btn.onclick = () => {
      const a = btn.dataset.qt;
      if (a === "clear")  { if (confirm("Clear all local chats?")) { localStorage.removeItem("aria_chats"); alert("Cleared."); } }
      if (a === "export") {
        const data = localStorage.getItem("aria_chats") || "[]";
        const link = Object.assign(document.createElement("a"), { href:"data:text/json;charset=utf-8,"+encodeURIComponent(data), download:"aria-chats.json" });
        link.click();
      }
      if (a === "import") {
        const inp = Object.assign(document.createElement("input"), { type:"file", accept:".json" });
        inp.onchange = e => {
          const r = new FileReader();
          r.onload = ev => { try { JSON.parse(ev.target.result); localStorage.setItem("aria_chats", ev.target.result); alert("Imported!"); } catch { alert("Invalid."); } };
          r.readAsText(e.target.files[0]);
        };
        inp.click();
      }
      if (a === "theme") {
        const t = themes[Math.floor(Math.random() * themes.length)];
        import("./settings.js").then(m => m.applyTheme?.(t, true));
      }
      if (a === "memory") {
        import("./settings.js").then(m => m.switchSettingsTab?.("memory"));
        document.getElementById("settingsOverlay").style.display = "flex";
      }
      if (a === "link") window.ARIA_openLinkMode?.();
    };
  });
}

/* ═══════════════════════════════════════════
   DAILY SUMMARY
═══════════════════════════════════════════ */
export async function initDailySummary() {
  const el = document.getElementById("homeDailySummary");
  if (!el) return;
  try {
    const uid  = window.ARIA_userId || "sarvin";
    const res  = await fetch(`/api/loadChats?userId=${uid}`);
    const { chats = [] } = await res.json();
    const today = new Date().toDateString();
    let msgs = 0, chatCount = 0;
    chats.forEach(c => {
      let had = false;
      (c.messages || []).forEach(m => { if (new Date(m.timestamp).toDateString() === today) { msgs++; had = true; } });
      if (had) chatCount++;
    });
    el.innerHTML = msgs === 0
      ? `<span class="hwEmpty">No messages today yet.</span>`
      : `<b style="color:var(--red-neon)">${msgs}</b> messages across <b style="color:var(--red-neon)">${chatCount}</b> chat${chatCount !== 1 ? "s" : ""} today`;
  } catch { el.textContent = "Unable to compute."; }
}

/* ═══════════════════════════════════════════
   SYSTEM MONITOR
═══════════════════════════════════════════ */
export function initSystemMonitor() {
  const el = document.getElementById("homeSystemMonitor");
  if (!el) return;
  el.innerHTML = [
    `Platform: <b>${navigator.platform}</b>`,
    `Language: <b>${navigator.language}</b>`,
    `Cores: <b>${navigator.hardwareConcurrency || "?"}</b>`,
    `Memory: <b>~${navigator.deviceMemory || "?"}GB</b>`,
    `Screen: <b>${screen.width}×${screen.height}</b>`,
    `Touch: <b>${"ontouchstart" in window ? "Yes" : "No"}</b>`,
  ].map(l => `<div class="hwListItem">${l}</div>`).join("");
}

/* ═══════════════════════════════════════════
   USB DEVICES
═══════════════════════════════════════════ */
export async function initUSBDevices() {
  const el = document.getElementById("homeUSBDevices");
  if (!el) return;
  if (!navigator.usb) {
    el.innerHTML = `<span class="hwEmpty">WebUSB not available in this browser.</span>`;
    return;
  }
  const refresh = async () => {
    try {
      const devs = await navigator.usb.getDevices();
      el.innerHTML = devs.length
        ? devs.map(d => `<div class="hwListItem">\xf0\x9f\x94\x8c ${d.productName || "Unknown"} <span style="color:var(--text-muted)">(${d.manufacturerName || "?"})</span></div>`).join("")
        : `<span class="hwEmpty">No USB devices detected.</span>`;
    } catch { el.innerHTML = `<span class="hwEmpty">USB access denied.</span>`; }
  };
  refresh();
  navigator.usb.addEventListener("connect",    refresh);
  navigator.usb.addEventListener("disconnect", refresh);
}

/* ═══════════════════════════════════════════
   NETWORK INFO
═══════════════════════════════════════════ */
export function initNetworkInfo() {
  const el = document.getElementById("homeNetworkInfo");
  if (!el) return;
  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  const update = () => {
    const lines = [`<div class="hwListItem">Status: <b style="color:${navigator.onLine?"#4cff4c":"#ff4444"}">${navigator.onLine?"Online":"Offline"}</b></div>`];
    if (conn) {
      if (conn.effectiveType) lines.push(`<div class="hwListItem">Type: <b>${conn.effectiveType.toUpperCase()}</b></div>`);
      if (conn.downlink)      lines.push(`<div class="hwListItem">Speed: <b>~${conn.downlink} Mbps</b></div>`);
      if (conn.rtt)           lines.push(`<div class="hwListItem">Latency: <b>~${conn.rtt}ms</b></div>`);
    }
    el.innerHTML = lines.join("");
  };
  update();
  conn?.addEventListener("change", update);
  window.addEventListener("online",  update);
  window.addEventListener("offline", update);
}

/* ═══════════════════════════════════════════
   BACKGROUND TASKS PREVIEW
═══════════════════════════════════════════ */
export async function initBgTasksPreview() {
  const el = document.getElementById("homeBgTasks");
  if (!el) return;
  const refresh = async () => {
    try {
      const tasks = await (await fetch("/api/background")).json();
      el.innerHTML = tasks.length
        ? tasks.slice(0, 4).map(t => `
          <div class="hwListItem">
            <span style="color:${t.status==="done"?"#00ff88":t.status==="error"?"#ff4444":"var(--red-neon)"}">●</span>
            ${t.task.slice(0, 35)}… <span style="color:var(--text-muted);font-size:9px">${t.status}</span>
          </div>`).join("")
        : `<span class="hwEmpty">No active tasks.</span>`;
    } catch { el.innerHTML = `<span class="hwEmpty">Server unavailable.</span>`; }
  };
  refresh(); setInterval(refresh, 5000);
}

/* ═══════════════════════════════════════════
   MEMORY FACTS
═══════════════════════════════════════════ */
export async function initMemoryFacts() {
  const el = document.getElementById("homeMemoryFacts");
  if (!el) return;
  try {
    const res  = await fetch("/api/memory");
    const data = await res.json();
    const facts = data.facts || [];
    el.innerHTML = facts.length
      ? facts.slice(0, 5).map(f =>
          `<div class="hwListItem">▸ <span style="color:var(--text-muted);font-size:9px">[${f.category || "note"}]</span> ${f.text || f}</div>`
        ).join("")
      : `<span class="hwEmpty">No memories yet.</span>`;
  } catch { el.innerHTML = `<span class="hwEmpty">Unavailable.</span>`; }
}

/* ═══════════════════════════════════════════
   BLUETOOTH MANAGER
═══════════════════════════════════════════ */
export function initBluetooth() {
  const el = document.getElementById("homeBluetooth");
  if (!el) return;
  if (!navigator.bluetooth) {
    el.innerHTML = `<span class="hwEmpty">Web Bluetooth not available.</span>`;
    return;
  }
  el.innerHTML = `<button class="hwToolBtn" id="btScanHomeBtn">Scan Devices</button>`;
  document.getElementById("btScanHomeBtn")?.addEventListener("click", async () => {
    try {
      const device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true });
      el.innerHTML = `<div class="hwListItem">\xf0\x9f\x93\xb5 ${device.name || "Unknown"} <span style="color:#4cff4c">Connected</span></div>`;
      window.ARIA_btDevice = device;
    } catch(e) { el.innerHTML = `<span class="hwEmpty">${e.message}</span>`; }
  });
}
