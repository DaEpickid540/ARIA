// lib/arena.js — the agent arena: two or three contenders answer the same
// question, read each other's answers and push back once, and a judge
// scores them and picks a winner
// ═══════════════════════════════════════════════════════════════════
//
// Good for hard homework ("which of these is right?") and checking code:
// a wrong step one contender makes is often exactly what another one
// catches in the rebuttal round, and the judge sees all of it.
//
// Contenders are different models when the server has keys for several
// (Groq, OpenRouter, DeepSeek…), and always different approaches, so they
// don't just agree with each other. The judge is a model that didn't
// compete when there is one. Everything here is pure; server.js runs it.
//
// arena.json keeps the last 30 bouts and a win tally per model, so over
// time you can see which model is actually best at your homework.
// ═══════════════════════════════════════════════════════════════════

import fs from "fs";
import path from "path";
import { DATA_DIR } from "./paths.js";

const FILE = path.join(DATA_DIR, "arena.json");
const KEEP = 30;

/** How each contender attacks the problem, so three of the same model still differ. */
export const APPROACHES = [
  { name: "Solver", brief: "Work it out step by step from first principles. Show the working that matters, then give a clear final answer." },
  { name: "Checker", brief: "Solve it a DIFFERENT way from the obvious one (another method, a worked example, a sanity check with numbers), then give a clear final answer." },
  { name: "Skeptic", brief: "Look first for the trap: the misread condition, the edge case, the common mistake. Then solve it carefully and give a clear final answer." },
];

/**
 * Who competes and who judges, from the providers that have keys.
 * @param {{ provider: string, model?: string|null, label: string }[]} available  best first
 * @param {{ count?: number, contenders?: object[] }} [o]  contenders: an explicit lineup
 */
export function pickLineup(available, { count = 2, contenders = null } = {}) {
  if (!available.length) throw new Error("No AI provider is set up, so there's nobody to compete.");
  const n = Math.max(2, Math.min(3, Number(count) || 2));
  const models = contenders?.length ? contenders.slice(0, 3) : Array.from({ length: n }, (_, i) => available[i % available.length]);
  const lineup = models.map((m, i) => ({
    name: `${APPROACHES[i].name} (${m.label})`,
    approach: APPROACHES[i],
    provider: m.provider,
    model: m.model || null,
    label: m.label,
  }));
  // A judge that didn't compete, if there is one.
  const used = new Set(lineup.map((c) => `${c.provider}|${c.model || ""}`));
  const judge = available.find((m) => !used.has(`${m.provider}|${m.model || ""}`)) || available[0];
  return { contenders: lineup, judge, sameModel: new Set(lineup.map((c) => c.label)).size === 1 };
}

export const contenderSystem = (c) =>
  `You are ${c.name}, one of several agents answering the same question independently; a judge will compare your answers. ${c.approach.brief} Use tools if they help (calc for arithmetic, research for facts). Be concise: no preamble, no restating the question. End with a line starting "FINAL ANSWER:".`;

/** The rebuttal round: read the others, say what's wrong, then stand by or revise. */
export function rebuttalMessages(question, me, others) {
  return [
    {
      role: "system",
      content: `You are ${me.name} in an answer arena. Read the other agents' answers. Point out any concrete mistakes in them (quote the step), and say plainly if one of them caught a mistake of yours. Then give your final answer: keep yours or change it, whichever is right. Under 200 words. End with a line starting "FINAL ANSWER:".`,
    },
    {
      role: "user",
      content: `QUESTION:\n${question}\n\nYOUR ANSWER:\n${me.answer}\n\n${others.map((o) => `${o.name.toUpperCase()}'S ANSWER:\n${o.answer}`).join("\n\n")}`,
    },
  ];
}

/** The judge's brief: a rubric and a JSON verdict. */
export function judgeMessages(question, finals) {
  const names = finals.map((f) => f.name);
  return [
    {
      role: "system",
      content:
        "You are the judge of an answer arena. Score each contender 0-10 on correctness (most important: check the actual working and the final answer yourself), completeness and clarity. A confident wrong answer scores low on correctness however well written. " +
        `Reply with ONLY JSON: {"scores":[{"name":"<exact name>","correctness":0-10,"completeness":0-10,"clarity":0-10,"notes":"<one sentence>"}],"winner":"<exact name, or tie>","why":"<two sentences>","answer":"<the correct final answer in one or two sentences>","mistakes":["<a specific error a contender made>"]}. Names: ${names.map((n) => JSON.stringify(n)).join(", ")}.`,
    },
    {
      role: "user",
      content: `QUESTION:\n${question}\n\n${finals
        .map((f) => `=== ${f.name} ===\nFIRST ANSWER:\n${f.answer}\n${f.rebuttal ? `\nAFTER READING THE OTHERS:\n${f.rebuttal}` : ""}`)
        .join("\n\n")}`,
    },
  ];
}

const clamp10 = (x) => Math.max(0, Math.min(10, Math.round(Number(x) || 0)));

/**
 * The judge's reply as a checked verdict, or null when it isn't one.
 * Scores get a total (correctness counts double); a winner the judge named
 * wrongly is matched by prefix, else the top total wins.
 */
export function parseVerdict(raw, names) {
  const text = String(raw || "").replace(/<think>[\s\S]*?<\/think>/gi, "");
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let v;
  try {
    v = JSON.parse(m[0]);
  } catch {
    return null;
  }
  if (!Array.isArray(v.scores)) return null;
  const find = (n) => {
    const s = String(n || "").toLowerCase().trim();
    return names.find((x) => x.toLowerCase() === s) || names.find((x) => s && (x.toLowerCase().startsWith(s) || s.startsWith(x.toLowerCase().split(" (")[0]))) || null;
  };
  const scores = [];
  for (const s of v.scores) {
    const name = find(s?.name);
    if (!name || scores.some((x) => x.name === name)) continue;
    const correctness = clamp10(s.correctness);
    const completeness = clamp10(s.completeness);
    const clarity = clamp10(s.clarity);
    scores.push({ name, correctness, completeness, clarity, total: correctness * 2 + completeness + clarity, notes: String(s.notes || "").slice(0, 300) });
  }
  if (!scores.length) return null;
  const best = [...scores].sort((a, b) => b.total - a.total);
  let winner = /^tie$/i.test(String(v.winner || "").trim()) ? "tie" : find(v.winner);
  if (!winner) winner = best.length > 1 && best[0].total === best[1].total ? "tie" : best[0].name;
  return {
    scores,
    winner,
    why: String(v.why || "").slice(0, 600),
    answer: String(v.answer || "").slice(0, 600),
    mistakes: (Array.isArray(v.mistakes) ? v.mistakes : []).map((x) => String(x).slice(0, 300)).slice(0, 6),
  };
}

/* ── history and the win tally ───────────────────────────────── */

let _data = { bouts: [], tally: {} };

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, "utf8"));
    _data = { bouts: Array.isArray(raw.bouts) ? raw.bouts : [], tally: raw.tally && typeof raw.tally === "object" ? raw.tally : {} };
  } catch {
    _data = { bouts: [], tally: {} };
  }
}
function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE + ".tmp", JSON.stringify(_data));
    fs.renameSync(FILE + ".tmp", FILE);
  } catch (e) {
    console.warn("[arena] save failed:", e.message);
  }
}

/** Files a finished bout; only bouts between different models count in the tally. */
export function record(bout) {
  _data.bouts = [..._data.bouts, bout].slice(-KEEP);
  const labels = new Set(bout.contenders.map((c) => c.label));
  if (bout.verdict && labels.size > 1) {
    for (const c of bout.contenders) {
      const t = (_data.tally[c.label] ||= { plays: 0, wins: 0 });
      t.plays++;
      if (bout.verdict.winner === c.name) t.wins++;
    }
  }
  save();
}

export const history = () => [..._data.bouts].reverse();
export const tally = () =>
  Object.entries(_data.tally)
    .map(([label, t]) => ({ label, ...t, rate: t.plays ? Math.round((t.wins / t.plays) * 100) : 0 }))
    .sort((a, b) => b.rate - a.rate || b.plays - a.plays);

export function init() {
  load();
}

/** Tests only. */
export function _reset() {
  _data = { bouts: [], tally: {} };
}
