// Anagrammer: type letters, then rearrange the tiles by dragging,
// tapping two tiles to swap them, or shuffling.

export function createAnagrammer(root, { getPattern, onFill } = {}) {
  root.innerHTML = `
    <div class="ana-pattern" hidden></div>
    <label class="ana-label" for="ana-input">Letters</label>
    <input id="ana-input" class="ana-input" type="text" autocomplete="off" autocorrect="off"
      autocapitalize="characters" spellcheck="false" placeholder="Type letters…" maxlength="30">
    <div class="ana-tiles" aria-live="polite"></div>
    <div class="ana-actions">
      <button type="button" class="btn" data-act="shuffle">⤮ Shuffle</button>
      <button type="button" class="btn" data-act="reset">↺ Reset order</button>
      <button type="button" class="btn ghost" data-act="clear">Clear</button>
      <button type="button" class="btn primary ana-fill" data-act="fill" disabled>Fill in answer</button>
    </div>
    <p class="ana-hint">Drag tiles to move them, or tap two tiles to swap.</p>`;

  const input = root.querySelector('.ana-input');
  const tilesEl = root.querySelector('.ana-tiles');
  const patternEl = root.querySelector('.ana-pattern');
  let tiles = []; // [{ id, ch }]
  let nextId = 1;
  let selected = null;
  let pattern = null; // { label, letters } for the current answer, captured when opened

  const lettersOf = s => s.toUpperCase().replace(/[^A-Z]/g, '').split('');

  function setFromInput() {
    // keep existing arrangement where possible when letters are added/removed
    const want = lettersOf(input.value);
    const pool = [...tiles];
    const kept = [];
    const need = [...want];
    for (const t of pool) {
      const i = need.indexOf(t.ch);
      if (i >= 0) { kept.push(t); need.splice(i, 1); }
    }
    for (const ch of need) kept.push({ id: nextId++, ch });
    tiles = kept;
    selected = null;
    render();
  }

  function updateFill() {
    const btn = root.querySelector('.ana-fill');
    const need = pattern?.letters.length || 0;
    btn.hidden = !pattern;
    if (!pattern) return;
    btn.disabled = !need || tiles.length !== need;
    btn.title = !need ? '' : tiles.length === need ? `Put ${tiles.map(t => t.ch).join('')} into ${pattern.label}` : `Needs exactly ${need} letters (you have ${tiles.length})`;
    // preview the arrangement in the answer pattern; flag clashes with letters already in the grid
    root.querySelectorAll('.ana-slot').forEach((el, i) => {
      const known = pattern.letters[i];
      const mine = tiles.length === need ? tiles[i]?.ch : '';
      el.textContent = mine || known || '';
      el.classList.toggle('known', !!known && !mine);
      el.classList.toggle('preview', !!mine);
      el.classList.toggle('clash', !!mine && !!known && mine !== known);
    });
  }

  function render() {
    updateFillLater();
    tilesEl.innerHTML = '';
    if (!tiles.length) {
      tilesEl.innerHTML = '<span class="ana-empty">Your tiles will appear here</span>';
      return;
    }
    tiles.forEach((t, i) => {
      const el = document.createElement('div');
      el.className = 'ana-tile' + (selected === t.id ? ' selected' : '');
      el.textContent = t.ch;
      el.dataset.id = t.id;
      el.dataset.index = i;
      tilesEl.appendChild(el);
    });
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
    tilesEl.classList.remove('shuffled'); void tilesEl.offsetWidth; tilesEl.classList.add('shuffled');
  }

  function updateFillLater() { queueMicrotask(updateFill); }

  root.addEventListener('click', e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'fill' && pattern && tiles.length === pattern.letters.length) onFill?.(tiles.map(t => t.ch));
    if (act === 'shuffle') shuffle();
    if (act === 'reset') { tiles = []; setFromInput(); }
    if (act === 'clear') { input.value = ''; tiles = []; render(); input.focus(); }
  });
  input.addEventListener('input', setFromInput);

  // ----- drag / tap -----
  let drag = null;
  tilesEl.addEventListener('pointerdown', e => {
    const el = e.target.closest('.ana-tile');
    if (!el) return;
    e.preventDefault();
    const rect = el.getBoundingClientRect();
    drag = { id: +el.dataset.id, el, startX: e.clientX, startY: e.clientY, dx: e.clientX - rect.left, dy: e.clientY - rect.top, moved: false, ghost: null, pointerId: e.pointerId };
    tilesEl.setPointerCapture(e.pointerId);
  });
  tilesEl.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 6) return;
    if (!drag.moved) {
      drag.moved = true;
      selected = null;
      const g = drag.el.cloneNode(true);
      g.className = 'ana-tile ghost';
      document.body.appendChild(g);
      drag.ghost = g;
      render();
      tilesEl.querySelector(`[data-id="${drag.id}"]`)?.classList.add('placeholder');
    }
    drag.ghost.style.left = `${e.clientX - drag.dx}px`;
    drag.ghost.style.top = `${e.clientY - drag.dy}px`;
    // find the tile under the pointer and move the dragged tile to its slot
    const under = [...tilesEl.querySelectorAll('.ana-tile')].find(t => {
      const r = t.getBoundingClientRect();
      return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    });
    if (under && +under.dataset.id !== drag.id) {
      const from = tiles.findIndex(t => t.id === drag.id);
      const to = +under.dataset.index;
      const [t] = tiles.splice(from, 1);
      tiles.splice(to, 0, t);
      render();
      tilesEl.querySelector(`[data-id="${drag.id}"]`)?.classList.add('placeholder');
    }
  });
  const endDrag = e => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (!drag.moved) {
      // tap: select / swap
      if (selected == null) selected = drag.id;
      else if (selected === drag.id) selected = null;
      else {
        const a = tiles.findIndex(t => t.id === selected);
        const b = tiles.findIndex(t => t.id === drag.id);
        [tiles[a], tiles[b]] = [tiles[b], tiles[a]];
        selected = null;
      }
    }
    drag.ghost?.remove();
    drag = null;
    render();
  };
  tilesEl.addEventListener('pointerup', endDrag);
  tilesEl.addEventListener('pointercancel', endDrag);

  render();

  return {
    open() {
      const p = getPattern?.();
      pattern = p || null;
      if (p) {
        patternEl.hidden = false;
        patternEl.innerHTML = `<span class="ana-pattern-label">${p.label}</span>` +
          p.letters.map(ch => `<span class="ana-slot${ch ? ' known' : ''}">${ch || ''}</span>`).join('');
      } else patternEl.hidden = true;
      updateFill();
      setTimeout(() => input.focus(), 50);
    },
  };
}
