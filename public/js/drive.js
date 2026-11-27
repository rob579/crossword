// Get new puzzles from a Google Drive folder.
// Runs entirely in the browser: no sync server and no sign-in are involved, so anyone can point
// it at their own folder. The folder must be shared as "Anyone with the link" (view).
//
// Drive's API needs an API key even for public folders. Put the key below. It is visible to
// anyone who views the page, so restrict it in Google Cloud (see README: Drive folder setup)
// to the Drive API only, and to this site's addresses only.

export const DRIVE_API_KEY = 'AIzaSyD1FtpuQwBKrwVWluIMPQ610_rA8xAJFEI';

const API = 'https://www.googleapis.com/drive/v3/files';
const MAX_BYTES = 2 * 1024 * 1024; // a crossword is a few KB; skip anything much bigger
const KEY_FOLDER = 'cw.driveFolder';
const KEY_SEEN = 'cw.driveSeen';
const KEY_LAST = 'cw.driveLast';

const read = k => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
const write = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

export const driveConfigured = () => !!DRIVE_API_KEY;

// The folder link as the person pasted it (kept on this device only)
export const driveFolder = { get: () => read(KEY_FOLDER), set: v => write(KEY_FOLDER, String(v || '').trim()) };
export const driveLast = { get: () => read(KEY_LAST), set: () => write(KEY_LAST, new Date().toISOString()) };

// Files already fetched on this device, so a puzzle you delete doesn't come back next time
function seenSet() { try { return new Set(JSON.parse(read(KEY_SEEN) || '[]')); } catch { return new Set(); } }
export const driveSeen = {
  has: id => seenSet().has(id),
  size: () => seenSet().size,
  add(id) { const s = seenSet(); s.add(id); write(KEY_SEEN, JSON.stringify([...s])); },
};

// Accepts a share link (…/folders/ID, …?id=ID) or a bare folder ID; returns the ID or ''
export function folderIdFrom(text) {
  const t = String(text || '').trim();
  const m = t.match(/\/folders\/([A-Za-z0-9_-]{10,})/) || t.match(/[?&]id=([A-Za-z0-9_-]{10,})/) || t.match(/^([A-Za-z0-9_-]{20,})$/);
  return m ? m[1] : '';
}

async function failure(res) {
  let reason = '';
  try { reason = (await res.json())?.error?.message || ''; } catch {}
  if (res.status === 404) return new Error('Couldn\'t find that folder. Check the link, and that it is shared as "Anyone with the link".');
  if (res.status === 400) return new Error('That doesn\'t look like a Google Drive folder link.');
  if (res.status === 403) return new Error(`Google refused the request${reason ? ` (${reason})` : ''}. The folder may be private, or this site's API key isn't allowed here.`);
  return new Error(`Google Drive returned an error (${res.status}).`);
}

async function get(url) {
  let res;
  try { res = await fetch(url); } catch { throw new Error('Couldn\'t reach Google Drive. Check your connection.'); }
  if (!res.ok) throw await failure(res);
  return res;
}

// The .ipuz files directly inside the folder, oldest first (so a puzzle arrives before its answers file)
export async function listFolder(folderId) {
  if (!DRIVE_API_KEY) throw new Error('Not set up yet: this site needs a Google API key.');
  const out = [];
  let pageToken = '';
  do {
    const p = new URLSearchParams({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'nextPageToken,files(id,name,size,mimeType,modifiedTime)',
      orderBy: 'modifiedTime,name',
      pageSize: '200',
      key: DRIVE_API_KEY,
    });
    if (pageToken) p.set('pageToken', pageToken);
    const data = await (await get(`${API}?${p}`)).json();
    for (const f of data.files || []) {
      if (!/\.ipuz$/i.test(f.name || '')) continue;
      if (f.size && +f.size > MAX_BYTES) continue;
      out.push({ id: f.id, name: f.name });
    }
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return out;
}

export async function fetchFileText(fileId) {
  const p = new URLSearchParams({ alt: 'media', key: DRIVE_API_KEY });
  return (await get(`${API}/${encodeURIComponent(fileId)}?${p}`)).text();
}
