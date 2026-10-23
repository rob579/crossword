import { json, validId } from '../../../lib/util.js';

const newShareId = () => {
  const b = crypto.getRandomValues(new Uint8Array(9));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_');
};

// POST /api/share { id, raw, title }  (needs the sync key)
// Saves a snapshot of the puzzle and returns a share id. Sharing the same puzzle
// again reuses its link and refreshes the snapshot (e.g. after a grid fix).
export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const { id, raw, title } = body || {};
  if (!validId(id)) return json({ error: 'Invalid id' }, 400);
  if (typeof raw !== 'string' || raw.length > 2_000_000) return json({ error: 'Invalid puzzle' }, 400);
  const kv = env.CROSSWORD_KV;
  let sid = await kv.get(`sharedby:${id}`);
  if (!sid) {
    sid = newShareId();
    await kv.put(`sharedby:${id}`, sid);
  }
  await kv.put(`share:${sid}`, raw, { metadata: { title: String(title || '').slice(0, 200), puzzle: id, at: Date.now() } });
  return json({ sid });
}
