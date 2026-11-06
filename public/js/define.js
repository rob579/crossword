// Dictionary lookups for finished answers.
// Tries the Free Dictionary API (clean, structured), then Wiktionary (much wider coverage:
// obscure words, plurals, phrases, proper nouns – the stuff crosswords love).
// Returns { term, source, url, senses: [{ pos, defs: [text] }] } or null when nothing was found.

const cache = new Map();
const MAX_POS = 4, MAX_DEFS = 5;

async function getJson(url, ms = 8000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { Accept: 'application/json' } });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

const textOf = html => {
  const doc = new DOMParser().parseFromString(`<div>${html || ''}</div>`, 'text/html');
  return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
};

async function freeDictionary(term) {
  const data = await getJson(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(term)}`);
  if (!Array.isArray(data) || !data.length) return null;
  const byPos = new Map();
  for (const entry of data) for (const m of entry.meanings || []) {
    const list = byPos.get(m.partOfSpeech || '') || [];
    for (const d of m.definitions || []) if (d.definition && list.length < MAX_DEFS) list.push(d.definition);
    byPos.set(m.partOfSpeech || '', list);
  }
  const senses = [...byPos].filter(([, defs]) => defs.length).slice(0, MAX_POS).map(([pos, defs]) => ({ pos, defs }));
  return senses.length ? { term: data[0].word || term, source: 'Free Dictionary', url: wiktionaryUrl(term), senses } : null;
}

async function wiktionary(term) {
  const variants = [...new Set([term, term[0].toUpperCase() + term.slice(1), term.replace(/\b\w/g, c => c.toUpperCase())])];
  for (const v of variants) {
    const data = await getJson(`https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(v.replace(/ /g, '_'))}`);
    const en = data?.en;
    if (!Array.isArray(en) || !en.length) continue;
    const senses = [];
    for (const s of en) {
      const defs = (s.definitions || []).map(d => textOf(d.definition)).filter(Boolean).slice(0, MAX_DEFS);
      if (defs.length) senses.push({ pos: (s.partOfSpeech || '').toLowerCase(), defs });
      if (senses.length >= MAX_POS) break;
    }
    if (senses.length) return { term: v, source: 'Wiktionary', url: wiktionaryUrl(v), senses };
  }
  return null;
}

export const wiktionaryUrl = term => `https://en.wiktionary.org/wiki/${encodeURIComponent(term.replace(/ /g, '_'))}`;
export const googleUrl = term => `https://www.google.com/search?q=${encodeURIComponent(`define ${term}`)}`;

// Look one term up. Throws only if every source failed to answer (e.g. offline).
export async function lookup(term) {
  term = term.trim().toLowerCase();
  if (cache.has(term)) return cache.get(term);
  let failed = 0, res = null;
  for (const src of [freeDictionary, wiktionary]) {
    try { res = await src(term); } catch { failed++; continue; }
    if (res) break;
  }
  if (!res && failed === 2) throw new Error('Dictionary not reachable');
  cache.set(term, res);
  return res;
}

// "ONEQUARTER" + breaks after 3 → "one quarter"; hyphen breaks → "rock-hard".
export function answerPhrase(letters, breaks = []) {
  let out = '';
  [...letters].forEach((ch, i) => {
    const b = breaks.find(x => x.after === i);
    if (b) out += b.type === 'hyphen' ? '-' : ' ';
    out += ch;
  });
  return out.toLowerCase();
}
