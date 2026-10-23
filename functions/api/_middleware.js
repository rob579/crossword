import { json, safeEqual } from '../../lib/util.js';

// Every /api/* request must carry: Authorization: Bearer <SYNC_TOKEN>
export async function onRequest(ctx) {
  const { request, env } = ctx;
  if (new URL(request.url).pathname === '/api/health') return ctx.next();
  if (!env.SYNC_TOKEN) return json({ error: 'Server not configured: SYNC_TOKEN is not set' }, 500);
  if (!env.CROSSWORD_KV) return json({ error: 'Server not configured: KV binding CROSSWORD_KV is missing' }, 500);
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token || !(await safeEqual(token, env.SYNC_TOKEN))) return json({ error: 'Wrong sync key' }, 401);
  return ctx.next();
}
