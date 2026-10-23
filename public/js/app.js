import { parseIpuz, clueHtml, parseEnumeration, editGrid } from './ipuz.js';
import { local, puzzleId, syncAll, pullProgress, pushProgress, deleteRemote, uploadPuzzle, onSyncStatus, testToken, filledCount } from './store.js';
import { createAnagrammer } from './anagram.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const isTouch = matchMedia('(pointer: coarse)').matches;
document.body.classList.toggle('touch', isTouch);

// ======================================================================
// Toast
// ======================================================================
let toastTimer;
function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

// ======================================================================
// Library
// ======================================================================
function openCellCount(model) { return model.cells.filter(c => !c.block && !c.void).length; }

function renderLibrary() {
  const list = $('#lib-list');
  const all = Object.entries(local.puzzles())
    .map(([id, rec]) => ({ id, ...rec }))
    .sort((a, b) => (b.lastOpened || b.added || 0) - (a.lastOpened || a.added || 0));
  $('#lib-empty').hidden = all.length > 0;
  list.innerHTML = '';
  for (const p of all) {
    const meta = p.meta || {};
    const total = meta.cells || 1;
    const filled = filledCount(local.getProgress(p.id));
    const pct = Math.min(100, Math.round((filled / total) * 100));
    const card = document.createElement('div');
    card.className = 'lib-card';
    card.innerHTML = `
      <button class="lib-open" data-id="${p.id}">
        <span class="lib-title"></span>
        <span class="lib-meta"></span>
        <span class="lib-progress"><span style="width:${pct}%"></span></span>
        <span class="lib-pct">${meta.solved ? 'Solved ✓' : pct ? pct + '% filled' : 'Not started'}</span>
      </button>
      <button class="lib-del icon-btn" data-del="${p.id}" aria-label="Delete puzzle" title="Delete">✕</button>`;
    $('.lib-title', card).textContent = meta.title || 'Untitled';
    $('.lib-meta', card).textContent = [meta.author, meta.width && `${meta.width}×${meta.height}`].filter(Boolean).join(' · ');
    if (meta.solved) card.classList.add('solved');
    list.appendChild(card);
  }
}

$('#lib-list').addEventListener('click', e => {
  const del = e.target.closest('[data-del]');
  if (del) {
    const id = del.dataset.del;
    const title = local.getPuzzle(id)?.meta?.title || 'this puzzle';
    if (confirm(`Delete "${title}" and its progress from all your devices?`)) {
      local.deletePuzzle(id);
      deleteRemote(id);
      renderLibrary();
    }
    return;
  }
  const open = e.target.closest('[data-id]');
  if (open) location.hash = `#/p/${open.dataset.id}`;
});

async function importFiles(files) {
  let lastId = null, added = 0;
  for (const file of files) {
    try {
      const raw = await file.text();
      const model = parseIpuz(raw);
      const id = await puzzleId(raw);
      if (local.getPuzzle(id)) { toast(`"${model.title}" is already in your library`); lastId = id; continue; }
      const meta = { title: model.title, author: model.author, width: model.width, height: model.height, cells: openCellCount(model), added: Date.now() };
      local.putPuzzle(id, { raw, meta, added: meta.added });
      // seed progress from any state saved in the file / pre-filled cells
      const cells = {};
      model.cells.forEach((c, i) => { if (c.given) cells[i] = { v: c.given, t: 1 }; });
      for (const [i, v] of Object.entries(model.saved)) if (!cells[i]) cells[i] = { v, t: 1 };
      local.putProgress(id, { cells, updatedAt: 0, total: meta.cells });
      uploadPuzzle(id, { raw, meta });
      lastId = id; added++;
    } catch (err) {
      toast(`${file.name}: ${err.message}`, 5000);
    }
  }
  renderLibrary();
  if (files.length === 1 && lastId) location.hash = `#/p/${lastId}`;
  else if (added) toast(`Imported ${added} puzzle${added > 1 ? 's' : ''}`);
}

$('#file-input').addEventListener('change', e => { importFiles([...e.target.files]); e.target.value = ''; });
// drag & drop anywhere
window.addEventListener('dragover', e => { e.preventDefault(); document.body.classList.add('dragging'); });
window.addEventListener('dragleave', e => { if (!e.relatedTarget) document.body.classList.remove('dragging'); });
window.addEventListener('drop', e => {
  e.preventDefault();
  document.body.classList.remove('dragging');
  const files = [...(e.dataTransfer?.files || [])];
  if (files.length) importFiles(files);
});

// ======================================================================
// Solver
// ======================================================================
let cur = null; // { id, model, progress, sel, wrong:Set, cellEls, entryClue, wasFull }

function openPuzzle(id) {
  const rec = local.getPuzzle(id);
  if (!rec) {
    if (local.token()) {
      syncAll().then(() => { if (local.getPuzzle(id) && location.hash.includes(id)) openPuzzle(id); else { toast('Puzzle not found'); location.hash = ''; } });
    } else { toast('Puzzle not found'); location.hash = ''; }
    return;
  }
  let model;
  try { model = parseIpuz(rec.raw); } catch (e) { toast(e.message); location.hash = ''; return; }

  const entryClue = {};
  for (const dir of ['across', 'down']) for (const cl of model.clues[dir]) if (cl.entryIds[0] && !entryClue[cl.entryIds[0]]) entryClue[cl.entryIds[0]] = cl;
  for (const dir of ['across', 'down']) for (const cl of model.clues[dir]) for (const eid of cl.entryIds) if (!entryClue[eid]) entryClue[eid] = cl;

  const progress = local.getProgress(id);
  const total = openCellCount(model);
  cur = { id, raw: rec.raw, editing: null, model, progress, total, wrong: new Set(), entryClue, cellEls: [], wasFull: false, sel: null };

  // restore selection
  const firstClue = model.clues.across.find(c => c.entryIds.length) || model.clues.down.find(c => c.entryIds.length);
  let s = null;
  try { s = JSON.parse(localStorage.getItem(`cw.sel.${id}`) || 'null'); } catch {}
  if (s && model.cells[s.cell] && model.cellEntries[s.cell]?.[s.dir]) cur.sel = { ...s };
  else if (firstClue) cur.sel = { cell: model.entries[firstClue.entryIds[0]].cells[0], dir: firstClue.dir };
  else cur.sel = { cell: model.cells.findIndex(c => !c.block && !c.void), dir: 'across' };

  local.putPuzzle(id, { lastOpened: Date.now() });

  $('#puz-title').textContent = model.title;
  $('#puz-author').textContent = [model.author, model.copyright].filter(Boolean).join(' · ');
  $('#puz-notes').hidden = !model.notes;
  $('#puz-notes').title = model.notes || '';
  for (const el of $$('[data-needs-solution]')) el.disabled = !model.hasSolution;

  buildGrid();
  buildClues();
  showView('solver');
  sizeGrid();
  cur.wasFull = filledCount(progress) >= total;
  update();

  pullProgress(id).then(merged => { if (merged && cur?.id === id) { cur.progress = local.getProgress(id); paintLetters(); } });
}

function closePuzzle() {
  if (cur?.editing) stopEditGrid();
  if (cur) flushPush();
  cur = null;
  closeClueSheet();
}

function buildGrid() {
  const { model } = cur;
  const grid = $('#grid');
  grid.innerHTML = '';
  grid.style.setProperty('--w', model.width);
  grid.style.setProperty('--h', model.height);
  grid.classList.remove('solved');
  cur.cellEls = model.cells.map((c, i) => {
    const el = document.createElement('div');
    el.className = 'cell';
    el.dataset.i = i;
    if (c.block) el.classList.add('block');
    else if (c.void) el.classList.add('void');
    else {
      if (c.label) { const n = document.createElement('span'); n.className = 'num'; n.textContent = c.label; el.appendChild(n); }
      const l = document.createElement('span'); l.className = 'ltr'; el.appendChild(l);
      if (c.circle) { const o = document.createElement('span'); o.className = 'circ'; el.appendChild(o); }
      if (c.color) el.style.setProperty('--cell-tint', c.color);
      if (c.bars) {
        const sh = [];
        if (c.bars.includes('T')) sh.push('inset 0 var(--bar) 0 0 var(--bar-color)');
        if (c.bars.includes('B')) sh.push('inset 0 calc(-1 * var(--bar)) 0 0 var(--bar-color)');
        if (c.bars.includes('L')) sh.push('inset var(--bar) 0 0 0 var(--bar-color)');
        if (c.bars.includes('R')) sh.push('inset calc(-1 * var(--bar)) 0 0 0 var(--bar-color)');
        const b = document.createElement('span'); b.className = 'bars'; b.style.boxShadow = sh.join(', ');
        el.appendChild(b);
      }
    }
    grid.appendChild(el);
    return el;
  });
  addWordBreaks();
  paintLetters();
}

// Thick line between words (3,4) and a small dash for hyphens (3-4).
function addWordBreaks() {
  const { model, cellEls } = cur;
  for (const dir of ['across', 'down']) {
    for (const cl of model.clues[dir]) {
      if (!cl.entryIds.length) continue;
      const en = parseEnumeration(cl);
      if (!en || !en.breaks.length) continue;
      const cells = cl.entryIds.flatMap(id => model.entries[id]?.cells || []);
      if (en.total !== cells.length) continue; // lengths don't match the grid: don't guess
      const firstDir = model.entries[cl.entryIds[0]].dir;
      for (const b of en.breaks) {
        const ci = cells[b.after - 1];
        // which direction is this cell's word going (linked clues can change direction)
        const entry = cl.entryIds.map(id => model.entries[id]).find(e => e.cells.includes(ci));
        const d = entry?.dir || firstDir;
        // skip if the split falls at the end of one linked part (the grid already shows it)
        if (entry && entry.cells[entry.cells.length - 1] === ci) continue;
        const mark = document.createElement('span');
        mark.className = `${b.type === 'hyphen' ? 'hyph' : 'wbrk'} ${d === 'across' ? 'r' : 'b'}`;
        cellEls[ci].appendChild(mark);
      }
    }
  }
}

function paintLetters() {
  const { model, progress, cellEls } = cur;
  model.cells.forEach((c, i) => {
    if (c.block || c.void) return;
    const p = progress.cells[i];
    const el = cellEls[i];
    el.querySelector('.ltr').textContent = p?.v || '';
    el.classList.toggle('revealed', p?.f === 'r' && !!p.v);
    el.classList.toggle('wrong', cur.wrong.has(i));
  });
  checkComplete(false);
}

function buildClues() {
  for (const dir of ['across', 'down']) {
    const ol = $(`#clues-${dir}`);
    ol.innerHTML = '';
    for (const cl of cur.model.clues[dir]) {
      const li = document.createElement('li');
      li.className = 'clue';
      li.dataset.clue = cl.id;
      const enumTxt = cl.enumeration && !hasEnum(cl.text) ? ` <span class="enum">(${clueHtml(cl.enumeration)})</span>` : '';
      li.innerHTML = `<span class="clue-num">${clueHtml(cl.number)}</span><span class="clue-text">${clueHtml(cl.text) || '<em class="muted">—</em>'}${enumTxt}</span>`;
      if (!cl.entryIds.length) li.classList.add('orphan');
      ol.appendChild(li);
    }
  }
}

// True if the clue text already ends with a length such as (5), (3,4), (2-5) or (4 words)
const hasEnum = text => /\(\s*\d+(?:\s*[-,.\s/]\s*\d+)*(?:\s*words?)?\s*\)\s*$/i.test(String(text).replace(/<[^>]*>/g, '').trim());

const clueById = id => [...cur.model.clues.across, ...cur.model.clues.down].find(c => c.id === id);
const entryAt = (cell, dir) => cur.model.entries[cur.model.cellEntries[cell]?.[dir]] || null;

function activeClue() {
  const e = entryAt(cur.sel.cell, cur.sel.dir);
  return e ? cur.entryClue[e.id] || null : null;
}
function activeWordCells() {
  const e = entryAt(cur.sel.cell, cur.sel.dir);
  if (!e) return [];
  const cl = cur.entryClue[e.id];
  if (cl && cl.entryIds.length > 1) return cl.entryIds.flatMap(id => cur.model.entries[id]?.cells || []);
  return e.cells;
}

function update() {
  if (!cur) return;
  const { sel, cellEls, model } = cur;
  const word = new Set(activeWordCells());
  cellEls.forEach((el, i) => {
    el.classList.toggle('word', word.has(i));
    el.classList.toggle('sel', i === sel.cell);
  });

  const cl = activeClue();
  const otherDir = sel.dir === 'across' ? 'down' : 'across';
  const cross = entryAt(sel.cell, otherDir);
  const crossClue = cross ? cur.entryClue[cross.id] : null;
  for (const li of $$('#clue-panel .clue')) {
    const on = cl && li.dataset.clue === cl.id;
    li.classList.toggle('active', !!on);
    li.classList.toggle('cross', !!(crossClue && li.dataset.clue === crossClue.id));
  }
  for (const id of [cl?.id, crossClue?.id]) {
    const li = id && $(`#clue-panel .clue[data-clue="${CSS.escape(id)}"]`);
    if (li) scrollIntoList(li);
  }

  // clue bar
  if (cl) {
    const len = activeWordCells().length;
    const enumTxt = cl.enumeration ? cl.enumeration : len;
    $('#cluebar-num').textContent = `${cl.number}${cl.dir === 'across' ? 'A' : 'D'}`;
    const showEnum = !hasEnum(cl.text);
    $('#cluebar-text').innerHTML = `${clueHtml(cl.text) || '<em class="muted">No clue</em>'}${showEnum ? ` <span class="enum">(${clueHtml(String(enumTxt))})</span>` : ''}`;
  } else {
    $('#cluebar-num').textContent = '';
    $('#cluebar-text').textContent = '';
  }
  try { localStorage.setItem(`cw.sel.${cur.id}`, JSON.stringify(sel)); } catch {}
  void model;
}

function scrollIntoList(li) {
  const list = li.closest('ol');
  if (!list || list.scrollHeight <= list.clientHeight) return;
  const top = li.offsetTop - list.offsetTop;
  if (top < list.scrollTop || top + li.offsetHeight > list.scrollTop + list.clientHeight) {
    list.scrollTo({ top: top - list.clientHeight / 3, behavior: 'smooth' });
  }
}

// ---- editing ----
let pushTimer = null;
function schedulePush() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => { if (cur) pushProgress(cur.id, { total: cur.total }); }, 4000);
}
function flushPush() {
  if (!cur || !pushTimer) return;
  clearTimeout(pushTimer);
  pushTimer = null;
  pushProgress(cur.id, { keepalive: true, total: cur.total });
}

function setCells(changes) {
  // changes: [[cellIndex, value, flag?]]
  const t = Date.now();
  for (const [i, v, f] of changes) {
    const c = cur.model.cells[i];
    if (!c || c.block || c.void) continue;
    const entry = { v, t };
    if (f) entry.f = f;
    cur.progress.cells[i] = entry;
    cur.wrong.delete(i);
  }
  cur.progress.updatedAt = t;
  cur.progress.total = cur.total;
  local.putProgress(cur.id, cur.progress);
  local.markDirty(cur.id);
  schedulePush();
  paintLetters();
}

const valueAt = i => cur.progress.cells[i]?.v || '';

function checkComplete(announce = true) {
  const { model, total } = cur;
  const filled = model.cells.reduce((n, c, i) => n + (!c.block && !c.void && valueAt(i) ? 1 : 0), 0);
  const full = filled >= total;
  let solved = false;
  if (full && model.hasSolution) solved = model.cells.every((c, i) => c.block || c.void || !c.solution || valueAt(i) === c.solution);
  $('#grid').classList.toggle('solved', solved);
  const rec = local.getPuzzle(cur.id);
  if (rec && !!rec.meta?.solved !== solved) local.putPuzzle(cur.id, { meta: { ...rec.meta, solved } });
  if (announce && full && !cur.wasFull) {
    if (!model.hasSolution) toast('Grid complete!');
    else if (solved) toast('🎉 Solved! Nicely done.', 4000);
    else toast("Grid's full, but something isn't right yet.", 3500);
  }
  if (announce) cur.wasFull = full;
}

function selectCell(i, dir) {
  const c = cur.model.cells[i];
  if (!c || c.block || c.void) return;
  cur.sel.cell = i;
  if (dir) cur.sel.dir = dir;
  if (!cur.model.cellEntries[i][cur.sel.dir]) {
    const other = cur.sel.dir === 'across' ? 'down' : 'across';
    if (cur.model.cellEntries[i][other]) cur.sel.dir = other;
  }
  update();
}

function toggleDir() {
  const other = cur.sel.dir === 'across' ? 'down' : 'across';
  if (cur.model.cellEntries[cur.sel.cell][other]) { cur.sel.dir = other; update(); }
}

function orderedClues() {
  return [...cur.model.clues.across, ...cur.model.clues.down].filter(c => c.entryIds.length);
}

function selectClue(cl) {
  const e = cur.model.entries[cl.entryIds[0]];
  const firstEmpty = e.cells.find(i => !valueAt(i));
  cur.sel = { cell: firstEmpty ?? e.cells[0], dir: e.dir };
  update();
}

function nextClue(step) {
  const list = orderedClues();
  if (!list.length) return;
  const cl = activeClue();
  let i = cl ? list.indexOf(cl) : -1;
  // when stepping forward, prefer clues that still have empty cells
  for (let n = 0; n < list.length; n++) {
    i = (i + step + list.length) % list.length;
    const cand = list[i];
    const hasEmpty = cand.entryIds.some(id => cur.model.entries[id].cells.some(c => !valueAt(c)));
    if (hasEmpty || n === list.length - 1 || allFilled()) { selectClue(cand); return; }
  }
}
const allFilled = () => cur.model.cells.every((c, i) => c.block || c.void || valueAt(i));

const prefs = {
  get skipFilled() { return localStorage.getItem('cw.skipFilled') === '1'; },
  set skipFilled(v) { localStorage.setItem('cw.skipFilled', v ? '1' : '0'); },
};

function typeLetter(ch) {
  const e = entryAt(cur.sel.cell, cur.sel.dir);
  // "skip filled" only applies while the word still has gaps; when overwriting a
  // complete word, step through it one square at a time as usual.
  const wordHadGaps = e && e.cells.some(i => i !== cur.sel.cell && !valueAt(i));
  setCells([[cur.sel.cell, ch]]);
  checkComplete(true);
  if (!e) return update();
  const k = e.cells.indexOf(cur.sel.cell);
  if (prefs.skipFilled && wordHadGaps) {
    // next empty square after this one, wrapping round to the start of the word
    const order = [...e.cells.slice(k + 1), ...e.cells.slice(0, k)];
    const next = order.find(i => !valueAt(i));
    if (next != null) { cur.sel.cell = next; update(); return; }
  }
  if (k < e.cells.length - 1 && !(prefs.skipFilled && wordHadGaps)) { cur.sel.cell = e.cells[k + 1]; update(); }
  else if (!allFilled()) nextClue(1);
  else update();
}

function backspace() {
  const i = cur.sel.cell;
  if (valueAt(i)) { setCells([[i, '']]); update(); return; }
  const e = entryAt(i, cur.sel.dir);
  if (!e) return;
  const k = e.cells.indexOf(i);
  if (k > 0) {
    cur.sel.cell = e.cells[k - 1];
    if (valueAt(cur.sel.cell)) setCells([[cur.sel.cell, '']]);
    update();
  }
}

function arrow(dr, dc) {
  const axis = dc ? 'across' : 'down';
  if (axis !== cur.sel.dir && cur.model.cellEntries[cur.sel.cell][axis]) { cur.sel.dir = axis; update(); return; }
  const { width, height, cells } = cur.model;
  let r = Math.floor(cur.sel.cell / width), c = cur.sel.cell % width;
  for (;;) {
    r += dr; c += dc;
    if (r < 0 || c < 0 || r >= height || c >= width) return;
    const cell = cells[r * width + c];
    if (!cell.block && !cell.void) { selectCell(r * width + c); return; }
  }
}

// grid click: select, or toggle direction if the selected cell is clicked again
$('#grid').addEventListener('click', e => {
  const el = e.target.closest('.cell');
  if (!el || !cur) return;
  const i = +el.dataset.i;
  if (cur.editing) {
    if (el.classList.contains('void')) return;
    if (cur.editing.has(i)) cur.editing.delete(i); else cur.editing.add(i);
    el.classList.toggle('flip', cur.editing.has(i));
    return;
  }
  if (i === cur.sel.cell) toggleDir();
  else selectCell(i);
});

$('#clue-panel').addEventListener('click', e => {
  const li = e.target.closest('.clue');
  if (!li || !cur) return;
  const cl = clueById(li.dataset.clue);
  if (cl?.entryIds.length) { selectClue(cl); closeClueSheet(); }
});

$('#cluebar-prev').addEventListener('click', () => cur && nextClue(-1));
$('#cluebar-next').addEventListener('click', () => cur && nextClue(1));
$('#cluebar-body').addEventListener('click', () => cur && toggleDir());

const isTypingTarget = el => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);

document.addEventListener('keydown', e => {
  if (!cur || $('#view-solver').hidden || cur.editing) return;
  if (document.querySelector('dialog[open]') || isTypingTarget(e.target)) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key;
  if (/^[a-zA-Z0-9]$/.test(k)) { e.preventDefault(); typeLetter(k.toUpperCase()); }
  else if (k === 'Backspace') { e.preventDefault(); backspace(); }
  else if (k === 'Delete') { e.preventDefault(); setCells([[cur.sel.cell, '']]); update(); }
  else if (k === 'ArrowLeft') { e.preventDefault(); arrow(0, -1); }
  else if (k === 'ArrowRight') { e.preventDefault(); arrow(0, 1); }
  else if (k === 'ArrowUp') { e.preventDefault(); arrow(-1, 0); }
  else if (k === 'ArrowDown') { e.preventDefault(); arrow(1, 0); }
  else if (k === ' ') { e.preventDefault(); toggleDir(); }
  else if (k === 'Tab' || k === 'Enter') { e.preventDefault(); nextClue(e.shiftKey ? -1 : 1); }
  else if (k === 'Escape') { closeMenus(); }
});

// on-screen keyboard (touch devices)
function buildKeyboard() {
  const kb = $('#keyboard');
  const rows = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];
  kb.innerHTML = rows.map((row, ri) =>
    `<div class="kb-row">${[...row].map(ch => `<button type="button" class="kb-key" data-key="${ch}">${ch}</button>`).join('')}${ri === 2 ? '<button type="button" class="kb-key kb-wide" data-key="Backspace" aria-label="Backspace">⌫</button>' : ''}</div>`
  ).join('');
  kb.addEventListener('pointerdown', e => {
    const key = e.target.closest('[data-key]')?.dataset.key;
    if (!key || !cur || cur.editing) return;
    e.preventDefault();
    if (key === 'Backspace') backspace(); else typeLetter(key);
  });
}
buildKeyboard();

// ---- menus: check / reveal / clear ----
function closeMenus() { $$('details.menu[open]').forEach(d => d.removeAttribute('open')); }
document.addEventListener('click', e => { if (!e.target.closest('details.menu')) closeMenus(); });

function cellsFor(scope) {
  const { model } = cur;
  if (scope === 'cell') return [cur.sel.cell];
  if (scope === 'word') return activeWordCells();
  return model.cells.map((c, i) => i).filter(i => !model.cells[i].block && !model.cells[i].void);
}

$('#view-solver').addEventListener('click', e => {
  const btn = e.target.closest('[data-act]');
  if (!btn || !cur) return;
  const [act, scope] = btn.dataset.act.split(':');
  closeMenus();
  const { model } = cur;
  if (act === 'check') {
    let wrong = 0;
    for (const i of cellsFor(scope)) {
      const sol = model.cells[i].solution;
      if (sol && valueAt(i) && valueAt(i) !== sol) { cur.wrong.add(i); wrong++; }
    }
    paintLetters();
    toast(wrong ? `${wrong} incorrect ${wrong === 1 ? 'letter' : 'letters'}` : 'No mistakes found');
  } else if (act === 'reveal') {
    if (scope === 'all' && !confirm('Reveal the whole puzzle?')) return;
    const changes = cellsFor(scope).filter(i => model.cells[i].solution && valueAt(i) !== model.cells[i].solution).map(i => [i, model.cells[i].solution, 'r']);
    if (changes.length) { setCells(changes); checkComplete(true); }
    update();
  } else if (act === 'clear') {
    if (scope === 'all' && !confirm('Clear all your answers in this puzzle?')) return;
    const changes = cellsFor(scope).filter(i => valueAt(i)).map(i => [i, '']);
    if (scope === 'all') cur.wrong.clear();
    if (changes.length) setCells(changes);
    update();
  } else if (act === 'clues') {
    toggleClueSheet();
  } else if (act === 'anagram') {
    openAnagram();
  } else if (act === 'library') {
    location.hash = '';
  } else if (act === 'edit-grid') {
    startEditGrid();
  } else if (act === 'edit-cancel') {
    stopEditGrid();
  } else if (act === 'edit-save') {
    saveEditGrid();
  } else if (act === 'notes') {
    alert(model.notes);
  }
});

// ---- grid editing (fix black/white squares) ----
function startEditGrid() {
  closeClueSheet();
  cur.editing = new Set();
  $('#grid').classList.add('editing');
  document.body.classList.add('editing');
  $('#edit-bar').hidden = false;
}
function stopEditGrid() {
  if (!cur) return;
  cur.editing = null;
  $$('#grid .cell.flip').forEach(el => el.classList.remove('flip'));
  $('#grid').classList.remove('editing');
  document.body.classList.remove('editing');
  $('#edit-bar').hidden = true;
}
function saveEditGrid() {
  const flips = [...cur.editing];
  if (!flips.length) { stopEditGrid(); return; }
  const id = cur.id;
  const rec = local.getPuzzle(id);
  let raw, model;
  try { raw = editGrid(rec.raw, flips); model = parseIpuz(raw); }
  catch (e) { toast(`Couldn't update the grid: ${e.message}`, 5000); return; }
  // clear any letters in squares that are now black
  const nowBlack = flips.filter(i => model.cells[i].block && valueAt(i)).map(i => [i, '']);
  if (nowBlack.length) setCells(nowBlack);
  const meta = { ...rec.meta, cells: openCellCount(model), rev: Date.now() };
  local.putPuzzle(id, { raw, meta });
  uploadPuzzle(id, { raw, meta });
  flushPush();
  stopEditGrid();
  reopenPuzzle();
  // warn if the clue numbers no longer line up with the grid
  const unmatched = [...model.clues.across, ...model.clues.down].filter(c => !c.entryIds.length).length;
  toast(unmatched ? `Grid updated, but ${unmatched} clue${unmatched > 1 ? 's' : ''} no longer match the grid` : 'Grid updated', unmatched ? 5000 : 2600);
}
function reopenPuzzle() {
  const id = cur.id;
  cur = null;
  openPuzzle(id);
}

function toggleClueSheet() { document.body.classList.toggle('clues-open'); }
function closeClueSheet() { document.body.classList.remove('clues-open'); }
$('#clue-sheet-backdrop').addEventListener('click', closeClueSheet);

// ---- sizing ----
function sizeGrid() {
  if (!cur) return;
  const board = $('#board');
  const { width: W, height: H } = cur.model;
  const bw = board.clientWidth, bh = board.clientHeight;
  if (!bw || !bh) return;
  const cell = Math.max(14, Math.floor(Math.min((bw - 4 - (W - 1)) / W, (bh - 4 - (H - 1)) / H, 64)));
  $('#grid').style.setProperty('--cell', `${cell}px`);
}
new ResizeObserver(sizeGrid).observe($('#board'));

// ======================================================================
// Anagrammer dialog
// ======================================================================
const anagram = createAnagrammer($('#anagram-body'), {
  getPattern() {
    if (!cur) return null;
    const cl = activeClue();
    if (!cl) return null;
    const cells = activeWordCells();
    const clue = String(cl.text || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
    const enumTxt = cl.enumeration && !hasEnum(clue) ? ` (${cl.enumeration})` : '';
    return { label: `${cl.number} ${cl.dir === 'across' ? 'Across' : 'Down'}`, clue: clue + enumTxt, letters: cells.map(i => valueAt(i)) };
  },
  onFill(letters) {
    if (!cur) return;
    const cells = activeWordCells();
    if (letters.length !== cells.length) return;
    setCells(cells.map((i, k) => [i, letters[k]]));
    checkComplete(true);
    update();
    $('#dlg-anagram').close();
    toast(`Filled in ${letters.join('')}`);
  },
});
function openAnagram() { $('#dlg-anagram').showModal(); anagram.open(); }
$('#btn-anagram-close').addEventListener('click', () => $('#dlg-anagram').close());

// ======================================================================
// Settings / sync
// ======================================================================
onSyncStatus(({ state, message }) => {
  const pill = $('#sync-pill');
  pill.dataset.state = state;
  $('.txt', pill).textContent = { off: 'Sync off', ok: 'Synced', syncing: 'Syncing', error: 'Sync error', offline: 'Offline' }[state] || state;
  pill.title = message;
});

function openSettings() {
  $('#token-input').value = local.token();
  $('#settings-msg').textContent = '';
  $('#btn-sync-off').hidden = !local.token();
  $('#pref-skip').checked = prefs.skipFilled;
  $('#dlg-settings').showModal();
}
$('#btn-settings').addEventListener('click', openSettings);
$('#pref-skip').addEventListener('change', e => { prefs.skipFilled = e.target.checked; });
$('#sync-pill').addEventListener('click', () => {
  const st = $('#sync-pill').dataset.state;
  if (st === 'off' || st === 'error') openSettings();
  else syncAll(onRemoteChange);
});
$('#btn-token-show').addEventListener('click', () => {
  const inp = $('#token-input');
  inp.type = inp.type === 'password' ? 'text' : 'password';
});
$('#settings-form').addEventListener('submit', async e => {
  e.preventDefault();
  const token = $('#token-input').value.trim();
  const msg = $('#settings-msg');
  if (!token) { msg.textContent = 'Enter your sync key.'; return; }
  msg.textContent = 'Checking…';
  try {
    const r = await testToken(token);
    if (!r.ok) { msg.textContent = `Couldn't connect: ${r.message}`; return; }
  } catch { msg.textContent = "Couldn't reach the server (offline?)"; return; }
  local.setToken(token);
  $('#dlg-settings').close();
  toast('Sync is on');
  syncAll(onRemoteChange);
});
$('#btn-sync-off').addEventListener('click', () => {
  local.setToken('');
  $('#dlg-settings').close();
  syncAll();
  toast('Sync turned off on this device');
});
$('#btn-settings-close').addEventListener('click', () => $('#dlg-settings').close());

function onRemoteChange() {
  if (cur) {
    if (!local.getPuzzle(cur.id)) { toast('This puzzle was deleted on another device'); location.hash = ''; return; }
    if (local.getPuzzle(cur.id).raw !== cur.raw && !cur.editing) { reopenPuzzle(); return; }
    cur.progress = local.getProgress(cur.id);
    paintLetters();
    update();
  } else renderLibrary();
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushPush();
  else syncAll(onRemoteChange);
});
window.addEventListener('pagehide', flushPush);
window.addEventListener('online', () => syncAll(onRemoteChange));
// while a puzzle is open, pick up changes from other devices
setInterval(() => {
  if (!cur || document.visibilityState !== 'visible' || !local.token() || pushTimer) return;
  const id = cur.id;
  pullProgress(id).then(m => { if (m && cur?.id === id && !pushTimer) { cur.progress = local.getProgress(id); paintLetters(); } });
}, 30000);

// ======================================================================
// Routing
// ======================================================================
function showView(name) {
  $('#view-library').hidden = name !== 'library';
  $('#view-solver').hidden = name !== 'solver';
  document.body.dataset.view = name;
}

function route() {
  const m = location.hash.match(/^#\/p\/([a-f0-9]+)/);
  if (m) { if (cur?.id !== m[1]) { closePuzzle(); openPuzzle(m[1]); } }
  else { closePuzzle(); renderLibrary(); showView('library'); }
}
window.addEventListener('hashchange', route);
$('#btn-home').addEventListener('click', () => { location.hash = ''; });

route();
syncAll(onRemoteChange);
