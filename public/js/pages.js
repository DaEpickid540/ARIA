// pages.js — full-screen Weather, News, System and Commands pages.
//
// They sit next to #chatWindow in the layout and take its place while open;
// the sidebar's page buttons open them and each page's Back button returns
// to the chat. lock.js calls initPages() once the chat modules load.

import { getHostInfo, formatBytes, formatUptime, formatPlatform } from "./hostInfo.js";
import { HOME_COORDS, WMO } from "./homeTools.js";

const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Only web links: a news feed's "link" could be javascript: anything. */
const safeHref = (u) => {
  try {
    const url = new URL(String(u));
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
};

const PAGES = {
  weather: { btn: "openWeatherPageBtn", load: loadWeatherPage },
  news: { btn: "openNewsPageBtn", load: loadNewsPage },
  system: { btn: "openSystemPageBtn", load: loadSystemPage },
  tools: { btn: "openToolsPageBtn", load: loadToolsPage },
};

let _inited = false;

export function initPages() {
  if (_inited) return;
  _inited = true;
  for (const [name, { btn, load }] of Object.entries(PAGES)) {
    document.getElementById(btn)?.addEventListener("click", () => {
      showPage(name);
      load();
      window.ARIA_closeSidebar?.(); // phones: get the sidebar out of the way
    });
  }
  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-page-back]")) showPage(null);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && currentPage()) showPage(null);
  });
  window.ARIA_showPage = showPage;
}

function currentPage() {
  return Object.keys(PAGES).find((n) => {
    const el = document.getElementById(`${n}Page`);
    return el && el.style.display !== "none";
  });
}

/** Show one page in place of the chat, or the chat again (null). */
export function showPage(name) {
  for (const n of Object.keys(PAGES)) {
    const el = document.getElementById(`${n}Page`);
    if (el) el.style.display = n === name ? "" : "none";
  }
  // A class, not an inline style: the phone layout pins #chatWindow to
  // display:flex !important (panels.css), which an inline style can't beat.
  document.getElementById("layout")?.classList.toggle("pageOpen", !!name);
}

/* ---------------- WEATHER ---------------- */

async function loadWeatherPage() {
  const el = document.getElementById("weatherPageContent");
  if (!el) return;
  el.textContent = "Loading weather…";
  try {
    const res = await fetch(`/api/weather?lat=${HOME_COORDS.lat}&lon=${HOME_COORDS.lon}`);
    const w = (await res.json()).weather;
    if (!w) {
      el.textContent = "Weather unavailable.";
      return;
    }
    const f = Math.round((w.temperature * 9) / 5 + 32);
    el.innerHTML = `
      <div class="ariaPageHero">${esc(Math.round(w.temperature))}°C <span class="hwSub">${esc(f)}°F</span></div>
      <div class="ariaPageLead">${esc(WMO[w.weathercode] || "—")}</div>
      <dl class="ariaPageFacts">
        <dt>Wind</dt><dd>${esc(w.windspeed)} km/h from ${esc(w.winddirection)}°</dd>
        <dt>Location</dt><dd>Mason, OH</dd>
        <dt>Updated</dt><dd>${esc(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }))}</dd>
      </dl>`;
  } catch {
    el.textContent = "Couldn't reach the weather service.";
  }
}

/* ---------------- NEWS ---------------- */

async function loadNewsPage() {
  const el = document.getElementById("newsPageContent");
  if (!el) return;
  el.textContent = "Loading news…";
  try {
    const articles = (await (await fetch("/api/news")).json()).articles || [];
    if (!articles.length) {
      el.innerHTML = `<p class="hwEmpty">No news right now. Headlines need <code>NEWSDATA_KEY</code> (Settings ▸ Keys).</p>`;
      return;
    }
    el.innerHTML = `<ul class="ariaNewsList">${articles
      .slice(0, 20)
      .map((a) => {
        const href = safeHref(a.link || a.url);
        const title = esc(a.title || "Untitled article");
        const meta = [a.source_id || a.source_name, a.pubDate && new Date(a.pubDate).toLocaleString()]
          .filter(Boolean)
          .map(esc)
          .join(" · ");
        return `<li>${
          href ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${title}</a>` : title
        }${meta ? `<div class="hwSub">${meta}</div>` : ""}</li>`;
      })
      .join("")}</ul>`;
  } catch {
    el.textContent = "Couldn't load the news.";
  }
}

/* ---------------- SYSTEM ---------------- */

async function loadSystemPage() {
  const el = document.getElementById("systemPageContent");
  if (!el) return;
  el.textContent = "Loading…";
  const row = (k, v) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`;
  let server = `<p class="hwEmpty">Server details unavailable.</p>`;
  try {
    const info = await getHostInfo();
    // source "browser" is hostInfo's guess when the server didn't answer.
    if (info.source !== "host") throw new Error("no server");
    const { host, cpu, memory, process: proc } = info;
    server = `<dl class="ariaPageFacts">
      ${row("Machine", `${host.hostname} · ${formatPlatform(host)}`)}
      ${row("CPU", `${cpu.model} · ${cpu.cores} cores${cpu.usagePercent != null ? ` · ${cpu.usagePercent}% busy` : ""}`)}
      ${row("Memory", `${formatBytes(memory.usedBytes)} of ${formatBytes(memory.totalBytes)} (${memory.usedPercent}%)`)}
      ${row("Up for", formatUptime(host.uptimeSec))}
      ${row("ARIA", `Node ${proc.node} · up ${formatUptime(proc.uptimeSec)} · ${formatBytes(proc.rssBytes)}`)}
    </dl>`;
  } catch {}
  const nav = navigator;
  el.innerHTML = `
    <h3 class="ariaPageSub">Server</h3>${server}
    <h3 class="ariaPageSub">This browser</h3>
    <dl class="ariaPageFacts">
      ${row("Platform", nav.userAgentData?.platform || nav.platform || "unknown")}
      ${row("Cores / memory", `${nav.hardwareConcurrency || "?"} cores · ~${nav.deviceMemory || "?"} GB`)}
      ${row("Language", nav.language)}
      ${row("Network", nav.onLine ? "Online" : "Offline")}
      ${row("User agent", nav.userAgent)}
    </dl>`;
}

/* ---------------- COMMANDS ---------------- */

async function loadToolsPage() {
  const el = document.getElementById("toolsPageContent");
  if (!el) return;
  el.textContent = "Loading…";
  try {
    const tools = (await (await fetch("/api/tools")).json()).tools || [];
    el.innerHTML = `
      <p class="ariaPageLead">Type these in chat, or just ask: ARIA picks the tool itself.</p>
      <ul class="ariaToolList">${tools
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(
          (t) =>
            `<li><code>/${esc(t.name)}</code> <span class="hwSub">${esc(t.desc || "")}${
              t.skill ? ` · from the ${esc(t.skill)} skill` : t.dropIn ? " · drop-in" : ""
            }</span></li>`,
        )
        .join("")}</ul>`;
  } catch {
    el.textContent = "Couldn't load the tool list.";
  }
}
