// GET /api/health – reports whether the server can see its configuration.
// Never reveals the key itself, only whether it is set.
export async function onRequestGet({ env }) {
  return new Response(JSON.stringify({
    SYNC_TOKEN: env.SYNC_TOKEN ? `set (${String(env.SYNC_TOKEN).length} characters)` : 'NOT SET',
    CROSSWORD_KV: env.CROSSWORD_KV ? 'bound' : 'NOT BOUND',
    other_names_visible: Object.keys(env).filter(k => !['SYNC_TOKEN', 'CROSSWORD_KV', 'ASSETS'].includes(k)),
  }, null, 2), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
