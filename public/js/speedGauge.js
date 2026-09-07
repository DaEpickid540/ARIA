// speedGauge.js — the dial a speed test draws while it runs.
//
// Modelled on the Ookla/Fast.com style: a 270° arc, a non-linear scale so slow
// links still get visual room, and a needle that tracks the live sample rather
// than only the final number.
//
// The scale is the part worth explaining. A linear 0–1000 dial spends 90% of
// its sweep on speeds most connections never reach, so a 40 Mbps line and a
// 90 Mbps line look identical — both pinned near zero. Real speed tests use a
// compressed scale instead, and so does this: the stops below are spaced
// evenly around the dial regardless of how far apart their values are, so the
// busy 0–100 range gets most of the arc.

const STOPS = [0, 1, 5, 10, 20, 50, 100, 250, 500, 1000];

// Angles are measured clockwise from straight up (see polar() below), so
// 225° is the south-west corner: the dial opens at bottom-left, sweeps up
// through west/north/east, and closes at bottom-right (225 + 270 = 495 ≡ 135).
const START_ANGLE = 225;
const SWEEP = 270;

/** Value → fraction of the sweep, piecewise-linear between the stops above. */
function valueToFraction(value) {
  const v = Math.max(0, Math.min(value, STOPS[STOPS.length - 1]));
  for (let i = 0; i < STOPS.length - 1; i++) {
    const lo = STOPS[i];
    const hi = STOPS[i + 1];
    if (v <= hi) {
      const withinSegment = (v - lo) / (hi - lo);
      return (i + withinSegment) / (STOPS.length - 1);
    }
  }
  return 1;
}

function polar(cx, cy, r, deg) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

/** SVG arc path from `fromDeg` to `toDeg` on a circle. */
function arcPath(cx, cy, r, fromDeg, toDeg) {
  const start = polar(cx, cy, r, fromDeg);
  const end = polar(cx, cy, r, toDeg);
  const largeArc = Math.abs(toDeg - fromDeg) > 180 ? 1 : 0;
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}

/**
 * Mount a gauge into `host`.
 * Returns handles for driving it; the caller owns the measurement.
 */
export function createSpeedGauge(host, { size = 168 } = {}) {
  const cx = 100;
  const cy = 100;
  const r = 78;
  const trackEnd = START_ANGLE + SWEEP;

  // Tick marks at each scale stop, so the numbers on the dial mean something.
  const ticks = STOPS.map((stop) => {
    const deg = START_ANGLE + valueToFraction(stop) * SWEEP;
    const outer = polar(cx, cy, r + 9, deg);
    const inner = polar(cx, cy, r + 3, deg);
    const label = polar(cx, cy, r + 20, deg);
    return `
      <line x1="${inner.x.toFixed(1)}" y1="${inner.y.toFixed(1)}"
            x2="${outer.x.toFixed(1)}" y2="${outer.y.toFixed(1)}"
            class="sgTick" />
      <text x="${label.x.toFixed(1)}" y="${label.y.toFixed(1)}"
            class="sgTickLabel">${stop}</text>`;
  }).join("");

  host.innerHTML = `
    <svg class="speedGauge" viewBox="0 0 200 200" width="${size}" height="${size}"
         role="img" aria-label="Download speed gauge">
      <path class="sgTrack" d="${arcPath(cx, cy, r, START_ANGLE, trackEnd)}" />
      <path class="sgFill" d="${arcPath(cx, cy, r, START_ANGLE, trackEnd)}"
            pathLength="1" stroke-dasharray="1" stroke-dashoffset="1" />
      <g class="sgTicks">${ticks}</g>
      <g class="sgNeedleGroup" transform="rotate(0 ${cx} ${cy})">
        <line class="sgNeedle" x1="${cx}" y1="${cy}" x2="${cx}" y2="${cy - r + 12}" />
      </g>
      <circle class="sgHub" cx="${cx}" cy="${cy}" r="5" />
      <!-- The readout sits in the open wedge below the hub, between the two
           ends of the arc, so the needle never crosses it. -->
      <text class="sgValue" x="${cx}" y="${cy + 42}">—</text>
      <text class="sgUnit" x="${cx}" y="${cy + 58}">Mbps</text>
    </svg>`;

  const svg = host.querySelector(".speedGauge");
  const fill = svg.querySelector(".sgFill");
  const needleGroup = svg.querySelector(".sgNeedleGroup");
  const valueText = svg.querySelector(".sgValue");
  const unitText = svg.querySelector(".sgUnit");

  function setValue(mbps) {
    const fraction = Number.isFinite(mbps) ? valueToFraction(mbps) : 0;
    fill.setAttribute("stroke-dashoffset", String(1 - fraction));
    // The needle is drawn pointing straight up, which is 0° in the same
    // clockwise-from-north convention the arc uses — so the gauge angle is the
    // rotation, with no offset to reconcile.
    needleGroup.setAttribute(
      "transform",
      `rotate(${(START_ANGLE + fraction * SWEEP).toFixed(2)} ${cx} ${cy})`,
    );
    valueText.textContent = Number.isFinite(mbps)
      ? mbps >= 100
        ? Math.round(mbps)
        : mbps >= 10
          ? mbps.toFixed(1)
          : mbps.toFixed(2)
      : "—";
  }

  function setUnit(text) {
    unitText.textContent = text;
  }

  /** idle | running | done | failed — drives the CSS colour states. */
  function setState(state) {
    svg.dataset.state = state;
  }

  setState("idle");
  setValue(NaN);

  return { setValue, setUnit, setState, element: svg };
}
