// firebase-auth.js — verifying Firebase Auth ID tokens without the Admin SDK,
// which does not run on Workers. Copied from openplan/worker/firebase-auth.js
// (same Firebase project).

const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

function b64urlDecode(s) {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  return Uint8Array.from(atob(pad), c => c.charCodeAt(0));
}

let jwksCache = { keys: null, until: 0 };

async function signingKeys() {
  if (jwksCache.keys && Date.now() < jwksCache.until) return jwksCache.keys;
  const res = await fetch(JWKS_URL);
  if (!res.ok) throw new Error('could not fetch Google signing keys');
  const { keys } = await res.json();
  const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get('Cache-Control') || '')?.[1]) || 3600;
  jwksCache = { keys, until: Date.now() + maxAge * 1000 };
  return keys;
}

/** Verifies a Firebase Auth ID token the way the Admin SDK does: RS256 against
 *  Google's published keys, then audience, issuer, expiry and subject. */
export async function verifyFirebaseToken(token, projectId) {
  if (!projectId) throw new Error('FIREBASE_PROJECT is not set');
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('missing token');

  const decoder = new TextDecoder();
  const header = JSON.parse(decoder.decode(b64urlDecode(parts[0])));
  const payload = JSON.parse(decoder.decode(b64urlDecode(parts[1])));
  if (header.alg !== 'RS256') throw new Error('bad algorithm');

  const jwk = (await signingKeys()).find(k => k.kid === header.kid);
  if (!jwk) throw new Error('unknown signing key');
  const key = await crypto.subtle.importKey(
    'jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5', key, b64urlDecode(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!ok) throw new Error('bad signature');

  const now = Math.floor(Date.now() / 1000);
  if (payload.aud !== projectId) throw new Error('wrong audience');
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) throw new Error('wrong issuer');
  if (!(payload.exp > now)) throw new Error('expired');
  if (!(payload.iat <= now + 60)) throw new Error('issued in the future');
  if (!payload.sub) throw new Error('no subject');
  return payload;
}
