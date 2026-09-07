// netTest.js — real latency and throughput measurement.
//
// This replaces the old "speed test", which timed one request to /api/ping —
// an endpoint that did not exist. The 404 fell through to the SPA handler and
// returned index.html, so the widget was really timing a 60KB error page and
// then mapping that duration onto a hardcoded bucket ("<80ms" printed
// ">200 Mbps"). No part of it measured bandwidth.
//
// What it measures now:
//   • Latency  — median round trip, so one scheduling hiccup doesn't skew it.
//   • Download — bytes/second over parallel connections, timed from first byte.
//
// Where it measures TO matters. A download from the ARIA server is a loopback
// or LAN transfer — on this machine that reads ~2 Gbps, which says nothing
// about the internet connection. So the internet endpoint is tried first and
// the local one is the fallback; the result says which was used and the UI
// labels it, rather than presenting a loopback number as an internet speed.

// Cloudflare's public speed-test origin. Sends permissive CORS headers and
// returns exactly `bytes` of incompressible data.
const NET_ORIGIN = "https://speed.cloudflare.com/__down?bytes=";
const LOCAL_ORIGIN = "/api/speedtest/down?bytes=";

/** Fetch `bytes` and return how long the transfer took, in seconds.
 *  Reads the body to completion — resolving on headers alone would time the
 *  first packet rather than the transfer. */
async function timedDownload(urlBase, bytes, signal) {
  const url = `${urlBase}${bytes}&r=${Math.random()}`;
  const started = performance.now();
  const res = await fetch(url, { cache: "no-store", signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  return {
    seconds: (performance.now() - started) / 1000,
    bytes: buf.byteLength,
  };
}

/** Median round-trip time in ms over `samples` probes.
 *
 *  Median, not mean: a single GC pause or scheduler hiccup in one sample drags
 *  a mean well off the real figure, and this runs on a page that is also
 *  booting the rest of the dashboard. */
export async function measureLatency({ samples = 5, signal } = {}) {
  const timings = [];

  // One warm-up, discarded: the first request pays DNS, TCP and TLS setup,
  // which is connection cost rather than latency.
  try {
    await fetch(`/api/ping?warmup=${Math.random()}`, { cache: "no-store", signal });
  } catch {
    /* fall through — the loop below reports the failure */
  }

  for (let i = 0; i < samples; i++) {
    const started = performance.now();
    try {
      const res = await fetch(`/api/ping?r=${Math.random()}`, {
        cache: "no-store",
        signal,
      });
      if (!res.ok) continue;
      timings.push(performance.now() - started);
    } catch {
      /* skip this sample */
    }
  }

  if (!timings.length) return null;
  timings.sort((a, b) => a - b);
  return Math.round(timings[Math.floor(timings.length / 2)]);
}

/** Download throughput in Mbps.
 *
 *  Two details that decide whether the number means anything:
 *
 *  1. Size. A 1MB single-stream download is mostly TCP slow-start — measured
 *     against Cloudflare it reported 10 Mbps on a link that sustains far more.
 *     So it ramps: a small probe first, and if that clears quickly, a large one
 *     whose steady-state dominates the total.
 *  2. Parallelism. One connection is capped by the bandwidth-delay product on
 *     a high-latency link. Four streams in parallel is what real speed tests
 *     do, and it is enough to saturate a home connection.
 */
export async function measureDownload({ signal } = {}) {
  for (const [source, base] of [
    ["internet", NET_ORIGIN],
    ["local", LOCAL_ORIGIN],
  ]) {
    try {
      // Probe: also warms the connection for the measured run below.
      const probe = await timedDownload(base, 1_000_000, signal);

      // Size the real run so it lasts roughly two seconds — long enough to get
      // past slow-start, short enough not to stall the dashboard.
      const probeBps = probe.bytes / Math.max(probe.seconds, 0.001);
      const streams = 4;
      const perStream = Math.min(
        Math.max(Math.round((probeBps * 2) / streams), 500_000),
        25_000_000,
      );

      const started = performance.now();
      const runs = await Promise.all(
        Array.from({ length: streams }, () =>
          timedDownload(base, perStream, signal),
        ),
      );
      const seconds = (performance.now() - started) / 1000;
      const bytes = runs.reduce((sum, r) => sum + r.bytes, 0);
      if (!seconds || !bytes) continue;

      return {
        mbps: (bytes * 8) / 1e6 / seconds,
        bytes,
        seconds,
        source,
      };
    } catch {
      // Try the next endpoint — offline, blocked, or the request was aborted.
    }
  }
  return null;
}

/** Latency + throughput together. Either half can come back null. */
export async function runSpeedTest({ signal } = {}) {
  const latencyMs = await measureLatency({ signal });
  const download = await measureDownload({ signal });
  return { latencyMs, download };
}

/** Mbps → a short human string. Sub-10 links deserve a decimal; 900 Mbps does
 *  not need to be "900.4". */
export function formatMbps(mbps) {
  if (!Number.isFinite(mbps)) return "—";
  if (mbps >= 100) return `${Math.round(mbps)}`;
  if (mbps >= 10) return mbps.toFixed(1);
  return mbps.toFixed(2);
}
