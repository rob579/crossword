// Anagrammer.
// Letters are loaded by tapping clue words or typing, then arranged on an
// "answer board" laid out like the answer: one slot per square, split into
// words/hyphenated parts. Letters already confirmed by a completed crossing
// answer start locked in place. Press and hold any letter on the board to lock
// it where it is (e.g. the AND in "X AND Y"), and again to unlock it.

const LONG_PRESS_MS = 550;

export function createAnagrammer(root, { getPattern, onFill } = {}) {
  root.innerHTML = `
    <div class="ana-clue" hidden>
      <div class="ana-clue-text"></div>
      <p class="ana-hint">Tap words to load their letters (tap again to remove).</p>
    </div>
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
    <p class="ana-hint">Drag tiles, or tap two to swap. Press and hold a letter to lock it in place (shuffle leaves it alone); hold again to unlock.<span class="ana-lock-hint"> Blue 🔒 letters come from finished crossing answers.</span></p>`;

  const input = root.querySelector('.ana-input');
  const board = root.querySelector('.ana-board');
  const boardLabel = root.querySelector('.ana-board-label');
  const countEl = root.querySelector('.ana-count');
  const lockHint = root.querySelector('.ana-lock-hint');
  const clueEl = root.querySelector('.ana-clue');
  const clueTextEl = root.querySelector('.ana-clue-text');

  let pattern = null;   // { label, clue, letters[], fixed[], breaks[] } for the current answer
  let lastClueKey = null;
  let locked = new Map(); // slot index -> letter locked in that square
  let tiles = [];         // movable tiles, in the order they fill the free slots: [{ id, ch }]
  let nextId = 1;
  let selected = null;    // tile id picked for tap-to-swap

  const lettersOf = s => String(s).toUpperCase().replace(/[^A-Z]/g, '').split('');
  const N = () => (pattern ? pattern.letters.length : 0);
  const freeSlots = () => (pattern ? [...Array(N()).keys()].filter(s => !locked.has(s)) : []);

  // ---------- letters in play ----------
  // The tiles are the typed letters minus any that are locked on the board,
  // keeping the current arrangement where possible.
  function setFromInput() {
    const need = lettersOf(input.value);
    for (const ch of locked.values()) {
      const at = need.indexOf(ch);
      if (at >= 0) need.splice(at, 1);
    }
    const kept = [];
    for (const t of tiles) {
      const at = need.indexOf(t.ch);
      if (at >= 0) { kept.push(t); need.splice(at, 1); }
    }
    for (const ch of need) kept.push({ id: nextId++, ch });
    tiles = kept;
    if (!tiles.some(t => t.id === selected)) selected = null;
    render();
  }

  function toggleLock(slot) {
    if (!pattern) return;
    if (locked.has(slot)) {
      // unlock: the letter becomes a movable tile again, placed where it was
      const ch = locked.get(slot);
      const before = new Set(tiles.map(t => t.id));
      locked.delete(slot);
      setFromInput();
      const fresh = tiles.findIndex(t => !before.has(t.id) && t.ch === ch);
      const target = freeSlots().indexOf(slot);
      if (fresh >= 0 && target >= 0) {
        const [t] = tiles.splice(fresh, 1);
        tiles.splice(Math.min(target, tiles.length), 0, t);
      }
    } else {
      // lock the tile sitting in this square (move it to the end so it's the one taken out of play)
      const k = freeSlots().indexOf(slot);
      const t = tiles[k];
      if (!t) return;
      tiles.push(tiles.splice(k, 1)[0]);
      locked.set(slot, t.ch);
      setFromInput();
    }
    navigator.vibrate?.(15);
    render();
    board.querySelector(`[data-slot="${slot}"]`)?.classList.add('lock-flash');
  }

  // ---------- rendering ----------
  function tileEl(cls, ch, attrs = {}) {
    const el = document.createElement('div');
    el.className = cls;
    el.textContent = ch || '';
    for (const [k, v] of Object.entries(attrs)) el.dataset[k] = v;
    return el;
  }

  function render() {
    board.innerHTML = '';
    if (!pattern) {
      // no answer to aim at: just a row of tiles
      const row = document.createElement('div');
      row.className = 'ana-free';
      tiles.forEach((t, k) => row.appendChild(tileEl('ana-tile' + (selected === t.id ? ' selected' : ''), t.ch, { id: t.id, index: k })));
      if (!tiles.length) row.innerHTML = '<span class="ana-empty">Your tiles will appear here</span>';
      board.appendChild(row);
      sizeTiles([Math.min(Math.max(1, tiles.length), 10)]);
      updateFill();
      return;
    }

    const n = N();
    const breakAt = new Map(pattern.breaks.map(b => [b.after, b.type]));
    const groups = [];
    let group = null, groupLen = 0;
    const lens = [];
    const free = freeSlots();
    for (let s = 0; s < n; s++) {
      if (!group) { group = document.createElement('div'); group.className = 'ana-group'; groupLen = 0; }
      const k = free.indexOf(s);
      const grid = pattern.letters[s];
      let el;
      if (locked.has(s)) {
        const ch = locked.get(s);
        const fromGrid = pattern.fixed[s] && ch === grid;
        el = tileEl(`ana-tile locked ${fromGrid ? 'from-grid' : 'mine'}`, ch, { slot: s });
        if (grid && grid !== ch) el.classList.add('clash');
        el.title = fromGrid ? 'From a finished crossing answer – press and hold to unlock' : 'Locked – press and hold to unlock';
      } else if (tiles[k]) {
        const t = tiles[k];
        el = tileEl('ana-tile', t.ch, { id: t.id, index: k, slot: s });
        if (selected === t.id) el.classList.add('selected');
        if (grid && grid !== t.ch) el.classList.add('clash');
        if (pattern.fixed[s]) { el.classList.add('unlocked'); el.title = 'Press and hold to lock this letter again'; }
      } else {
        el = tileEl('ana-slot', grid, { index: k, slot: s });
        if (grid) el.classList.add('hint');
      }
      group.appendChild(el);
      groupLen++;
      const br = breakAt.get(s + 1);
      if (br || s === n - 1) {
        if (br === 'hyphen') { const h = document.createElement('span'); h.className = 'ana-sep'; h.textContent = '-'; group.appendChild(h); }
        groups.push(group); lens.push(groupLen); group = null;
      }
    }
    const ans = document.createElement('div');
    ans.className = 'ana-answer';
    groups.forEach(g => ans.appendChild(g));
    board.appendChild(ans);

    // letters that don't fit in the answer
    const spare = tiles.slice(free.length);
    if (spare.length) {
      const wrap = document.createElement('div');
      wrap.className = 'ana-spare';
      wrap.innerHTML = `<span class="ana-spare-label">${spare.length} extra</span>`;
      spare.forEach((t, j) => {
        const el = tileEl('ana-tile spare', t.ch, { id: t.id, index: free.length + j });
        if (selected === t.id) el.classList.add('selected');
        wrap.appendChild(el);
      });
      board.appendChild(wrap);
    }

    lockHint.hidden = !pattern.fixed.some(Boolean);
    sizeTiles(lens);
    updateFill();
  }

  // Size tiles so the longest word fits on one line (long words get smaller tiles).
  let lastLens = [1];
  function sizeTiles(lens) {
    lastLens = lens;
    const w = board.clientWidth - 24; // board padding
    if (w <= 0) return;
    const longest = Math.max(...lens, 1);
    // tile size plus a gap of ~12% of it must fit the longest word on one line
    const fit = Math.floor((w - 2) / (longest + (longest - 1) * 0.12));
    // shrink long words a little, but not below a comfortable size for dragging;
    // past that, a very long word is allowed to wrap onto a second line
    const MIN = 28;
    const size = Math.max(MIN, Math.min(46, fit));
    board.classList.toggle('wrap-words', fit < MIN);
    board.style.setProperty('--tile', `${size}px`);
    board.style.setProperty('--gap', `${Math.max(2, Math.round(size * 0.12))}px`);
  }
  new ResizeObserver(() => sizeTiles(lastLens)).observe(board);

  function answerLetters() {
    const free = freeSlots();
    if (!pattern || tiles.length !== free.length) return null;
    return pattern.letters.map((ch, s) => (locked.has(s) ? locked.get(s) : tiles[free.indexOf(s)].ch));
  }

  function updateFill() {
    const btn = root.querySelector('.ana-fill');
    btn.hidden = !pattern;
    if (!pattern) { countEl.textContent = ''; return; }
    const need = freeSlots().length;
    const have = tiles.length;
    const letters = answerLetters();
    btn.disabled = !letters;
    btn.title = letters ? `Put ${letters.join('')} into ${pattern.label}` : `Needs ${need} more letter${need === 1 ? '' : 's'} to fill the gaps`;
    countEl.textContent = have === need ? '' : have < need ? `${need - have} to place` : `${have - need} too many`;
    countEl.classList.toggle('over', have > need);
  }

  function shuffle() {
    if (tiles.length < 2) return;
    const before = tiles.map(t => t.ch).join('');
    for (let tries = 0; tries < 10; tries++) {
      for (let i = tiles.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
      }
      if (tiles.map(t => t.ch).join('') !== before) break;
    }
    selected = null;
    render();
    board.classList.remove('shuffled'); void board.offsetWidth; board.classList.add('shuffled');
  }

  // ---------- buttons, input, clue words ----------
  root.addEventListener('click', e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'fill') { const l = answerLetters(); if (l) onFill?.(l); }
    if (act === 'shuffle') shuffle();
    if (act === 'reset') { tiles = []; setFromInput(); }
    if (act === 'clear') {
      input.value = ''; tiles = []; selected = null;
      for (const [s, ch] of [...locked]) if (!(pattern?.fixed[s] && pattern.letters[s] === ch)) locked.delete(s);
      clueTextEl.querySelectorAll('.ana-word.on').forEach(w => w.classList.remove('on'));
      render();
    }
  });
  input.addEventListener('input', setFromInput);

  clueTextEl.addEventListener('click', e => {
    const w = e.target.closest('.ana-word');
    if (!w) return;
    const letters = lettersOf(w.dataset.letters);
    if (w.classList.toggle('on')) {
      input.value = (input.value + letters.join('')).toUpperCase();
    } else {
      const v = input.value.toUpperCase().split('');
      for (const ch of letters) {
        const at = v.lastIndexOf(ch);
        if (at >= 0) v.splice(at, 1);
      }
      input.value = v.join('');
    }
    setFromInput();
  });

  // ---------- drag, tap-to-swap, press-and-hold ----------
  let drag = null;
  const targetAt = (x, y) => [...board.querySelectorAll('[data-index]')].find(t => {
    const r = t.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  });

  board.addEventListener('contextmenu', e => e.preventDefault());
  board.addEventListener('pointerdown', e => {
    const el = e.target.closest('.ana-tile, .ana-slot');
    if (!el) return;
    e.preventDefault();
    const slot = el.dataset.slot != null ? +el.dataset.slot : null;
    const rect = el.getBoundingClientRect();
    drag = {
      el, slot, pointerId: e.pointerId,
      id: el.dataset.id ? +el.dataset.id : null,
      startX: e.clientX, startY: e.clientY, dx: e.clientX - rect.left, dy: e.clientY - rect.top,
      moved: false, ghost: null, held: false, timer: null,
    };
    if (slot != null && pattern && (locked.has(slot) || drag.id != null)) {
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
    if (drag.id == null) return; // locked tiles and empty slots don't move
    if (!drag.moved) {
      drag.moved = true;
      clearTimeout(drag.timer);
      drag.el.classList.remove('pressing');
      selected = null;
      const g = drag.el.cloneNode(true);
      g.className = 'ana-tile ghost';
      g.style.setProperty('--tile', getComputedStyle(board).getPropertyValue('--tile'));
      document.body.appendChild(g);
      drag.ghost = g;
      render();
      board.querySelector(`[data-id="${drag.id}"]`)?.classList.add('placeholder');
    }
    drag.ghost.style.left = `${e.clientX - drag.dx}px`;
    drag.ghost.style.top = `${e.clientY - drag.dy}px`;
    const under = targetAt(e.clientX, e.clientY);
    if (under && +under.dataset.id !== drag.id) {
      const from = tiles.findIndex(t => t.id === drag.id);
      const to = Math.min(+under.dataset.index, tiles.length - 1);
      if (from !== to) {
        const [t] = tiles.splice(from, 1);
        tiles.splice(to, 0, t);
        render();
        board.querySelector(`[data-id="${drag.id}"]`)?.classList.add('placeholder');
      }
    }
  });

  const endDrag = e => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    clearTimeout(drag.timer);
    drag.el.classList.remove('pressing');
    if (!drag.moved && !drag.held) {
      if (drag.id != null) {
        // tap a tile: select, or swap with the selected one
        if (selected == null) selected = drag.id;
        else if (selected === drag.id) selected = null;
        else {
          const a = tiles.findIndex(t => t.id === selected);
          const b = tiles.findIndex(t => t.id === drag.id);
          [tiles[a], tiles[b]] = [tiles[b], tiles[a]];
          selected = null;
        }
      } else if (drag.el.classList.contains('ana-slot') && selected != null) {
        // tap an empty square: move the selected tile there
        const from = tiles.findIndex(t => t.id === selected);
        const [t] = tiles.splice(from, 1);
        tiles.splice(Math.min(+drag.el.dataset.index, tiles.length), 0, t);
        selected = null;
      } else if (drag.el.classList.contains('locked')) {
        drag.el.classList.remove('nudge'); void drag.el.offsetWidth; drag.el.classList.add('nudge');
        drag.ghost?.remove(); drag = null;
        return;
      }
    }
    drag.ghost?.remove();
    drag = null;
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
        input.value = ''; tiles = []; selected = null;
        clueEl.hidden = !p?.clue;
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
      boardLabel.textContent = p ? `${p.label}${p.enumText ? ` (${p.enumText})` : ''}` : '';
      setFromInput();
      // on phones, don't pop up the keyboard straight away; the clue words are the quicker way in
      if (!matchMedia('(pointer: coarse)').matches && !p?.clue) setTimeout(() => input.focus(), 50);
    },
  };
}
