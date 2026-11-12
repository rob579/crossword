import { json, validId, pre } from '../../../lib/util.js';
import { loadIndex, indexPuzzle } from '../../../lib/index.js';

// GET /api/puzzles -> { puzzles: [{id, ...meta}], deleted: [id], progress: {id: {updatedAt, filled, total}} }
export async function onRequestGet({ env, data }) {
  // Reads the per-person index (lib/index.js) rather than listing the namespace.
  const { lib, prog } = await loadIndex(env.CROSSWORD_KV, pre(data));
  return json({
    puzzles: Object.entries(lib.puzzles).map(([id, meta]) => ({ id, ...meta })),
    deleted: Object.keys(lib.deleted),
    progress: Object.fromEntries(Object.entries(prog.progress).map(
      ([id, s]) => [id, { updatedAt: s.updatedAt, filled: s.filled, total: s.total }])),
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
    title: clip(meta.title, 200), author: clip(meta.author, 120), publisher: clip(meta.publisher, 120), date: clip(meta.date, 40),
    width: Number(meta.width) || 0, height: Number(meta.height) || 0,
    cells: Number(meta.cells) || 0, added: Number(meta.added) || Date.now(),
    rev: Number(meta.rev) || 0,
  };
  const kv = env.CROSSWORD_KV;
  await kv.put(`${p}puzzle:${id}`, raw, { metadata });
  await kv.delete(`${p}deleted:${id}`); // re-importing a deleted puzzle brings it back
  await indexPuzzle(kv, p, id, JSON.parse(JSON.stringify(metadata))).catch(() => {});
  return json({ ok: true, id });
}
