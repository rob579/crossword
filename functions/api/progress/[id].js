import { json, validId, mergeProgress } from '../../../lib/util.js';

const key = id => `progress:${id}`;

// GET /api/progress/:id -> { cells, updatedAt }
export async function onRequestGet({ params, env }) {
  if (!validId(params.id)) return json({ error: 'Invalid id' }, 400);
  const stored = await env.CROSSWORD_KV.get(key(params.id), 'json');
  return json(stored || { cells: {}, updatedAt: 0 });
}

// PUT /api/progress/:id  { cells, updatedAt, total } -> merged progress
export async function onRequestPut({ params, request, env }) {
  if (!validId(params.id)) return json({ error: 'Invalid id' }, 400);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const kv = env.CROSSWORD_KV;
  const stored = (await kv.get(key(params.id), 'json')) || { cells: {}, updatedAt: 0 };
  const merged = mergeProgress(stored, body);
  const filled = Object.values(merged.cells).filter(c => c.v).length;
  const total = Number(body.total) || 0;
  await kv.put(key(params.id), JSON.stringify(merged), { metadata: { updatedAt: merged.updatedAt, filled, total } });
  return json(merged);
}
