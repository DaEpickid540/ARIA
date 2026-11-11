// paletteCore.js — the matching behind the command palette (palette.js).
// No DOM in here, so it runs under node --test (tests/palette.test.mjs).

/**
 * Does `query` appear in `text` as a subsequence? Returns { score, idx }
 * (idx = the matched character positions, for highlighting) or null.
 *
 * Higher is better. What earns points:
 *   - letters in a row            "flash" in "Flashcards" beats f-l-a-s-h spread out
 *   - starting a word             "dr" finds "Daily Rings"
 *   - starting the text itself
 * and long gaps and long texts lose a little, so the tighter match wins.
 */
export function fuzzy(query, text) {
  const q = String(query || "").toLowerCase().replace(/\s+/g, "");
  const t = String(text || "");
  const tl = t.toLowerCase();
  if (!q) return { score: 0, idx: [] };
  if (q.length > tl.length) return null;

  // A plain substring is the best kind of match; take it when there is one.
  const sub = tl.indexOf(q);
  // Prefer a substring that starts a word over one in the middle of a word.
  let at = sub;
  if (sub > 0) {
    let from = sub;
    while (from !== -1) {
      if (isWordStart(tl, from)) {
        at = from;
        break;
      }
      from = tl.indexOf(q, from + 1);
    }
  }
  if (at !== -1) {
    const idx = Array.from({ length: q.length }, (_, i) => at + i);
    let score = 100 + q.length * 10;
    if (at === 0) score += 40;
    else if (isWordStart(tl, at)) score += 25;
    return { score: score - tl.length * 0.2, idx };
  }

  // Otherwise walk the text, taking each query letter at the first place it
  // fits, but jumping ahead to a word start when the same letter begins one.
  const idx = [];
  let score = 0;
  let pos = 0;
  let prev = -2;
  for (const ch of q) {
    let found = tl.indexOf(ch, pos);
    if (found === -1) return null;
    if (!isWordStart(tl, found) && found !== prev + 1) {
      let next = found;
      while (next !== -1 && !isWordStart(tl, next)) next = tl.indexOf(ch, next + 1);
      if (next !== -1) found = next;
    }
    if (found === prev + 1) score += 8;
    else if (isWordStart(tl, found)) score += 12;
    else score += 1;
    if (prev >= 0) score -= Math.min(6, (found - prev - 1) * 0.5);
    idx.push(found);
    prev = found;
    pos = found + 1;
  }
  return { score: score - tl.length * 0.2, idx };
}

function isWordStart(s, i) {
  return i === 0 || /[\s\-_/:(.]/.test(s[i - 1]);
}

/**
 * The items that match `query`, best first. Each item is { label, keywords? };
 * a match on the label outranks the same match on a keyword. With no query
 * the items come back in their own order.
 * @returns {{ item: object, score: number, idx: number[] }[]}
 */
export function rank(items, query, limit = 40) {
  const q = String(query || "").trim();
  if (!q) return items.slice(0, limit).map((item) => ({ item, score: 0, idx: [] }));
  const out = [];
  for (const item of items) {
    const onLabel = fuzzy(q, item.label);
    let best = onLabel ? { score: onLabel.score + 15, idx: onLabel.idx } : null;
    for (const k of item.keywords || []) {
      const m = fuzzy(q, k);
      if (m && (!best || m.score > best.score)) best = { score: m.score, idx: onLabel ? onLabel.idx : [] };
    }
    if (best) out.push({ item, score: best.score + (item.boost || 0), idx: best.idx });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}

/** A leading ">" sends the rest to Claw, "?" asks ARIA; otherwise it's a search. */
export function parseQuery(raw) {
  const s = String(raw || "");
  const m = s.match(/^\s*([>?])\s*(.*)$/s);
  if (!m) return { mode: "search", text: s.trim() };
  return { mode: m[1] === ">" ? "claw" : "ask", text: m[2].trim() };
}

/** `label` as HTML with the matched letters wrapped in <mark>. */
export function highlight(label, idx) {
  const esc = (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : c);
  const hit = new Set(idx);
  let out = "";
  let open = false;
  [...String(label)].forEach((c, i) => {
    const on = hit.has(i);
    if (on && !open) out += "<mark>";
    if (!on && open) out += "</mark>";
    open = on;
    out += esc(c);
  });
  return out + (open ? "</mark>" : "");
}
