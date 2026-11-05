// Shared helpers for the Pages Functions API.

export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

// Sync keys.
//  SYNC_TOKEN  – the original key; its data uses the plain KV keys (unchanged).
//  SYNC_USERS  – optional extra people, each with their own private library:
//                JSON {"name":"key", ...} or lines/commas of name=key.
//                Their data lives under "u:<name>:" in the same KV namespace.
export function extraUsers(env) {
  // accept curly quotes too (phones and Macs often swap them in when typing)
  const raw = String(env.SYNC_USERS || '').replace(/[\u201C\u201D\u201E\u2033]/g, '"').replace(/[\u2018\u2019]/g, "'").trim();
  if (!raw) return [];
  let pairs = [];
  try {
    const o = JSON.parse(raw);
    if (o && typeof o === 'object') pairs = Object.entries(o);
  } catch {
    pairs = raw.split(/[\n,;]+/).map(s => s.split('=')).filter(p => p.length >= 2).map(([n, ...k]) => [n, k.join('=')]);
  }
  return pairs
    .map(([n, k]) => [String(n).trim().toLowerCase(), String(k).trim()])
    .filter(([n, k]) => /^[a-z0-9_-]{1,32}$/.test(n) && k.length >= 8);
}
// Key prefix for the current request's user ('' for the original key).
export const pre = data => data?.prefix || '';

export const validId = id => /^[a-f0-9]{16}$/.test(id || '');

// Merge two progress objects cell-by-cell; the newest timestamp wins.
export function mergeProgress(a, b) {
  const cells = { ...(a?.cells || {}) };
  for (const [k, v] of Object.entries(b?.cells || {})) {
    if (!v || typeof v !== 'object') continue;
    const cell = { v: String(v.v ?? '').slice(0, 4), t: Number(v.t) || 0 };
    if (v.f) cell.f = String(v.f).slice(0, 2);
    if (!cells[k] || cell.t > (cells[k].t || 0)) cells[k] = cell;
  }
  // clues marked as confirmed: { clueId: { on, t } }, newest wins
  const confirmed = { ...(a?.confirmed || {}) };
  for (const [k, v] of Object.entries(b?.confirmed || {})) {
    if (!v || typeof v !== 'object' || String(k).length > 40) continue;
    const c = { on: !!v.on, t: Number(v.t) || 0 };
    if (!confirmed[k] || c.t > (confirmed[k].t || 0)) confirmed[k] = c;
  }
  // per-puzzle flags such as { completed: { on, t } }, newest wins
  const flags = { ...(a?.flags || {}) };
  for (const [k, v] of Object.entries(b?.flags || {})) {
    if (!v || typeof v !== 'object' || !/^[a-z]{1,20}$/.test(k)) continue;
    const f = { on: !!v.on, t: Number(v.t) || 0 };
    if (!flags[k] || f.t > (flags[k].t || 0)) flags[k] = f;
  }
  return { cells, confirmed, flags, updatedAt: Math.max(a?.updatedAt || 0, b?.updatedAt || 0) };
}

async function sha(s) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
}
// Constant-time comparison of two strings (compares their hashes).
export async function safeEqual(a, b) {
  const [x, y] = await Promise.all([sha(a), sha(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

// List every key under a prefix (KV list is paginated).
export async function listAll(kv, prefix) {
  const keys = [];
  let cursor;
  do {
    const page = await kv.list({ prefix, cursor });
    keys.push(...page.keys);
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return keys;
}
