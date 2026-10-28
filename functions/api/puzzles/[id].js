import { json, validId, pre } from '../../../lib/util.js';

// GET /api/puzzles/:id -> { raw, meta }
export async function onRequestGet({ params, env, data }) {
  if (!validId(params.id)) return json({ error: 'Invalid id' }, 400);
  const { value, metadata } = await env.CROSSWORD_KV.getWithMetadata(`${pre(data)}puzzle:${params.id}`);
  if (value == null) return json({ error: 'Not found' }, 404);
  return json({ raw: value, meta: metadata || {} });
}

// DELETE /api/puzzles/:id -> removes puzzle + progress and leaves a tombstone so other devices drop it too
export async function onRequestDelete({ params, env, data }) {
  const p = pre(data);
  if (!validId(params.id)) return json({ error: 'Invalid id' }, 400);
  const kv = env.CROSSWORD_KV;
  await Promise.all([
    kv.delete(`${p}puzzle:${params.id}`),
    kv.delete(`${p}progress:${params.id}`),
    kv.put(`${p}deleted:${params.id}`, String(Date.now()), { metadata: { at: Date.now() } }),
  ]);
  return json({ ok: true });
}
