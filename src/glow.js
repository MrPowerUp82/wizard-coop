import { createCanvas, RENDER_TUNING } from './platform.js';

// Consoles can reuse a tiny pre-rendered radial glow instead of building a new CanvasGradient +
// path/clip sequence for every particle, familiar and zone on every split-screen viewport.
// The browser keeps the original per-draw gradient path for pixel-identical visuals.
const SIZE = 64;
const cache = new Map();

function cachedGlow(color) {
  let canvas = cache.get(color);
  if (canvas) return canvas;
  canvas = createCanvas(SIZE, SIZE);
  const ctx = canvas.getContext('2d');
  const half = SIZE / 2;
  const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
  gradient.addColorStop(0, color);
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  // nx.js handles radial gradients correctly on fillRect; unlike path fill this needs no compatibility clip.
  ctx.fillRect(0, 0, SIZE, SIZE);
  cache.set(color, canvas);
  return canvas;
}

/** Draw a soft center-to-transparent glow while preserving the caller's current world transform. */
export function drawSoftGlow(ctx, x, y, radius, color, alpha = 1) {
  if (!(radius > 0) || alpha <= 0) return;
  if (RENDER_TUNING.cachedGlows) {
    const oldAlpha = ctx.globalAlpha;
    ctx.globalAlpha = alpha;
    ctx.drawImage(cachedGlow(color), x - radius, y - radius, radius * 2, radius * 2);
    ctx.globalAlpha = oldAlpha;
    return;
  }
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, color);
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  const oldAlpha = ctx.globalAlpha;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = gradient;
  ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = oldAlpha;
}
