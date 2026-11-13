// serverWake.js — says so when ARIA's server is asleep or unreachable
//
// The cloud server (Render, free tier) sleeps after 15 idle minutes, and the
// next request waits 30–60 seconds while it starts. Without this, a message
// sent then just sits there, and a dropped connection shows only
// "[Error contacting server]".
//
// This only watches. It wraps fetch to look at POST /api/chat and never
// changes, retries or resends a request, so it can't send a message twice:
//   - No answer after 4s: ping the server. A quick pong means the model is
//     just slow, so nothing shows. No pong means the server is waking: a
//     banner counts the seconds until the reply starts.
//   - The request fails outright: a banner says so and pings until the
//     server answers, then asks you to send again.
//
// (Not the wake word: that's wakeCore.js / wakeWord.js.)

const SLOW_MS = 4000; // how long a chat request may be silent before we check
const PING_TIMEOUT_MS = 2500;
const RETRY_MS = 3000;
const GIVE_UP_MS = 2 * 60 * 1000;
const BACK_SHOWN_MS = 6000;

const TEXT = {
  waking: ["Waking ARIA's server…", "It sleeps when idle. Your message will go through, usually within a minute."],
  down: ["Can't reach ARIA's server. Retrying…", "Your last message was not sent."],
  back: ["ARIA is back.", "Send your message again."],
  gaveUp: ["Still can't reach ARIA.", "Check your connection, then try again."],
};

const baseFetch = window.fetch.bind(window); // apiBase.js's fetch, when it's routing

let el = null;
let state = null; // a key of TEXT, or null when hidden
let since = 0;
let tick = null;
let poll = null;
let hideTimer = null;

function ensureEl() {
  if (el) return el;
  const style = document.createElement("style");
  style.textContent = `
    #serverWake {
      position: fixed; top: 14px; left: 50%; z-index: 99980;
      transform: translateX(-50%) translateY(-20px);
      max-width: min(92vw, 420px); padding: 10px 16px;
      background: var(--bg-raised, #16161c);
      border: 1px solid var(--border-strong, #3a3a46);
      border-left: 3px solid var(--warning, #e0a030);
      border-radius: var(--r-sm, 8px);
      color: var(--text, #eee); font-family: var(--font-sans, system-ui, sans-serif);
      font-size: 13px; line-height: 1.4;
      opacity: 0; pointer-events: none;
      transition: opacity 0.2s, transform 0.2s;
    }
    #serverWake.show { opacity: 1; transform: translateX(-50%) translateY(0); }
    #serverWake.ok { border-left-color: var(--accent, #4caf7d); }
    #serverWake small { display: block; color: var(--text-3, #999); font-size: 12px; }
    @media (prefers-reduced-motion: reduce) { #serverWake { transition: none; } }
  `;
  document.head.appendChild(style);
  el = document.createElement("div");
  el.id = "serverWake";
  el.setAttribute("role", "status");
  el.setAttribute("aria-live", "polite");
  el.append(document.createElement("span"), document.createElement("small"));
  document.body.appendChild(el);
  return el;
}

function paint() {
  const [title, detail] = TEXT[state];
  const secs = Math.round((Date.now() - since) / 1000);
  // Only the wake-up counts seconds: it's the one with a known end.
  el.firstChild.textContent = state === "waking" && secs >= 1 ? `${title} ${secs}s` : title;
  el.lastChild.textContent = detail;
}

function show(next) {
  clearTimeout(hideTimer);
  clearInterval(tick);
  ensureEl();
  state = next;
  since = Date.now();
  el.classList.toggle("ok", next === "back");
  paint();
  el.classList.add("show");
  if (next === "waking") tick = setInterval(paint, 1000);
  if (next === "back" || next === "gaveUp") hideTimer = setTimeout(hide, next === "back" ? BACK_SHOWN_MS : BACK_SHOWN_MS * 2);
}

function hide() {
  clearTimeout(hideTimer);
  clearInterval(tick);
  clearInterval(poll);
  poll = null;
  state = null;
  el?.classList.remove("show");
}

async function serverAnswers() {
  try {
    const r = await baseFetch(`/api/ping?wake=${Date.now()}`, { cache: "no-store", signal: AbortSignal.timeout(PING_TIMEOUT_MS) });
    return r.ok;
  } catch {
    return false;
  }
}

/** The request failed: say so, and watch for the server coming back. */
function waitForServer() {
  show("down");
  const started = Date.now();
  clearInterval(poll);
  poll = setInterval(async () => {
    if (state !== "down") return clearInterval(poll);
    if (await serverAnswers()) {
      clearInterval(poll);
      if (state === "down") show("back");
    } else if (Date.now() - started > GIVE_UP_MS) {
      clearInterval(poll);
      if (state === "down") show("gaveUp");
    }
  }, RETRY_MS);
}

function watch(request) {
  let settled = false;
  const slow = setTimeout(async () => {
    const awake = await serverAnswers();
    // Awake and silent = a slow model, which the typing indicator covers.
    if (!settled && !awake && state !== "down") show("waking");
  }, SLOW_MS);
  const done = () => {
    settled = true;
    clearTimeout(slow);
  };
  request.then(
    (res) => {
      done();
      // A gateway error is the host answering for a server that isn't up.
      if (res.status >= 502 && res.status <= 504) waitForServer();
      else if (state) hide();
    },
    (err) => {
      done();
      if (err?.name === "AbortError") {
        if (state === "waking") hide(); // you pressed stop
      } else waitForServer();
    },
  );
}

const isChatPost = (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.pathname : input?.url || "";
  const method = (init?.method || input?.method || "GET").toUpperCase();
  return method === "POST" && /(^|\/\/[^/]+)\/api\/chat(\?|$)/.test(url);
};

window.fetch = (input, init) => {
  const request = baseFetch(input, init);
  try {
    if (isChatPost(input, init)) watch(request);
  } catch {}
  return request;
};

// The browser knows before any request does.
window.addEventListener("online", () => {
  if (state === "down" || state === "gaveUp") waitForServer();
});
