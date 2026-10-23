// Shared helpers for the Pages Functions API.

export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

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
  return { cells, updatedAt: Math.max(a?.updatedAt || 0, b?.updatedAt || 0) };
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
