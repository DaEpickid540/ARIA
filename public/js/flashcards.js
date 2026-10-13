// flashcards.js — the Flashcards panel: decks, today's reviews (Again /
// Hard / Good / Easy, keys 1–4, space to flip), adding cards by pasting
// "front => back" lines, and browsing a deck. Scheduling is server-side
// (lib/flashcards.js, SM-2), so a review on the phone counts on the PC.

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
const toast = (msg, icon) => window.ARIA_showNotification?.(`${icon ? icon + " " : ""}${msg}`);
const $ = (id) => document.getElementById(id);

async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: { "Content-Type": "application/json", ...(opts.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

const GRADES = [
  ["again", "Again"],
  ["hard", "Hard"],
  ["good", "Good"],
  ["easy", "Easy"],
];

/* ── decks ───────────────────────────────────────────────────── */
let _decks = [];
async function showDecks() {
  const body = $("cardsBody");
  if (!body) return;
  try {
    const d = await api("/api/flashcards");
    _decks = d.decks;
  } catch (e) {
    body.innerHTML = `<p class="watchErr">Couldn't load decks: ${esc(e.message)}</p>`;
    return;
  }
  const due = _decks.reduce((a, d) => a + d.due, 0);
  body.innerHTML = `
    ${due ? `<div class="watchFormRow"><button class="memBtn" data-review="">Review all (${due} due)</button></div>` : ""}
    ${
      _decks.length
        ? _decks
            .map(
              (d) => `<div class="cardDeckRow">
                <div class="watchMain"><b>${esc(d.deck)}</b> <span class="watchHint">${d.total} cards · ${d.fresh} new · ${d.mature} learned well</span></div>
                ${d.due ? `<button class="memBtn" data-review="${esc(d.deck)}">Review ${d.due}</button>` : `<span class="watchHint">done for today</span>`}
                <button class="memBtn" data-browse="${esc(d.deck)}" title="See the cards">☰</button>
                <button class="memBtn" data-deldeck="${esc(d.deck)}" title="Delete deck">✕</button>
              </div>`,
            )
            .join("")
        : `<p class="watchEmpty">No cards yet. Paste some below, or in chat: <i>"quiz me on chapter 4"</i>, then <i>"save the ones I missed as flashcards"</i>.</p>`
    }
    <form id="cardForm" class="watchForm cardForm" autocomplete="off">
      <input name="deck" list="cardDecks" placeholder="Deck (e.g. AP Bio)" required maxlength="60" />
      <datalist id="cardDecks">${_decks.map((d) => `<option value="${esc(d.deck)}">`).join("")}</datalist>
      <textarea name="text" placeholder="One card per line:&#10;What is ATP? => The cell's energy currency&#10;mitosis :: division into two identical cells&#10;(Q: / A: lines work too)" required></textarea>
      <div class="watchFormRow"><button type="submit" class="memBtn">Add cards</button></div>
    </form>`;
}

async function onAdd(e) {
  const form = e.target.closest("#cardForm");
  if (!form) return;
  e.preventDefault();
  try {
    const r = await api("/api/flashcards", { method: "POST", body: JSON.stringify({ deck: form.deck.value.trim(), text: form.text.value }) });
    toast(`Added ${r.added} to ${r.deck}${r.skipped ? ` (${r.skipped} already there)` : ""}.`, "🃏");
  } catch (err) {
    return toast(err.message, "✗");
  }
  showDecks();
}

/* ── review ──────────────────────────────────────────────────── */
let queue = [];
let current = null;
let flipped = false;
let done = 0;

async function startReview(deck) {
  try {
    const { cards } = await api(`/api/flashcards/due?deck=${encodeURIComponent(deck)}`);
    queue = cards;
  } catch (e) {
    return toast(e.message, "✗");
  }
  done = 0;
  next();
}

function next() {
  current = queue.shift() || null;
  flipped = false;
  drawCard();
}

function drawCard() {
  const body = $("cardsBody");
  if (!body) return;
  if (!current) {
    body.innerHTML = `<p class="watchEmpty">${done ? `Done: ${done} review${done === 1 ? "" : "s"}. ` : ""}Nothing else due right now.</p>
      <div class="watchFormRow"><button class="memBtn" data-back="1">Back to decks</button></div>`;
    return;
  }
  body.innerHTML = `
    <div class="watchFormRow"><span class="watchHint">${esc(current.deck)} · ${queue.length + 1} left</span><button class="memBtn" data-back="1" style="margin-left:auto">Stop</button></div>
    <div class="cardFace">${esc(current.front)}${flipped ? `<div class="cardBack">${esc(current.back)}</div>` : ""}</div>
    ${
      flipped
        ? `<div class="cardGrades">${GRADES.map(([g, label], i) => `<button class="memBtn" data-grade="${g}" title="Key ${i + 1}">${label}<small>${esc(current.preview?.[g] || "")}</small></button>`).join("")}</div>`
        : `<div class="watchFormRow"><button class="memBtn" data-flip="1" style="flex:1">Show answer (space)</button></div>`
    }`;
}

async function grade(g) {
  if (!current || !flipped) return;
  const card = current;
  try {
    await api(`/api/flashcards/${encodeURIComponent(card.id)}/review`, { method: "POST", body: JSON.stringify({ grade: g }) });
  } catch (e) {
    return toast(e.message, "✗");
  }
  done++;
  // Missed: it's due again in 10 minutes, so it comes back at the end of this session.
  if (g === "again") queue.push({ ...card, reps: 0, interval: 0, preview: { ...card.preview, hard: "1d", good: "1d", easy: "3d" } });
  next();
}

/* ── browse ──────────────────────────────────────────────────── */
async function browse(deck) {
  const body = $("cardsBody");
  let cards = [];
  try {
    ({ cards } = await api(`/api/flashcards/cards?deck=${encodeURIComponent(deck)}`));
  } catch (e) {
    return toast(e.message, "✗");
  }
  const when = (c) => {
    const d = Math.round((c.due - Date.now()) / 86400000);
    return d <= 0 ? "due" : `in ${d}d`;
  };
  body.innerHTML = `<div class="watchFormRow"><b>${esc(deck)}</b><button class="memBtn" data-back="1" style="margin-left:auto">Back</button></div>` +
    cards
      .map(
        (c) => `<div class="watchRow"><div class="watchMain"><div class="watchTitle">${esc(c.front)}</div><div class="watchMeta">${esc(c.back)}</div>
          <div class="watchHint">${when(c)}${c.lapses ? ` · missed ${c.lapses}×` : ""}</div></div>
          <div class="watchBtns"><button class="memBtn" data-delcard="${esc(c.id)}" data-deck="${esc(deck)}" title="Delete card">✕</button></div></div>`,
      )
      .join("");
}

async function onClick(e) {
  const b = e.target.closest("button");
  if (!b) return;
  const d = b.dataset;
  if (d.review != null) return startReview(d.review);
  if (d.flip) {
    flipped = true;
    return drawCard();
  }
  if (d.grade) return grade(d.grade);
  if (d.back) {
    current = null;
    return showDecks();
  }
  if (d.browse) return browse(d.browse);
  try {
    if (d.deldeck) {
      if (!confirm(`Delete the whole "${d.deldeck}" deck?`)) return;
      await api(`/api/flashcards/deck/${encodeURIComponent(d.deldeck)}`, { method: "DELETE" });
      return showDecks();
    }
    if (d.delcard) {
      await api(`/api/flashcards/${encodeURIComponent(d.delcard)}`, { method: "DELETE" });
      return browse(d.deck);
    }
  } catch (err) {
    toast(err.message, "✗");
  }
}

function onKey(e) {
  // Only while the panel is showing (a closed quick modal is hidden, not removed).
  if (!$("cardsBody") || !current || $("ariaQuickModal")?.style.display === "none") return;
  if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || "")) return;
  if (e.key === " " && !flipped) {
    e.preventDefault();
    flipped = true;
    drawCard();
  } else if (flipped && /^[1-4]$/.test(e.key)) {
    e.preventDefault();
    grade(GRADES[+e.key - 1][0]);
  }
}

export function showFlashcards() {
  const show = window.ARIA_showQuickModal;
  if (!show) return;
  show("Flashcards", `<div id="cardsBody"><p class="watchEmpty">Loading…</p></div>`);
  const body = $("cardsBody");
  body.addEventListener("click", onClick);
  body.addEventListener("submit", onAdd);
  current = null;
  showDecks();
}

export function initFlashcards() {
  window.ARIA_showFlashcards = showFlashcards;
  document.addEventListener("keydown", onKey);
  document.getElementById("tool_flashcards")?.addEventListener("click", () => {
    document.getElementById("toolsDropdown")?.style.setProperty("display", "none");
    showFlashcards();
  });
}
