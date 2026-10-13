// lib/sms-commands.js — quick commands you can text ARIA's number
// ═══════════════════════════════════════════════════════════════════
//
// Texts already reach ARIA (aria-voice-hook.js → /api/chat), and she can use
// Claw from there. These are the things worth not waiting on a model for:
// one word (or two), answered straight away by the server, the same every
// time. Anything that isn't exactly one of them goes to ARIA as usual, so
// "what's on my screen right now?" is still a question for her.
//
//   screen | screenshot            your PC's screen, as a picture
//   status                         is the PC on, what's in front, what's running
//   fix [what's wrong]             look at the screen and propose a fix (YES/NO)
//   run <routine> [args]           a taught routine (asks YES/NO when it should)
//   lock                           lock the PC (Win+L)
//   help | commands                this list
//
// The password gate (lib/sms-gate.js) sits in front of all of it.
// ═══════════════════════════════════════════════════════════════════

export const HELP =
  "Text commands: screen (see your PC), status, fix [what's wrong], run <routine> [args], lock, help. Anything else goes to ARIA.";

/**
 * The command in a text, or null when it's a message for ARIA.
 * @returns {{ cmd: "screen"|"status"|"fix"|"run"|"lock"|"help", arg: string } | null}
 */
export function parseSmsCommand(text) {
  const t = String(text || "").trim().replace(/[.!]+$/, "");
  if (!t || t.length > 300) return null;
  const low = t.toLowerCase();
  if (/^(screen|screenshot|ss|show (me )?(my )?screen)$/.test(low)) return { cmd: "screen", arg: "" };
  if (/^(status|pc status|pc)$/.test(low)) return { cmd: "status", arg: "" };
  if (/^(help|commands|\?)$/.test(low)) return { cmd: "help", arg: "" };
  if (/^(lock|lock (my )?(pc|computer|screen))$/.test(low)) return { cmd: "lock", arg: "" };
  // "fix", "fix my screen", "fix: VS Code won't build" — not "fixed it, thanks".
  let m = t.match(/^fix(?:\s+(?:my\s+)?screen)?\b\s*[:\-–]?\s*([\s\S]*)$/i);
  if (m) return { cmd: "fix", arg: m[1].trim() };
  m = t.match(/^run\s+([a-z0-9][a-z0-9-]*)(?:\s+([\s\S]+))?$/i);
  if (m) return { cmd: "run", arg: `${m[1]}${m[2] ? ` | ${m[2].trim()}` : ""}` };
  return null;
}

/** "3h 12m" from seconds. */
export function fmtUptime(sec) {
  const s = Math.max(0, Math.floor(sec));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}

/**
 * The status text, from what the server knows. Plain, short, SMS-sized.
 * @param {object} s { relay: bool, killed: bool, app?: string, cpu?: number, memUsedPct?: number,
 *   uptimeSec?: number, watchers?: number, triggers?: number, pending?: number, tasks?: number }
 */
export function statusText(s) {
  const lines = [];
  lines.push(s.relay ? (s.killed ? "PC: connected, but Claw is killed." : "PC: connected ✓") : "PC: not connected (Claw relay off, or the PC is asleep).");
  if (s.app) lines.push(`In front: ${s.app}`);
  const sys = [];
  if (Number.isFinite(s.cpu)) sys.push(`CPU ${Math.round(s.cpu)}%`);
  if (Number.isFinite(s.memUsedPct)) sys.push(`RAM ${Math.round(s.memUsedPct)}%`);
  if (Number.isFinite(s.uptimeSec)) sys.push(`up ${fmtUptime(s.uptimeSec)}`);
  if (sys.length) lines.push(sys.join(" · "));
  const busy = [];
  if (s.tasks) busy.push(`${s.tasks} task${s.tasks === 1 ? "" : "s"} running`);
  if (s.watchers) busy.push(`${s.watchers} watcher${s.watchers === 1 ? "" : "s"}`);
  if (s.triggers) busy.push(`${s.triggers} trigger${s.triggers === 1 ? "" : "s"}`);
  if (busy.length) lines.push(busy.join(" · "));
  if (s.pending) lines.push(`${s.pending} action${s.pending === 1 ? "" : "s"} waiting for your OK.`);
  return lines.join("\n");
}
