import { json } from '../../lib/util.js';

// GET /api/whoami – who is this request from?
//   user:  library name ('' = the original library)
//   email: Google email when signed in with Google
//   via:   'google' or 'key'
export async function onRequestGet({ data }) {
  return json({ user: data.user || '', email: data.email || '', via: data.via || 'key' });
}
