// lib/debrief.js — the evening debrief: what got done, what slipped, and
// what tomorrow starts with
// ═══════════════════════════════════════════════════════════════════
//
// The morning briefing looks ahead; this looks back. Everything here is pure:
// server.js hands in the day's raw material (todos, background tasks, chats,
// calendar, GRIND), gatherDay() turns it into facts, and either the user's
// model writes them up (debriefPrompt) or, with no model, fallbackDebrief()
// does it plainly. Nothing is invented: a section with no facts is left out.
// ═══════════════════════════════════════════════════════════════════

import { TZ, dayBounds, dateKey } from "./clock.js";

// The owner's day, not the server's (Render runs on UTC): see lib/clock.js.
export { dayBounds };

const today = (t, b) => typeof t === "number" && t >= b.start && t < b.tomorrow;
const clip = (s, n = 90) => {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
};

/**
 * The day as facts.
 * @param {object} src
 *   todos     [{ text, done, createdAt?, doneAt? }]
 *   tasks     [{ title, status, finishedAt?, created? }]   (lib/tasks.js)
 *   chats     [{ id, title, messages:[{ role, timestamp, channel? }] }]
 *   events    [{ title, start, allDay }]                   (tomorrow's calendar; null = not configured)
 *   grind     string                                       (lib/life-context.js, may be "")
 */
export function gatherDay({ now = Date.now(), tz = TZ, todos = [], tasks = [], chats = [], events = null, grind = "" } = {}) {
  const b = dayBounds(now, tz);
  const doneToday = todos.filter((t) => t.done && today(t.doneAt, b)).map((t) => clip(t.text));
  const open = todos.filter((t) => !t.done);
  // Open and older than today: slipped. Added today and still open: on deck.
  const slipped = open.filter((t) => !t.createdAt || t.createdAt < b.start).map((t) => clip(t.text));
  const addedToday = open.filter((t) => today(t.createdAt, b)).map((t) => clip(t.text));

  const tasksDone = tasks.filter((t) => t.status === "done" && today(t.finishedAt, b)).map((t) => clip(t.title));
  // Stuck recently: a task that failed six weeks ago isn't tonight's news.
  const tasksStuck = tasks
    .filter((t) => ["failed", "paused", "awaiting_approval"].includes(t.status))
    .filter((t) => (t.changedAt || t.created || 0) >= b.start - 3 * 24 * 3600_000)
    .map((t) => `${clip(t.title)} (${t.status.replace("_", " ")})`);

  // Conversations today: what was talked about, by title, busiest first.
  // Server-filed chats (briefings, alerts) aren't conversations.
  const talked = chats
    .filter((c) => !c.briefings && !c.alerts)
    .map((c) => ({
      title: clip(c.title || "Untitled", 60),
      n: (c.messages || []).filter((m) => m.role === "user" && today(m.timestamp, b)).length,
    }))
    .filter((c) => c.n > 0 && !/^new chat$/i.test(c.title))
    .sort((a, b2) => b2.n - a.n)
    .slice(0, 5);

  const alerts = chats
    .filter((c) => c.alerts)
    .flatMap((c) => (c.messages || []).filter((m) => today(m.timestamp, b)))
    .map((m) => clip(String(m.content || "").split("\n")[0].replace(/\*\*/g, ""), 100));

  const tomorrow = Array.isArray(events)
    ? events
        .filter((e) => {
          const t = new Date(e.start).getTime();
          // An all-day date ("2026-10-13") parses as UTC midnight: compare
          // dates. One that started earlier and runs through tomorrow (a
          // trip) counts too; its end date is exclusive.
          if (e.allDay) {
            const day = dateKey(b.tomorrow, tz);
            const s = String(e.start).slice(0, 10);
            const end = String(e.end || "").slice(0, 10);
            return s === day || (s < day && end > day);
          }
          return t >= b.tomorrow && t < b.after;
        })
        .sort((x, y) => new Date(x.start) - new Date(y.start))
        .map((e) => ({ title: clip(e.title, 70), time: e.allDay ? "all day" : fmtTime(e.start, tz), allDay: !!e.allDay }))
    : null;
  const firstBlock = tomorrow?.find((e) => !e.allDay) || null;

  return {
    date: new Date(now).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: tz }),
    doneToday,
    slipped,
    addedToday,
    tasksDone,
    tasksStuck,
    talked,
    alerts,
    tomorrow,
    firstBlock,
    grind: String(grind || "").trim(),
  };
}

function fmtTime(s, tz) {
  return new Date(s).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz });
}

/**
 * When the briefings chat last got a message of `channel` ("briefing" or
 * "debrief"), 0 if never. The two share a chat, so each server's stand-down
 * must look at its own kind only; debriefs count only when scheduled, so
 * "Write one now" doesn't cancel tonight's.
 */
export function lastFiled(chat, channel) {
  const msgs = (chat?.messages || []).filter((m) => m.channel === channel && (channel !== "debrief" || m.scheduled));
  return msgs.at(-1)?.timestamp || 0;
}

/** True when there is nothing at all to say. */
export function emptyDay(f) {
  return (
    !f.doneToday.length && !f.slipped.length && !f.addedToday.length && !f.tasksDone.length &&
    !f.tasksStuck.length && !f.talked.length && !f.alerts.length && !f.tomorrow?.length
  );
}

/** The facts as a compact block for the model (and the fallback's source). */
export function factsBlock(f) {
  const list = (xs) => (xs.length ? xs.map((x) => `- ${x}`).join("\n") : "- (none)");
  const parts = [
    `TODAY: ${f.date}`,
    `TODOS CHECKED OFF TODAY:\n${list(f.doneToday)}`,
    `TODOS STILL OPEN FROM BEFORE TODAY (slipped):\n${list(f.slipped)}`,
    `TODOS ADDED TODAY, STILL OPEN:\n${list(f.addedToday)}`,
    `BACKGROUND TASKS ARIA FINISHED TODAY:\n${list(f.tasksDone)}`,
    `BACKGROUND TASKS STUCK:\n${list(f.tasksStuck)}`,
    `CONVERSATIONS WITH ARIA TODAY (title — messages):\n${list(f.talked.map((c) => `${c.title} — ${c.n}`))}`,
    `ALERTS TODAY:\n${list(f.alerts)}`,
    f.tomorrow == null
      ? "TOMORROW'S CALENDAR: (calendar not connected)"
      : `TOMORROW'S CALENDAR:\n${list(f.tomorrow.map((e) => `${e.time} ${e.title}`))}`,
  ];
  if (f.grind) parts.push(`GRIND (habits):\n${f.grind}`);
  return parts.join("\n\n");
}

export function debriefPrompt(f, { sms = false } = {}) {
  return `Write Sarvin's evening debrief from the facts below. Use ONLY these facts; never invent tasks, events or progress.

${factsBlock(f)}

Format:
- One opening line on how the day went, honest, not cheesy.
- "Done:" what got finished (todos, ARIA tasks). Skip if nothing.
- "Slipped:" what's still open from before today, at most 3, most important first. Skip if nothing.
- "Tomorrow:" the first fixed block (time + what), then anything else notable. If the calendar isn't connected or is empty, say what to start with from the open todos instead.
- One concrete suggestion for tonight or first thing tomorrow (e.g. which slipped item to do first).
${sms ? "This goes out as a text message: plain text, no markdown, under 600 characters." : "Markdown is fine. Max 170 words."}`;
}

/** No model: the same sections, written plainly. */
export function fallbackDebrief(f) {
  const out = [];
  if (emptyDay(f))
    return "Quiet day on record: no todos checked off or added, no ARIA tasks, no chats." +
      (f.tomorrow == null ? " (Connect Google Calendar and I'll include tomorrow's schedule.)" : " Nothing on the calendar tomorrow either.");
  const done = [...f.doneToday, ...f.tasksDone.map((t) => `${t} (ARIA task)`)];
  out.push(done.length ? `You finished ${done.length} thing${done.length === 1 ? "" : "s"} today.` : "Nothing checked off today.");
  if (done.length) out.push(`Done: ${done.slice(0, 5).join("; ")}`);
  if (f.slipped.length) out.push(`Slipped: ${f.slipped.slice(0, 3).join("; ")}${f.slipped.length > 3 ? ` (+${f.slipped.length - 3} more)` : ""}`);
  if (f.tasksStuck.length) out.push(`Stuck: ${f.tasksStuck.slice(0, 3).join("; ")}`);
  if (f.tomorrow?.length) {
    out.push(`Tomorrow: ${f.firstBlock ? `${f.firstBlock.time} ${f.firstBlock.title} first` : f.tomorrow[0].title}` +
      (f.tomorrow.length > 1 ? `, then ${f.tomorrow.length - 1} more on the calendar.` : "."));
  }
  const next = f.slipped[0] || f.addedToday[0];
  if (next) out.push(`Start with: ${next}`);
  return out.join("\n");
}

