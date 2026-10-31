import { json, safeEqual, extraUsers } from '../../lib/util.js';
import { checkAccessToken, tokenFrom, userForEmail } from '../../lib/access.js';

// Every /api/* request must come from someone who is either
//  - signed in with Google (Cloudflare Access cookie, see lib/access.js), or
//  - sending a sync key: Authorization: Bearer <SYNC_TOKEN or a SYNC_USERS key>
// except the health check and opening a share link (GET /api/share/<id>).
export async function onRequest(ctx) {
  const { request, env } = ctx;
  const path = new URL(request.url).pathname;
  if (path === '/api/health') return ctx.next();
  if (!env.CROSSWORD_KV) return json({ error: 'Server not configured: KV binding CROSSWORD_KV is missing' }, 500);
  if (request.method === 'GET' && path.startsWith('/api/share/')) return ctx.next();

  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  let user = null;
  if (token) {
    if (!env.SYNC_TOKEN) return json({ error: 'Server not configured: SYNC_TOKEN is not set' }, 500);
    // work out whose key this is: the original key, or one of the extra people
    if (await safeEqual(token, env.SYNC_TOKEN)) user = { name: '', prefix: '' };
    else {
      for (const [name, key] of extraUsers(env)) {
        if (await safeEqual(token, key)) { user = { name, prefix: `u:${name}:` }; break; }
      }
    }
    if (!user) return json({ error: 'Wrong sync key' }, 401);
    user.via = 'key';
  } else {
    let r;
    try { r = await checkAccessToken(tokenFrom(request), env); } catch (e) { return json({ error: e.message }, 503); }
    if (!r.email) return json({ error: 'Not signed in', signin: true, reason: r.reason }, 401);
    user = { ...(await userForEmail(r.email, env)), email: r.email, via: 'google' };
  }
  ctx.data.user = user.name;
  ctx.data.prefix = user.prefix;
  ctx.data.email = user.email || '';
  ctx.data.via = user.via;
  return ctx.next();
}
