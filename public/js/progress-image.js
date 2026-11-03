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
 * @param {string} [o.author]      setter
 * @param {string} [o.publisher]   publication
 * @param {string} [o.date]        already formatted for display
 * @param {string} [o.copyright]
 * @param {{across: object[], down: object[]}} o.clues  clue = { number, text }
 * @param {(clue) => 'open'|'done'|'confirmed'|'assisted'} o.status   assisted = confirmed, with revealed letters
 * @returns {HTMLCanvasElement}
 */
export function renderProgressImage({ title, author, publisher, date, copyright, clues, status }) {
  const W = 1000, SCALE = 2;
  const PAD = 24, COL_GAP = 0;
  const colW = (W - COL_GAP) / 2;
  const FONT = 17, LH = 24, ROW_PAD = 8;
  const TICK_W = 24, NUM_W = 30, GAP = 8;

  const measure = document.createElement('canvas').getContext('2d');
  const textX = PAD + TICK_W + NUM_W + GAP;
  const textW = colW - textX - PAD;

  // lay out both columns first so we know the height
  // a long label such as "26, 21 across" pushes that row's text along instead of overlapping
  const layout = dir => clues[dir].map(cl => {
    const label = String(cl.label || cl.number || '');
    measure.font = `700 ${FONT}px ${SANS}`;
    const labelW = measure.measureText(label).width;
    const shift = Math.max(0, labelW - NUM_W);
    measure.font = `${FONT}px ${SANS}`;
    const text = plain(cl.text) || '—';
    return { cl, label, shift, st: status(cl), lines: wrap(measure, text, textW - shift) };
  });
  const cols = { across: layout('across'), down: layout('down') };
  // header: title, then setter · publication · date (· copyright), then progress
  measure.font = `15px ${SANS}`;
  const details = [author, publisher, date, copyright].map(plain).filter(Boolean).join('  ·  ');
  const detailLines = details ? wrap(measure, details, W - PAD * 2) : [];
  const PROGRESS_Y = 60 + detailLines.length * 22;
  const HEAD_Y = PROGRESS_Y + 30;  // where the ACROSS / DOWN headings sit
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
  const all = [...cols.across, ...cols.down].filter(r => r.cl.entryIds?.length !== 0 && !r.cl.seeOf);
  const solved = all.filter(r => r.st !== 'open').length;
  const sure = all.filter(r => r.st === 'confirmed' || r.st === 'assisted').length;
  const helped = all.filter(r => r.st === 'assisted').length;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = C.ink;
  ctx.font = `600 24px ${SERIF}`;
  ctx.fillText(plain(title) || 'Crossword', PAD, 40);
  ctx.fillStyle = C.ink;
  ctx.font = `15px ${SANS}`;
  detailLines.forEach((ln, k) => ctx.fillText(ln, PAD, 66 + k * 22));
  ctx.fillStyle = C.muted;
  ctx.font = `14px ${SANS}`;
  const summary = [`${solved} of ${all.length} clues solved`, sure ? `${sure} confirmed` : '', helped ? `${helped} with help` : ''].filter(Boolean).join('  ·  ');
  ctx.fillText(summary, PAD, PROGRESS_Y + 6);

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
      const sure = r.st === 'confirmed' || r.st === 'assisted';
      if (sure) { ctx.fillStyle = C.sureBg; ctx.fillRect(x0, y, colW, h); }
      if (r.st === 'assisted') {
        // dotted outline: confirmed, but with revealed letters
        ctx.save();
        ctx.strokeStyle = C.tick; ctx.globalAlpha = .7; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]);
        ctx.strokeRect(x0 + 4.5, y + 3.5, colW - 9, h - 7);
        ctx.restore();
      }
      const colour = r.st === 'open' ? C.ink : C.faded;
      const baseY = y + ROW_PAD + LH - 7;
      if (sure) {
        ctx.fillStyle = C.tick;
        ctx.font = `700 18px ${SANS}`;
        ctx.fillText('✓', x0 + PAD, baseY);
      }
      ctx.fillStyle = colour;
      ctx.font = `700 ${FONT}px ${SANS}`;
      ctx.textAlign = 'right';
      ctx.fillText(r.label, x0 + PAD + TICK_W + NUM_W + r.shift, baseY);
      ctx.textAlign = 'left';
      ctx.font = `${FONT}px ${SANS}`;
      r.lines.forEach((ln, k) => ctx.fillText(ln, x0 + textX + r.shift, baseY + k * LH));
      y += h;
    }
  }
  // divider between columns
  ctx.fillStyle = C.line;
  ctx.fillRect(colW, HEAD_Y - 14, 1, H - HEAD_Y + 14);
  return canvas;
}
