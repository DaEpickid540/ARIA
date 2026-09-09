// think.js — separate a model's reasoning from its answer.
//
// Reasoning models emit their scratchpad inline, wrapped in <think> tags. The
// chat renderer has always understood that; nothing else did. Background tasks
// stored whatever came back verbatim, so every step's output opened with a few
// hundred words of "Okay, so the user wants…" and the actual result was
// somewhere below it — and the planner's JSON was regularly found inside the
// reasoning rather than after it.
//
// Kept deliberately small and dependency-free: one function, used by the task
// engine, the planner and anything else that has to store model output rather
// than render it.

// <think>, and the variants that turn up when a model is imitating the format
// rather than trained on it.
const TAGS = ["think", "thinking", "reasoning", "thought"];
const OPEN = new RegExp(`<(${TAGS.join("|")})\\s*>`, "i");
const CLOSE = new RegExp(`<\\/(${TAGS.join("|")})\\s*>`, "i");
const PAIR = new RegExp(`<(${TAGS.join("|")})\\s*>([\\s\\S]*?)<\\/\\1\\s*>`, "gi");

/**
 * @param {string} raw model output
 * @returns {{ text: string, thinking: string }}
 *   `text` is what the user asked for, `thinking` is the scratchpad (empty
 *   string when there wasn't one) — kept rather than dropped so the task panel
 *   can still show its work behind a disclosure.
 */
export function splitThinking(raw) {
  let text = String(raw ?? "");
  const parts = [];

  text = text.replace(PAIR, (_, _tag, inner) => {
    parts.push(inner.trim());
    return "";
  });

  // An opener the pair pass did not consume: either the model never closed the
  // block (ran out of tokens mid-thought) or it closed with a different tag
  // than it opened with, which small models do often enough to matter. Close it
  // at the next closing tag of the family if there is one, at the end if not.
  const open = text.match(OPEN);
  if (open) {
    const after = text.slice(open.index + open[0].length);
    const close = after.match(CLOSE);
    if (close) {
      parts.push(after.slice(0, close.index).trim());
      text = text.slice(0, open.index) + after.slice(close.index + close[0].length);
    } else {
      parts.push(after.trim());
      text = text.slice(0, open.index);
    }
  }

  // A stray closing tag with no opener — the model started thinking before its
  // first token was captured. Everything before it was the thought.
  const strayClose = text.match(CLOSE);
  if (strayClose) {
    parts.push(text.slice(0, strayClose.index).trim());
    text = text.slice(strayClose.index + strayClose[0].length);
  }

  return {
    text: text.trim(),
    thinking: parts.filter(Boolean).join("\n\n").trim(),
  };
}

/** Just the answer. For callers that have nowhere to put the reasoning. */
export function stripThinking(raw) {
  return splitThinking(raw).text;
}
