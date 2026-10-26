// Draws the clue list as a shareable image: always light colours, no selection,
// solved clues faded and confirmed clues tinted green with a tick.

const C = {
  bg: '#fffdf8',
  ink: '#1d1f24',
  faded: '#9fa1a6',
  muted: '#6b6f78',
  line: '#e3ddcf',
  sureBg: '#e5eee3',
  tick: '#1f8a4c',
};
const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const SERIF = '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif';

const plain = s => String(s || '')
  .replace(/<[^>]*>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").trim();

function wrap(ctx, text, width) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width <= width || !line) line = test;
    else { lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

/**
 * @param {object} o
 * @param {string} o.title
 * @param {string} [o.author]
 * @param {{across: object[], down: object[]}} o.clues  clue = { number, text }
 * @param {(clue) => 'open'|'done'|'confirmed'} o.status
 * @returns {HTMLCanvasElement}
 */
export function renderProgressImage({ title, author, clues, status }) {
  const W = 1000, SCALE = 2;
  const PAD = 24, COL_GAP = 0;
  const colW = (W - COL_GAP) / 2;
  const FONT = 17, LH = 24, ROW_PAD = 8;
  const TICK_W = 24, NUM_W = 30, GAP = 8;

  const measure = document.createElement('canvas').getContext('2d');
  const textX = PAD + TICK_W + NUM_W + GAP;
  const textW = colW - textX - PAD;

  // lay out both columns first so we know the height
  const layout = dir => clues[dir].map(cl => {
    measure.font = `${FONT}px ${SANS}`;
    const text = plain(cl.text) || '—';
    return { cl, st: status(cl), lines: wrap(measure, text, textW) };
  });
  const cols = { across: layout('across'), down: layout('down') };
  const HEAD_Y = 92;            // where the ACROSS / DOWN headings sit
  const LIST_Y = HEAD_Y + 26;   // first row
  const colHeight = rows => rows.reduce((h, r) => h + r.lines.length * LH + ROW_PAD * 2, 0);
  const H = LIST_Y + Math.max(colHeight(cols.across), colHeight(cols.down)) + 16;

  const canvas = document.createElement('canvas');
  canvas.width = W * SCALE;
  canvas.height = H * SCALE;
  const ctx = canvas.getContext('2d');
  ctx.scale(SCALE, SCALE);
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);

  // title + summary
  const all = [...cols.across, ...cols.down].filter(r => r.cl.entryIds?.length !== 0);
  const solved = all.filter(r => r.st !== 'open').length;
  const sure = all.filter(r => r.st === 'confirmed').length;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = C.ink;
  ctx.font = `600 24px ${SERIF}`;
  ctx.fillText(plain(title) || 'Crossword', PAD, 40);
  ctx.fillStyle = C.muted;
  ctx.font = `14px ${SANS}`;
  const summary = [plain(author), `${solved} of ${all.length} clues solved`, sure ? `${sure} confirmed` : ''].filter(Boolean).join('  ·  ');
  ctx.fillText(summary, PAD, 64);

  // column headings
  ctx.font = `700 12px ${SANS}`;
  ctx.fillStyle = C.muted;
  try { ctx.letterSpacing = '2px'; } catch {}
  ctx.fillText('ACROSS', PAD, HEAD_Y + 4);
  ctx.fillText('DOWN', colW + PAD, HEAD_Y + 4);
  try { ctx.letterSpacing = '0px'; } catch {}
  ctx.fillStyle = C.line;
  ctx.fillRect(0, HEAD_Y + 14, W, 1);

  // rows
  for (const [ci, dir] of ['across', 'down'].entries()) {
    const x0 = ci * colW;
    let y = LIST_Y;
    for (const r of cols[dir]) {
      const h = r.lines.length * LH + ROW_PAD * 2;
      if (r.st === 'confirmed') { ctx.fillStyle = C.sureBg; ctx.fillRect(x0, y, colW, h); }
      const colour = r.st === 'open' ? C.ink : C.faded;
      const baseY = y + ROW_PAD + LH - 7;
      if (r.st === 'confirmed') {
        ctx.fillStyle = C.tick;
        ctx.font = `700 18px ${SANS}`;
        ctx.fillText('✓', x0 + PAD, baseY);
      }
      ctx.fillStyle = colour;
      ctx.font = `700 ${FONT}px ${SANS}`;
      ctx.textAlign = 'right';
      ctx.fillText(String(r.cl.label || r.cl.number || ''), x0 + PAD + TICK_W + NUM_W, baseY);
      ctx.textAlign = 'left';
      ctx.font = `${FONT}px ${SANS}`;
      r.lines.forEach((ln, k) => ctx.fillText(ln, x0 + textX, baseY + k * LH));
      y += h;
    }
  }
  // divider between columns
  ctx.fillStyle = C.line;
  ctx.fillRect(colW, HEAD_Y - 14, 1, H - HEAD_Y + 14);
  return canvas;
}
