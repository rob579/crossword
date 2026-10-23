// Appearance: theme (auto / light / dark) and optional custom grid colours.
// Loaded as a plain script in <head> so the page never flashes the wrong colours.
(function () {
  const KEYS = ['paper', 'block', 'letter', 'word', 'sel'];
  const PRESETS = {
    newsprint: { name: 'Newsprint', paper: '#f4efe1', block: '#2b2a27', letter: '#1f1d1a', word: '#e2d7b8', sel: '#c9a227' },
    seaside:   { name: 'Seaside',   paper: '#f3fbfb', block: '#0e4a5c', letter: '#0b2b33', word: '#bfe6ea', sel: '#ff9f6b' },
    forest:    { name: 'Forest',    paper: '#f1f5ee', block: '#1f3a2b', letter: '#14261c', word: '#cfe3c4', sel: '#e3b04b' },
    nightink:  { name: 'Night ink', paper: '#1b2233', block: '#06080f', letter: '#e8ecf7', word: '#2f4a7a', sel: '#d8b04c' },
  };
  const get = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
  const set = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} };

  // dark or light text, whichever reads better on this background
  function inkFor(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
    if (!m) return null;
    const n = parseInt(m[1], 16);
    const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    const L = 0.2126 * lin(n >> 16 & 255) + 0.7152 * lin(n >> 8 & 255) + 0.0722 * lin(n & 255);
    return L > 0.36 ? '#111317' : '#f5f3ee';
  }

  const state = {
    get theme() { return get('cw.theme', 'auto'); },
    set theme(v) { set('cw.theme', v === 'auto' ? null : v); apply(); },
    get customOn() { return get('cw.coloursOn', '0') === '1'; },
    set customOn(v) { set('cw.coloursOn', v ? '1' : null); apply(); },
    get colours() { try { return JSON.parse(get('cw.colours', 'null')) || null; } catch { return null; } },
    set colours(c) { set('cw.colours', c ? JSON.stringify(c) : null); apply(); },
  };

  function apply() {
    const root = document.documentElement;
    const theme = state.theme;
    if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
    else delete root.dataset.theme;
    // browser/status-bar colour on phones
    document.querySelectorAll('meta[name="theme-color"]').forEach(m => {
      const isDarkMeta = (m.media || '').includes('dark');
      const want = theme === 'dark' ? '#16181c' : theme === 'light' ? '#f6f3ec' : (isDarkMeta ? '#16181c' : '#f6f3ec');
      m.setAttribute('content', want);
    });
    for (const v of ['--paper', '--block', '--grid-line', '--letter', '--word', '--sel', '--sel-ink', '--word-ink', '--bar-color']) root.style.removeProperty(v);
    const c = state.customOn && state.colours;
    if (c) {
      if (c.paper) root.style.setProperty('--paper', c.paper);
      if (c.block) { root.style.setProperty('--block', c.block); root.style.setProperty('--grid-line', c.block); }
      // bars and word-break marks follow the letter colour so they always show against the squares
      if (c.letter) { root.style.setProperty('--letter', c.letter); root.style.setProperty('--bar-color', c.letter); }
      if (c.word) { root.style.setProperty('--word', c.word); root.style.setProperty('--word-ink', inkFor(c.word)); }
      if (c.sel) { root.style.setProperty('--sel', c.sel); root.style.setProperty('--sel-ink', inkFor(c.sel)); }
    }
  }

  // the colours currently on screen (used to seed the pickers)
  function current() {
    const cs = getComputedStyle(document.documentElement);
    const out = {};
    for (const k of KEYS) out[k] = cs.getPropertyValue(`--${k}`).trim();
    return out;
  }

  window.cwTheme = { state, apply, current, KEYS, PRESETS };
  apply();
})();
