// visualize.js — render a model-authored SVG or HTML widget inline in chat.
//
// The equivalent of the visualize tool in Claude's own chat: the model writes
// a self-contained diagram, chart, or small interactive widget, and it appears
// in the conversation instead of being described in prose.
//
// This module only validates and packages. The markup is never executed here —
// it is handed to the client, which renders it inside a sandboxed iframe with
// no same-origin access. That boundary is the whole security story: the code
// is written by a language model, quite possibly steered by whatever the model
// just read off a web page, so it is treated as untrusted throughout.

// Generous enough for a detailed inline SVG, small enough that a runaway
// generation cannot wedge a chat log in localStorage.
const MAX_BYTES = 256 * 1024;

/** SVG or full HTML? Decides which wrapper the client uses. */
function detectKind(code) {
  return /^\s*<svg[\s>]/i.test(code) ? "svg" : "html";
}

/**
 * @param {object} payload
 * @param {string} payload.title  short label shown above the widget
 * @param {string} payload.code   the SVG or HTML source
 */
export async function runVisualize({ title = "", code = "" } = {}) {
  const source = String(code || "").trim();

  if (!source) {
    return "Visualize needs markup. Put the SVG or HTML in a fenced code block directly after the ACTION line.";
  }

  const bytes = Buffer.byteLength(source, "utf8");
  if (bytes > MAX_BYTES) {
    return `Visualization is too large (${Math.round(bytes / 1024)}KB, limit ${MAX_BYTES / 1024}KB). Simplify it or drop embedded data.`;
  }

  // A bare fragment with no element at all is almost always the model having
  // narrated instead of drawn — say so rather than rendering an empty box.
  if (!/<[a-z][\s\S]*>/i.test(source)) {
    return "Visualize expects markup, but the input had no HTML or SVG elements in it.";
  }

  return (
    "__VISUAL__" +
    JSON.stringify({
      title: String(title || "").trim().slice(0, 120),
      kind: detectKind(source),
      code: source,
    })
  );
}
