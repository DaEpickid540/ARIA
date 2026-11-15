// lib/search.js — one search over everything ARIA holds
// ═══════════════════════════════════════════════════════════════════
//
// "What did we decide about the kiosk?" used to mean scrolling chats. This
// searches chats (every message), memory facts, notes, todos, flashcards,
// routines and reminders in one pass, and returns the best matches with a
// snippet around the words. The command palette (Ctrl+K) shows them as you
// type; ARIA uses it herself through ACTION: find.
//
// No index: a personal store is a few MB of text, and a linear scan of that
// is a few milliseconds. Every word of the query has to appear (in any
// order); the exact phrase, a title match and recency rank a hit higher.
// ═══════════════════════════════════════════════════════════════════

const norm = (s) => String(s ?? "").toLowerCase();

/** Query → the words that all have to appear. Quotes keep a phrase together. */
export function terms(q) {
  const out = [];
  const s = norm(q).trim();
  const re = /"([^"]+)"|(\S+)/g;
  let m;
  while ((m = re.exec(s))) {
    const t = (m[1] ?? m[2]).trim();
    if (t) out.push(t);
  }
  return [...new Set(out)].slice(0, 8);
}

/** ~width characters around the first matching word, on one line. */
export function snippet(text, words, width = 140) {
  const flat = String(text ?? "").replace(/\s+/g, " ").trim();
  if (flat.length <= width) return flat;
  const low = flat.toLowerCase();
  let at = -1;
  for (const w of words) {
    const i = low.indexOf(w);
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  if (at < 0) return flat.slice(0, width).trimEnd() + "…";
  let start = Math.max(0, at - Math.floor(width / 3));
  // Start on a word, not mid-way through one.
  if (start > 0) {
    const sp = flat.indexOf(" ", start);
    if (sp >= 0 && sp < at) start = sp + 1;
  }
  const end = Math.min(flat.length, start + width);
  return (start > 0 ? "…" : "") + flat.slice(start, end).trim() + (end < flat.length ? "…" : "");
}

/** 0 = no match. Higher = better. */
function score(title, body, words, phrase, at, now) {
  const t = norm(title);
  const b = norm(body);
  const all = t + "\n" + b;
  for (const w of words) if (!all.includes(w)) return 0;
  let s = 10;
  if (words.length > 1 && all.includes(phrase)) s += 8;
  for (const w of words) {
    if (t.includes(w)) s += 4;
    // A whole word beats a fragment of a longer one.
    if (new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`).test(all)) s += 2;
  }
  if (at) {
    const days = Math.max(0, (now - at) / 86400_000);
    s += Math.max(0, 5 - Math.log2(1 + days)); // today +5, a month ago ~0
  }
  return s;
}

/**
 * @param {string} q
 * @param {object} src  { chats, memories, notes, todos, cards, routines, reminders }
 *   Every source is optional; shapes are the ones the server already holds.
 * @returns {{ kind, id, title, snippet, at, chatId?, msgIndex?, score }[]}
 */
export function searchAll(q, src = {}, { limit = 30, kinds = null, now = Date.now() } = {}) {
  const words = terms(q);
  if (!words.length) return [];
  const phrase = norm(q).replace(/"/g, "").trim();
  const want = (k) => !kinds || kinds.includes(k);
  const hits = [];
  const push = (kind, id, title, body, when, extra = {}) => {
    // Some stores keep a display string ("3:45 PM") where a time would be.
    const at = typeof when === "number" && Number.isFinite(when) ? when : 0;
    const sc = score(title, body, words, phrase, at, now);
    if (sc) hits.push({ kind, id: String(id), title: String(title || "").slice(0, 120), snippet: snippet(body || title, words), at: at || null, ...extra, score: Math.round(sc * 10) / 10 });
  };

  if (want("chat"))
    for (const c of src.chats || []) {
      const title = c.title || "Untitled";
      let best = null;
      (c.messages || []).forEach((m, i) => {
        const text = typeof m.content === "string" ? m.content : "";
        if (!text) return;
        const when = Number(m.timestamp || c.updatedAt) || 0;
        const sc = score("", text, words, phrase, when, now);
        if (sc && (!best || sc > best.sc)) best = { sc, i, text, at: when, role: m.role };
      });
      if (best) {
        const titleBonus = words.some((w) => norm(title).includes(w)) ? 3 : 0;
        hits.push({
          kind: "chat", id: c.id, chatId: c.id, msgIndex: best.i, title,
          snippet: `${best.role === "user" ? "You" : "ARIA"}: ${snippet(best.text, words)}`,
          at: best.at || null, score: Math.round((best.sc + titleBonus) * 10) / 10,
        });
      } else push("chat", c.id, title, "", c.updatedAt, { chatId: c.id });
    }

  if (want("memory"))
    (src.memories || []).forEach((f, i) => {
      const text = typeof f === "string" ? f : f?.text || f?.fact || "";
      push("memory", f?.id ?? i, "Memory", text, f?.timestamp || f?.at || f?.createdAt || 0);
    });
  if (want("note"))
    (src.notes || []).forEach((n, i) => push("note", n?.id ?? i, "Note", typeof n === "string" ? n : n?.text || "", n?.created || n?.at || 0));
  if (want("todo"))
    (src.todos || []).forEach((t, i) => push("todo", t?.id ?? i, t?.done ? "Todo (done)" : "Todo", typeof t === "string" ? t : t?.text || "", t?.created || 0));
  if (want("card")) for (const c of src.cards || []) push("card", c.id, `Flashcard · ${c.deck || "deck"}`, `${c.front || ""} — ${c.back || ""}`, c.created || 0, { deck: c.deck });
  if (want("routine"))
    for (const r of src.routines || []) push("routine", r.name, `Routine · ${r.name}`, [r.description, ...(r.steps || [])].filter(Boolean).join(" · "), r.updatedAt || 0);
  if (want("reminder")) for (const r of src.reminders || []) push("reminder", r.id, "Reminder", r.text, r.created || 0, { due: r.at });

  return hits.sort((a, b) => b.score - a.score || (b.at || 0) - (a.at || 0)).slice(0, Math.max(1, Math.min(100, limit)));
}

const KIND_LABEL = { chat: "Chat", memory: "Memory", note: "Note", todo: "Todo", card: "Flashcard", routine: "Routine", reminder: "Reminder" };

/** The results as the model reads them (ACTION: find). */
export function formatHits(q, hits, { now = Date.now() } = {}) {
  if (!hits.length) return `Nothing in ARIA's chats, memory, notes, todos, flashcards, routines or reminders matches "${q}".`;
  const ago = (at) => {
    if (!at) return "";
    const d = Math.floor((now - at) / 86400_000);
    return d <= 0 ? " (today)" : d === 1 ? " (yesterday)" : d < 60 ? ` (${d} days ago)` : ` (${new Date(at).toISOString().slice(0, 10)})`;
  };
  return (
    `${hits.length} match${hits.length === 1 ? "" : "es"} for "${q}":\n` +
    hits.map((h, i) => `${i + 1}. [${KIND_LABEL[h.kind] || h.kind}${h.kind === "chat" ? `: ${h.title}` : ""}]${ago(h.at)} ${h.snippet}`).join("\n")
  );
}
