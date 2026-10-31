import { extraUsers } from '../../lib/util.js';
import { accessConfigured, accessUsers } from '../../lib/access.js';

const KNOWN = ['SYNC_TOKEN', 'SYNC_USERS', 'CROSSWORD_KV', 'ASSETS', 'ACCESS_TEAM_DOMAIN', 'ACCESS_AUD', 'ACCESS_USERS'];

// GET /api/health – reports whether the server can see its configuration.
// Never reveals any value, only whether it is set.
export async function onRequestGet({ env }) {
  return new Response(JSON.stringify({
    SYNC_TOKEN: env.SYNC_TOKEN ? 'set' : 'NOT SET',
    CROSSWORD_KV: env.CROSSWORD_KV ? 'bound' : 'NOT BOUND',
    SYNC_USERS: `${extraUsers(env).length} extra key(s)`,
    GOOGLE_SIGN_IN: accessConfigured(env) ? 'configured' : 'not configured (ACCESS_TEAM_DOMAIN / ACCESS_AUD)',
    ACCESS_USERS: `${Object.keys(accessUsers(env)).length} linked account(s)`,
    other_names_visible: Object.keys(env).filter(k => !KNOWN.includes(k)),
  }, null, 2), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
