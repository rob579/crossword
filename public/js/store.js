// Local storage + cloud sync.
// Puzzles are stored as their original ipuz text. Progress is a map of
// cellIndex -> { v: letter ('' = cleared), t: timestamp, f?: 'r' (revealed) }.
// Devices merge progress cell-by-cell, newest timestamp wins.

const LS = {
  puzzles: 'cw.puzzles',
  progress: id => `cw.progress.${id}`,
  token: 'cw.token',
  dirty: 'cw.dirty',
  signedIn: 'cw.signedIn', // '1' = syncing via Google sign-in
  email: 'cw.email',
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
  const confirmed = { ...(a?.confirmed || {}) };
  for (const [k, v] of Object.entries(b?.confirmed || {})) {
    if (!confirmed[k] || (v.t || 0) > (confirmed[k].t || 0)) confirmed[k] = v;
  }
  return { cells, confirmed, updatedAt: Math.max(a?.updatedAt || 0, b?.updatedAt || 0) };
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
  // whose sync key this device last used ('' = original key, null = never synced)
  syncUser: () => localStorage.getItem('cw.syncUser'),
  setSyncUser: u => localStorage.setItem('cw.syncUser', u),
  // forget this device's library (used when switching to a different person's key)
  clearLibrary() {
    for (const k of Object.keys(localStorage)) {
      if (k === LS.puzzles || k === LS.dirty || k.startsWith('cw.progress.') || k.startsWith('cw.sel.')) localStorage.removeItem(k);
    }
  },
  setToken: t => (t ? localStorage.setItem(LS.token, t) : localStorage.removeItem(LS.token)),
  // Google sign-in (the login itself is a cookie the browser keeps; this just remembers sync is on)
  signedIn: () => localStorage.getItem(LS.signedIn) === '1',
  setSignedIn: on => (on ? localStorage.setItem(LS.signedIn, '1') : localStorage.removeItem(LS.signedIn)),
  email: () => localStorage.getItem(LS.email) || '',
  setEmail: e => (e ? localStorage.setItem(LS.email, e) : localStorage.removeItem(LS.email)),
  // is sync on at all (sync key or Google)?
  syncOn: () => !!localStorage.getItem(LS.token) || localStorage.getItem(LS.signedIn) === '1',
};

// ---------- sync ----------
const listeners = new Set();
let status = { state: 'off', message: 'Sync is off' };
export const onSyncStatus = fn => { listeners.add(fn); fn(status); return () => listeners.delete(fn); };
function setStatus(state, message) { status = { state, message }; listeners.forEach(fn => fn(status)); }

async function api(path, opts = {}) {
  const token = local.token();
  if (!token && !local.signedIn()) throw Object.assign(new Error('Sync is off'), { code: 'off' });
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  // Google sign-in rides on the site's CF_Authorization cookie (same origin).
  // redirect:'manual' so an expired sign-in shows up as "signed out" rather than a CORS error.
  const res = await fetch(`/api/${path}`, { ...opts, headers, credentials: 'same-origin', redirect: 'manual' });
  if (!token && (res.type === 'opaqueredirect' || res.status === 401 || res.status === 403)) {
    throw Object.assign(new Error('Signed out'), { code: 'signin' });
  }
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { msg = (await res.json()).error || msg; } catch {}
    throw Object.assign(new Error(msg), { code: res.status });
  }
  return res.json();
}

function reportError(e) {
  if (e.code === 'off') setStatus('off', 'Sync is off');
  else if (e.code === 'signin') setStatus('signin', 'Signed out – sign in again to sync');
  else if (e.code === 401) setStatus('error', 'Sync key rejected');
  else if (e instanceof TypeError) setStatus('offline', 'Offline – saved on this device');
  else setStatus('error', `Sync error: ${e.message}`);
}

// Check a sync key; returns { ok, user } where user is '' for the original key.
export async function testToken(token) {
  const res = await fetch('/api/whoami', { headers: { Authorization: `Bearer ${token}` } });
  if (res.ok) { const { user = '' } = await res.json().catch(() => ({})); return { ok: true, user }; }
  let msg = `HTTP ${res.status}`;
  try { msg = (await res.json()).error || msg; } catch {}
  return { ok: false, message: msg };
}

// Is this browser signed in with Google? Returns { ok, user, email }.
export async function checkSession() {
  const res = await fetch('/api/whoami', { credentials: 'same-origin', redirect: 'manual' });
  if (!res.ok) return { ok: false };
  const b = await res.json().catch(() => ({}));
  return b.via === 'google' ? { ok: true, user: b.user || '', email: b.email || '' } : { ok: false };
}

// Sign out of Google on this site (clears the CF_Authorization cookie). Best effort.
export function signOutRemote() {
  fetch('/cdn-cgi/access/logout', { credentials: 'same-origin', redirect: 'manual' }).catch(() => {});
}

// Full sync of library + progress. onChange is called if anything local changed.
let syncing = null;
export function syncAll(onChange) {
  if (syncing) return syncing;
  syncing = (async () => {
    if (!local.syncOn()) { setStatus('off', 'Sync is off'); return; }
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
      // grid edited on one device: newer revision wins
      for (const p of remote.puzzles) {
        const mine = localAll[p.id];
        if (!mine) continue;
        const lrev = mine.meta?.rev || 0, rrev = p.rev || 0;
        if (rrev > lrev) {
          const full = await api(`puzzles/${p.id}`);
          local.putPuzzle(p.id, { raw: full.raw, meta: { ...mine.meta, ...full.meta } });
          changed = true;
        } else if (lrev > rrev) {
          await api('puzzles', { method: 'POST', body: JSON.stringify({ id: p.id, raw: mine.raw, meta: mine.meta }) });
        }
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
    const changed = JSON.stringify(merged.cells) !== JSON.stringify(lp.cells)
      || JSON.stringify(merged.confirmed) !== JSON.stringify(lp.confirmed || {});
    local.putProgress(id, { ...lp, ...merged, syncedAt: Date.now() });
    return changed ? merged : null;
  } catch (e) { reportError(e); return null; }
}

export async function pushProgress(id, { quiet = false, keepalive = false, total = 0 } = {}) {
  if (!local.syncOn()) return;
  const lp = local.getProgress(id);
  if (!quiet) setStatus('syncing', 'Saving…');
  try {
    const merged = await api(`progress/${id}`, {
      method: 'PUT',
      keepalive,
      body: JSON.stringify({ cells: lp.cells, confirmed: lp.confirmed || {}, updatedAt: lp.updatedAt, total: total || lp.total || 0 }),
    });
    const now = local.getProgress(id); // may have changed during the request
    local.putProgress(id, { ...now, ...mergeProgress(now, merged), syncedAt: Date.now() });
    local.clearDirty(id);
    if (!quiet) setStatus('ok', 'Synced');
    return merged;
  } catch (e) { reportError(e); }
}

export async function deleteRemote(id) {
  if (!local.syncOn()) return;
  try { await api(`puzzles/${id}`, { method: 'DELETE' }); } catch (e) { reportError(e); }
}

export async function uploadPuzzle(id, rec) {
  if (!local.syncOn()) return;
  try { await api('puzzles', { method: 'POST', body: JSON.stringify({ id, raw: rec.raw, meta: rec.meta }) }); }
  catch (e) { reportError(e); }
}

// ---------- share links ----------
export async function createShare(id, raw, title) {
  if (!local.syncOn()) throw new Error('Sign in (Settings) to create share links');
  return api('share', { method: 'POST', body: JSON.stringify({ id, raw, title }) });
}
export async function fetchShare(sid) {
  const res = await fetch(`/api/share/${encodeURIComponent(sid)}`);
  let body = {};
  try { body = await res.json(); } catch {}
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body.raw;
}
