// Local storage + cloud sync.
// Puzzles are stored as their original ipuz text. Progress is a map of
// cellIndex -> { v: letter ('' = cleared), t: timestamp, f?: 'r' (revealed) }.
// Devices merge progress cell-by-cell, newest timestamp wins.

const LS = {
  puzzles: 'cw.puzzles',
  progress: id => `cw.progress.${id}`,
  token: 'cw.token',
  dirty: 'cw.dirty',
};

const read = (k, def) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch { return def; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { console.warn('localStorage write failed', e); } };

export async function puzzleId(raw) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return [...new Uint8Array(buf)].slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function mergeProgress(a, b) {
  const cells = { ...(a?.cells || {}) };
  for (const [k, v] of Object.entries(b?.cells || {})) {
    if (!cells[k] || (v.t || 0) > (cells[k].t || 0)) cells[k] = v;
  }
  return { cells, updatedAt: Math.max(a?.updatedAt || 0, b?.updatedAt || 0) };
}

export function filledCount(progress) {
  return Object.values(progress?.cells || {}).filter(c => c.v).length;
}

// ---------- local ----------
export const local = {
  puzzles: () => read(LS.puzzles, {}),
  getPuzzle: id => read(LS.puzzles, {})[id] || null,
  putPuzzle(id, rec) { const all = read(LS.puzzles, {}); all[id] = { ...all[id], ...rec }; write(LS.puzzles, all); },
  deletePuzzle(id) {
    const all = read(LS.puzzles, {}); delete all[id]; write(LS.puzzles, all);
    localStorage.removeItem(LS.progress(id));
    const dirty = read(LS.dirty, []); write(LS.dirty, dirty.filter(x => x !== id));
  },
  getProgress: id => read(LS.progress(id), { cells: {}, updatedAt: 0 }),
  putProgress: (id, p) => write(LS.progress(id), p),
  markDirty(id) { const d = new Set(read(LS.dirty, [])); d.add(id); write(LS.dirty, [...d]); },
  clearDirty(id) { write(LS.dirty, read(LS.dirty, []).filter(x => x !== id)); },
  dirty: () => read(LS.dirty, []),
  token: () => localStorage.getItem(LS.token) || '',
  setToken: t => (t ? localStorage.setItem(LS.token, t) : localStorage.removeItem(LS.token)),
};

// ---------- sync ----------
const listeners = new Set();
let status = { state: 'off', message: 'Sync is off' };
export const onSyncStatus = fn => { listeners.add(fn); fn(status); return () => listeners.delete(fn); };
function setStatus(state, message) { status = { state, message }; listeners.forEach(fn => fn(status)); }

async function api(path, opts = {}) {
  const token = local.token();
  if (!token) throw Object.assign(new Error('Sync is off'), { code: 'off' });
  const res = await fetch(`/api/${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(opts.headers || {}) },
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { msg = (await res.json()).error || msg; } catch {}
    throw Object.assign(new Error(msg), { code: res.status });
  }
  return res.json();
}

function reportError(e) {
  if (e.code === 'off') setStatus('off', 'Sync is off');
  else if (e.code === 401) setStatus('error', 'Sync key rejected');
  else if (e instanceof TypeError) setStatus('offline', 'Offline – saved on this device');
  else setStatus('error', `Sync error: ${e.message}`);
}

export async function testToken(token) {
  const res = await fetch('/api/puzzles', { headers: { Authorization: `Bearer ${token}` } });
  if (res.ok) return { ok: true };
  let msg = `HTTP ${res.status}`;
  try { msg = (await res.json()).error || msg; } catch {}
  return { ok: false, message: msg };
}

// Full sync of library + progress. onChange is called if anything local changed.
let syncing = null;
export function syncAll(onChange) {
  if (syncing) return syncing;
  syncing = (async () => {
    if (!local.token()) { setStatus('off', 'Sync is off'); return; }
    setStatus('syncing', 'Syncing…');
    let changed = false;
    try {
      const remote = await api('puzzles');
      const localAll = local.puzzles();
      // tombstones
      for (const id of remote.deleted || []) {
        if (localAll[id]) { local.deletePuzzle(id); delete localAll[id]; changed = true; }
      }
      const remoteIds = new Set(remote.puzzles.map(p => p.id));
      // upload local-only puzzles
      for (const [id, rec] of Object.entries(localAll)) {
        if (!remoteIds.has(id)) await api('puzzles', { method: 'POST', body: JSON.stringify({ id, raw: rec.raw, meta: rec.meta }) });
      }
      // download remote-only puzzles
      for (const p of remote.puzzles) {
        if (!localAll[p.id]) {
          const full = await api(`puzzles/${p.id}`);
          local.putPuzzle(p.id, { raw: full.raw, meta: full.meta, added: full.meta?.added || Date.now() });
          changed = true;
        }
      }
      // progress: pull where remote is newer, push where local is dirty
      const dirty = new Set(local.dirty());
      for (const p of remote.puzzles) {
        const rp = remote.progress?.[p.id];
        const lp = local.getProgress(p.id);
        if (rp && rp.updatedAt > (lp.syncedAt || 0)) {
          const merged = await pullProgress(p.id);
          if (merged) changed = true;
        }
      }
      for (const id of dirty) await pushProgress(id, { quiet: true });
      setStatus('ok', 'Synced');
    } catch (e) { reportError(e); }
    if (changed && onChange) onChange();
  })().finally(() => { syncing = null; });
  return syncing;
}

// Fetch remote progress and merge into local. Returns merged progress (or null if unchanged).
export async function pullProgress(id) {
  try {
    const remote = await api(`progress/${id}`);
    const lp = local.getProgress(id);
    const merged = mergeProgress(lp, remote);
    const changed = JSON.stringify(merged.cells) !== JSON.stringify(lp.cells);
    local.putProgress(id, { ...lp, ...merged, syncedAt: Date.now() });
    return changed ? merged : null;
  } catch (e) { reportError(e); return null; }
}

export async function pushProgress(id, { quiet = false, keepalive = false, total = 0 } = {}) {
  if (!local.token()) return;
  const lp = local.getProgress(id);
  if (!quiet) setStatus('syncing', 'Saving…');
  try {
    const merged = await api(`progress/${id}`, {
      method: 'PUT',
      keepalive,
      body: JSON.stringify({ cells: lp.cells, updatedAt: lp.updatedAt, total: total || lp.total || 0 }),
    });
    const now = local.getProgress(id); // may have changed during the request
    local.putProgress(id, { ...now, ...mergeProgress(now, merged), syncedAt: Date.now() });
    local.clearDirty(id);
    if (!quiet) setStatus('ok', 'Synced');
    return merged;
  } catch (e) { reportError(e); }
}

export async function deleteRemote(id) {
  if (!local.token()) return;
  try { await api(`puzzles/${id}`, { method: 'DELETE' }); } catch (e) { reportError(e); }
}

export async function uploadPuzzle(id, rec) {
  if (!local.token()) return;
  try { await api('puzzles', { method: 'POST', body: JSON.stringify({ id, raw: rec.raw, meta: rec.meta }) }); }
  catch (e) { reportError(e); }
}
