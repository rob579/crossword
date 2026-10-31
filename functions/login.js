import { checkAccessToken, tokenFrom } from '../lib/access.js';

// GET /login – this path is protected by Cloudflare Access (Google sign-in).
// Reaching it means sign-in worked. Cloudflare's own cookie may only be sent to
// this path, so check the token and keep it in our own site-wide cookie (cw_auth),
// then send the browser back to the app, which finishes signing in.
export async function onRequestGet({ request, env }) {
  const jwt = tokenFrom(request);
  const r = await checkAccessToken(jwt, env).catch(e => ({ reason: e.message }));
  const headers = new Headers({ 'Cache-Control': 'no-store' });
  if (r.email) {
    const maxAge = Math.max(60, r.exp - Math.floor(Date.now() / 1000));
    headers.append('Set-Cookie', `cw_auth=${jwt}; Path=/; Max-Age=${maxAge}; Secure; HttpOnly; SameSite=Lax`);
    headers.set('Location', '/#/signed-in');
  } else {
    headers.set('Location', `/#/signed-in/${encodeURIComponent(r.reason || 'unknown')}`);
  }
  return new Response(null, { status: 302, headers });
}
