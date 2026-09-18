// @ts-check
// Small canvas drawing helpers for the Switch UI (the web draws the same screens with DOM + CSS).

export const COLORS = {
  ink: '#e6f5ef', dim: '#819796', mint: '#83d9bf', gold: '#ffd36b', danger: '#ff8a7a',
  panel: 'rgba(7, 14, 20, .86)', panelSolid: '#0b151c', line: 'rgba(131, 225, 196, .35)', focus: '#83e1c4'
};

export function roundPanel(ctx, x, y, width, height, { fill = COLORS.panel, stroke = COLORS.line, radius = 12, lineWidth = 1 } = {}) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
  ctx.fillStyle = fill; ctx.fill();
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lineWidth; ctx.stroke(); }
}

export function text(ctx, value, x, y, { font = '600 18px Inter', color = COLORS.ink, align = 'left', baseline = 'alphabetic', maxWidth = undefined } = {}) {
  ctx.font = font; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = baseline;
  if (maxWidth) ctx.fillText(String(value), x, y, maxWidth);
  else ctx.fillText(String(value), x, y);
}

/** Draws `value` word-wrapped inside `maxWidth`; returns the y below the last line. */
export function wrapText(ctx, value, x, y, maxWidth, lineHeight, options = {}) {
  ctx.font = options.font || '500 16px Inter';
  const words = String(value).split(/\s+/);
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxWidth) { text(ctx, line, x, y, options); y += lineHeight; line = word; }
    else line = next;
  }
  if (line) { text(ctx, line, x, y, options); y += lineHeight; }
  return y;
}

export function bar(ctx, x, y, width, height, ratio, color, back = '#16242a') {
  ctx.fillStyle = back; ctx.fillRect(x, y, width, height);
  ctx.fillStyle = color; ctx.fillRect(x, y, width * Math.max(0, Math.min(1, ratio)), height);
}

/** Dims the whole screen under a modal. */
export function veil(ctx, W, H, alpha = 0.62) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = `rgba(3, 7, 11, ${alpha})`;
  ctx.fillRect(0, 0, W, H);
}

/** A vertical list of choices with one focused; returns nothing, purely visual. */
export function menuList(ctx, items, focus, x, y, width, { rowHeight = 54, font = '700 20px Inter' } = {}) {
  items.forEach((item, index) => {
    const top = y + index * rowHeight;
    const active = index === focus;
    const disabled = item.disabled;
    roundPanel(ctx, x, top, width, rowHeight - 10, {
      fill: active ? 'rgba(40, 92, 78, .9)' : COLORS.panel, stroke: active ? COLORS.focus : COLORS.line, lineWidth: active ? 2 : 1, radius: 10
    });
    text(ctx, item.label, x + 20, top + (rowHeight - 10) / 2 + 1, { font, baseline: 'middle', color: disabled ? COLORS.dim : COLORS.ink });
    if (item.detail) text(ctx, item.detail, x + width - 20, top + (rowHeight - 10) / 2 + 1,
      { font: '500 15px Inter', baseline: 'middle', align: 'right', color: active ? COLORS.mint : COLORS.dim, maxWidth: width * 0.5 });
  });
}
