import { parseIpuz, clueHtml, parseEnumeration, editGrid, editCircles, editInfo, formatPuzzleDate, puzzleDateToIso, isoToPuzzleDate } from './ipuz.js?v=20261128c';
import { createShare, fetchShare, local, puzzleId, syncAll, pullProgress, pushProgress, deleteRemote, uploadPuzzle, onSyncStatus, testToken, checkSession, signOutRemote, filledCount } from './store.js?v=20261128c';
import { createAnagrammer } from './anagram.js?v=20261128c';
import { renderProgressImage } from './progress-image.js?v=20261128c';
import { lookup, answerPhrase, wiktionaryUrl, googleUrl } from './define.js?v=20261128c';
import { driveConfigured, driveFolder, driveLast, driveSeen, folderIdFrom, listFolder, fetchFileText } from './drive.js?v=20261128c';

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

// ---- library: sort order and a collapsible "Completed" section ----
const libPref = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const setLibPref = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

function libCard(p) {
  const meta = p.meta || {};
  const card = document.createElement('div');
  card.className = 'lib-card';
  card.innerHTML = `
      <button class="lib-open" data-id="${p.id}">
        <span class="lib-title"></span>
        <span class="lib-meta"></span>
        <span class="lib-progress"><span style="width:${p.pct}%"></span></span>
        <span class="lib-pct">${meta.solved ? 'Solved ✓' : p.complete ? (puzzleInfo(p).hasSolution ? 'Not quite right' : 'Complete') : p.pct ? p.pct + '% filled' : 'Not started'}</span>
      </button>
      <button class="lib-more icon-btn" data-more="${p.id}" aria-label="More options" title="Share or delete">⋯</button>`;
  $('.lib-title', card).textContent = meta.title || 'Untitled';
  $('.lib-meta', card).textContent = libraryLine(p);
  // full grid: green = right, purple = no answers to check against, red = doesn't match the answers
  if (meta.solved) card.classList.add('solved');
  else if (p.complete) card.classList.add(puzzleInfo(p).hasSolution ? 'notquite' : 'complete');
  return card;
}

// Put cards into a container in the chosen order; for "puzzle date", undated puzzles form their own group at the end.
function addCards(box, items, sort) {
  const recent = (a, b) => (b.lastOpened || b.added || 0) - (a.lastOpened || a.added || 0);
  const [key, dir] = sort.split('-');
  const flip = dir === 'asc' ? -1 : 1;
  if (key === 'progress') items.sort((a, b) => flip * (b.pct - a.pct) || recent(a, b));
  else if (key === 'date') {
    // dated puzzles in the chosen order; undated ones always last
    items.sort((a, b) => (!a.iso - !b.iso) || flip * (b.iso || '').localeCompare(a.iso || '') || recent(a, b));
  } else items.sort(recent);
  let undatedShown = false;
  for (const p of items) {
    if (key === 'date' && !p.iso && !undatedShown && items.some(q => q.iso)) {
      undatedShown = true;
      const h = document.createElement('h3');
      h.className = 'lib-group';
      h.textContent = 'No date';
      box.appendChild(h);
    }
    box.appendChild(libCard(p));
  }
}

function renderLibrary() {
  const list = $('#lib-list');
  let sort = libPref('cw.libSort', 'recent');
  if (sort === 'progress' || sort === 'date') sort += '-desc'; // older saved choices
  if (![...$('#lib-sort').options].some(o => o.value === sort)) sort = 'recent';
  $('#lib-sort').value = sort;
  const all = Object.entries(local.puzzles()).map(([id, rec]) => {
    const p = { id, ...rec };
    const total = p.meta?.cells || 1;
    const filled = filledCount(local.getProgress(id));
    p.pct = Math.min(100, Math.round((filled / total) * 100));
    p.complete = filled >= total;               // every square filled
    p.iso = puzzleDateToIso(puzzleInfo(p).date); // '' when the puzzle has no (readable) date
    return p;
  });
  $('#lib-empty').hidden = all.length > 0;
  $('#lib-tools').hidden = all.length < 2;
  list.innerHTML = '';
  // Completed = solved, or full with no answers to check, or full-but-wrong that you moved there yourself
  const done = all.filter(p => p.meta?.solved || (p.complete && (!puzzleInfo(p).hasSolution || movedToCompleted(p.id))));
  addCards(list, all.filter(p => !done.includes(p)), sort);
  if (done.length) {
    const sec = document.createElement('details');
    sec.className = 'lib-done';
    sec.open = libPref('cw.libDoneOpen', '0') === '1';
    sec.innerHTML = `<summary>Completed <span class="lib-done-n">${done.length}</span></summary>`;
    sec.addEventListener('toggle', () => setLibPref('cw.libDoneOpen', sec.open ? '1' : '0'));
    const inner = document.createElement('div');
    inner.className = 'lib-list';
    addCards(inner, done, sort);
    sec.appendChild(inner);
    list.appendChild(sec);
  }
}
$('#lib-sort').addEventListener('change', e => { setLibPref('cw.libSort', e.target.value); renderLibrary(); });

// Setter, publication and date, read from the file itself so they're right for older imports and
// after an edit synced from another device. Cached per file text.
const infoCache = new Map();
function puzzleInfo(rec) {
  const hit = infoCache.get(rec.id);
  if (hit && hit.raw === rec.raw) return hit.info;
  let info;
  try { const m = parseIpuz(rec.raw); info = { author: m.author, publisher: m.publisher, date: m.date, hasSolution: m.hasSolution }; }
  catch { info = { author: rec.meta?.author || '', publisher: rec.meta?.publisher || '', date: rec.meta?.date || '' }; }
  infoCache.set(rec.id, { raw: rec.raw, info });
  return info;
}
// "DS (Herald Sun) · Fri, 23 Oct 2026 · 15×15"
function libraryLine(rec) {
  const { author, publisher, date } = puzzleInfo(rec), meta = rec.meta || {};
  const who = author && publisher ? `${author} (${publisher})` : author || publisher;
  return [who, formatPuzzleDate(date), meta.width && `${meta.width}×${meta.height}`].filter(Boolean).join(' · ');
}

$('#lib-list').addEventListener('click', e => {
  const more = e.target.closest('[data-more]');
  if (more) {
    const r = more.getBoundingClientRect();
    openLibMenu(more.dataset.more, r.right, r.bottom);
    return;
  }
  const open = e.target.closest('[data-id]');
  if (open) location.hash = `#/p/${open.dataset.id}`;
});

// Save the puzzle's .ipuz file (as it is now, including any Edit puzzle changes) to the device.
function downloadIpuz(id) {
  const rec = local.getPuzzle(id);
  if (!rec) return;
  const base = (rec.meta?.title || 'crossword').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'crossword';
  const url = URL.createObjectURL(new Blob([rec.raw], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${base}.ipuz`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  toast(`Downloaded ${base}.ipuz`);
}

// ---- per-puzzle menu in the library: ⋯ button, long press, or right-click ----
let libMenuFor = null;
const movedToCompleted = id => !!local.getProgress(id).flags?.completed?.on;
function setMovedToCompleted(id, on) {
  const p = local.getProgress(id);
  const t = Date.now();
  p.flags = { ...(p.flags || {}), completed: { on, t } };
  p.updatedAt = t;
  local.putProgress(id, p);
  local.markDirty(id);
  pushProgress(id, { total: p.total });
}
// a full grid that doesn't match its answers ("Not quite right")
function notQuiteRight(id) {
  const rec = local.getPuzzle(id);
  if (!rec || rec.meta?.solved || !puzzleInfo({ id, ...rec }).hasSolution) return false;
  return filledCount(local.getProgress(id)) >= (rec.meta?.cells || Infinity);
}
function openLibMenu(id, x, y) {
  const m = $('#lib-menu');
  libMenuFor = id;
  const nq = notQuiteRight(id), moved = movedToCompleted(id);
  $('[data-lib-act="to-completed"]').hidden = !nq || moved;
  $('[data-lib-act="from-completed"]').hidden = !nq || !moved;
  m.hidden = false;
  const w = m.offsetWidth, h = m.offsetHeight;
  m.style.left = `${Math.max(8, Math.min(x - w, innerWidth - w - 8))}px`;
  m.style.top = `${Math.max(8, Math.min(y + 4, innerHeight - h - 8))}px`;
  $$('.lib-card').forEach(c => c.classList.toggle('menu-for', c.querySelector(`[data-id="${id}"]`) != null));
}
function closeLibMenu() {
  $('#lib-menu').hidden = true;
  libMenuFor = null;
  $$('.lib-card.menu-for').forEach(c => c.classList.remove('menu-for'));
}
$('#lib-menu').addEventListener('click', e => {
  const act = e.target.closest('[data-lib-act]')?.dataset.libAct;
  const id = libMenuFor;
  closeLibMenu();
  if (!act || !id) return;
  if (act === 'share') sharePuzzle(id);
  if (act === 'download') downloadIpuz(id);
  if (act === 'to-completed' || act === 'from-completed') {
    setMovedToCompleted(id, act === 'to-completed');
    renderLibrary();
    toast(act === 'to-completed' ? 'Moved to Completed' : 'Moved back to your puzzles');
  }
  if (act === 'delete') {
    const title = local.getPuzzle(id)?.meta?.title || 'this puzzle';
    if (confirm(`Delete "${title}" and its progress from all your devices?`)) {
      local.deletePuzzle(id);
      deleteRemote(id);
      renderLibrary();
    }
  }
});
document.addEventListener('pointerdown', e => { if (libMenuFor && !e.target.closest('#lib-menu, [data-more]')) closeLibMenu(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && libMenuFor) closeLibMenu(); });
addEventListener('scroll', () => libMenuFor && closeLibMenu(), true);
addEventListener('resize', () => libMenuFor && closeLibMenu());

// long press (touch) or right-click (mouse) on a card opens the same menu
{
  const list = $('#lib-list');
  let timer = null, start = null, fired = null; // fired = { card, at } just after a long press
  const cancel = () => { clearTimeout(timer); timer = null; $$('.lib-open.pressing').forEach(b => b.classList.remove('pressing')); };
  list.addEventListener('pointerdown', e => {
    fired = null; // any new press starts afresh
    const card = e.target.closest('.lib-open');
    if (!card || e.button > 0) return;
    start = { x: e.clientX, y: e.clientY };
    card.classList.add('pressing');
    timer = setTimeout(() => {
      fired = { card, at: Date.now() }; cancel();
      navigator.vibrate?.(15);
      openLibMenu(card.dataset.id, start.x + 60, start.y);
    }, 550);
  });
  list.addEventListener('pointermove', e => { if (timer && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 8) cancel(); });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) list.addEventListener(ev, cancel);
  list.addEventListener('contextmenu', e => {
    const card = e.target.closest('.lib-open');
    if (!card) return;
    e.preventDefault();
    if (!fired) openLibMenu(card.dataset.id, e.clientX + 60, e.clientY);
  });
  // the click that may follow a long press (same card, straight away) shouldn't open the puzzle;
  // anything else, like the ⋯ on another card, works as normal
  list.addEventListener('click', e => {
    const f = fired;
    fired = null;
    if (f && Date.now() - f.at < 1500 && e.target.closest('.lib-open') === f.card) { e.stopImmediatePropagation(); e.preventDefault(); }
  }, true);
}

// Is this the same puzzle as one already in the library? Same grid size and (nearly) the same clues,
// whatever else differs in the file (answers, title, date, formatting).
const clueNorm = t => String(t || '').replace(/<[^>]*>/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const clueKeys = m => ['across', 'down'].flatMap(d => m.clues[d].map(c => `${d}|${c.number}|${clueNorm(c.text)}`));
function findSamePuzzle(model) {
  const want = new Set(clueKeys(model));
  if (want.size < 2) return null;
  for (const [id, rec] of Object.entries(local.puzzles())) {
    let m;
    try { m = parseIpuz(rec.raw); } catch { continue; }
    if (m.width !== model.width || m.height !== model.height) continue;
    const have = clueKeys(m);
    const same = have.filter(k => want.has(k)).length;
    if (same / Math.max(want.size, have.length) >= 0.9) return { id, rec, model: m };
  }
  return null;
}
// Answers that the new file adds or changes, compared with the copy we have.
function addsAnswers(newModel, oldModel) {
  if (!newModel.hasSolution) return false;
  if (!oldModel.hasSolution) return true;
  return newModel.cells.some((c, i) => c.solution && c.solution !== oldModel.cells[i]?.solution);
}

// Add one ipuz text to the library. Returns { id, title, isNew, updated }.
// A newer file for a puzzle you already have that brings its answers (e.g. the next day's solution)
// replaces that copy's file, keeping its progress, instead of adding a second copy.
async function importRaw(raw) {
  const model = parseIpuz(raw);
  const id = await puzzleId(raw);
  if (local.getPuzzle(id)) return { id, title: model.title, isNew: false };
  const same = findSamePuzzle(model);
  if (same && addsAnswers(model, same.model)) {
    const title = same.rec.meta?.title || model.title;
    const what = same.model.hasSolution ? 'with different answers' : 'with the answers added';
    if (!confirm(`This is "${title}" ${what}.\n\nUpdate the copy in your library? Your progress is kept.`)) {
      return { id: same.id, title, isNew: false, declined: true };
    }
    const meta = { ...same.rec.meta, title: model.title, author: model.author, publisher: model.publisher, date: model.date,
      cells: openCellCount(model), rev: Date.now() };
    local.putPuzzle(same.id, { raw, meta });
    uploadPuzzle(same.id, { raw, meta });
    return { id: same.id, title: model.title, isNew: false, updated: true };
  }
  // the same puzzle again with nothing new (e.g. the answers file imported twice): don't add a second copy
  if (same) return { id: same.id, title: same.rec.meta?.title || model.title, isNew: false };
  const meta = { title: model.title, author: model.author, publisher: model.publisher, date: model.date, width: model.width, height: model.height, cells: openCellCount(model), added: Date.now() };
  local.putPuzzle(id, { raw, meta, added: meta.added });
  // seed progress from any state saved in the file / pre-filled cells
  const cells = {};
  model.cells.forEach((c, i) => { if (c.given) cells[i] = { v: c.given, t: 1 }; });
  for (const [i, v] of Object.entries(model.saved)) if (!cells[i]) cells[i] = { v, t: 1 };
  local.putProgress(id, { cells, updatedAt: 0, total: meta.cells });
  uploadPuzzle(id, { raw, meta });
  return { id, title: model.title, isNew: true };
}

async function importFiles(files) {
  let lastId = null, added = 0;
  for (const file of files) {
    try {
      const r = await importRaw(await file.text());
      if (r.updated) toast(`Added the answers to "${r.title}" – Check and Reveal now work`, 4500);
      else if (r.declined) toast('Not imported');
      else if (!r.isNew) toast(`"${r.title}" is already in your library`);
      lastId = r.id;
      if (r.isNew) added++;
    } catch (err) {
      toast(`${file.name}: ${err.message}`, 5000);
    }
  }
  renderLibrary();
  if (files.length === 1 && lastId) location.hash = `#/p/${lastId}`;
  else if (added) toast(`Imported ${added} puzzle${added > 1 ? 's' : ''}`);
}

// Opening a share link: add the puzzle to this device's library, then open it.
async function openShareLink(sid) {
  showView('library');
  renderLibrary();
  toast('Loading shared puzzle…', 10000);
  try {
    const raw = await fetchShare(sid);
    const r = await importRaw(raw);
    renderLibrary();
    location.replace(`#/p/${r.id}`);
    toast(r.isNew ? `Added "${r.title}" to your puzzles` : r.updated ? `Added the answers to "${r.title}"` : `"${r.title}" is already in your library`);
  } catch (e) {
    location.replace('#');
    toast(`Couldn't open that link: ${e.message}`, 6000);
  }
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
    if (local.syncOn()) {
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
  // setter · publication · date under the title (copyright only where there's room)
  // (each item is kept whole, so on a narrow screen the line wraps between items, not inside a date)
  const sub = $('#puz-author');
  sub.textContent = '';
  [model.author, model.publisher, formatPuzzleDate(model.date)].filter(Boolean).forEach((t, k) => {
    if (k) sub.append(' · ');
    const pt = document.createElement('span');
    pt.className = 'pt';
    pt.textContent = t;
    sub.append(pt);
  });
  if (model.copyright) {
    const c = document.createElement('small');
    c.className = 'puz-copy';
    c.textContent = `${sub.textContent ? ' · ' : ''}${model.copyright}`;
    sub.appendChild(c);
  }
  sub.hidden = !sub.textContent;
  $('#grid').classList.remove('show-circles');
  $('#puz-circles').hidden = !model.cells.some(c => c.circle && !c.block && !c.void);
  $('#puz-notes').hidden = !model.notes;
  $('#puz-notes').title = model.notes || '';
  for (const el of $$('[data-needs-solution]')) el.disabled = !model.hasSolution;

  buildGrid();
  buildClues();
  markDoneClues();
  showView('solver');
  sizeGrid();
  cur.wasFull = filledCount(progress) >= total;
  update();
  // a finished grid that hasn't been judged in its current state yet (e.g. the answers were added
  // after you finished): say how it went now. Puzzles without answers are just noted quietly.
  {
    let stored = null;
    try { stored = localStorage.getItem(verdictKey(id)); } catch {}
    cur.lastVerdict = stored;
    const full = model.cells.every((c, i) => c.block || c.void || valueAt(i));
    const verdict = !full ? null : !model.hasSolution ? 'complete' : $('#grid').classList.contains('solved') ? 'solved' : 'wrong';
    if (verdict && verdict !== stored && verdict !== 'complete') setTimeout(() => cur?.id === id && showVerdict(verdict), 300);
    setVerdict(verdict);
  }

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
      if (c.circle) { const o = document.createElement('span'); o.className = 'circ'; el.appendChild(o); el.classList.add('has-circ'); }
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
  markDoneClues();
  checkComplete(false);
}

// Fade clues whose squares are all filled in.
function markDoneClues() {
  const { model } = cur;
  const unconfirm = [];
  for (const li of $$('#clue-panel .clue')) {
    const own = clueById(li.dataset.clue);
    const cl = own?.seeOf ? clueById(own.seeOf) : own; // a "See 14" clue follows 14
    const done = clueComplete(cl);
    li.classList.toggle('done', done);
    // a confirmed answer that's no longer complete loses its confirmation
    if (cl && isConfirmed(cl.id) && !done) unconfirm.push(cl.id);
    li.classList.toggle('confirmed', !!cl && done && isConfirmed(cl.id));
    // confirmed with help: one or more of its letters were revealed
    li.classList.toggle('assisted', !!cl && done && isConfirmed(cl.id) && clueAssisted(cl));
  }
  if (unconfirm.length) setConfirmed(unconfirm, false);
  // letters in a confirmed answer are shown full strength; other letters are slightly faded
  const sure = new Set();
  for (const cl of [...model.clues.across, ...model.clues.down]) {
    if (isConfirmed(cl.id) && clueComplete(cl)) clueCells(cl).forEach(i => sure.add(i));
  }
  // revealed letters count as certain too
  cur.cellEls.forEach((el, i) => el.classList.toggle('tentative', !!valueAt(i) && !sure.has(i) && cur.progress.cells[i]?.f !== 'r'));
}

const clueAssisted = cl => clueCells(cl).some(i => cur.progress.cells[i]?.f === 'r');
const clueCells = cl => (cl ? cl.entryIds.flatMap(id => cur.model.entries[id]?.cells || []) : []);
function clueComplete(cl) { const c = clueCells(cl); return c.length > 0 && c.every(i => valueAt(i)); }
const isConfirmed = id => !!cur.progress.confirmed?.[id]?.on;

// Mark clues as confirmed ("I'm sure of this answer"); synced with progress.
function setConfirmed(ids, on) {
  const t = Date.now();
  cur.progress.confirmed = { ...(cur.progress.confirmed || {}) };
  for (const id of [].concat(ids)) cur.progress.confirmed[id] = { on, t };
  cur.progress.updatedAt = t;
  local.putProgress(cur.id, cur.progress);
  local.markDirty(cur.id);
  schedulePush();
}
function toggleConfirmed(cl) {
  if (!cl || !cl.entryIds.length) return;
  if (!isConfirmed(cl.id) && !clueComplete(cl)) { toast('Fill in the whole answer before marking it as confirmed'); return; }
  const on = !isConfirmed(cl.id);
  setConfirmed(cl.id, on);
  navigator.vibrate?.(15);
  markDoneClues();
  update();
  toast(on ? `${clueLong(cl)} confirmed ✓` : 'Confirmation removed', 1800);
}

// press and hold (on a clue in the list, or on the clue bar) to confirm / unconfirm
function onLongPress(el, getClue) {
  let timer = null, start = null, fired = false;
  const cancel = () => { clearTimeout(timer); timer = null; el.querySelectorAll('.pressing').forEach(x => x.classList.remove('pressing')); el.classList.remove('pressing'); };
  el.addEventListener('pointerdown', e => {
    fired = false; // any new press starts afresh
    if (!cur || e.button > 0) return;
    const target = getClue(e) ;
    if (!target) return;
    start = { x: e.clientX, y: e.clientY };
    target.el.classList.add('pressing');
    timer = setTimeout(() => { fired = true; cancel(); toggleConfirmed(target.clue); }, 550);
  });
  el.addEventListener('pointermove', e => { if (timer && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 8) cancel(); });
  el.addEventListener('pointerup', cancel);
  el.addEventListener('pointercancel', cancel);
  el.addEventListener('pointerleave', cancel);
  el.addEventListener('contextmenu', e => e.preventDefault());
  // swallow the click that follows a long press
  el.addEventListener('click', e => { const f = fired; fired = false; if (f) { e.stopImmediatePropagation(); e.preventDefault(); } }, true);
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
      li.innerHTML = `<span class="clue-num">${clueHtml(clueName(cl))}</span><span class="clue-text">${clueHtml(cl.text) || '<em class="muted">—</em>'}${enumTxt}</span>`;
      if (cl.seeOf) li.classList.add('see');
      else if (!cl.entryIds.length) li.classList.add('orphan');
      ol.appendChild(li);
    }
  }
}

// The number shown for a clue: "14, 16" for a linked clue that has a label, otherwise its number.
const clueName = cl => (cl.label || cl.number);

// Names built from the clue's actual parts, so linked answers read properly:
//   clueTag  -> "26D" or, for a linked answer, "26D, 21A"           (clue bar)
//   clueLong -> "26 Down", "14, 16 Across" or "26 Down, 21 Across"   (messages, anagrammer)
const DIR = { across: 'Across', down: 'Down' };
const clueParts = cl => cl.entryIds.map(id => cur.model.entries[id]).filter(Boolean);
function clueTag(cl) {
  const parts = clueParts(cl);
  if (parts.length < 2) return `${cl.number}${cl.dir === 'across' ? 'A' : 'D'}`;
  return parts.map(e => `${e.number}${e.dir === 'across' ? 'A' : 'D'}`).join(', ');
}
function clueLong(cl) {
  const parts = clueParts(cl);
  if (parts.length < 2) return `${cl.number} ${DIR[cl.dir]}`;
  if (parts.every(e => e.dir === parts[0].dir)) return `${parts.map(e => e.number).join(', ')} ${DIR[parts[0].dir]}`;
  return parts.map(e => `${e.number} ${DIR[e.dir]}`).join(', ');
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
    const own = clueById(li.dataset.clue);
    const ref = own?.seeOf || li.dataset.clue; // "See 14" lights up with 14
    li.classList.toggle('active', !!(cl && ref === cl.id));
    li.classList.toggle('cross', !!(crossClue && ref === crossClue.id));
  }
  for (const id of [cl?.id, crossClue?.id]) {
    const li = id && $(`#clue-panel .clue[data-clue="${CSS.escape(id)}"]`);
    if (li) scrollIntoList(li);
  }

  // clue bar
  if (cl) {
    const len = activeWordCells().length;
    const enumTxt = cl.enumeration ? cl.enumeration : len;
    $('#cluebar-num').textContent = clueTag(cl);
    $('#cluebar').classList.toggle('confirmed', isConfirmed(cl.id) && clueComplete(cl));
    const showEnum = !hasEnum(cl.text);
    $('#cluebar-text').innerHTML = `${clueHtml(cl.text) || '<em class="muted">No clue</em>'}${showEnum ? ` <span class="enum">(${clueHtml(String(enumTxt))})</span>` : ''}`;
    $('#cluebar-define').hidden = !activeWordCells().every(i => valueAt(i));
  } else {
    $('#cluebar-define').hidden = true;
    $('#cluebar-num').textContent = '';
    $('#cluebar-text').textContent = '';
  }
  try { localStorage.setItem(`cw.sel.${cur.id}`, JSON.stringify(sel)); } catch {}
  void model;
}

// Bring a clue into view in its list (only if it isn't fully visible already).
function scrollIntoList(li) {
  const list = li.closest('ol');
  if (!list || list.scrollHeight <= list.clientHeight) return;
  const lr = list.getBoundingClientRect(), r = li.getBoundingClientRect();
  if (r.top < lr.top || r.bottom > lr.bottom) {
    const top = list.scrollTop + (r.top - lr.top) - list.clientHeight / 3;
    list.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
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
  pushProgress(cur.id, { keepalive: true, total: cur.total, final: true });
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
  $('#grid').classList.toggle('complete', full && !model.hasSolution); // finished, correctness unknown
  const rec = local.getPuzzle(cur.id);
  if (rec && !!rec.meta?.solved !== solved) local.putPuzzle(cur.id, { meta: { ...rec.meta, solved } });
  if (!full && cur.lastVerdict) setVerdict(null); // no longer finished: the next finish gets a fresh message
  // Once the grid is full, say how it went – again whenever that changes (e.g. fixing the last
  // wrong letter), but not every time you open it or retype a letter.
  if (announce) {
    const verdict = !full ? null : !model.hasSolution ? 'complete' : solved ? 'solved' : 'wrong';
    if (verdict && verdict !== cur.lastVerdict) showVerdict(verdict);
    setVerdict(verdict);
  }
}

const verdictKey = id => `cw.verdict.${id}`;
function setVerdict(v) {
  cur.lastVerdict = v;
  try { v ? localStorage.setItem(verdictKey(cur.id), v) : localStorage.removeItem(verdictKey(cur.id)); } catch {}
}
function showVerdict(v) {
  if (v === 'complete') { toast('Grid complete!'); return; }
  const ok = v === 'solved';
  const helped = ok ? cur.model.cells.filter((c, i) => cur.progress.cells[i]?.f === 'r' && valueAt(i)).length : 0;
  $('#dlg-result').classList.toggle('wrong', !ok);
  $('#result-icon').textContent = ok ? '🎉' : '🤔';
  $('#result-title').textContent = ok ? 'Solved!' : "Something's not right here…";
  $('#result-text').textContent = ok
    ? `Nicely done – every letter is right${helped ? ` (with ${helped} revealed)` : ''}.`
    : "The grid is full, but it doesn't match the answers yet.";
  $('#btn-result-check').hidden = ok;
  $('#btn-result-ok').textContent = ok ? 'Done' : 'Keep looking';
  if (!$('#dlg-result').open) $('#dlg-result').showModal();
}
$('#btn-result-ok').addEventListener('click', () => $('#dlg-result').close());
$('#btn-result-check').addEventListener('click', () => {
  $('#dlg-result').close();
  $('.menu-items [data-act="check:all"]')?.click(); // marks the wrong letters, as Check → Puzzle does
});


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

function selectClue(cl) {
  const e = cur.model.entries[cl.entryIds[0]];
  const firstEmpty = e.cells.find(i => !valueAt(i));
  cur.sel = { cell: firstEmpty ?? e.cells[0], dir: e.dir };
  update();
}

// Next / previous step through the grid's answers one entry at a time (Across then Down, in
// number order). Linked answers count as their separate parts here, so 20A -> 21A -> 24A
// even when 21A is the second half of 26D.
function orderedEntries() {
  const n = e => parseInt(e.number, 10) || 0;
  return Object.values(cur.model.entries)
    .sort((a, b) => (a.dir === b.dir ? n(a) - n(b) || a.cells[0] - b.cells[0] : a.dir === 'across' ? -1 : 1));
}
function selectEntry(e) {
  const firstEmpty = e.cells.find(i => !valueAt(i));
  cur.sel = { cell: firstEmpty ?? e.cells[0], dir: e.dir };
  update();
}
function nextClue(step) {
  const list = orderedEntries();
  if (!list.length) return;
  const here = entryAt(cur.sel.cell, cur.sel.dir);
  let i = here ? list.indexOf(here) : -1;
  // prefer answers that still have empty squares
  for (let n = 0; n < list.length; n++) {
    i = (i + step + list.length) % list.length;
    const cand = list[i];
    const hasEmpty = cand.cells.some(c => !valueAt(c));
    if (hasEmpty || n === list.length - 1 || allFilled()) { selectEntry(cand); return; }
  }
}
const allFilled = () => cur.model.cells.every((c, i) => c.block || c.void || valueAt(i));

const prefs = {
  get skipFilled() { return localStorage.getItem('cw.skipFilled') === '1'; },
  set skipFilled(v) { localStorage.setItem('cw.skipFilled', v ? '1' : '0'); },
};

// The answer the selected square is part of, square by square with each square's direction.
// For a linked clue (e.g. 14,16 Across, or 5 Across / 17 Down) that's every entry in order,
// so typing and Backspace carry on from one entry into the next.
function answerAt() {
  const e = entryAt(cur.sel.cell, cur.sel.dir);
  if (!e) return null;
  const cl = cur.entryClue[e.id];
  const parts = cl && cl.entryIds.length > 1 ? cl.entryIds.map(id => cur.model.entries[id]).filter(Boolean) : [e];
  const cells = [], dirs = [];
  for (const p of parts) for (const c of p.cells) { cells.push(c); dirs.push(p.dir); }
  let k = cells.findIndex((c, j) => c === cur.sel.cell && dirs[j] === cur.sel.dir);
  if (k < 0) k = cells.indexOf(cur.sel.cell);
  return { cells, dirs, k };
}
const moveTo = (w, j) => { cur.sel.cell = w.cells[j]; cur.sel.dir = w.dirs[j]; };

function typeLetter(ch) {
  const w = answerAt();
  // "skip filled" only applies while the word still has gaps; when overwriting a
  // complete word, step through it one square at a time as usual.
  const wordHadGaps = !!w && w.cells.some((i, j) => j !== w.k && !valueAt(i));
  setCells([[cur.sel.cell, ch]]);
  checkComplete(true);
  if (!w) return update();
  const n = w.cells.length, k = w.k;
  if (prefs.skipFilled && wordHadGaps) {
    // next empty square after this one, wrapping round to the start of the word
    for (let s = 1; s < n; s++) {
      const j = (k + s) % n;
      if (!valueAt(w.cells[j])) { moveTo(w, j); update(); return; }
    }
  }
  // step to the next square, skipping letters that belong to a confirmed crossing answer
  let j = k + 1;
  while (j < n && crossConfirmed(w.cells[j], w.dirs[j])) j++;
  if (j < n && !(prefs.skipFilled && wordHadGaps)) { moveTo(w, j); update(); }
  else if (!allFilled()) nextClue(1);
  else update();
}

// the square holds a letter from a confirmed answer running the other way
function crossConfirmed(i, dir) {
  if (!valueAt(i)) return false;
  const eid = cur.model.cellEntries[i]?.[dir === 'across' ? 'down' : 'across'];
  const cl = eid && cur.entryClue[eid];
  return !!cl && isConfirmed(cl.id);
}

// A letter belongs to a confirmed answer (across or down) — Backspace steps over it
// unless you picked that square yourself (tapped it or moved to it with the arrows).
function isProtected(i) {
  if (!valueAt(i)) return false;
  return ['across', 'down'].some(d => {
    const eid = cur.model.cellEntries[i]?.[d];
    const cl = eid && cur.entryClue[eid];
    return !!cl && isConfirmed(cl.id);
  });
}
const pickedHere = () => cur.picked === cur.sel.cell;
const canDelete = i => !isProtected(i) || (i === cur.sel.cell && pickedHere());

function backspace() {
  const i = cur.sel.cell;
  if (valueAt(i) && canDelete(i)) { setCells([[i, '']]); update(); return; }
  const w = answerAt();
  if (!w) return;
  // step back through the word (all of a linked answer), skipping letters from confirmed answers
  let k = w.k - 1;
  while (k >= 0 && isProtected(w.cells[k])) k--;
  if (k >= 0) {
    moveTo(w, k);
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
    if (!cell.block && !cell.void) { selectCell(r * width + c); cur.picked = r * width + c; return; }
  }
}

// grid click: select, or toggle direction if the selected cell is clicked again
$('#grid').addEventListener('click', e => {
  const el = e.target.closest('.cell');
  if (!el || !cur) return;
  const i = +el.dataset.i;
  if (cur.editing) {
    if (el.classList.contains('void')) return;
    if ($('input[name="edit-mode"]:checked')?.value === 'circle') {
      if (el.classList.contains('block') || cur.editing.has(i)) return; // circles go in white squares
      const set = cur.editCircles;
      if (set.has(i)) set.delete(i); else set.add(i);
      const on = set.has(i);
      el.classList.toggle('circ-flip', on);
      if (!el.querySelector('.circ:not(.pending)')) {
        if (on) { const o = document.createElement('span'); o.className = 'circ pending'; el.appendChild(o); }
        else el.querySelector('.circ.pending')?.remove();
      }
      return;
    }
    if (cur.editCircles.has(i)) return; // undo the circle first
    if (cur.editing.has(i)) cur.editing.delete(i); else cur.editing.add(i);
    el.classList.toggle('flip', cur.editing.has(i));
    return;
  }
  if (i === cur.sel.cell) toggleDir();
  else selectCell(i);
  cur.picked = i;
});

$('#clue-panel').addEventListener('click', e => {
  const li = e.target.closest('.clue');
  if (!li || !cur) return;
  let cl = clueById(li.dataset.clue);
  if (cl?.seeOf) cl = clueById(cl.seeOf); // "See 14" jumps to 14
  if (cl?.entryIds.length) { selectClue(cl); closeClueSheet(); }
});

$('#cluebar-prev').addEventListener('click', () => cur && nextClue(-1));
$('#cluebar-next').addEventListener('click', () => cur && nextClue(1));
$('#cluebar-body').addEventListener('click', () => cur && toggleDir());
onLongPress($('#clue-panel'), e => {
  const li = e.target.closest('.clue');
  let clue = li && clueById(li.dataset.clue);
  if (clue?.seeOf) clue = clueById(clue.seeOf); // holding "See 3" confirms 3 itself
  return clue ? { el: li, clue } : null;
});
onLongPress($('#cluebar-body'), () => {
  const clue = activeClue();
  return clue ? { el: $('#cluebar-body'), clue } : null;
});

const isTypingTarget = el => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);

document.addEventListener('keydown', e => {
  if (!cur || $('#view-solver').hidden || cur.editing) return;
  if (document.querySelector('dialog[open]') || isTypingTarget(e.target)) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key;
  if (/^[a-zA-Z0-9]$/.test(k)) { e.preventDefault(); typeLetter(k.toUpperCase()); }
  else if (k === 'Backspace') { e.preventDefault(); backspace(); }
  else if (k === 'Delete') { e.preventDefault(); if (canDelete(cur.sel.cell)) { setCells([[cur.sel.cell, '']]); update(); } }
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
  } else if (act === 'fullscreen') {
    toggleFullscreen();
  } else if (act === 'anagram') {
    openAnagram();
  } else if (act === 'library') {
    location.hash = '';
  } else if (act === 'share') {
    sharePuzzle();
  } else if (act === 'share-progress') {
    shareProgress();
  } else if (act === 'edit-grid') {
    startEditGrid();
  } else if (act === 'edit-cancel') {
    stopEditGrid();
  } else if (act === 'edit-save') {
    saveEditGrid();
  } else if (act === 'notes') {
    alert(model.notes);
  } else if (act === 'define') {
    openDefine();
  } else if (act === 'circles') {
    openCircles();
  }
});

// ---- dictionary ----
// The finished answer for the current clue, split into words using its enumeration ("3,4" → "one quarter").
function currentAnswer() {
  const cl = activeClue();
  const cells = activeWordCells();
  if (!cl || !cells.length || !cells.every(i => valueAt(i))) return null;
  const letters = cells.map(i => valueAt(i)).join('');
  const en = parseEnumeration(cl);
  return answerPhrase(letters, en && en.total === letters.length ? en.breaks : []);
}

const esc = t => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
let defineSeq = 0;
async function openDefine() {
  const phrase = currentAnswer();
  if (!phrase) return;
  const seq = ++defineSeq;
  const body = $('#define-body');
  $('#define-word').textContent = phrase.toUpperCase();
  body.innerHTML = '<p class="muted">Looking it up…</p>';
  const links = (t) => `Look up <strong>${esc(t)}</strong> on <a href="${wiktionaryUrl(t)}" target="_blank" rel="noopener">Wiktionary</a> · <a href="${googleUrl(t)}" target="_blank" rel="noopener">Google</a>`;
  $('#define-links').innerHTML = links(phrase);
  if (!$('#dlg-define').open) $('#dlg-define').showModal();

  // The whole answer first; for a phrase nobody lists, each word on its own.
  const parts = phrase.split(/[ -]/).filter(Boolean);
  const terms = [phrase];
  let results;
  try {
    let r = await lookup(phrase);
    if (!r && parts.length > 1 && phrase.includes('-')) r = await lookup(phrase.replace(/-/g, ' ')) || await lookup(phrase.replace(/-/g, ''));
    results = [[phrase, r]];
    if (!r && parts.length > 1) {
      results = [];
      for (const w of parts) { results.push([w, await lookup(w).catch(() => null)]); terms.push(w); }
    }
  } catch {
    if (seq !== defineSeq) return;
    body.innerHTML = `<p>Couldn't reach the dictionary. Check your connection, or try the links below.</p>`;
    return;
  }
  if (seq !== defineSeq) return;
  const found = results.filter(([, r]) => r);
  if (!found.length) {
    body.innerHTML = `<p>No definition found for <strong>${esc(phrase)}</strong>. It may be a name, an abbreviation or a rare word – the links below search further.</p>`;
    return;
  }
  const many = results.length > 1;
  body.innerHTML = (many ? `<p class="muted">No entry for the whole phrase, so here are the words on their own.</p>` : '') + results.map(([w, r]) => `
    <section class="define-entry">
      ${many || r?.term.toLowerCase() !== phrase ? `<h3>${esc(r?.term || w)}</h3>` : ''}
      ${r ? r.senses.map(s => `
        ${s.pos ? `<div class="define-pos">${esc(s.pos)}</div>` : ''}
        <ol>${s.defs.map(d => `<li>${esc(d)}</li>`).join('')}</ol>`).join('')
        + `<div class="define-src muted">From <a href="${r.url}" target="_blank" rel="noopener">${esc(r.source)}</a></div>`
      : `<p class="muted">Not found.</p>`}
    </section>`).join('');
  if (many) $('#define-links').innerHTML = [...new Set(terms)].map(links).join('<br>');
}
$('#btn-define-close').addEventListener('click', () => $('#dlg-define').close());

// ---- share link ----
async function sharePuzzle(id = cur?.id) {
  const rec = local.getPuzzle(id);
  if (!rec) return;
  if (!local.syncOn()) { toast('Sign in (Settings) to create share links', 4000); return; }
  toast('Creating link…');
  try {
    const { sid } = await createShare(id, rec.raw, rec.meta?.title);
    const url = `${location.origin}/#/s/${sid}`;
    $('#share-url').value = url;
    $('#share-title').textContent = `"${rec.meta?.title || 'this puzzle'}"`;
    $('#btn-share-native').hidden = !navigator.share;
    $('#btn-share-copy').textContent = 'Copy';
    $('#toast').classList.remove('show');
    $('#dlg-share').showModal();
  } catch (e) {
    toast(`Couldn't create link: ${e.message}`, 5000);
  }
}
$('#btn-share-copy').addEventListener('click', async () => {
  const inp = $('#share-url');
  try { await navigator.clipboard.writeText(inp.value); }
  catch { inp.select(); document.execCommand('copy'); }
  $('#btn-share-copy').textContent = 'Copied ✓';
});
$('#btn-share-native').addEventListener('click', () => {
  const title = $('#share-title').textContent.replace(/"/g, '');
  navigator.share({ title, text: `Have a go at this crossword: ${title}`, url: $('#share-url').value }).catch(() => {});
});
$('#btn-share-close').addEventListener('click', () => $('#dlg-share').close());
$('#share-url').addEventListener('focus', e => e.target.select());

// ---- share progress (picture of the clue list) ----
let progressFile = null;
async function shareProgress() {
  const { model } = cur;
  const withEnum = cl => {
    const t = String(cl.text || '');
    return cl.enumeration && !hasEnum(t) ? { ...cl, text: `${t} (${cl.enumeration})` } : cl;
  };
  const canvas = renderProgressImage({
    title: model.title,
    author: model.author,
    publisher: model.publisher,
    date: formatPuzzleDate(model.date),
    copyright: model.copyright,
    clues: { across: model.clues.across.map(withEnum), down: model.clues.down.map(withEnum) },
    status: c => {
      const cl = c.seeOf ? clueById(c.seeOf) || c : c; // "See 3" shows the same state as 3
      return !clueComplete(cl) ? 'open' : !isConfirmed(cl.id) ? 'done' : clueAssisted(cl) ? 'assisted' : 'confirmed';
    },
  });
  const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
  const name = `${(model.title || 'crossword').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'crossword'}-progress.png`;
  progressFile = new File([blob], name, { type: 'image/png' });
  const img = $('#progress-img');
  if (img.src) URL.revokeObjectURL(img.src);
  img.src = URL.createObjectURL(blob);
  $('#btn-progress-share').hidden = !(navigator.canShare && navigator.canShare({ files: [progressFile] }));
  $('#btn-progress-copy').hidden = !(navigator.clipboard && window.ClipboardItem);
  $('#btn-progress-copy').textContent = 'Copy';
  $('#dlg-progress').showModal();
}
$('#btn-progress-share').addEventListener('click', () => {
  navigator.share({ files: [progressFile], title: cur?.model.title || 'Crossword' }).catch(() => {});
});
$('#btn-progress-save').addEventListener('click', () => {
  const a = document.createElement('a');
  a.href = $('#progress-img').src;
  a.download = progressFile.name;
  document.body.appendChild(a); a.click(); a.remove();
});
$('#btn-progress-copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': progressFile })]);
    $('#btn-progress-copy').textContent = 'Copied ✓';
  } catch { toast("Couldn't copy the picture – try Download instead"); }
});
$('#btn-progress-close').addEventListener('click', () => $('#dlg-progress').close());

// ---- grid editing (fix black/white squares) ----
function startEditGrid() {
  closeClueSheet();
  cur.editing = new Set();
  cur.editCircles = new Set();
  $('input[name="edit-mode"][value="block"]').checked = true;
  $('#grid').classList.remove('show-circles');
  // details: title, setter, date (a date the picker can't show stays as it is unless changed)
  const m = cur.model;
  $('#edit-title').value = m.title === 'Untitled crossword' && !/"title"\s*:/.test(cur.raw) ? '' : m.title;
  $('#edit-author').value = m.author || '';
  $('#edit-publisher').value = m.publisher || '';
  $('#edit-date').value = puzzleDateToIso(m.date);
  cur.editInfoStart = { title: $('#edit-title').value, author: $('#edit-author').value, publisher: $('#edit-publisher').value, date: $('#edit-date').value };
  $('#edit-date-raw').hidden = !(m.date && !puzzleDateToIso(m.date));
  $('#edit-date-raw').textContent = m.date ? `Currently “${m.date}”` : '';
  $('#grid').classList.add('editing');
  document.body.classList.add('editing');
  $('#edit-bar').hidden = false;
}
function stopEditGrid() {
  if (!cur) return;
  cur.editing = null;
  $$('#grid .cell.flip').forEach(el => el.classList.remove('flip'));
  $$('#grid .cell.circ-flip').forEach(el => el.classList.remove('circ-flip'));
  $$('#grid .circ.pending').forEach(el => el.remove());
  cur.editCircles = null;
  $('#grid').classList.remove('editing');
  document.body.classList.remove('editing');
  $('#edit-bar').hidden = true;
}
function saveEditGrid() {
  const flips = [...cur.editing];
  // only the details that were changed are written, so an unreadable date isn't lost by accident
  const start = cur.editInfoStart || {}, info = {};
  const now = { title: $('#edit-title').value.trim(), author: $('#edit-author').value.trim(), publisher: $('#edit-publisher').value.trim(), date: $('#edit-date').value };
  if (now.title !== start.title.trim()) info.title = now.title;
  if (now.author !== start.author.trim()) info.author = now.author;
  if (now.publisher !== start.publisher.trim()) info.publisher = now.publisher;
  if (now.date !== start.date) info.date = isoToPuzzleDate(now.date);
  const circs = [...cur.editCircles];
  if (!flips.length && !circs.length && !Object.keys(info).length) { stopEditGrid(); return; }
  const id = cur.id;
  const rec = local.getPuzzle(id);
  let raw, model;
  try {
    raw = rec.raw;
    if (flips.length) raw = editGrid(raw, flips);
    if (circs.length) raw = editCircles(raw, circs);
    if (Object.keys(info).length) raw = editInfo(raw, info);
    model = parseIpuz(raw);
  }
  catch (e) { toast(`Couldn't update the puzzle: ${e.message}`, 5000); return; }
  // clear any letters in squares that are now black
  const nowBlack = flips.filter(i => model.cells[i].block && valueAt(i)).map(i => [i, '']);
  if (nowBlack.length) setCells(nowBlack);
  const meta = { ...rec.meta, title: model.title, author: model.author, publisher: model.publisher, date: model.date, cells: openCellCount(model), rev: Date.now() };
  local.putPuzzle(id, { raw, meta });
  uploadPuzzle(id, { raw, meta });
  flushPush();
  stopEditGrid();
  reopenPuzzle();
  // warn if the clue numbers no longer line up with the grid
  const unmatched = flips.length ? [...model.clues.across, ...model.clues.down].filter(c => !c.entryIds.length && !c.seeOf).length : 0;
  const kinds = [flips.length, circs.length, Object.keys(info).length].filter(Boolean).length;
  const what = kinds > 1 ? 'Puzzle updated' : flips.length ? 'Grid updated' : circs.length ? 'Circles updated' : 'Details updated';
  toast(unmatched ? `${what}, but ${unmatched} clue${unmatched > 1 ? 's' : ''} no longer match the grid` : what, unmatched ? 5000 : 2600);
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
  // clientWidth/Height include the board's padding, so take it off to get the real space
  const cs = getComputedStyle(board);
  const bw = board.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const bh = board.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  if (!bw || !bh) return;
  const cell = Math.max(14, Math.floor(Math.min((bw - 4 - (W - 1)) / W, (bh - 4 - (H - 1)) / H, 64)));
  $('#grid').style.setProperty('--cell', `${cell}px`);
}
new ResizeObserver(sizeGrid).observe($('#board'));

// ======================================================================
// Anagrammer dialog
// ======================================================================
// Circled squares in reading order (row by row).
const circledCells = () => (cur ? cur.model.cells.map((c, i) => (c.circle && !c.block && !c.void ? i : -1)).filter(i => i >= 0) : []);
function openCircles() {
  const cells = circledCells();
  if (!cells.length) return;
  const letters = cells.map(i => valueAt(i));
  const got = letters.filter(Boolean).length;
  const box = $('#circ-letters');
  box.innerHTML = '';
  for (const ch of letters) {
    const s = document.createElement('span');
    s.textContent = ch || '';
    if (!ch) s.className = 'empty';
    box.appendChild(s);
  }
  $('#circ-note').textContent = `${got} of ${cells.length} filled in · read row by row, left to right`;
  $('#btn-circles-wp').disabled = !got;
  $('#btn-circles-show').textContent = $('#grid').classList.contains('show-circles') ? 'Stop showing in grid' : 'Show in grid';
  $('#dlg-circles').showModal();
}
$('#btn-circles-close').addEventListener('click', () => $('#dlg-circles').close());
$('#btn-circles-show').addEventListener('click', () => {
  $('#grid').classList.toggle('show-circles');
  $('#dlg-circles').close();
});
$('#btn-circles-wp').addEventListener('click', () => { $('#dlg-circles').close(); openAnagram('circles'); });

let anagramSource = 'clue';
const anagram = createAnagrammer($('#anagram-body'), {
  getPattern() {
    if (!cur) return null;
    if (anagramSource === 'circles') {
      const cells = circledCells();
      const n = cells.length;
      return { label: 'Circled letters', clue: '', letters: Array(n).fill(''), fixed: Array(n).fill(false), breaks: [],
        start: cells.map(i => valueAt(i)).join(''), noFill: true };
    }
    const cl = activeClue();
    if (!cl) return null;
    const cells = activeWordCells();
    const clue = String(cl.text || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
    const enumTxt = cl.enumeration && !hasEnum(clue) ? ` (${cl.enumeration})` : '';
    const { model } = cur;
    // a letter is "fixed" if the crossing answer through that square is completely filled in
    // 'confirmed' if the crossing answer (or this one) is marked as confirmed,
    // 'cross' if the crossing answer is completely filled in, otherwise not fixed
    const selfConfirmed = isConfirmed(cl.id) && clueComplete(cl);
    const fixed = cells.map(i => {
      if (!valueAt(i)) return false;
      if (selfConfirmed) return 'confirmed';
      const own = cl.entryIds.map(id => model.entries[id]).find(e => e?.cells.includes(i));
      const other = own?.dir === 'down' ? 'across' : 'down';
      const cross = model.entries[model.cellEntries[i][other]];
      if (!cross || !cross.cells.every(c => valueAt(c))) return false;
      const crossClue = cur.entryClue[cross.id];
      return crossClue && isConfirmed(crossClue.id) ? 'confirmed' : 'cross';
    });
    const en = parseEnumeration(cl);
    const breaks = en && en.total === cells.length ? en.breaks : [];
    // the answer's letters, for WordPlay's "Check letters" (only when every square has one)
    const sols = cells.map(i => model.cells[i].solution);
    const answer = model.hasSolution && sols.every(Boolean) ? sols.join('') : null;
    return { label: clueLong(cl), clue: clue + enumTxt, letters: cells.map(i => valueAt(i)), fixed, breaks, answer };
  },
  onFill(letters) {
    if (!cur) return;
    const cells = activeWordCells();
    if (letters.length !== cells.length) return;
    // gaps leave the grid square as it is
    setCells(cells.map((i, k) => [i, letters[k]]).filter(([, ch]) => ch));
    checkComplete(true);
    update();
    $('#dlg-anagram').close();
    toast(`Filled in ${letters.map(c => c || '·').join('')}`);
  },
});
function openAnagram(source = 'clue') { anagramSource = source; $('#dlg-anagram').showModal(); anagram.open(); }
$('#btn-anagram-close').addEventListener('click', () => $('#dlg-anagram').close());

// ======================================================================
// Full screen: hide the app's top bar while solving and, where the browser
// allows it (iPad, Android, desktop), hide the browser's own bars too.
// ======================================================================
const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement;
const fsSupported = () => !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches || navigator.standalone === true;
function setFocusMode(on) {
  document.body.classList.toggle('focus', on);
  for (const b of $$('[data-act="fullscreen"]')) {
    b.title = on ? 'Exit full screen' : 'Full screen';
    b.setAttribute('aria-label', b.title);
  }
}
async function toggleFullscreen() {
  if (document.body.classList.contains('focus')) {
    setFocusMode(false);
    if (fsEl()) (document.exitFullscreen || document.webkitExitFullscreen).call(document)?.catch?.(() => {});
    return;
  }
  setFocusMode(true);
  if (fsSupported() && !isStandalone()) {
    const el = document.documentElement;
    try { await (el.requestFullscreen || el.webkitRequestFullscreen).call(el); } catch {}
  } else if (!isStandalone()) {
    toast('For true full screen on iPhone: Share → Add to Home Screen, then open Crossword from there', 6000);
  }
}
// leaving browser full screen (swipe, Esc) also leaves focus mode
for (const ev of ['fullscreenchange', 'webkitfullscreenchange']) {
  document.addEventListener(ev, () => { if (!fsEl() && fsSupported() && !isStandalone()) setFocusMode(false); });
}

// ======================================================================
// Settings / sync
// ======================================================================
onSyncStatus(({ state, message }) => {
  const pill = $('#sync-pill');
  pill.dataset.state = state;
  $('.txt', pill).textContent = { off: 'Sync off', ok: 'Synced', syncing: 'Syncing', error: 'Sync error', offline: 'Offline', signin: 'Sign in' }[state] || state;
  pill.title = message;
});

// ---- appearance ----
const T = window.cwTheme;
function buildColourPreview() {
  // a tiny 5×3 grid using the real cell styles: a highlighted word with the selected square, plus blocks
  const cells = [
    ['word', 'C', '1'], ['sel', 'L'], ['word', 'U'], ['word', 'E'], ['block'],
    ['', 'A', '2'], ['block'], ['', ''], ['block'], ['', ''],
    ['', 'T', '3'], ['', 'R'], ['', 'E'], ['', 'A'], ['', 'T'],
  ];
  $('#colour-preview').innerHTML = cells.map(([cls, ch, num]) =>
    cls === 'block' ? '<div class="cell block"></div>'
      : `<div class="cell ${cls}">${num ? `<span class="num">${num}</span>` : ''}<span class="ltr">${ch}</span></div>`).join('');
}
function syncAppearanceUI() {
  for (const r of $$('input[name="theme"]')) r.checked = r.value === T.state.theme;
  const on = T.state.customOn;
  $('#pref-colours').checked = on;
  $('#colour-panel').hidden = !on;
  const c = { ...T.current(), ...(T.state.colours || {}) };
  for (const btn of $$('[data-colour]')) btn.querySelector('.swatch').style.background = toHex(c[btn.dataset.colour]) || '#000000';
  if (!on) closePicker();
}
function toHex(v) {
  v = String(v || '').trim();
  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(v)) return '#' + [...v.slice(1)].map(x => x + x).join('').toLowerCase();
  const m = v.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  return m ? '#' + m.slice(1, 4).map(n => (+n).toString(16).padStart(2, '0')).join('') : null;
}
$('#colour-presets').innerHTML = Object.entries(T.PRESETS).map(([id, p]) =>
  `<button type="button" class="preset" data-preset="${id}"><i style="background:${p.paper}"></i><i style="background:${p.block}"></i><i style="background:${p.sel}"></i>${p.name}</button>`).join('');
buildColourPreview();
for (const r of $$('input[name="theme"]')) r.addEventListener('change', () => { T.state.theme = r.value; syncAppearanceUI(); });
$('#pref-colours').addEventListener('change', e => {
  if (e.target.checked && !T.state.colours) {
    // start from whatever is on screen now
    const c = {};
    for (const k of T.KEYS) c[k] = toHex(T.current()[k]);
    T.state.colours = c;
  }
  T.state.customOn = e.target.checked;
  syncAppearanceUI();
});
// ---- colour picker: hue / strength / lightness sliders that always start on the current colour ----
const hexToHsl = hex => {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
};
const hslToHex = ({ h, s, l }) => {
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
  return '#' + [f(0), f(8), f(4)].map(x => x.toString(16).padStart(2, '0')).join('');
};
let picking = null; // { key, hsl }
function openPicker(key, label) {
  const hex = toHex({ ...T.current(), ...(T.state.colours || {}) }[key]) || '#808080';
  picking = { key, hsl: hexToHsl(hex) };
  $('#picker-title').textContent = label;
  $$('[data-colour]').forEach(b => b.classList.toggle('editing', b.dataset.colour === key));
  $('#colour-picker').hidden = false;
  paintPicker(hex);
}
function closePicker() {
  picking = null;
  $('#colour-picker').hidden = true;
  $$('[data-colour]').forEach(b => b.classList.remove('editing'));
}
function paintPicker(hex, keepHexBox = false) {
  const { h, s, l } = picking.hsl;
  for (const r of $$('[data-hsl]')) r.value = picking.hsl[r.dataset.hsl];
  if (!keepHexBox) $('#picker-hex').value = hex;
  $('#picker-swatch').style.background = hex;
  // slider tracks show what each slider will do
  const p = $('#colour-picker');
  p.style.setProperty('--sat-track', `linear-gradient(to right, hsl(${h} 0% ${l}%), hsl(${h} 100% ${l}%))`);
  p.style.setProperty('--light-track', `linear-gradient(to right, #000, hsl(${h} ${s}% 50%), #fff)`);
}
function setPicked(hex) {
  T.state.colours = { ...(T.state.colours || {}), [picking.key]: hex };
  $(`[data-colour="${picking.key}"] .swatch`).style.background = hex;
  paintPicker(hex);
}
for (const btn of $$('[data-colour]')) btn.addEventListener('click', () => {
  if (picking?.key === btn.dataset.colour) closePicker();
  else openPicker(btn.dataset.colour, btn.querySelector('span').textContent);
});
for (const r of $$('[data-hsl]')) r.addEventListener('input', () => {
  picking.hsl[r.dataset.hsl] = +r.value;
  setPicked(hslToHex(picking.hsl));
});
$('#picker-hex').addEventListener('input', e => {
  const v = toHex(e.target.value.startsWith('#') ? e.target.value : '#' + e.target.value);
  if (!v) return;
  picking.hsl = hexToHsl(v);
  T.state.colours = { ...(T.state.colours || {}), [picking.key]: v };
  $(`[data-colour="${picking.key}"] .swatch`).style.background = v;
  paintPicker(v, true);
});
$('#picker-done').addEventListener('click', closePicker);

$('#colour-presets').addEventListener('click', e => {
  const id = e.target.closest('[data-preset]')?.dataset.preset;
  if (!id) return;
  const { name, ...c } = T.PRESETS[id];
  T.state.colours = c;
  closePicker();
  syncAppearanceUI();
});
$('#btn-colours-reset').addEventListener('click', () => {
  T.state.colours = null;          // drop custom values so the theme's own colours show
  const c = {};
  for (const k of T.KEYS) c[k] = toHex(T.current()[k]);
  T.state.colours = c;             // then start the pickers from them
  closePicker();
  syncAppearanceUI();
});

// keyboard position on wide touch screens
const kbPos = () => { try { return localStorage.getItem('cw.kbPos') || 'grid'; } catch { return 'grid'; } };
function applyKbPos() { document.body.classList.toggle('kb-clues', kbPos() === 'clues'); }
applyKbPos();
for (const r of $$('input[name="kbpos"]')) r.addEventListener('change', () => {
  try { localStorage.setItem('cw.kbPos', r.value); } catch {}
  applyKbPos();
});

// ---------- Puzzle folder (Google Drive) ----------
function driveStatus() {
  const msg = $('#drive-msg');
  $('#btn-drive-get').disabled = !driveConfigured();
  if (!driveConfigured()) { msg.textContent = 'Not set up yet: this site needs a Google API key (see the README).'; return; }
  const last = driveLast.get();
  msg.textContent = last ? `Last checked ${new Date(last).toLocaleString('en-AU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}.` : '';
}
$('#btn-drive-get').addEventListener('click', async () => {
  const btn = $('#btn-drive-get'), msg = $('#drive-msg');
  const id = folderIdFrom($('#drive-folder').value);
  if (!id) { msg.textContent = 'Paste the folder\'s share link first.'; return; }
  driveFolder.set($('#drive-folder').value);
  btn.disabled = true;
  msg.textContent = 'Checking the folder…';
  try {
    const all = await listFolder(id);
    if (!all.length) { msg.textContent = 'No .ipuz files found in that folder.'; return; }
    const fresh = all.filter(f => !driveSeen.has(f.id));
    driveLast.set();
    if (!fresh.length) { msg.textContent = `No new puzzles (${all.length} already fetched).`; return; }
    if (!driveSeen.size() && fresh.length > 1 && !confirm(`Found ${fresh.length} puzzles in that folder.\n\nAdd them all to your library?`)) {
      msg.textContent = 'Nothing added.'; return;
    }
    let added = 0, updated = 0, had = 0, skipped = 0;
    const unreadable = [], missed = [];
    for (const [k, f] of fresh.entries()) {
      msg.textContent = `Fetching ${k + 1} of ${fresh.length}…`;
      let raw;
      try { raw = await fetchFileText(f.id); } catch { missed.push(f.name); continue; } // try again next time
      try {
        const r = await importRaw(raw);
        if (r.declined) skipped++; else if (r.updated) updated++; else if (r.isNew) added++; else had++;
      } catch { unreadable.push(f.name); }
      driveSeen.add(f.id); // not asked about again, even if you later delete it
    }
    renderLibrary();
    const bits = [];
    if (added) bits.push(`${added} new puzzle${added > 1 ? 's' : ''} added`);
    if (updated) bits.push(`answers added to ${updated}`);
    if (had) bits.push(`${had} already in your library`);
    if (skipped) bits.push(`${skipped} skipped`);
    if (unreadable.length) bits.push(`couldn't read: ${unreadable.join(', ')}`);
    if (missed.length) bits.push(`couldn't download: ${missed.join(', ')} (press again to retry)`);
    msg.textContent = bits.join('; ') + '.';
    if (added || updated) toast(`Fetched ${added + updated} puzzle${added + updated > 1 ? 's' : ''} from Drive`);
  } catch (e) {
    msg.textContent = e.message;
  } finally {
    btn.disabled = !driveConfigured();
  }
});

function openSettings() {
  $('#drive-folder').value = driveFolder.get();
  driveStatus();
  syncAppearanceUI();
  for (const r of $$('input[name="kbpos"]')) r.checked = r.value === kbPos();
  $('#token-input').value = local.token();
  $('#settings-msg').textContent = '';
  $('#btn-sync-off').hidden = !local.token();
  const u = local.syncUser();
  if (local.token() && u) $('#settings-msg').textContent = `Syncing as ${u}.`;
  const signed = local.signedIn();
  $('#btn-signin').hidden = signed;
  $('#btn-signout').hidden = !signed;
  $('#signin-msg').textContent = signed ? `Signed in as ${local.email() || 'you'} – syncing.`
    : local.token() ? 'Syncing with a sync key. Sign in with Google to switch over.' : '';
  // The sync-key option is only for devices already using one (and the pages.dev
  // test addresses, where Google sign-in isn't available). Everyone else signs in with Google.
  const keyAllowed = !!local.token() || location.hostname.endsWith('.pages.dev') || location.hostname === 'localhost';
  $('#key-details').hidden = !keyAllowed;
  $('#key-details').open = !!local.token();
  $('#pref-skip').checked = prefs.skipFilled;
  $('#dlg-settings').showModal();
}
$('#btn-settings').addEventListener('click', openSettings);
$('#pref-skip').addEventListener('change', e => { prefs.skipFilled = e.target.checked; });
$('#sync-pill').addEventListener('click', () => {
  const st = $('#sync-pill').dataset.state;
  // a rejected key or being signed out needs Settings; any other error is worth a retry
  if (st === 'off' || st === 'signin' || (st === 'error' && /rejected/i.test($('#sync-pill').title))) openSettings();
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
    var r = await testToken(token);
    if (!r.ok) { msg.textContent = `Couldn't connect: ${r.message}`; return; }
  } catch { msg.textContent = "Couldn't reach the server (offline?)"; return; }
  // Switching to someone else's key: don't mix their library with the one on this device.
  const prev = local.syncUser();
  const hasLocal = Object.keys(local.puzzles()).length > 0;
  if (prev != null && prev !== r.user && hasLocal) {
    const who = r.user ? `${r.user}'s` : 'the main';
    if (!confirm(`This is ${who} sync key. Switch this device over to its puzzles?\n\nThe puzzles currently on this device stay safe on the server under the other key.`)) {
      msg.textContent = 'Not changed.';
      return;
    }
    location.hash = '';
    local.clearLibrary();
  }
  local.setToken(token);
  local.setSignedIn(false);
  local.setSyncUser(r.user);
  $('#dlg-settings').close();
  toast(r.user ? `Sync is on – syncing as ${r.user}` : 'Sync is on');
  renderLibrary();
  syncAll(onRemoteChange);
});
$('#btn-sync-off').addEventListener('click', () => {
  local.setToken('');
  $('#dlg-settings').close();
  syncAll();
  toast('Sync turned off on this device');
});
$('#btn-settings-close').addEventListener('click', () => $('#dlg-settings').close());

// ---- Google sign-in (Cloudflare Access protects /login) ----
$('#btn-signin').addEventListener('click', () => { location.href = '/login'; });
$('#btn-signout').addEventListener('click', () => {
  local.setSignedIn(false);
  signOutRemote();
  $('#dlg-settings').close();
  syncAll();
  toast('Signed out on this device');
});
// /login sends the browser back to #/signed-in
async function completeSignIn(loginReason) {
  history.replaceState(null, '', location.pathname + location.search);
  let r;
  if (loginReason) r = { ok: false, reason: loginReason };
  else { try { r = await checkSession(); } catch { r = { ok: false, reason: 'offline' }; } }
  if (!r.ok) { toast(`Couldn't finish signing in (${r.reason || 'unknown'}) – please try again`, 6000); return; }
  // Moving to a different library: don't mix it with the one on this device.
  const prev = local.syncUser();
  const hasLocal = Object.keys(local.puzzles()).length > 0;
  if (prev != null && prev !== r.user && hasLocal) {
    if (!confirm(`${r.email} has a different library from the one on this device. Switch this device over to it?\n\nThe puzzles currently on this device stay safe on the server.`)) {
      toast('Not changed');
      return;
    }
    local.clearLibrary();
  }
  local.setToken('');
  local.setSignedIn(true);
  local.setEmail(r.email);
  local.setSyncUser(r.user);
  toast(`Signed in as ${r.email}`);
  renderLibrary();
  syncAll(onRemoteChange);
}

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
  else syncAll(onRemoteChange, { auto: true });
});
window.addEventListener('pagehide', flushPush);
window.addEventListener('online', () => syncAll(onRemoteChange, { auto: true }));
// while a puzzle is open, pick up changes from other devices
setInterval(() => {
  if (!cur || document.visibilityState !== 'visible' || !local.syncOn() || pushTimer) return;
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
  const signedIn = location.hash.match(/^#\/signed-in(?:\/(.*))?$/);
  if (signedIn) { closePuzzle(); renderLibrary(); showView('library'); completeSignIn(signedIn[1] && decodeURIComponent(signedIn[1])); return; }
  const share = location.hash.match(/^#\/s\/([A-Za-z0-9_-]+)/);
  if (share) { closePuzzle(); openShareLink(share[1]); return; }
  const m = location.hash.match(/^#\/p\/([a-f0-9]+)/);
  if (m) { if (cur?.id !== m[1]) { closePuzzle(); openPuzzle(m[1]); } }
  else { closePuzzle(); renderLibrary(); showView('library'); }
}
window.addEventListener('hashchange', route);
$('#btn-home').addEventListener('click', () => { location.hash = ''; });

route();
syncAll(onRemoteChange, { auto: true });
// devices that were syncing before per-person keys existed: remember whose key they use
if (local.token() && local.syncUser() == null) testToken(local.token()).then(r => { if (r.ok) local.setSyncUser(r.user); }).catch(() => {});
