import { json } from '../../../lib/util.js';

// GET /api/share/:sid  (public – no sync key needed)
// Returns the shared puzzle's ipuz text so anyone with the link can add it to their library.
export async function onRequestGet({ params, env }) {
  if (!/^[A-Za-z0-9_-]{12}$/.test(params.sid || '')) return json({ error: 'Invalid link' }, 400);
  const raw = await env.CROSSWORD_KV.get(`share:${params.sid}`);
  if (raw == null) return json({ error: 'This share link has expired or never existed' }, 404);
  return json({ raw });
}
