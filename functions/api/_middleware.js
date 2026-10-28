import { json, safeEqual, extraUsers } from '../../lib/util.js';

// Every /api/* request must carry: Authorization: Bearer <SYNC_TOKEN>
// except the health check and opening a share link (GET /api/share/<id>).
export async function onRequest(ctx) {
  const { request, env } = ctx;
  const path = new URL(request.url).pathname;
  if (path === '/api/health') return ctx.next();
  if (request.method === 'GET' && path.startsWith('/api/share/')) {
    if (!env.CROSSWORD_KV) return json({ error: 'Server not configured: KV binding CROSSWORD_KV is missing' }, 500);
    return ctx.next();
  }
  if (!env.SYNC_TOKEN) return json({ error: 'Server not configured: SYNC_TOKEN is not set' }, 500);
  if (!env.CROSSWORD_KV) return json({ error: 'Server not configured: KV binding CROSSWORD_KV is missing' }, 500);
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'Wrong sync key' }, 401);
  // work out whose key this is: the original key, or one of the extra people
  let user = null;
  if (await safeEqual(token, env.SYNC_TOKEN)) user = { name: '', prefix: '' };
  else {
    for (const [name, key] of extraUsers(env)) {
      if (await safeEqual(token, key)) { user = { name, prefix: `u:${name}:` }; break; }
    }
  }
  if (!user) return json({ error: 'Wrong sync key' }, 401);
  ctx.data.user = user.name;
  ctx.data.prefix = user.prefix;
  return ctx.next();
}
