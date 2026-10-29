import { json, validId, listAll, pre } from '../../../lib/util.js';

// GET /api/puzzles -> { puzzles: [{id, ...meta}], deleted: [id], progress: {id: {updatedAt, filled, total}} }
export async function onRequestGet({ env, data }) {
  const p = pre(data);
  const kv = env.CROSSWORD_KV;
  const [puzzles, deleted, progress] = await Promise.all([
    listAll(kv, `${p}puzzle:`),
    listAll(kv, `${p}deleted:`),
    listAll(kv, `${p}progress:`),
  ]);
  return json({
    puzzles: puzzles.map(k => ({ id: k.name.slice(p.length + 7), ...(k.metadata || {}) })),
    deleted: deleted.map(k => k.name.slice(p.length + 8)),
    progress: Object.fromEntries(progress.map(k => [k.name.slice(p.length + 9), k.metadata || {}])),
  });
}

// POST /api/puzzles  { id, raw, meta }
export async function onRequestPost({ request, env, data }) {
  const p = pre(data);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const { id, raw, meta = {} } = body || {};
  if (!validId(id)) return json({ error: 'Invalid id' }, 400);
  if (typeof raw !== 'string' || raw.length > 2_000_000) return json({ error: 'Invalid puzzle' }, 400);
  const clip = (s, n) => (s == null ? undefined : String(s).slice(0, n));
  const metadata = {
    title: clip(meta.title, 200), author: clip(meta.author, 120), date: clip(meta.date, 40),
    width: Number(meta.width) || 0, height: Number(meta.height) || 0,
    cells: Number(meta.cells) || 0, added: Number(meta.added) || Date.now(),
    rev: Number(meta.rev) || 0,
  };
  const kv = env.CROSSWORD_KV;
  await kv.put(`${p}puzzle:${id}`, raw, { metadata });
  await kv.delete(`${p}deleted:${id}`); // re-importing a deleted puzzle brings it back
  return json({ ok: true, id });
}
