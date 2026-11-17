// ipuz crossword parser.
// Produces a normalised model the solver understands:
//   { title, author, copyright, notes, width, height, hasSolution,
//     cells:   [{ r, c, block, void, label, circle, bars, color, solution, given }],
//     entries: { [id]: { id, dir, number, cells: [idx...] } },
//     clues:   { across: [clue], down: [clue] },   clue = { id, number, label, text, enumeration, entryIds, seeOf }
//              (a linked clue such as "14, 16" lists every entry in entryIds; its "See 14" clues have
//               no entries of their own and point to it with seeOf)
//     cellEntries: [{ across: entryId|null, down: entryId|null }] }

export function parseIpuz(text) {
  let t = String(text).trim();
  // Some sites wrap ipuz in JSONP: ipuz({...})
  if (!t.startsWith('{')) {
    const s = t.indexOf('{');
    const e = t.lastIndexOf('}');
    if (s < 0 || e < s) throw new Error("This doesn't look like an ipuz file.");
    t = t.slice(s, e + 1);
  }
  let d;
  try { d = JSON.parse(t); } catch { throw new Error("Couldn't read the file as ipuz (invalid JSON)."); }

  const kinds = [].concat(d.kind || []);
  if (kinds.length && !kinds.some(k => /crossword/i.test(String(k)))) {
    throw new Error('This ipuz file is not a crossword (kind: ' + kinds.join(', ') + ').');
  }
  if (!Array.isArray(d.puzzle)) throw new Error('ipuz file has no puzzle grid.');

  const height = d.dimensions?.height ?? d.puzzle.length;
  const width = d.dimensions?.width ?? Math.max(...d.puzzle.map(r => r.length));
  const blockVal = String(d.block ?? '#');
  const emptyVal = String(d.empty ?? 0);
  const styles = d.styles || {};

  const resolveStyle = s => (typeof s === 'string' ? styles[s] || {} : s || {});
  const unwrap = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : { cell: v });

  const cells = [];
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const raw = d.puzzle[r]?.[c];
      const o = unwrap(raw);
      const style = resolveStyle(o.style);
      const v = o.cell;
      const cell = { r, c, block: false, void: false, label: null, circle: false, bars: '', color: null, solution: null, given: null };
      if (raw === null || raw === undefined || v === null) cell.void = true;
      else if (String(v) === blockVal) cell.block = true;
      else if (String(v) !== emptyVal && String(v) !== '' && String(v) !== '0') cell.label = String(v);
      if (o.value && !cell.block && !cell.void) cell.given = String(o.value).toUpperCase();
      if (/circle/i.test(String(style.shapebg || ''))) cell.circle = true;
      if (typeof style.barred === 'string') cell.bars = style.barred.toUpperCase();
      if (style.color != null && !cell.block) {
        const col = String(style.color);
        cell.color = /^[0-9a-f]{6}$/i.test(col) ? '#' + col : col;
      }
      cells.push(cell);
    }
  }

  // Solution
  let hasSolution = false;
  if (Array.isArray(d.solution)) {
    for (let r = 0; r < height; r++) {
      for (let c = 0; c < width; c++) {
        let s = d.solution[r]?.[c];
        if (s && typeof s === 'object') s = s.value ?? s.cell;
        const cell = cells[r * width + c];
        if (s == null || cell.block || cell.void) continue;
        s = String(s);
        if (s === blockVal || s === '' || s === emptyVal) continue;
        cell.solution = s.toUpperCase();
        hasSolution = true;
      }
    }
  }

  // Previously saved state embedded in the file
  const saved = {};
  if (Array.isArray(d.saved)) {
    for (let r = 0; r < height; r++) {
      for (let c = 0; c < width; c++) {
        let s = d.saved[r]?.[c];
        if (s && typeof s === 'object') s = s.value ?? s.cell;
        const cell = cells[r * width + c];
        if (s == null || cell.block || cell.void) continue;
        s = String(s);
        if (/^[A-Za-z0-9]$/.test(s)) saved[r * width + c] = s.toUpperCase();
      }
    }
  }

  // --- Words ---
  const idx = (r, c) => r * width + c;
  const open = (r, c) => r >= 0 && c >= 0 && r < height && c < width && !cells[idx(r, c)].block && !cells[idx(r, c)].void;
  // bar between (r,c) and the next cell in direction
  const barAfter = (r, c, dir) => {
    if (dir === 'across') return cells[idx(r, c)].bars.includes('R') || (c + 1 < width && cells[idx(r, c + 1)].bars.includes('L'));
    return cells[idx(r, c)].bars.includes('B') || (r + 1 < height && cells[idx(r + 1, c)].bars.includes('T'));
  };

  const words = []; // {dir, start, cells}
  for (const dir of ['across', 'down']) {
    const [dr, dc] = dir === 'across' ? [0, 1] : [1, 0];
    for (let r = 0; r < height; r++) {
      for (let c = 0; c < width; c++) {
        if (!open(r, c)) continue;
        const pr = r - dr, pc = c - dc;
        const startsHere = !open(pr, pc) || barAfter(pr, pc, dir);
        if (!startsHere) continue;
        const list = [idx(r, c)];
        let rr = r, cc = c;
        while (!barAfter(rr, cc, dir) && open(rr + dr, cc + dc)) { rr += dr; cc += dc; list.push(idx(rr, cc)); }
        if (list.length >= 2) words.push({ dir, start: idx(r, c), cells: list });
      }
    }
  }

  // Numbering: use labels from the file; if there are none, number the grid conventionally.
  const anyLabels = cells.some(c => c.label);
  if (!anyLabels) {
    const starts = [...new Set(words.map(w => w.start))].sort((a, b) => a - b);
    starts.forEach((s, i) => { cells[s].label = String(i + 1); });
  }

  const entries = {};
  const cellEntries = cells.map(() => ({ across: null, down: null }));
  const byNumber = { across: {}, down: {} };
  for (const w of words) {
    const number = cells[w.start].label ?? `${w.dir[0]}${w.start}`;
    const id = `${w.dir === 'across' ? 'A' : 'D'}${number}`;
    if (entries[id]) continue; // duplicate label, keep first
    entries[id] = { id, dir: w.dir, number, cells: w.cells };
    byNumber[w.dir][number] = id;
    for (const ci of w.cells) cellEntries[ci][w.dir] = id;
  }

  // --- Clues ---
  const clues = { across: [], down: [] };
  const clueSrc = d.clues || {};
  for (const key of Object.keys(clueSrc)) {
    const dir = key.split(':')[0].trim().toLowerCase();
    if (dir !== 'across' && dir !== 'down') continue;
    const list = clueSrc[key] || [];
    list.forEach((item, i) => {
      let number = null, text = '', enumeration = null, continued = [], cellList = null, label = null, see = null;
      if (Array.isArray(item)) { number = item[0]; text = item[1]; }
      else if (item && typeof item === 'object') {
        number = item.number ?? item.label ?? null;
        label = item.label != null ? String(item.label) : null;
        text = item.clue ?? item.text ?? '';
        enumeration = item.enumeration ?? null;
        continued = [].concat(item.continued || []);
        see = item.see && typeof item.see === 'object' ? item.see : null;
        cellList = item.cells || null;
      } else if (typeof item === 'string') { text = item; }
      if (text && typeof text === 'object') text = text.text ?? JSON.stringify(text);
      number = number == null ? null : String(number);

      const entryIds = [];
      let primary = number != null ? byNumber[dir][number] : null;
      if (!primary && number == null) {
        // unnumbered: map by position
        const ordered = words.filter(w => w.dir === dir);
        const w = ordered[i];
        if (w) primary = byNumber[dir][cells[w.start].label];
      }
      if (!primary && Array.isArray(cellList) && cellList.length) {
        const zeroBased = cellList.some(([x, y]) => x === 0 || y === 0);
        const ids = cellList.map(([x, y]) => zeroBased ? idx(y, x) : idx(y - 1, x - 1)).filter(n => n >= 0 && n < cells.length);
        const id = `${dir === 'across' ? 'A' : 'D'}${number ?? 'x' + i}`;
        if (!entries[id] && ids.length) {
          entries[id] = { id, dir, number: number ?? '', cells: ids };
          for (const ci of ids) if (!cellEntries[ci][dir]) cellEntries[ci][dir] = id;
          primary = id;
        }
      }
      if (primary) entryIds.push(primary);
      for (const cont of continued) {
        const cdir = String(cont.direction || dir).toLowerCase().split(':')[0];
        const cid = byNumber[cdir]?.[String(cont.number)];
        if (cid) entryIds.push(cid);
      }
      clues[dir].push({
        id: `${dir}-${number ?? i}-${i}`,
        dir,
        number: number ?? '',
        label,
        text: String(text ?? ''),
        enumeration: enumeration != null ? String(enumeration) : null,
        entryIds,
        see,
      });
    });
  }

  // "See 14" clues (a "see" reference, or just that text): the squares belong to the linked clue.
  // Add them to that clue if its "continued" didn't already, and keep the See clue only as a
  // pointer in the list (seeOf), so typing and highlighting treat the whole answer as one.
  for (const dir of ['across', 'down']) {
    for (const cl of clues[dir]) {
      let ref = cl.see;
      if (!ref) {
        const m = cl.text.replace(/<[^>]*>/g, '').match(/^\s*see\s+(\d+)\s*-?\s*(across|down|a|d)?\b/i);
        if (m) ref = { number: m[1], direction: m[2] ? (m[2][0].toLowerCase() === 'a' ? 'across' : 'down') : dir };
      }
      if (!ref) continue;
      const tdir = String(ref.direction || dir).toLowerCase().split(':')[0];
      const target = clues[tdir]?.find(t => t !== cl && !t.see && String(t.number) === String(ref.number) && t.entryIds.length);
      if (!target) continue;
      for (const eid of cl.entryIds) if (!target.entryIds.includes(eid)) target.entryIds.push(eid);
      cl.entryIds = [];
      cl.seeOf = target.id;
    }
  }
  for (const dir of ['across', 'down']) for (const cl of clues[dir]) delete cl.see;

  // Entries with no clue still get a placeholder so navigation works.
  for (const e of Object.values(entries)) {
    if (!clues[e.dir].some(cl => cl.entryIds.includes(e.id)) && !clues[e.dir === 'across' ? 'down' : 'across'].some(cl => cl.entryIds.includes(e.id))) {
      clues[e.dir].push({ id: `${e.dir}-${e.number}-auto`, dir: e.dir, number: e.number, text: '', enumeration: null, entryIds: [e.id] });
    }
  }
  const numSort = (a, b) => (parseInt(a.number, 10) || 0) - (parseInt(b.number, 10) || 0);
  clues.across.sort(numSort);
  clues.down.sort(numSort);

  const stripHtml = s => String(s || '').replace(/<[^>]*>/g, '').trim();
  return {
    title: stripHtml(d.title) || 'Untitled crossword',
    author: stripHtml(d.author),
    date: stripHtml(d.date),
    publisher: stripHtml(d.publisher),
    copyright: stripHtml(d.copyright),
    notes: stripHtml(d.notes || d.intro),
    width, height, hasSolution, cells, entries, clues, cellEntries, saved,
  };
}

// Allow a few inline formatting tags in clues; escape everything else.
export function clueHtml(text) {
  const esc = String(text).replace(/&(?![a-z]+;|#\d+;)/gi, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc.replace(/&lt;(\/?)(i|b|em|strong|sub|sup|u)&gt;/gi, '<$1$2>');
}

// Work out where an answer splits, from an enumeration like "3,4", "(2-5)" or
// from the end of the clue text, e.g. "Some clue (3,4)".
// Returns { total, breaks: [{ after, type: 'word' | 'hyphen' }] } or null.
export function parseEnumeration(clue) {
  let src = clue.enumeration;
  if (!src) {
    const m = String(clue.text || '').replace(/<[^>]*>/g, '').trim().match(/\(([^()]*\d[^()]*)\)\s*$/);
    if (!m) return null;
    src = m[1];
  }
  src = String(src).replace(/^\(|\)$/g, '').replace(/words?/gi, '').trim();
  if (!/^\d/.test(src)) return null;
  const parts = src.split(/(\d+)/); // ['', '3', ',', '4', '']
  const breaks = [];
  let total = 0;
  for (let i = 1; i < parts.length; i += 2) {
    total += parseInt(parts[i], 10);
    const sep = parts[i + 1] || '';
    if (i + 2 >= parts.length) break; // nothing after the last number
    if (sep.includes('-')) breaks.push({ after: total, type: 'hyphen' });
    else if (/[,\s.\/]/.test(sep)) breaks.push({ after: total, type: 'word' });
  }
  return { total, breaks };
}

// ---- Puzzle dates ----
// The ipuz spec writes dates as mm/dd/yyyy; files in the wild also use yyyy-mm-dd or dd/mm/yyyy.
// Returns { y, m, d } or null when the text isn't a recognisable date.
export function parsePuzzleDate(s) {
  s = String(s || '').trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/);
  if (m) {
    const a = +m[1], b = +m[2], y = +m[3];
    // mm/dd/yyyy as the spec says, unless the first number can't be a month
    return a > 12 ? valid(y, b, a) : valid(y, a, b);
  }
  return null;
  function valid(y, mo, d) {
    const dt = new Date(Date.UTC(y, mo - 1, d));
    return dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? { y, m: mo, d } : null;
  }
}
// "Thu 23 Oct 2026" for display; any other text is shown as it is.
export function formatPuzzleDate(s) {
  const p = parsePuzzleDate(s);
  if (!p) return String(s || '').trim();
  return new Date(Date.UTC(p.y, p.m - 1, p.d)).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
const pad = n => String(n).padStart(2, '0');
// yyyy-mm-dd for an <input type="date">, or '' if the date can't be read.
export function puzzleDateToIso(s) { const p = parsePuzzleDate(s); return p ? `${p.y}-${pad(p.m)}-${pad(p.d)}` : ''; }
// yyyy-mm-dd (from a date input) to the spec's mm/dd/yyyy.
export function isoToPuzzleDate(iso) { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? `${m[2]}/${m[3]}/${m[1]}` : ''; }

// Change the title, setter, publication and/or date. Each of info.title / author / publisher / date that is a
// string replaces the file's value (an empty string removes it). Returns the updated ipuz text.
export function editInfo(raw, info) {
  let t = String(raw).trim();
  if (!t.startsWith('{')) t = t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1);
  const d = JSON.parse(t);
  for (const k of ['title', 'author', 'publisher', 'date']) {
    if (typeof info[k] !== 'string') continue;
    const v = info[k].trim();
    if (v) d[k] = v; else delete d[k];
  }
  return JSON.stringify(d);
}

// Flip the given cells between black and white, then renumber the grid
// conventionally. Returns the updated ipuz text.
// Add or remove the circle in each listed square (shapebg: "circle" in the cell's style).
export function editCircles(raw, idxs) {
  let t = String(raw).trim();
  if (!t.startsWith('{')) t = t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1);
  const d = JSON.parse(t);
  const width = d.dimensions?.width ?? Math.max(...d.puzzle.map(r => r.length));
  const styles = d.styles || {};
  for (const i of idxs) {
    const r = Math.floor(i / width), c = i % width;
    const row = d.puzzle[r];
    if (!row || row[c] === null || row[c] === undefined) continue;
    const o = row[c] && typeof row[c] === 'object' && !Array.isArray(row[c]) ? row[c] : { cell: row[c] };
    // a named style is copied into the cell, so other squares using it don't change
    const style = typeof o.style === 'string' ? { ...(styles[o.style] || {}) } : { ...(o.style || {}) };
    if (/circle/i.test(String(style.shapebg || ''))) delete style.shapebg; else style.shapebg = 'circle';
    if (Object.keys(style).length) o.style = style; else delete o.style;
    row[c] = Object.keys(o).length === 1 && 'cell' in o ? o.cell : o;
  }
  return JSON.stringify(d);
}

export function editGrid(raw, flips) {
  let t = String(raw).trim();
  if (!t.startsWith('{')) t = t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1);
  const d = JSON.parse(t);
  const width = d.dimensions?.width ?? Math.max(...d.puzzle.map(r => r.length));
  const block = d.block ?? '#';
  const empty = d.empty ?? 0;
  const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
  const getV = (r, c) => (isObj(d.puzzle[r][c]) ? d.puzzle[r][c].cell : d.puzzle[r][c]);
  const setV = (r, c, v) => { if (isObj(d.puzzle[r][c])) d.puzzle[r][c].cell = v; else d.puzzle[r][c] = v; };

  for (const i of flips) {
    const r = Math.floor(i / width), c = i % width;
    const v = getV(r, c);
    if (v === null || v === undefined) continue; // outside the grid shape
    const nowBlock = String(v) === String(block);
    setV(r, c, nowBlock ? empty : block);
    if (Array.isArray(d.solution) && d.solution[r]) d.solution[r][c] = nowBlock ? null : block;
    if (Array.isArray(d.saved) && d.saved[r]) d.saved[r][c] = nowBlock ? empty : block;
  }

  // Renumber: clear every label, let the parser number the grid, copy the numbers back.
  const height = d.puzzle.length;
  for (let r = 0; r < height; r++) for (let c = 0; c < d.puzzle[r].length; c++) {
    const v = getV(r, c);
    if (v !== null && v !== undefined && String(v) !== String(block)) setV(r, c, empty);
  }
  const model = parseIpuz(JSON.stringify(d));
  model.cells.forEach((cell, i) => {
    if (cell.block || cell.void) return;
    const r = Math.floor(i / width), c = i % width;
    if (cell.label) setV(r, c, Number(cell.label));
  });
  return JSON.stringify(d);
}
