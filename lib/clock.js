// lib/clock.js — the owner's wall clock, whatever the server's is
//
// Render runs on UTC; the PC runs on Eastern time. "Today", "tomorrow" and
// "9 PM" have to mean the owner's, or a debrief written on Render covers the
// wrong day and arrives at 5 PM. ARIA_TZ sets the zone (an IANA name);
// unset, it's America/New_York, the zone the calendar code already assumes.

export const TZ = process.env.ARIA_TZ || "America/New_York";

const _fmt = new Map();
function fmt(tz) {
  if (!_fmt.has(tz))
    _fmt.set(
      tz,
      new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        hourCycle: "h23",
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "numeric",
        second: "numeric",
      }),
    );
  return _fmt.get(tz);
}

/** The wall-clock parts of instant `t` in `tz`: { y, m (1–12), d, h, min, s }. */
export function zoned(t = Date.now(), tz = TZ) {
  const p = Object.fromEntries(fmt(tz).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, min: +p.minute, s: +p.second };
}

/** How far `tz` is ahead of UTC at instant `t`, in ms (EDT: −4 h). */
function offset(t, tz) {
  const z = zoned(t, tz);
  return Date.UTC(z.y, z.m - 1, z.d, z.h, z.min, z.s) - Math.floor(t / 1000) * 1000;
}

/** The instant of 00:00 on y-m-d in `tz` (m is 1–12; overflowing days roll over). */
export function zonedMidnight(y, m, d, tz = TZ) {
  const guess = Date.UTC(y, m - 1, d);
  // Twice, so a DST change between the guess and the answer is accounted for.
  const first = guess - offset(guess, tz);
  return guess - offset(first, tz);
}

/** Midnight today, midnight tomorrow and midnight the day after, in `tz`. */
export function dayBounds(now = Date.now(), tz = TZ) {
  const z = zoned(now, tz);
  return {
    start: zonedMidnight(z.y, z.m, z.d, tz),
    tomorrow: zonedMidnight(z.y, z.m, z.d + 1, tz),
    after: zonedMidnight(z.y, z.m, z.d + 2, tz),
  };
}

/** "2026-10-13" for instant `t` in `tz`. */
export function dateKey(t = Date.now(), tz = TZ) {
  const z = zoned(t, tz);
  return `${z.y}-${String(z.m).padStart(2, "0")}-${String(z.d).padStart(2, "0")}`;
}
