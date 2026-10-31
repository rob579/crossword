// Google sign-in via Cloudflare Access.
//
// Cloudflare Access protects only /login. Signing in there gives us a signed token
// (Cloudflare's header/cookie); /login checks it and stores it in our own site-wide
// cw_auth cookie, which the browser then sends with every /api request. We verify
// that token ourselves (signature, issuer, audience,
// expiry), so the API stays reachable for sync keys and public share links, and
// requests via the unprotected *.pages.dev hostnames can't pretend to be signed in.
//
// Settings (Pages → Settings → Variables and Secrets):
//   ACCESS_TEAM_DOMAIN  e.g. robsofficetips.cloudflareaccess.com
//   ACCESS_AUD          the Access application's "Application Audience (AUD) Tag"
//                       (several allowed, separated by commas)
//   ACCESS_USERS        optional JSON {"email": "name"} linking a Google account to an
//                       existing library: "" = the original SYNC_TOKEN library,
//                       "sam" = the SYNC_USERS library for sam. Anyone else who is
//                       allowed through Access gets their own new library automatically.

const cache = { url: '', keys: null, at: 0 };

function b64urlBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const b64urlJson = s => JSON.parse(new TextDecoder().decode(b64urlBytes(s)));

export const teamHost = env =>
  String(env.ACCESS_TEAM_DOMAIN || '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');

export const accessConfigured = env => !!(teamHost(env) && String(env.ACCESS_AUD || '').trim());

async function signingKeys(team, refresh) {
  const url = `https://${team}/cdn-cgi/access/certs`;
  if (!refresh && cache.keys && cache.url === url && Date.now() - cache.at < 3600_000) return cache.keys;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't fetch Access keys (HTTP ${res.status})`);
  const { keys = [] } = await res.json();
  Object.assign(cache, { url, keys, at: Date.now() });
  return keys;
}

function cookie(request, name) {
  const m = (request.headers.get('Cookie') || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? m[1] : '';
}

// The token can arrive three ways: Cloudflare's header (only on the protected /login
// path), our own site-wide cw_auth cookie (set by /login), or Cloudflare's cookie.
export function tokenFrom(request) {
  return request.headers.get('Cf-Access-Jwt-Assertion') || cookie(request, 'cw_auth') || cookie(request, 'CF_Authorization');
}

// Verify an Access token. Returns { email, exp } or { reason } explaining why not
// (the reason is safe to show: it never contains the token or any setting's value).
export async function checkAccessToken(jwt, env) {
  if (!accessConfigured(env)) return { reason: 'not-configured' };
  const parts = String(jwt || '').split('.');
  if (parts.length !== 3) return { reason: 'no-token' };
  let header, claims;
  try { header = b64urlJson(parts[0]); claims = b64urlJson(parts[1]); } catch { return { reason: 'unreadable-token' }; }
  if (header.alg !== 'RS256') return { reason: 'wrong-algorithm' };

  const team = teamHost(env);
  const now = Math.floor(Date.now() / 1000);
  const wanted = String(env.ACCESS_AUD).split(/[\s,]+/).filter(Boolean);
  const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (claims.iss !== `https://${team}`) return { reason: 'wrong-issuer (check ACCESS_TEAM_DOMAIN)' };
  if (!auds.some(a => wanted.includes(a))) return { reason: 'wrong-audience (check ACCESS_AUD)' };
  if (!claims.exp || claims.exp < now - 30) return { reason: 'expired' };
  if (claims.nbf && claims.nbf > now + 30) return { reason: 'not-yet-valid' };
  if (!claims.email) return { reason: 'no-email-in-token' };

  const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const sig = b64urlBytes(parts[2]);
  // keys rotate: if the key id isn't in our cached set, fetch a fresh set once
  for (const refresh of [false, true]) {
    const jwk = (await signingKeys(team, refresh)).find(k => k.kid === header.kid);
    if (!jwk) continue;
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, sig, signed);
    return ok ? { email: String(claims.email).trim().toLowerCase(), exp: claims.exp } : { reason: 'bad-signature' };
  }
  return { reason: 'unknown-signing-key' };
}

// Returns the signed-in Google email (lowercase), or null.
export async function accessEmail(request, env) {
  return (await checkAccessToken(tokenFrom(request), env)).email || null;
}

// ACCESS_USERS → { email: name }
export function accessUsers(env) {
  const raw = String(env.ACCESS_USERS || '').replace(/[“”„″]/g, '"').trim();
  if (!raw) return {};
  try {
    const o = JSON.parse(raw);
    if (!o || typeof o !== 'object') return {};
    const out = {};
    for (const [email, name] of Object.entries(o)) {
      const n = String(name ?? '').trim().toLowerCase();
      if (n === '' || /^[a-z0-9_-]{1,32}$/.test(n)) out[String(email).trim().toLowerCase()] = n;
    }
    return out;
  } catch { return {}; }
}

async function hex(s) {
  const b = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  return [...b].map(x => x.toString(16).padStart(2, '0')).join('');
}

// Which library a signed-in email uses: { name, prefix }
export async function userForEmail(email, env) {
  const map = accessUsers(env);
  if (Object.prototype.hasOwnProperty.call(map, email)) {
    const name = map[email];
    return name ? { name, prefix: `u:${name}:` } : { name: '', prefix: '' };
  }
  const name = `g-${(await hex(email)).slice(0, 12)}`;
  return { name, prefix: `u:${name}:` };
}
