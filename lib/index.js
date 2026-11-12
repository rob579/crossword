// Per-person index of the library.
//
// A sync used to list the KV namespace three times (puzzles, tombstones, progress).
// KV's free plan only allows 1,000 list requests a day, so the lists now live in two
// small keys that every write keeps up to date, and a sync just reads those:
//   <prefix>index:lib       { v, builtAt, puzzles: { id: meta }, deleted: { id: at } }
//   <prefix>index:progress  { v, builtAt, progress: { id: { updatedAt, filled, total, at } } }
// They are separate so that frequent progress saves can never overwrite the puzzle list.
//
// The index is rebuilt from real lists when it is missing, and at most once every
// REBUILD_MS per person after that, which repairs any drift (KV has no transactions).
import { listAll } from './util.js';

const V = 1;
const REBUILD_MS = 6 * 60 * 60 * 1000;
// While someone is solving, the progress summary is refreshed at most this often.
const PROGRESS_REFRESH_MS = 60 * 1000;

const libKey = p => `${p}index:lib`;
const progKey = p => `${p}index:progress`;
const ok = (x, field) => !!x && x.v === V && !!x[field] && typeof x[field] === 'object';

async function read(kv, p) {
  const [lib, prog] = await Promise.all([kv.get(libKey(p), 'json'), kv.get(progKey(p), 'json')]);
  return { lib: ok(lib, 'puzzles') ? lib : null, prog: ok(prog, 'progress') ? prog : null };
}

async function rebuild(kv, p) {
  const [puzzles, deleted, progress] = await Promise.all([
    listAll(kv, `${p}puzzle:`),
    listAll(kv, `${p}deleted:`),
    listAll(kv, `${p}progress:`),
  ]);
  const now = Date.now();
  const lib = {
    v: V, builtAt: now,
    puzzles: Object.fromEntries(puzzles.map(k => [k.name.slice(p.length + 7), k.metadata || {}])),
    deleted: Object.fromEntries(deleted.map(k => [k.name.slice(p.length + 8), k.metadata?.at || now])),
  };
  const prog = {
    v: V, builtAt: now,
    progress: Object.fromEntries(progress.map(k => [k.name.slice(p.length + 9), { ...(k.metadata || {}), at: now }])),
  };
  await Promise.all([kv.put(libKey(p), JSON.stringify(lib)), kv.put(progKey(p), JSON.stringify(prog))]);
  return { lib, prog };
}

// The index for a sync. Normally two reads and nothing else.
export async function loadIndex(kv, p) {
  const cur = await read(kv, p);
  const fresh = cur.lib && cur.prog && Date.now() - (cur.lib.builtAt || 0) < REBUILD_MS;
  if (fresh) return cur;
  try {
    return await rebuild(kv, p);
  } catch (e) {
    // e.g. the daily list limit has been reached: an older index is better than an error
    if (cur.lib && cur.prog) return cur;
    throw e;
  }
}

// The calls below run after the real write has succeeded. If there is no index yet
// they do nothing: the next sync builds one from the keys themselves.

export async function indexPuzzle(kv, p, id, meta) {
  const { lib } = await read(kv, p);
  if (!lib) return;
  lib.puzzles[id] = meta;
  delete lib.deleted[id];
  await kv.put(libKey(p), JSON.stringify(lib));
}

export async function indexDelete(kv, p, id) {
  const { lib, prog } = await read(kv, p);
  const jobs = [];
  if (lib) {
    delete lib.puzzles[id];
    lib.deleted[id] = Date.now();
    jobs.push(kv.put(libKey(p), JSON.stringify(lib)));
  }
  if (prog && prog.progress[id]) {
    delete prog.progress[id];
    jobs.push(kv.put(progKey(p), JSON.stringify(prog)));
  }
  await Promise.all(jobs);
}

// summary: { updatedAt, filled, total }. To keep within the daily write limit this
// only writes when it matters: the first save of a puzzle, the puzzle becoming
// complete (or no longer complete), the app saying this is its last save for now
// (force), or a minute having passed since the summary was last refreshed.
// Other devices only use the summary to decide whether to fetch the full progress,
// which they also do whenever the puzzle is opened.
export async function indexProgress(kv, p, id, summary, force = false) {
  const { prog } = await read(kv, p);
  if (!prog) return;
  const prev = prog.progress[id];
  const now = Date.now();
  const done = s => s.total > 0 && s.filled >= s.total;
  const changed = !prev || prev.updatedAt !== summary.updatedAt || prev.filled !== summary.filled || prev.total !== summary.total;
  if (!changed) return;
  const due = !prev || force || done(prev) !== done(summary) || now - (prev.at || 0) >= PROGRESS_REFRESH_MS;
  if (!due) return;
  prog.progress[id] = { ...summary, at: now };
  await kv.put(progKey(p), JSON.stringify(prog));
}
