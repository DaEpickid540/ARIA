// sse.js — opening a server-sent event stream, the same way every time
//
// Three routes keep a connection open and push to it (task progress, chat
// sync, the daily briefing). Each used to carry its own copy of the same
// four headers, the same keep-alive ping and the same cleanup, and a leak
// in one copy is easy to miss. They share this now.
//
// (The chat reply stream in /api/chat is different: it ends when the reply
// does and has no ping, so it stays where it is.)

const PING_MS = 25000; // often enough that proxies don't drop an idle stream

let open = 0;

/**
 * Turn `res` into an event stream and say hello.
 * @param {object} hello     first event, sent at once so the page knows it's connected
 * @param {Function} onClose called once when the browser goes away: drop `res`
 *                           from whatever list was pushing to it
 */
export function openSse(req, res, { hello = { type: "connected" }, onClose } = {}) {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no", // nginx-style proxies: don't hold events back
  });
  res.write(`data: ${JSON.stringify(hello)}\n\n`);

  const ping = setInterval(() => {
    try {
      res.write(": ping\n\n");
    } catch {}
  }, PING_MS);

  open++;
  req.on("close", () => {
    clearInterval(ping);
    open--;
    try {
      onClose?.();
    } catch (e) {
      console.warn("[SSE] cleanup failed:", e.message);
    }
  });
}

/** How many streams opened here are still open (for /api/health/details). */
export const openSseCount = () => open;
