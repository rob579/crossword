// ipuz crossword parser.
// Produces a normalised model the solver understands:
//   { title, author, copyright, notes, width, height, hasSolution,
//     cells:   [{ r, c, block, void, label, circle, bars, color, solution, given }],
//     entries: { [id]: { id, dir, number, cells: [idx...] } },
//     clues:   { across: [clue], down: [clue] },   clue = { id, number, text, enumeration, entryIds }
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
      if (style.shapebg === 'circle') cell.circle = true;
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
      let number = null, text = '', enumeration = null, continued = [], cellList = null;
      if (Array.isArray(item)) { number = item[0]; text = item[1]; }
      else if (item && typeof item === 'object') {
        number = item.number ?? item.label ?? null;
        text = item.clue ?? item.text ?? '';
        enumeration = item.enumeration ?? null;
        continued = item.continued || [];
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
        text: String(text ?? ''),
        enumeration: enumeration != null ? String(enumeration) : null,
        entryIds,
      });
    });
  }

  // Entries with no clue still get a placeholder so navigation works.
  for (const e of Object.values(entries)) {
    if (!clues[e.dir].some(cl => cl.entryIds[0] === e.id)) {
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

// Flip the given cells between black and white, then renumber the grid
// conventionally. Returns the updated ipuz text.
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
