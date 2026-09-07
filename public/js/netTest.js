// netTest.js — real latency and throughput measurement.
//
// This replaces the old "speed test", which timed one request to /api/ping —
// an endpoint that did not exist. The 404 fell through to the SPA handler and
// returned index.html, so it was really timing a 60KB error page and then
// mapping that duration onto a hardcoded bucket ("<80ms" printed ">200 Mbps").
// No part of it measured bandwidth.
//
// What it measures now:
//   • Latency  — median round trip, so one scheduling hiccup doesn't skew it.
//   • Download — a sustained multi-stream transfer, sampled continuously so a
//     gauge can track it live, with slow-start discarded from the final figure.
//
// Where it measures TO matters. A download from the ARIA server is a loopback
// or LAN transfer — on a desktop that reads ~2 Gbps, which says nothing about
// the internet connection. So the internet endpoint is tried first and the
// local one is the fallback; the result says which was used and the UI labels
// it, rather than presenting a loopback number as an internet speed.

// Cloudflare's public speed-test origin. Sends permissive CORS headers and
// returns exactly `bytes` of incompressible data.
const NET_ORIGIN = "https://speed.cloudflare.com/__down?bytes=";
const LOCAL_ORIGIN = "/api/speedtest/down?bytes=";

/* ── Tunables ───────────────────────────────────────────────── */

// How long the measured phase runs. Long enough for the rate to settle and for
// the dial to be worth watching; short enough that nobody walks away.
const MEASURE_MS = 9000;

// The opening stretch is TCP slow-start climbing toward the real rate, so it
// is sampled for the live display but excluded from the final average.
const RAMP_MS = 1800;

// Parallel connections. One stream is capped by the bandwidth-delay product on
// a high-latency link, which is why single-stream tests under-report; four is
// what the mainstream speed tests settle on.
const STREAMS = 4;

// A hard ceiling on the transfer, because MEASURE_MS on a gigabit line would
// otherwise pull down well over a gigabyte. Whichever limit is hit first ends
// the test, and the elapsed time is what the rate is computed from, so a
// truncated run is still accurate — just shorter.
//
// Cutting a fast link short costs very little: the rate converges within a
// second or two there. The long window earns its keep on slow and jittery
// connections, which is exactly where the cap is never reached.
const MAX_BYTES = 500 * 1024 * 1024;

// Requested per request, per stream. Each stream loops over requests of this
// size until the clock or the byte cap stops it — a single huge request would
// instead be capped by whatever maximum the endpoint enforces, and an earlier
// version of this quietly ended every test at 4 × 100MB because the payload,
// not the timer, was the binding constraint.
//
// Kept at or below SPEEDTEST_MAX_BYTES in server.js (25MB) so the local
// fallback returns the full amount asked for rather than silently truncating.
const CHUNK_REQUEST = 25 * 1024 * 1024;

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

/** Keep one connection busy until the controller aborts or the byte cap is
 *  reached, looping over requests rather than issuing one enormous one.
 *
 *  Streaming the body with a reader — rather than awaiting arrayBuffer() — is
 *  what makes a live readout possible, which is the whole point of the dial. */
async function drain(urlFor, tally, controller) {
  while (!controller.signal.aborted && tally.bytes < MAX_BYTES) {
    const res = await fetch(urlFor(), {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const reader = res.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      tally.bytes += value.length;
      if (tally.bytes >= MAX_BYTES) {
        controller.abort();
        break;
      }
    }
  }
}

/**
 * Sustained download throughput.
 *
 * @param {object}   opts
 * @param {function} opts.onProgress  called ~10×/s with {mbps, elapsedMs, bytes, phase}
 * @param {number}   opts.durationMs  measured window, default MEASURE_MS
 * @param {AbortSignal} opts.signal   caller's cancellation
 */
export async function measureDownload({
  onProgress,
  durationMs = MEASURE_MS,
  signal,
} = {}) {
  for (const [source, base] of [
    ["internet", NET_ORIGIN],
    ["local", LOCAL_ORIGIN],
  ]) {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });

    const tally = { bytes: 0, rampBytes: 0, rampDone: false };
    const started = performance.now();
    let ticker = null;

    try {
      // Confirm the endpoint answers before committing to a long transfer, so
      // an unreachable host falls through to the fallback in milliseconds
      // rather than after the full window.
      const probe = await fetch(`${base}1000&r=${Math.random()}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!probe.ok) throw new Error(`HTTP ${probe.status}`);
      await probe.arrayBuffer();

      const measureStart = performance.now();
      let rampEndBytes = 0;
      let rampEndAt = measureStart;

      ticker = setInterval(() => {
        const now = performance.now();
        const elapsed = now - measureStart;

        if (!tally.rampDone && elapsed >= RAMP_MS) {
          tally.rampDone = true;
          rampEndBytes = tally.bytes;
          rampEndAt = now;
        }

        // During ramp-up show the running average; afterwards show the rate
        // since ramp-up ended, which is the figure that will be reported.
        //
        // The post-ramp window starts at zero width, so for the first moments
        // after the handover it is too short to divide by — reading it anyway
        // dropped the needle to 0 for a tick. Hold the whole-run average until
        // the new window has enough in it to be meaningful.
        const settled = tally.rampDone && now - rampEndAt > 400;
        const windowBytes = settled ? tally.bytes - rampEndBytes : tally.bytes;
        const windowMs = settled ? now - rampEndAt : elapsed;
        const mbps = windowMs > 0 ? (windowBytes * 8) / 1e6 / (windowMs / 1000) : 0;

        onProgress?.({
          mbps,
          elapsedMs: elapsed,
          bytes: tally.bytes,
          phase: tally.rampDone ? "measuring" : "ramping",
          progress: Math.min(elapsed / durationMs, 1),
          source,
        });
      }, 100);

      const stopper = setTimeout(() => controller.abort(), durationMs);

      await Promise.allSettled(
        Array.from({ length: STREAMS }, (_, n) =>
          drain(
            () => `${base}${CHUNK_REQUEST}&r=${Math.random()}-${n}`,
            tally,
            controller,
          ),
        ),
      );
      clearTimeout(stopper);
      clearInterval(ticker);
      ticker = null;

      const ended = performance.now();
      // Final figure covers only the post-ramp window. If the transfer ended
      // before ramp-up finished (a very slow link, or the byte cap on a very
      // fast one) fall back to the whole window rather than reporting nothing.
      const usedRamp = tally.rampDone && ended > rampEndAt + 300;
      const bytes = usedRamp ? tally.bytes - rampEndBytes : tally.bytes;
      const seconds = ((usedRamp ? ended - rampEndAt : ended - measureStart)) / 1000;

      if (!bytes || seconds <= 0) throw new Error("no data transferred");

      return {
        // Rate comes from the measured window only — ramp-up excluded.
        mbps: (bytes * 8) / 1e6 / seconds,
        // Totals describe the whole run, for "this used X in Y". Reporting
        // total bytes against the measured window's duration would imply a
        // speed nobody achieved.
        bytes: tally.bytes,
        seconds: (ended - measureStart) / 1000,
        measuredBytes: bytes,
        measuredSeconds: seconds,
        source,
        sustained: usedRamp,
        cappedByBytes: tally.bytes >= MAX_BYTES,
      };
    } catch (err) {
      if (ticker) clearInterval(ticker);
      // The caller cancelled — don't silently fall through to the local
      // endpoint and start a second long transfer.
      if (signal?.aborted) return null;
      // Otherwise try the next endpoint: offline, blocked, or CORS.
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
  }
  return null;
}

/** Latency + throughput together. Either half can come back null. */
export async function runSpeedTest({ onProgress, durationMs, signal } = {}) {
  const latencyMs = await measureLatency({ signal });
  const download = await measureDownload({ onProgress, durationMs, signal });
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
