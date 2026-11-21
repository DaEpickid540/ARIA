// connect.js — the authorisation step of the OAuth flow: how a Claude
// connector gets permission to act as you in ARIA.
//
//   Claude ──/authorize──▶ here ──302──▶ ARIA (Render) /connect.html#h=…
//                                         (Google sign-in; you see who is
//                                          asking, and press Allow)
//   connect page ──POST /connect/complete { h, idToken, refreshToken }──▶ here
//   here ── asks ARIA /api/auth/me: is this account an owner? ──
//   here ──completeAuthorization──▶ { redirectTo: Claude's callback + code }
//
// The consent page lives on ARIA itself because that is where Google
// sign-in already works (its domain is authorised in the Firebase project).
//
// The refresh token is stored inside the OAuth grant, which
// workers-oauth-provider encrypts with a key derived from the issued token.
//
// Only Claude may connect: the redirect target must be on
// ALLOWED_REDIRECT_HOSTS, so a link made to look like "connect ARIA" cannot
// send access anywhere else. And only ARIA's owners: ARIA is asked, with
// the same check its lock screen uses.

import { verifyFirebaseToken } from './firebase-auth.js';
import { refreshTokenOwner } from './aria.js';

const HANDLE_TTL = 600; // seconds a consent page has to be answered

const list = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);

function cors(request, env) {
  const origin = request.headers.get('Origin');
  const headers = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
  if (origin && list(env.CONNECT_ORIGINS).includes(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function page(title, message, status = 400) {
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<body style="font-family:system-ui,sans-serif;max-width:520px;margin:12vh auto;padding:0 16px;line-height:1.5;color:#222;background:#fff">
<h1 style="font-size:1.3rem">${esc(title)}</h1><p>${esc(message)}</p></body>`, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Frame-Options': 'DENY' },
  });
}

const handleKey = (h) => `aria-connect:${h}`;

function newHandle() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function takeHandle(env, h) {
  if (!/^[0-9a-f]{48}$/.test(String(h || ''))) return null;
  const raw = await env.OAUTH_KV.get(handleKey(h));
  if (!raw) return null;
  // Spent on use. A replayed handle (KV deletes take a moment to spread) can
  // only mint another code for the same Claude callback, useless without
  // Claude's PKCE verifier.
  await env.OAUTH_KV.delete(handleKey(h));
  return JSON.parse(raw);
}

/** Asks ARIA whether this ID token belongs to one of its owners. */
async function ariaOwner(env, idToken) {
  let res;
  try {
    res = await fetch(`${env.ARIA_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${idToken}` },
      signal: AbortSignal.timeout(90_000), // Render may be waking up
    });
  } catch {
    return { ok: false, error: 'ARIA didn\'t answer. Render may be waking up — try Allow again in a minute.' };
  }
  const d = await res.json().catch(() => ({}));
  if (res.ok && d.ok) return { ok: true };
  if (d.error === 'not_owner' || d.error === 'owner_unset')
    return { ok: false, error: `${d.email || 'This account'} isn't one of ARIA's owners. Sign in with the account you use for ARIA.` };
  return { ok: false, error: `ARIA refused this sign-in (${d.error || res.status}).` };
}

export async function handleConnect(request, env) {
  const url = new URL(request.url);

  if (url.pathname === '/authorize' && request.method === 'GET') {
    let authReq, consent;
    try {
      authReq = await env.OAUTH_PROVIDER.parseAuthRequest(request);
      consent = await env.OAUTH_PROVIDER.describeConsent(authReq);
    } catch (err) {
      return page('Cannot connect', `This connection request is not valid: ${err.message || err}`);
    }
    if (!list(env.ALLOWED_REDIRECT_HOSTS).includes(consent.redirectHost)) {
      return page('Cannot connect', `ARIA only connects to Claude. This request would send access to ${consent.redirectHost}.`, 403);
    }
    const h = newHandle();
    await env.OAUTH_KV.put(handleKey(h), JSON.stringify({
      authReq,
      clientName: consent.clientName,
      clientDomain: consent.clientDomain || null,
      redirectHost: consent.redirectHost,
    }), { expirationTtl: HANDLE_TTL });
    // In the fragment, so it never reaches a server log or a Referer header.
    return Response.redirect(`${env.CONNECT_URL}#h=${h}`, 302);
  }

  if (url.pathname.startsWith('/connect/')) {
    const headers = cors(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });

    if (url.pathname === '/connect/info' && request.method === 'GET') {
      const h = url.searchParams.get('h');
      if (!/^[0-9a-f]{48}$/.test(String(h || ''))) return json({ error: 'Bad link.' }, 400, headers);
      const raw = await env.OAUTH_KV.get(handleKey(h));
      if (!raw) return json({ error: 'This connection request has expired. Start again from Claude.' }, 410, headers);
      const rec = JSON.parse(raw);
      return json({ clientName: rec.clientName, clientDomain: rec.clientDomain, redirectHost: rec.redirectHost }, 200, headers);
    }

    if (url.pathname === '/connect/complete' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      let claims;
      try {
        claims = await verifyFirebaseToken(String(body.idToken || ''), env.FIREBASE_PROJECT);
      } catch (err) {
        const known = /^(missing token|bad |unknown signing key|wrong |expired|issued in the future|no subject)/.test(err.message);
        return json({ error: `Not signed in (${known ? err.message : 'malformed token'}). Reload and try again.` }, 401, headers);
      }
      // The refresh token must be live and belong to the same account as the
      // ID token, or the grant would act as someone other than who pressed Allow.
      const owner = await refreshTokenOwner(env, String(body.refreshToken || ''));
      if (owner !== claims.sub) return json({ error: 'Sign-in tokens did not match. Reload and try again.' }, 401, headers);

      const allowed = await ariaOwner(env, String(body.idToken));
      if (!allowed.ok) return json({ error: allowed.error }, 403, headers);

      const rec = await takeHandle(env, body.h);
      if (!rec) return json({ error: 'This connection request has expired. Start again from Claude.' }, 410, headers);

      const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
        request: rec.authReq,
        userId: claims.sub,
        metadata: { label: claims.email || claims.sub, connectedAt: Date.now() },
        scope: rec.authReq.scope?.length ? rec.authReq.scope : ['aria'],
        props: { uid: claims.sub, email: claims.email || null, refreshToken: String(body.refreshToken) },
      });
      return json({ redirectTo }, 200, headers);
    }

    if (url.pathname === '/connect/deny' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const rec = await takeHandle(env, body.h);
      if (!rec) return json({ redirectTo: null }, 200, headers);
      const back = new URL(rec.authReq.redirectUri);
      back.searchParams.set('error', 'access_denied');
      if (rec.authReq.state) back.searchParams.set('state', rec.authReq.state);
      if (rec.authReq.issuer) back.searchParams.set('iss', rec.authReq.issuer);
      return json({ redirectTo: back.href }, 200, headers);
    }

    return json({ error: 'Not found' }, 404, headers);
  }

  if (url.pathname === '/' && request.method === 'GET') {
    return page('ARIA MCP', 'This is the ARIA connector for Claude. Add this server\'s /mcp URL as a custom connector in Claude (Settings → Connectors).', 200);
  }
  return new Response('Not found', { status: 404 });
}
