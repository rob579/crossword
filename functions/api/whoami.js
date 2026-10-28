import { json } from '../../lib/util.js';

// GET /api/whoami – which sync key is this? ('' = the original key)
export async function onRequestGet({ data }) {
  return json({ user: data.user || '' });
}
