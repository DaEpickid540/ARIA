// aria.js — the MCP server's way into ARIA: a Firebase session for the
// connected account, and ARIA's own REST API used AS that account.
//
// ARIA (lib/auth.js) accepts `Authorization: Bearer <Firebase ID token>` and
// lets it in only if the account is one of ARIA's owners, so the server on
// Render decides who gets in — exactly as it does for the browser.

export class ToolError extends Error {}

const SECURETOKEN = 'https://securetoken.googleapis.com/v1/token';

// uid → { token, exp }. Per isolate; a cold start just exchanges again.
const idTokens = new Map();

async function exchange(env, refreshToken) {
  const res = await fetch(`${SECURETOKEN}?key=${env.FIREBASE_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
  });
  const body = await res.json().catch(() => ({}));
  return res.ok && body.id_token ? body : null;
}

/** A Firebase ID token for the connected account, from the refresh token
 *  the consent page handed over when the connector was authorised. */
export async function idTokenFor(env, props) {
  const hit = idTokens.get(props.uid);
  if (hit && hit.exp - Date.now() > 60_000) return hit.token;
  const body = await exchange(env, props.refreshToken);
  if (!body) throw new ToolError('Your ARIA sign-in has expired or been revoked. Disconnect and reconnect the ARIA connector in Claude.');
  if (body.user_id !== props.uid) throw new ToolError('The ARIA sign-in does not match this connection. Reconnect the connector.');
  idTokens.set(props.uid, { token: body.id_token, exp: Date.now() + Number(body.expires_in || 3600) * 1000 });
  return body.id_token;
}

/** The account a refresh token belongs to, or null if it isn't live. */
export async function refreshTokenOwner(env, refreshToken) {
  return (await exchange(env, refreshToken))?.user_id || null;
}

// Render's free tier sleeps; the first request after a while waits ~1 min.
const WAKE_MS = 90_000;

/**
 * One call to ARIA. Returns the parsed JSON, or the raw Response when
 * `raw` is set (the chat stream). Expected failures become ToolErrors.
 */
export async function aria(env, token, method, path, body, { raw = false, timeoutMs = WAKE_MS, headers = {} } = {}) {
  let res;
  try {
    res = await fetch(`${env.ARIA_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    throw new ToolError(
      e?.name === 'TimeoutError'
        ? `ARIA didn't answer within ${Math.round(timeoutMs / 1000)}s (Render may still be waking up — try again).`
        : `Couldn't reach ARIA at ${env.ARIA_URL}: ${e?.message || e}`,
    );
  }
  if (res.status === 401) throw new ToolError('ARIA refused the sign-in. Reconnect the ARIA connector in Claude.');
  if (res.status === 403) {
    const d = await res.json().catch(() => ({}));
    throw new ToolError(d.message || 'This Google account is not one of ARIA\'s owners.');
  }
  if (raw) return res;
  const d = await res.json().catch(() => null);
  if (!res.ok) throw new ToolError(d?.error || d?.message || `ARIA answered ${res.status}.`);
  if (d == null) throw new ToolError('ARIA sent something that isn\'t JSON (is ARIA_URL right?).');
  return d;
}

/**
 * Reads ARIA's chat answer. /api/chat answers either with JSON ({reply})
 * or, for streaming models, with server-sent events ending in {done, full}.
 */
export async function readChat(res) {
  const type = res.headers.get('Content-Type') || '';
  if (!type.includes('text/event-stream')) {
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new ToolError(d.error || `ARIA answered ${res.status}.`);
    return { reply: d.reply || '', confirm: d.confirm || null, steps: d.steps || [] };
  }
  const text = await res.text();
  let reply = '';
  let confirm = null;
  let steps = [];
  let error = null;
  let deltas = '';
  for (const line of text.split('\n')) {
    if (!line.startsWith('data: ')) continue;
    let ev;
    try { ev = JSON.parse(line.slice(6)); } catch { continue; }
    if (ev.delta) deltas += ev.delta;
    if (ev.error) error = ev.error;
    if (ev.done) {
      reply = ev.full ?? ev.reply ?? reply;
      confirm = ev.confirm || confirm;
      steps = ev.steps || steps;
    }
  }
  if (!reply) reply = deltas;
  if (!reply && error) throw new ToolError(`ARIA: ${error}`);
  return { reply, confirm, steps };
}

/** A reply without its <think> block or any ACTION lines. */
export const cleanReply = (s) =>
  String(s || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^\s*(ACTION|CONFIRM):.*$/gim, '')
    .replace(/<\/?message>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
