// WordPlay (the anagrammer).
// Letters are loaded by tapping clue words or typing, then arranged on an
// "answer board" laid out like the answer: one square per letter, split into
// words / hyphenated parts. Each tile sits in a particular square, so gaps can
// be left anywhere (for letters you don't know yet). Moving a tile onto a
// square swaps it with whatever is there.
// Letters confirmed by a completed crossing answer start locked; press and hold
// any letter to lock it where it is, and again to unlock it.

const LONG_PRESS_MS = 550;

export function createAnagrammer(root, { getPattern, onFill } = {}) {
  root.innerHTML = `
    <div class="ana-clue" hidden>
      <div class="ana-clue-text"></div>
      <p class="ana-hint">Tap words to load their letters (tap again to remove).</p>
    </div>
    <div class="seg ana-modes" role="radiogroup" aria-label="Which letters to load" hidden>
      <label><input type="radio" name="ana-mode" value="all" checked><span>All letters</span></label>
      <label><input type="radio" name="ana-mode" value="odd"><span>Odd letters</span></label>
      <label><input type="radio" name="ana-mode" value="even"><span>Even letters</span></label>
    </div>
    <label class="ana-join" hidden><input type="checkbox"> Treat selected words as one</label>
    <label class="ana-label" for="ana-input">Letters</label>
    <input id="ana-input" class="ana-input" type="text" autocomplete="off" autocorrect="off"
      autocapitalize="characters" spellcheck="false" placeholder="Type letters…" maxlength="40">
    <div class="ana-board-head"><span class="ana-board-label"></span><span class="ana-count"></span></div>
    <div class="ana-board" aria-live="polite"></div>
    <div class="ana-actions">
      <button type="button" class="btn" data-act="shuffle">⤮ Shuffle</button>
      <button type="button" class="btn" data-act="reset">↺ Reset</button>
      <button type="button" class="btn ghost" data-act="clear">Clear</button>
      <button type="button" class="btn primary ana-fill" data-act="fill" disabled>Fill in answer</button>
    </div>
    <p class="ana-hint">Drag a tile to any square (leave gaps for letters you don't have yet), or tap two to swap. Press and hold a letter to lock it in place; hold again to unlock.<span class="ana-lock-hint"> Blue 🔒 letters come from finished crossing answers; green ✔ ones from answers you've confirmed.</span></p>`;

  const input = root.querySelector('.ana-input');
  const board = root.querySelector('.ana-board');
  const boardLabel = root.querySelector('.ana-board-label');
  const countEl = root.querySelector('.ana-count');
  const lockHint = root.querySelector('.ana-lock-hint');
  const clueEl = root.querySelector('.ana-clue');
  const clueTextEl = root.querySelector('.ana-clue-text');
  const modesEl = root.querySelector('.ana-modes');
  const joinEl = root.querySelector('.ana-join');
  let mode = 'all'; // which letters a tapped word gives: all, odd (1st, 3rd…) or even (2nd, 4th…)
  let joined = false; // count odd/even along all the selected words instead of within each one
  let loadedFromWords = ''; // the letters currently loaded from clue words

  let pattern = null;     // { label, clue, letters[], fixed[], breaks[] }
  let lastClueKey = null;
  let locked = new Map(); // slot -> letter locked in that square
  let place = [];         // slot -> tile placed there (or null); ignored for locked slots
  let spare = [];         // tiles not on the answer
  let nextId = 1;
  let selected = null;    // position picked for tap-to-swap: 's:<slot>' or 'x:<index>'
  let dragging = false;
  let drag = null;
  let dragId = null;      // tile being dragged (shown as a placeholder where it currently sits)

  const lettersOf = s => String(s).toUpperCase().replace(/[^A-Z]/g, '').split('');
  const N = () => (pattern ? pattern.letters.length : 0);
  const freeSlots = () => [...Array(N()).keys()].filter(s => !locked.has(s));
  const allTiles = () => [...place.filter(Boolean), ...spare];

  // ---------- positions ----------
  const getAt = pos => { const [k, n] = pos.split(':'); return k === 's' ? place[+n] || null : spare[+n] || null; };
  function setAt(pos, tile) {
    const [k, n] = pos.split(':');
    if (k === 's') place[+n] = tile;
    else if (n === 'end' || +n >= spare.length) { if (tile) spare.push(tile); }
    else spare[+n] = tile;
  }
  // swap the contents of two positions (either may be empty)
  function swap(a, b) {
    if (a === b) return;
    const ta = getAt(a), tb = getAt(b);
    setAt(a, tb); setAt(b, ta);
    spare = spare.filter(Boolean);
  }

  // ---------- letters in play ----------
  // Tiles = typed letters minus any locked on the board. Existing tiles keep their
  // squares; new letters go into the first empty squares, then the spare row.
  function setFromInput({ preferSlot = null } = {}) {
    const need = lettersOf(input.value);
    for (const ch of locked.values()) {
      const at = need.indexOf(ch);
      if (at >= 0) need.splice(at, 1);
    }
    const keep = t => { if (!t) return null; const at = need.indexOf(t.ch); if (at < 0) return null; need.splice(at, 1); return t; };
    place = Array.from({ length: N() }, (_, s) => (locked.has(s) ? null : keep(place[s])));
    spare = spare.map(keep).filter(Boolean);
    const fresh = need.map(ch => ({ id: nextId++, ch }));
    if (preferSlot != null && !locked.has(preferSlot) && !place[preferSlot]) {
      const ch = pattern.letters[preferSlot];
      const at = fresh.findIndex(t => t.ch === ch);
      if (at >= 0) place[preferSlot] = fresh.splice(at, 1)[0];
    }
    for (const t of fresh) {
      const s = freeSlots().find(i => !place[i]);
      if (s != null) place[s] = t; else spare.push(t);
    }
    if (selected && !getAt(selected)) selected = null;
    render();
  }

  function toggleLock(slot) {
    if (!pattern) return;
    if (locked.has(slot)) {
      const ch = locked.get(slot);
      locked.delete(slot);
      setFromInput({ preferSlot: slot }); // the letter comes back as a tile in the same square
      // a letter locked from the grid that wasn't among the typed letters still comes back as a tile
      if (!place[slot]) { place[slot] = { id: nextId++, ch }; input.value += ch; }
    } else {
      const t = place[slot];
      if (!t) return;
      place[slot] = null;
      locked.set(slot, t.ch);
      setFromInput();
    }
    navigator.vibrate?.(15);
    render();
    board.querySelector(`[data-pos="s:${slot}"]`)?.classList.add('lock-flash');
  }

  // ---------- rendering ----------
  function tileEl(cls, ch, attrs = {}) {
    const el = document.createElement('div');
    el.className = cls;
    el.textContent = ch || '';
    for (const [k, v] of Object.entries(attrs)) el.dataset[k] = v;
    return el;
  }
  const tileFor = (t, pos, extra = '') =>
    tileEl(`ana-tile${extra}${selected === pos ? ' selected' : ''}${dragId === t.id ? ' placeholder' : ''}`, t.ch, { pos, id: t.id });

  function render() {
    board.innerHTML = '';
    const lens = [];
    if (pattern) {
      const n = N();
      const breakAt = new Map(pattern.breaks.map(b => [b.after, b.type]));
      const ans = document.createElement('div');
      ans.className = 'ana-answer';
      let group = null, groupLen = 0;
      for (let s = 0; s < n; s++) {
        if (!group) { group = document.createElement('div'); group.className = 'ana-group'; groupLen = 0; }
        const grid = pattern.letters[s];
        const pos = `s:${s}`;
        let el;
        if (locked.has(s)) {
          const ch = locked.get(s);
          const fromGrid = pattern.fixed[s] && ch === grid;
          const sure = fromGrid && pattern.fixed[s] === 'confirmed';
          el = tileEl(`ana-tile locked ${fromGrid ? 'from-grid' : 'mine'}${sure ? ' sure' : ''}`, ch, { pos, slot: s });
          if (grid && grid !== ch) el.classList.add('clash');
          el.title = sure ? 'From a confirmed answer – press and hold to unlock' : fromGrid ? 'From a finished crossing answer – press and hold to unlock' : 'Locked – press and hold to unlock';
        } else if (place[s]) {
          el = tileFor(place[s], pos);
          el.dataset.slot = s;
          if (grid && grid !== place[s].ch) el.classList.add('clash');
        } else {
          el = tileEl('ana-slot', grid, { pos, slot: s });
          if (grid) el.classList.add('hint');
          if (selected) el.classList.add('target');
        }
        group.appendChild(el);
        groupLen++;
        const br = breakAt.get(s + 1);
        if (br || s === n - 1) {
          if (br === 'hyphen') { const h = document.createElement('span'); h.className = 'ana-sep'; h.textContent = '-'; group.appendChild(h); }
          ans.appendChild(group); lens.push(groupLen); group = null;
        }
      }
      board.appendChild(ans);
    }

    // letters not on the answer (also where you can drag a tile to take it off)
    if (spare.length || !pattern || dragging || (selected && selected.startsWith('s:'))) {
      const wrap = document.createElement('div');
      wrap.className = 'ana-spare' + (pattern ? '' : ' alone');
      if (pattern) wrap.innerHTML = `<span class="ana-spare-label${spare.length ? '' : ' quiet'}">${spare.length ? 'Not placed' : 'Drop here to take a letter off'}</span>`;
      spare.forEach((t, j) => wrap.appendChild(tileFor(t, `x:${j}`, ' spare')));
      if (pattern) wrap.appendChild(tileEl('ana-slot drop', '', { pos: 'x:end' }));
      if (!pattern && !spare.length) wrap.innerHTML = '<span class="ana-empty">Your tiles will appear here</span>';
      board.appendChild(wrap);
    }

    lockHint.hidden = !pattern?.fixed.some(Boolean);
    sizeTiles(pattern ? lens : [Math.min(Math.max(1, spare.length), 10)]);
    updateFill();
  }

  // Size tiles so the longest word fits on one line (long words get smaller tiles).
  let lastLens = [1];
  function sizeTiles(lens) {
    lastLens = lens;
    const w = board.clientWidth - 24; // board padding
    if (w <= 0) return;
    const longest = Math.max(...lens, 1);
    const fit = Math.floor((w - 2) / (longest + (longest - 1) * 0.12));
    // shrink long words a little, but not below a comfortable size for dragging;
    // past that, a very long word is allowed to wrap onto a second line
    const MIN = 26;
    const size = Math.max(MIN, Math.min(46, fit));
    board.classList.toggle('wrap-words', fit < MIN);
    board.style.setProperty('--tile', `${size}px`);
    board.style.setProperty('--gap', `${Math.max(2, Math.round(size * 0.12))}px`);
  }
  new ResizeObserver(() => sizeTiles(lastLens)).observe(board);

  // letters for each square ('' for a gap); null if nothing is on the board
  function answerLetters() {
    if (!pattern) return null;
    const out = pattern.letters.map((_, s) => (locked.has(s) ? locked.get(s) : place[s]?.ch || ''));
    return out.some(Boolean) ? out : null;
  }

  function updateFill() {
    const btn = root.querySelector('.ana-fill');
    btn.hidden = !pattern;
    if (!pattern) { countEl.textContent = ''; return; }
    const empty = freeSlots().filter(s => !place[s]).length;
    const letters = answerLetters();
    btn.disabled = !letters;
    btn.title = !letters ? 'Put some letters on the board first'
      : `Put ${letters.map(c => c || '·').join('')} into ${pattern.label}${empty ? ' (empty squares are left as they are)' : ''}`;
    // Letters already in the grid (locked) that your loaded letters don't account for
    // still have to come from somewhere, so count them as missing too.
    const typed = lettersOf(input.value);
    const take = ch => { const at = typed.indexOf(ch); if (at < 0) return false; typed.splice(at, 1); return true; };
    const gridLocks = [];
    for (const [s, ch] of locked) {
      const fromGrid = pattern.fixed[s] && ch === pattern.letters[s];
      if (!fromGrid) take(ch);                // letters you locked yourself came from your tiles
      else gridLocks.push([s, ch]);
    }
    const uncovered = gridLocks.filter(([, ch]) => !take(ch));
    const missing = empty + uncovered.length;
    const parts = [];
    if (missing) {
      let txt = `${missing} letter${missing === 1 ? '' : 's'} missing`;
      if (uncovered.length) {
        const chs = uncovered.map(([, ch]) => ch);
        const list = chs.length === 1 ? chs[0] : `${chs.slice(0, -1).join(', ')} and ${chs[chs.length - 1]}`;
        const allSure = uncovered.every(([s]) => pattern.fixed[s] === 'confirmed');
        txt += allSure ? `, including the confirmed ${list}` : `, including the ${list} already in the grid`;
      }
      parts.push(txt);
    }
    if (spare.length) parts.push(`${spare.length} not placed`);
    countEl.textContent = parts.join(' · ');
    countEl.classList.toggle('over', spare.length > 0 && empty === 0);
  }

  // Shuffle the letters among the squares they're in (gaps and locked letters stay put).
  function shuffle() {
    const spots = freeSlots().filter(s => place[s]);
    if (spots.length < 2) return;
    const before = spots.map(s => place[s].ch).join('');
    const tiles = spots.map(s => place[s]);
    for (let tries = 0; tries < 10; tries++) {
      for (let i = tiles.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
      }
      if (tiles.map(t => t.ch).join('') !== before) break;
    }
    spots.forEach((s, i) => { place[s] = tiles[i]; });
    selected = null;
    render();
    board.classList.remove('shuffled'); void board.offsetWidth; board.classList.add('shuffled');
  }

  // Put everything back in order from the first square, leaving no gaps.
  function resetOrder() {
    const tiles = allTiles();
    place = Array.from({ length: N() }, () => null);
    spare = [];
    for (const t of tiles) {
      const s = freeSlots().find(i => !place[i]);
      if (s != null) place[s] = t; else spare.push(t);
    }
    selected = null;
    render();
  }

  // ---------- buttons, input, clue words ----------
  root.addEventListener('click', e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'fill') { const l = answerLetters(); if (l) onFill?.(l); }
    if (act === 'shuffle') shuffle();
    if (act === 'reset') resetOrder();
    if (act === 'clear') {
      input.value = ''; place = []; spare = []; selected = null;
      for (const [s, ch] of [...locked]) if (!(pattern?.fixed[s] && pattern.letters[s] === ch)) locked.delete(s);
      clueTextEl.querySelectorAll('.ana-word.on').forEach(w => { w.classList.remove('on'); paintWord(w); });
      loadedFromWords = '';
      setFromInput();
    }
  });
  input.addEventListener('input', () => setFromInput());

  const removeLetters = letters => {
    const v = input.value.toUpperCase().split('');
    for (const ch of letters) {
      const at = v.lastIndexOf(ch);
      if (at >= 0) v.splice(at, 1);
    }
    input.value = v.join('');
  };
  // Which letters each selected word gives: all of them, or odd/even counted within each word –
  // or, with "Treat selected words as one", counted along all the selected words in clue order.
  function wordPicks() {
    const picks = new Map(); // word button -> Set of letter positions used
    let k = 0;
    for (const w of clueTextEl.querySelectorAll('.ana-word.on')) {
      const n = lettersOf(w.dataset.letters).length;
      const used = new Set();
      for (let j = 0; j < n; j++) {
        const pos = joined ? k + j : j;
        if (mode === 'all' || (mode === 'odd' ? pos % 2 === 0 : pos % 2 === 1)) used.add(j);
      }
      k += n;
      picks.set(w, used);
    }
    return picks;
  }
  // Show which letters of a selected word went in (the others are faded).
  function paintWord(w, used) {
    let k = 0;
    w.innerHTML = '';
    for (const ch of w.dataset.letters) {
      const sp = document.createElement('span');
      sp.textContent = ch;
      if (/[A-Za-z]/.test(ch)) {
        if (used && !used.has(k)) sp.className = 'skip';
        k++;
      }
      w.appendChild(sp);
    }
  }
  // Swap the letters the clue words gave for a fresh set (after a tap or a change of mode).
  function reloadWords() {
    removeLetters(lettersOf(loadedFromWords));
    const picks = wordPicks();
    let add = '';
    for (const [w, used] of picks) add += lettersOf(w.dataset.letters).filter((_, j) => used.has(j)).join('');
    loadedFromWords = add;
    input.value = (input.value + add).toUpperCase();
    for (const w of clueTextEl.querySelectorAll('.ana-word')) paintWord(w, picks.get(w));
    joinEl.hidden = mode === 'all';
    setFromInput();
    // after a reload, letters waiting in "Not placed" go into any empty squares
    for (const s2 of freeSlots()) if (!place[s2] && spare.length) place[s2] = spare.shift();
    render();
  }
  clueTextEl.addEventListener('click', e => {
    const w = e.target.closest('.ana-word');
    if (!w) return;
    w.classList.toggle('on');
    reloadWords();
  });
  modesEl.addEventListener('change', e => { mode = e.target.value; reloadWords(); });
  joinEl.querySelector('input').addEventListener('change', e => { joined = e.target.checked; reloadWords(); });

  // ---------- drag, tap-to-swap, press-and-hold ----------
  const posAt = (x, y) => [...board.querySelectorAll('[data-pos]')].find(t => {
    if (t.classList.contains('locked')) return false;
    const r = t.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  });
  const posOfTile = id => {
    const s = place.findIndex(t => t?.id === id);
    if (s >= 0) return `s:${s}`;
    const j = spare.findIndex(t => t.id === id);
    return j >= 0 ? `x:${j}` : null;
  };

  board.addEventListener('contextmenu', e => e.preventDefault());
  board.addEventListener('pointerdown', e => {
    const el = e.target.closest('[data-pos]');
    if (!el) return;
    e.preventDefault();
    const slot = el.dataset.slot != null ? +el.dataset.slot : null;
    const rect = el.getBoundingClientRect();
    drag = {
      el, pos: el.dataset.pos, slot, pointerId: e.pointerId,
      id: el.dataset.id ? +el.dataset.id : null,
      startX: e.clientX, startY: e.clientY, dx: e.clientX - rect.left, dy: e.clientY - rect.top,
      moved: false, ghost: null, held: false, timer: null,
    };
    // press and hold a letter on the answer to lock / unlock it
    if (slot != null && (locked.has(slot) || drag.id != null)) {
      el.classList.add('pressing');
      drag.timer = setTimeout(() => {
        if (!drag || drag.moved) return;
        drag.held = true;
        toggleLock(slot);
      }, LONG_PRESS_MS);
    }
    board.setPointerCapture(e.pointerId);
  });

  board.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.pointerId || drag.held) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 6) return;
    if (drag.id == null) return; // locked letters and empty squares don't move
    if (!drag.moved) {
      drag.moved = true;
      clearTimeout(drag.timer);
      drag.el.classList.remove('pressing');
      selected = null;
      dragging = true;
      dragId = drag.id;
      const g = drag.el.cloneNode(true);
      g.className = 'ana-tile ghost';
      g.style.setProperty('--tile', getComputedStyle(board).getPropertyValue('--tile'));
      document.body.appendChild(g);
      drag.ghost = g;
      render();
    }
    drag.ghost.style.left = `${e.clientX - drag.dx}px`;
    drag.ghost.style.top = `${e.clientY - drag.dy}px`;
    // moving over a square swaps the dragged tile into it; passing over several
    // tiles slides them along, and an empty square just takes the tile
    const under = posAt(e.clientX, e.clientY);
    const from = posOfTile(drag.id);
    if (under && from && under.dataset.pos !== from && +under.dataset.id !== drag.id) {
      swap(from, under.dataset.pos);
      render();
    }
  });

  const endDrag = e => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    clearTimeout(drag.timer);
    drag.el.classList.remove('pressing');
    const d = drag;
    d.ghost?.remove();
    drag = null; dragId = null; dragging = false;
    if (!d.moved && !d.held) {
      if (d.el.classList.contains('locked')) {
        d.el.classList.remove('nudge'); void d.el.offsetWidth; d.el.classList.add('nudge');
        return;
      }
      // tap: pick a tile, then tap another tile or an empty square to swap / move it there
      if (selected == null) { if (d.id != null) selected = d.pos; }
      else if (selected === d.pos) selected = null;
      else { swap(selected, d.pos); selected = null; }
    }
    render();
  };
  board.addEventListener('pointerup', endDrag);
  board.addEventListener('pointercancel', endDrag);

  render();

  return {
    open() {
      const p = getPattern?.();
      pattern = p || null;
      const key = p ? `${p.label}|${p.clue}` : null;
      const prevKey = lastClueKey;
      if (key !== lastClueKey) {
        // a different clue: start fresh
        lastClueKey = key;
        input.value = ''; place = []; spare = []; selected = null;
        clueEl.hidden = !p?.clue;
        modesEl.hidden = !p?.clue;
        mode = 'all';
        modesEl.querySelector('input[value="all"]').checked = true;
        joined = false;
        joinEl.querySelector('input').checked = false;
        joinEl.hidden = true;
        loadedFromWords = '';
        clueTextEl.innerHTML = '';
        for (const part of (p?.clue || '').split(/(\s+)/)) {
          if (!part) continue;
          if (/^\s+$/.test(part)) { clueTextEl.append(part); continue; }
          if (/[A-Za-z]/.test(part)) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'ana-word';
            b.dataset.letters = part;
            b.textContent = part;
            clueTextEl.append(b);
          } else {
            const sp = document.createElement('span');
            sp.className = 'ana-nonword';
            sp.textContent = part;
            clueTextEl.append(sp);
          }
        }
      }
      // letters confirmed by finished crossing answers start locked;
      // reopening the same clue keeps any letters you locked yourself
      const sameClue = key === prevKey;
      const mine = sameClue ? [...locked].filter(([s, ch]) => !(p.fixed[s] && p.letters[s] === ch)) : [];
      locked = new Map();
      if (p) p.fixed.forEach((f, s) => { if (f) locked.set(s, p.letters[s]); });
      for (const [s, ch] of mine) if (!locked.has(s) && s < p.letters.length) locked.set(s, ch);
      if (!p) { spare = [...place.filter(Boolean), ...spare]; place = []; }
      boardLabel.textContent = p ? p.label : '';
      setFromInput();
      // on phones, don't pop up the keyboard straight away; the clue words are the quicker way in
      if (!matchMedia('(pointer: coarse)').matches && !p?.clue) setTimeout(() => input.focus(), 50);
    },
  };
}
