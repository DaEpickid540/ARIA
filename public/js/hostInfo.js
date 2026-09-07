// hostInfo.js — real machine specs from the ARIA host.
//
// The dashboard used to read navigator.hardwareConcurrency and
// navigator.deviceMemory. Those describe what the *browser* is willing to
// admit, not the machine: deviceMemory is clamped to 8 and rounded to a power
// of two by spec, so a 32GB desktop reported "~8GB" and every machine above
// 8GB looked identical. navigator.platform is deprecated and frozen.
//
// The ARIA server runs on the host, so /api/system asks the OS directly and
// this module caches and formats the answer. When the server is unreachable
// (opened from a phone with the host asleep, say) it falls back to the
// navigator values and says so, rather than showing nothing.

let _cache = null;
let _cacheAt = 0;
let _inFlight = null;
const CACHE_MS = 5000;

/** Host specs plus live CPU/memory. `source` is "host" or "browser".
 *
 *  Three widgets call this, and on boot they all call it before any response
 *  has landed — a plain time cache is still empty for all three, so the page
 *  opened with three identical requests. Sharing the in-flight promise
 *  collapses them into one. */
export async function getHostInfo({ force = false } = {}) {
  if (!force && _cache && Date.now() - _cacheAt < CACHE_MS) return _cache;
  if (!force && _inFlight) return _inFlight;

  _inFlight = (async () => {
    try {
      const res = await fetch("/api/system", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      _cache = { ...data, source: "host" };
      _cacheAt = Date.now();
      return _cache;
    } catch {
      return browserFallback();
    } finally {
      _inFlight = null;
    }
  })();

  return _inFlight;
}

/** What the browser can tell us on its own — deliberately marked so callers
 *  can label the difference instead of presenting a guess as a measurement. */
function browserFallback() {
  const ua = navigator.userAgent;
  const osLabel =
    ua.match(/\(([^)]+)\)/)?.[1]?.split(";")[0]?.trim() || "Unknown OS";
  return {
    ok: false,
    source: "browser",
    host: { platform: osLabel, release: "", arch: "", hostname: "" },
    cpu: {
      model: null,
      cores: navigator.hardwareConcurrency || null,
      usagePercent: null,
      loadAvg: null,
    },
    // deviceMemory is a lower bound, not the installed total — flagged as
    // approximate so formatMemory can render it differently.
    memory: navigator.deviceMemory
      ? { totalBytes: navigator.deviceMemory * 1024 ** 3, approximate: true }
      : null,
    process: null,
  };
}

/** Browser and screen details, which only the client knows. */
export function getBrowserInfo() {
  const ua = navigator.userAgent;
  // screen.width reports 0 in some embedded/hidden webviews, which rendered as
  // "0×0". Fall back to the viewport, which is always meaningful.
  const w = screen.width || window.innerWidth;
  const h = screen.height || window.innerHeight;
  return {
    browser: ua.match(/(Chrome|Firefox|Safari|Edg)\/[\d.]+/)?.[0] || "Browser",
    language: navigator.language,
    screen: w && h ? `${w}×${h}` : "—",
    touch: "ontouchstart" in window,
    online: navigator.onLine,
  };
}

/* ── Formatting ─────────────────────────────────────────────── */

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "—";
  const gb = bytes / 1024 ** 3;
  if (gb >= 10) return `${Math.round(gb)} GB`;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${Math.round(bytes / 1024 ** 2)} MB`;
}

export function formatUptime(seconds) {
  if (!Number.isFinite(seconds)) return "—";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

/** Windows reports os.release() as an NT build ("10.0.26200"), which is not
 *  what anyone calls their operating system. Map the ones that matter. */
export function formatPlatform(host) {
  if (!host) return "Unknown";
  const { platform, release, arch } = host;
  if (platform === "win32") {
    const build = parseInt(String(release).split(".")[2], 10);
    // Windows 11 shipped as NT 10.0 and is only distinguishable by build.
    const name = build >= 22000 ? "Windows 11" : "Windows 10";
    return arch ? `${name} (${arch})` : name;
  }
  if (platform === "darwin") return arch ? `macOS (${arch})` : "macOS";
  if (platform === "linux") return arch ? `Linux (${arch})` : "Linux";
  return platform ? `${platform} ${release || ""}`.trim() : "Unknown";
}
