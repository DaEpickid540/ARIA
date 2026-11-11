// homeCore.js — the ring in the middle of the home screen, and the tool dock
// under it.
//
// The core is one SVG, drawn once:
//   - 60 ticks round the rim; the seconds sweep them
//   - a left arc for host CPU and a right arc for RAM (same numbers as the
//     System cards, from hostInfo.js)
//   - an inner ring that fills as today's Daily Rings close (rings.js calls
//     setCoreRings); with no rings set up it shows how much of the day is gone
// Four callouts sit in the corners: CPU, RAM, the round trip to the server,
// and whether a Claw relay is connected.
//
// The dock holds the utilities that used to be a row of cards. Each chip
// opens its card above the dock; the cards keep their ids, so homeTools.js
// fills them exactly as before.

import { getHostInfo } from "./hostInfo.js";

const C = 200; // centre of the 400×400 viewBox
const polar = (r, deg) => {
  const a = ((deg - 90) * Math.PI) / 180;
  return [C + r * Math.cos(a), C + r * Math.sin(a)];
};
const f = (n) => n.toFixed(2);

/** An arc of radius r from one angle to another (0° = top, clockwise). */
function arc(r, from, to, clockwise = true) {
  const [x1, y1] = polar(r, from);
  const [x2, y2] = polar(r, to);
  const span = clockwise ? (to - from + 360) % 360 : (from - to + 360) % 360;
  return `M${f(x1)} ${f(y1)} A${r} ${r} 0 ${span > 180 ? 1 : 0} ${clockwise ? 1 : 0} ${f(x2)} ${f(y2)}`;
}

const $ = (id) => document.getElementById(id);

function drawCore(svg) {
  let ticks = "";
  for (let i = 0; i < 60; i++) {
    const major = i % 5 === 0;
    const [x1, y1] = polar(major ? 183 : 187, i * 6);
    const [x2, y2] = polar(195, i * 6);
    ticks += `<line class="hudTick${major ? " major" : ""}" data-i="${i}" x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}"/>`;
  }
  // CPU climbs the left side, RAM the right, both from the bottom up.
  const cpu = arc(160, 215, 325);
  const ram = arc(160, 145, 35, false);
  const [cx, cy] = polar(160, 205);
  const [rx, ry] = polar(160, 155);
  svg.innerHTML = `
    <defs>
      <radialGradient id="hudGlowGrad">
        <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.16"/>
        <stop offset="70%" stop-color="var(--accent)" stop-opacity="0.04"/>
        <stop offset="100%" stop-color="var(--accent)" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <circle class="hudGlow" cx="${C}" cy="${C}" r="150" fill="url(#hudGlowGrad)"/>
    <g class="hudTicks">${ticks}</g>
    <circle class="hudRingA" cx="${C}" cy="${C}" r="174" pathLength="360"/>
    <path class="hudGaugeTrack" d="${cpu}"/>
    <path class="hudGaugeTrack" d="${ram}"/>
    <path id="hudCpuArc" class="hudGauge" d="${cpu}" pathLength="100" stroke-dasharray="0 100"/>
    <path id="hudRamArc" class="hudGauge" d="${ram}" pathLength="100" stroke-dasharray="0 100"/>
    <text class="hudGaugeText" x="${f(cx)}" y="${f(cy + 14)}" text-anchor="middle">CPU</text>
    <text class="hudGaugeText" x="${f(rx)}" y="${f(ry + 14)}" text-anchor="middle">RAM</text>
    <circle class="hudRingB" cx="${C}" cy="${C}" r="144" pathLength="360"/>
    <circle class="hudRingTrack" cx="${C}" cy="${C}" r="126"/>
    <circle id="hudRingsArc" class="hudRingProg" cx="${C}" cy="${C}" r="126" pathLength="100"
      stroke-dasharray="0 100" transform="rotate(-90 ${C} ${C})"/>
    <circle class="hudRingC" cx="${C}" cy="${C}" r="110"/>`;
}

/* ── clock ───────────────────────────────────────────────────── */
let _lastSec = -1;
function tickClock() {
  const now = new Date();
  const sec = now.getSeconds();
  if (sec === _lastSec) return;
  _lastSec = sec;

  const parts = new Intl.DateTimeFormat([], { hour: "numeric", minute: "2-digit" }).formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t)?.value || "";
  const main = $("hudClockMain");
  const secEl = $("hudClockSec");
  if (main) main.textContent = `${get("hour")}:${get("minute")}`;
  if (secEl) secEl.textContent = `${String(sec).padStart(2, "0")}${get("dayPeriod") ? " " + get("dayPeriod") : ""}`;

  document.querySelectorAll("#hudCoreSvg .hudTick").forEach((t) => {
    const i = +t.dataset.i;
    t.classList.toggle("on", i <= sec);
    t.classList.toggle("now", i === sec);
  });

  // Date and greeting only change with the minute.
  if (sec === 0 || !$("hudDate")?.textContent) {
    const date = $("hudDate");
    if (date)
      date.textContent = now
        .toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })
        .toUpperCase();
    const greet = $("hudGreeting");
    if (greet) {
      const h = now.getHours();
      const when = h < 5 ? "Up late" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
      const id = String(window.ARIA_userId || "").trim();
      const name = id ? id[0].toUpperCase() + id.slice(1) : "";
      greet.textContent = name ? `${when}, ${name}` : when;
    }
    if (!_rings.total) paintRings(); // the day-progress fallback moves too
  }
}

/* ── the inner ring: Daily Rings, or the day itself ──────────── */
let _rings = { total: 0, done: 0, percent: 0 };

function paintRings() {
  const arcEl = $("hudRingsArc");
  const btn = $("hudRingsBtn");
  let pct;
  if (_rings.total) {
    pct = _rings.percent;
    if (btn) {
      const all = _rings.done === _rings.total;
      btn.innerHTML = `<i class="bi bi-bullseye" aria-hidden="true"></i> ${_rings.done}/${_rings.total} RINGS${all ? " ✓" : ""}`;
      btn.classList.toggle("allDone", all);
    }
  } else {
    const now = new Date();
    pct = Math.round(((now.getHours() * 60 + now.getMinutes()) / 1440) * 100);
    if (btn) {
      btn.innerHTML = `<i class="bi bi-plus-circle" aria-hidden="true"></i> SET DAILY RINGS`;
      btn.classList.remove("allDone");
    }
  }
  if (arcEl) arcEl.setAttribute("stroke-dasharray", `${Math.max(0, Math.min(100, pct))} 100`);
  $("hudCore")?.classList.toggle("ringsClosed", !!_rings.total && _rings.done === _rings.total);
}

/** rings.js reports today's rings here: { total, done, percent }. */
export function setCoreRings(summary) {
  _rings = { total: summary?.total || 0, done: summary?.done || 0, percent: summary?.percent || 0 };
  paintRings();
}

/* ── live readings ───────────────────────────────────────────── */
const level = (v) => (v >= 90 ? "crit" : v >= 75 ? "warn" : "");

function setGauge(arcId, textId, value) {
  const arcEl = $(arcId);
  const text = $(textId);
  const ok = Number.isFinite(value);
  if (arcEl) {
    arcEl.setAttribute("stroke-dasharray", `${ok ? Math.max(0, Math.min(100, value)) : 0} 100`);
    arcEl.setAttribute("class", `hudGauge ${ok ? level(value) : ""}`.trim());
  }
  if (text) {
    text.textContent = ok ? `${Math.round(value)}%` : "—";
    text.className = `hudCalloutValue ${ok ? level(value) : "off"}`.trim();
  }
}

const homeVisible = () => {
  const s = $("homepageScreen");
  return !!s && s.style.display !== "none" && !document.hidden;
};

async function readHost() {
  if (!homeVisible()) return;
  const info = await getHostInfo();
  const host = info.source === "host";
  setGauge("hudCpuArc", "hudCpu", host ? Number(info.cpu?.usagePercent ?? NaN) : NaN);
  setGauge("hudRamArc", "hudRam", host ? Number(info.memory?.usedPercent ?? NaN) : NaN);
}

// One request, two readings: how long the server took, and what it says
// about the Claw relay.
async function readLink() {
  if (!homeVisible()) return;
  const link = $("hudLink");
  const claw = $("hudClaw");
  const status = $("hudStatusText");
  const mini = $("hudStatusMini");
  const t0 = performance.now();
  try {
    const res = await fetch("/api/claw/status", { cache: "no-store" });
    const ms = Math.round(performance.now() - t0);
    const d = await res.json();
    if (link) {
      link.textContent = `${ms}ms`;
      link.className = `hudCalloutValue ${ms < 150 ? "good" : ms < 400 ? "warn" : "crit"}`;
    }
    if (claw) {
      const relay = (d.relays || []).find((r) => r.relayType !== "screenwatcher") || d.relays?.[0];
      const [text, cls] = d.disabled
        ? ["DISABLED", "off"]
        : d.killed
          ? ["KILLED", "crit"]
          : relay
            ? ["ONLINE", "good"]
            : ["NO RELAY", "off"];
      claw.textContent = text;
      claw.className = `hudCalloutValue ${cls}`;
      const btn = $("hudClawCallout");
      if (btn) btn.title = relay ? `Claw relay: ${relay.hostname || relay.id} — click to open Claw` : "Claw relay — click to open Claw";
    }
    if (status) status.textContent = "ONLINE";
    mini?.classList.remove("down");
  } catch {
    if (link) {
      link.textContent = "DOWN";
      link.className = "hudCalloutValue crit";
    }
    if (claw) {
      claw.textContent = "—";
      claw.className = "hudCalloutValue off";
    }
    if (status) status.textContent = navigator.onLine ? "SERVER OFFLINE" : "OFFLINE";
    mini?.classList.add("down");
  }
}

/* ── the dock ────────────────────────────────────────────────── */
function closeDock() {
  document.querySelectorAll(".hudDockPanel.open").forEach((p) => p.classList.remove("open"));
  document.querySelectorAll(".hudDockBtn.active").forEach((b) => b.classList.remove("active"));
  $("hudDockPanels")?.classList.remove("open");
}

function openDock(id) {
  const panel = $(id);
  if (!panel) return;
  const wasOpen = panel.classList.contains("open");
  closeDock();
  if (wasOpen) return;
  panel.classList.add("open");
  $("hudDockPanels")?.classList.add("open");
  document.querySelector(`.hudDockBtn[data-panel="${id}"]`)?.classList.add("active");
  panel.querySelector("input:not([type=color]):not([type=checkbox]):not([type=range]):not([readonly]), textarea")?.focus({ preventScroll: true });
}

function initDock() {
  const dock = $("hudDock");
  if (!dock) return;
  dock.addEventListener("click", (e) => {
    const btn = e.target.closest(".hudDockBtn");
    if (btn) openDock(btn.dataset.panel);
  });
  // Click anywhere else, or Esc, puts the card away.
  document.addEventListener("pointerdown", (e) => {
    if (!$("hudDockPanels")?.classList.contains("open")) return;
    if (e.target.closest("#hudDockPanels, #hudDock")) return;
    closeDock();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeDock();
  });
}

/* ── init ────────────────────────────────────────────────────── */
let _started = false;

export function initHomeCore() {
  const svg = $("hudCoreSvg");
  if (!svg) return;
  if (!_started) {
    _started = true;
    drawCore(svg);
    initDock();
    setInterval(tickClock, 250);
    setInterval(readHost, 5000);
    setInterval(readLink, 8000);

    $("hudClawCallout")?.addEventListener("click", async () => {
      if (!window.ARIA_toggleClaw) await window.ARIA_loadChatModules?.();
      window.ARIA_toggleClaw?.();
    });
    $("hudSearchBtn")?.addEventListener("click", () => window.ARIA_openPalette?.());

    // The header carries the weather card's headline, so it's readable
    // without scrolling the rail.
    const src = $("homeWeatherMain");
    const mini = $("hudWeatherMini");
    if (src && mini) {
      const copy = () => {
        const t = src.textContent.trim();
        mini.textContent = /load|unavailable|error/i.test(t) ? "" : t;
      };
      new MutationObserver(copy).observe(src, { childList: true, characterData: true, subtree: true });
      copy();
    }
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        readHost();
        readLink();
      }
    });
  }
  _lastSec = -1;
  tickClock();
  paintRings();
  readHost();
  readLink();
}
