import { json, validId, mergeProgress, pre } from '../../../lib/util.js';
import { indexProgress } from '../../../lib/index.js';

const key = (data, id) => `${pre(data)}progress:${id}`;

// GET /api/progress/:id -> { cells, updatedAt }
export async function onRequestGet({ params, env, data }) {
  if (!validId(params.id)) return json({ error: 'Invalid id' }, 400);
  const stored = await env.CROSSWORD_KV.get(key(data, params.id), 'json');
  return json(stored || { cells: {}, updatedAt: 0 });
}

// PUT /api/progress/:id  { cells, updatedAt, total, final? } -> merged progress
// final: the app's last save for now (leaving the puzzle or the page)
export async function onRequestPut({ params, request, env, data }) {
  if (!validId(params.id)) return json({ error: 'Invalid id' }, 400);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const kv = env.CROSSWORD_KV;
  const stored = (await kv.get(key(data, params.id), 'json')) || { cells: {}, updatedAt: 0 };
  const merged = mergeProgress(stored, body);
  const filled = Object.values(merged.cells).filter(c => c.v).length;
  const total = Number(body.total) || 0;
  await kv.put(key(data, params.id), JSON.stringify(merged), { metadata: { updatedAt: merged.updatedAt, filled, total } });
  await indexProgress(kv, pre(data), params.id, { updatedAt: merged.updatedAt, filled, total }, !!body.final).catch(() => {});
  return json(merged);
}
