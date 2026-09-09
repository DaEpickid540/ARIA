// visualize.js — render a model-authored widget inside a sandboxed frame.
//
// The markup comes from a language model, quite possibly steered by something
// it just read off a web page, so it is untrusted. It renders in an iframe with
// `sandbox="allow-scripts"` and deliberately WITHOUT `allow-same-origin`:
//
//   • those two together are equivalent to no sandbox at all — the frame can
//     reach into its own sandbox attribute and remove it, so they are never
//     combined here;
//   • without same-origin the frame gets an opaque origin, so it cannot touch
//     ARIA's DOM, cookies, localStorage or any of its API endpoints;
//   • a CSP inside the frame blocks network access outright, so a widget can
//     neither phone home nor exfiltrate anything it was handed.
//
// The frame talks to the page through exactly one channel: a postMessage
// carrying its height, validated by source below.

const THEME_TOKENS = [
  ["--v-bg", "--bg-card"],
  ["--v-text", "--text"],
  ["--v-muted", "--text-3"],
  ["--v-border", "--border"],
  ["--v-accent", "--accent"],
  ["--v-accent-text", "--accent-text"],
  ["--v-success", "--success"],
  ["--v-warning", "--warning"],
  ["--v-danger", "--danger"],
];

/** Snapshot the host theme so widgets can match the app instead of guessing. */
function themeCss() {
  const root = getComputedStyle(document.documentElement);
  return THEME_TOKENS.map(
    ([alias, token]) => `${alias}: ${root.getPropertyValue(token).trim()};`,
  ).join("\n      ");
}

/** The document that goes inside the frame.
 *  Exported because the code panel's preview needs the same boundary: it is
 *  rendering the same kind of thing — markup a model just wrote — and a plain
 *  `iframe.srcdoc` in the app's own origin would hand that markup the page. */
export function buildSrcdoc({ kind, code }) {
  // default-src 'none' with an explicit unsafe-inline for style/script: the
  // widget's own inline CSS and JS must run, but nothing may be fetched.
  // No connect-src, no img-src beyond data:, so there is no path off the page.
  const csp =
    "default-src 'none'; " +
    "style-src 'unsafe-inline'; " +
    "script-src 'unsafe-inline'; " +
    "img-src data:; " +
    "font-src data:;";

  const body =
    kind === "svg"
      ? `<div class="svgWrap">${code}</div>`
      : code;

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style>
  :root {
      ${themeCss()}
    color-scheme: dark;
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    background: transparent;
    color: var(--v-text);
    font-family: "DM Sans", system-ui, -apple-system, "Segoe UI", sans-serif;
    font-size: 14px;
    line-height: 1.5;
  }
  /* An SVG is sized by the parent from its viewBox, which knows nothing about
     padding — any here becomes overflow and a scrollbar. HTML widgets are
     measured from the inside, so padding is free there. */
  body { padding: ${kind === "svg" ? "0" : "4px"}; overflow-x: auto; }
  .svgWrap svg { display: block; width: 100%; height: auto; max-width: 100%; }
  a { color: var(--v-accent-text); }
</style>
</head>
<body>
${body}
<script>
  // The only channel out of the frame: tell the parent how tall to make it.
  // Nothing is read from the parent, and nothing else is ever posted.
  function report() {
    var d = document.documentElement, b = document.body;
    var h = Math.max(
      d ? d.scrollHeight : 0, d ? d.offsetHeight : 0,
      b ? b.scrollHeight : 0, b ? b.offsetHeight : 0
    );
    // A zero means the document has not laid out yet; sending it would only
    // be discarded by the parent, so wait for the next tick instead.
    if (h > 0) parent.postMessage({ type: "aria-visual-height", height: h }, "*");
  }
  window.addEventListener("load", report);
  // Widgets that lay out after load (fonts, scripts, interaction) need a nudge.
  if (window.ResizeObserver) new ResizeObserver(report).observe(document.documentElement);
  setTimeout(report, 60);
  setTimeout(report, 400);
<\/script>
</body>
</html>`;
}

/** Aspect ratio from an SVG's viewBox, if it has a usable one.
 *
 *  Worth computing in the parent: it sizes an SVG correctly without the frame
 *  having to measure and report itself, so the picture is right even when the
 *  frame's script is slow, throttled (a backgrounded tab suspends layout and
 *  timers) or blocked. The postMessage handshake then only refines it, and
 *  only HTML widgets genuinely depend on it. */
function svgAspect(code) {
  const vb = code.match(
    /viewBox\s*=\s*["']\s*[-\d.eE]+[,\s]+[-\d.eE]+[,\s]+([\d.eE]+)[,\s]+([\d.eE]+)/i,
  );
  if (!vb) return null;
  const w = parseFloat(vb[1]);
  const h = parseFloat(vb[2]);
  if (!(w > 0) || !(h > 0)) return null;
  return h / w;
}

/**
 * Build the visualization block for a chat message.
 * @returns {HTMLElement}
 */
export function createVisual(visual) {
  const wrap = document.createElement("div");
  wrap.className = "msgVisual";

  const head = document.createElement("div");
  head.className = "msgVisualHead";
  head.innerHTML = `
    <span class="msgVisualTitle"></span>
    <span class="msgVisualActions">
      <button class="msgVisualBtn" data-act="source" type="button" title="View source">
        <i class="bi bi-code-slash" aria-hidden="true"></i>
      </button>
      <button class="msgVisualBtn" data-act="open" type="button" title="Open in new tab">
        <i class="bi bi-box-arrow-up-right" aria-hidden="true"></i>
      </button>
    </span>`;
  // textContent, not innerHTML — the title came from the model too.
  head.querySelector(".msgVisualTitle").textContent =
    visual.title || "Visualization";

  const frame = document.createElement("iframe");
  frame.className = "msgVisualFrame";
  // No allow-same-origin. See the note at the top of this file.
  frame.setAttribute("sandbox", "allow-scripts");
  frame.setAttribute("referrerpolicy", "no-referrer");
  // Deliberately NOT loading="lazy". A lazy frame appended below the fold
  // defers its srcdoc, so the document is still empty when the height
  // handshake runs and it reports 0 — the frame then sits at its CSS default
  // and clips the widget. There is no network cost to a srcdoc frame anyway.
  frame.title = visual.title || "Visualization";
  frame.srcdoc = buildSrcdoc(visual);

  const source = document.createElement("pre");
  source.className = "msgVisualSource codeBlock";
  source.hidden = true;
  source.textContent = visual.code;

  wrap.append(head, frame, source);

  const clampHeight = (h) => Math.min(Math.max(h, 80), 1400);

  // An SVG's height follows from its own viewBox, so hand that ratio to CSS
  // and let layout do the work. Declarative on purpose: measuring in script
  // would mean rAF or ResizeObserver, and both are suspended while the tab is
  // hidden — the widget would then render at the placeholder height until
  // something happened to touch it. aspect-ratio just works, with no script in
  // the frame and none in the parent.
  const aspect = visual.kind === "svg" ? svgAspect(visual.code) : null;
  if (aspect) {
    frame.style.aspectRatio = `1 / ${aspect.toFixed(4)}`;
    frame.style.height = "auto";
    // The handshake would otherwise overwrite the exact ratio with a measured
    // pixel height a frame or two later, undoing it.
    frame.dataset.sizedByAspect = "1";
  }

  // Height messages, matched to this specific frame by its content window so
  // one widget cannot resize another. This is what HTML widgets rely on; for
  // SVG it is a refinement over the aspect-ratio estimate above.
  const onMessage = (e) => {
    if (e.source !== frame.contentWindow) return;
    if (frame.dataset.sizedByAspect) return;
    const h = e.data?.type === "aria-visual-height" ? Number(e.data.height) : 0;
    if (!Number.isFinite(h) || h <= 0) return;
    frame.style.height = clampHeight(h) + "px";
  };
  window.addEventListener("message", onMessage);

  head.querySelector('[data-act="source"]').addEventListener("click", () => {
    source.hidden = !source.hidden;
  });

  head.querySelector('[data-act="open"]').addEventListener("click", () => {
    // A blob URL rather than the parent document, so the popup is its own
    // origin too and still cannot see anything of ARIA's.
    const blob = new Blob([buildSrcdoc(visual)], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener,noreferrer");
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  });

  return wrap;
}
