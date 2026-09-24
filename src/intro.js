// Developer seal, opening splash and credits — mirrors the native frontend (wizard_coop_cpp platforms/sdl/frontend.cpp).
export const DEVELOPER = 'MrPowerUp82';
const SPLASH_SECONDS = 1.5;
const SPLASH_KEY = 'arcana.splashSeen';

const ramp = (x, from, to) => Math.min(1, Math.max(0, (x - from) / (to - from)));
const rgba = (r, g, b, a = 1) => `rgba(${r},${g},${b},${a})`;

function glow(ctx, x, y, r, color, alpha) {
  if (alpha <= 0) return;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgba(...color, alpha));
  g.addColorStop(1, rgba(...color, 0));
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
  ctx.globalCompositeOperation = 'source-over';
}

/** Draws the seal; `reveal` 0→1 traces it in, `alpha` fades it out, `time` spins the dashed ring. */
export function drawSeal(ctx, cx, cy, r, reveal, alpha, time) {
  const top = -Math.PI / 2;
  const inner = ramp(reveal, 0.35, 0.8) * alpha, core = ramp(reveal, 0.6, 1) * alpha;
  const blue = rgba(110, 130, 255, 0.9 * alpha), pale = rgba(200, 212, 255, inner);
  const w = Math.max(1, r * 0.03);
  const stroke = (color, width) => { ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke(); };
  const arc = (x, y, radius, from, to, color, width) => { ctx.beginPath(); ctx.arc(x, y, radius, from, to); stroke(color, width); };

  ctx.save();
  ctx.lineCap = 'round';
  glow(ctx, cx, cy, r * 1.7, [70, 60, 210], 0.5 * alpha * reveal);

  // Rings trace themselves from the top, in opposite directions.
  const sweep = 2 * Math.PI * ramp(reveal, 0, 0.6);
  if (sweep > 0) {
    arc(cx, cy, r, top, top + sweep, blue, w);
    arc(cx, cy, r * 0.7, top - sweep, top, blue, w * 0.8);
  }
  ctx.setLineDash([r * 0.07, r * 0.05]);
  ctx.lineDashOffset = -time * r * 0.08;
  arc(cx, cy, r * 0.85, 0, Math.PI * 2, rgba(130, 120, 255, 0.6 * inner), w * 1.8);
  ctx.setLineDash([]);

  ctx.beginPath();
  for (let i = 0; i < 3; i++) ctx.lineTo(cx + Math.cos(top + i * 2 * Math.PI / 3) * r * 0.7, cy + Math.sin(top + i * 2 * Math.PI / 3) * r * 0.7);
  ctx.closePath();
  stroke(pale, w * 0.7);
  ctx.beginPath(); ctx.moveTo(cx, cy - r * 1.15); ctx.lineTo(cx, cy + r * 1.15); stroke(pale, w * 0.6);

  // Crescent cradling a moon above, a sealed orb below.
  arc(cx, cy - r * 0.47, r * 0.14, Math.PI * 0.1, Math.PI * 0.9, pale, w * 1.6);
  arc(cx, cy - r * 0.5, r * 0.06, 0, Math.PI * 2, pale, w * 0.8);
  arc(cx, cy + r * 0.5, r * 0.12, 0, Math.PI * 2, pale, w * 0.8);
  ctx.beginPath(); ctx.arc(cx, cy + r * 0.5, r * 0.055, 0, Math.PI * 2); ctx.fillStyle = pale; ctx.fill();

  // Four-point star at the heart.
  glow(ctx, cx, cy, r * 0.45, [150, 170, 255], core);
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = top + i * Math.PI / 4;
    const len = i % 2 ? r * 0.05 : (i % 4 === 0 ? r * 0.32 : r * 0.17);
    ctx.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len);
  }
  ctx.fillStyle = rgba(235, 240, 255, core);
  ctx.fill();
  ctx.restore();
}

function fitCanvas(canvas) {
  const dpr = Math.min(2, devicePixelRatio || 1);
  const { width, height } = canvas.getBoundingClientRect();
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width, height };
}

function splashSeen() {
  try { return sessionStorage.getItem(SPLASH_KEY) === '1'; } catch { return false; }
}

/**
 * Plays the developer seal once per browser session. Any key, click or touch skips it,
 * and it stays up until the web fonts are ready so it covers loading instead of adding to it.
 */
export function playSplash() {
  const skipByUrl = new URLSearchParams(location.search).has('nosplash');
  if (splashSeen() || skipByUrl || matchMedia('(prefers-reduced-motion: reduce)').matches) return Promise.resolve();
  try { sessionStorage.setItem(SPLASH_KEY, '1'); } catch { /* private mode: it just plays again next time */ }

  const overlay = document.createElement('div');
  overlay.className = 'splash';
  overlay.setAttribute('role', 'presentation');
  const canvas = document.createElement('canvas');
  overlay.append(canvas);
  document.body.append(overlay);

  return new Promise(resolve => {
    const started = performance.now();
    const elapsed = () => (performance.now() - started) / 1000;
    // Ends once the seal has played and the fonts are in, fading over the last 0.4s.
    let end = Infinity, done = false, frame = 0;
    const fontsIn = () => { end = Math.max(SPLASH_SECONDS, elapsed() + 0.4); };
    if (document.fonts) document.fonts.ready.then(fontsIn, fontsIn); else fontsIn();
    const finish = () => {
      if (done) return;
      done = true;
      cancelAnimationFrame(frame);
      removeEventListener('keydown', skip, true);
      overlay.classList.add('leaving');
      setTimeout(() => overlay.remove(), 250);
      resolve();
    };
    // The key that skips the seal must not also act on the menu underneath.
    const skip = event => { event.preventDefault(); event.stopPropagation(); finish(); };
    const draw = () => {
      const t = elapsed();
      const { ctx, width, height } = fitCanvas(canvas);
      const fade = ramp(Math.min(end, 3) - t, 0, 0.4);
      const r = Math.min(height * 0.3, width * 0.22), cx = width / 2, cy = height * 0.44;
      ctx.fillStyle = rgba(6, 6, 16);
      ctx.fillRect(0, 0, width, height);
      drawSeal(ctx, cx, cy, r, ramp(t, 0, 0.8), fade, t);
      // The name crosses the seal, never wider than 80% of the screen.
      const nameA = ramp(t, 0.35, 0.7) * fade;
      ctx.font = '700 100px Cinzel, serif';
      const px = Math.min(r * 0.42, width * 0.8 * 100 / ctx.measureText(DEVELOPER).width);
      ctx.font = `700 ${px}px Cinzel, serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineWidth = px * 0.12;
      ctx.strokeStyle = rgba(8, 8, 24, nameA);
      ctx.strokeText(DEVELOPER, cx, cy);
      ctx.fillStyle = rgba(236, 222, 190, nameA);
      ctx.fillText(DEVELOPER, cx, cy);
      ctx.font = `500 ${Math.max(15, r * 0.14)}px Inter, sans-serif`;
      ctx.fillStyle = rgba(150, 160, 190, ramp(t, 0.75, 1) * fade);
      ctx.fillText('apresenta', cx, cy + r * 1.22);
    };
    const tick = () => {
      draw();
      frame = requestAnimationFrame(tick);
    };
    // A timer, not the frame loop, ends it: a throttled or hidden tab must never keep the menu covered.
    const check = () => {
      if (done) return;
      if (elapsed() >= Math.min(end, 3)) finish();
      else setTimeout(check, 50);
    };
    overlay.addEventListener('pointerdown', finish);
    addEventListener('keydown', skip, true);
    tick();
    setTimeout(check, SPLASH_SECONDS * 1000);
  });
}

/** Keeps the credits seal turning while the credits dialog is open. */
export function animateCreditsSeal(canvas, isOpen) {
  const loop = now => {
    if (!isOpen()) return;
    const { ctx, width, height } = fitCanvas(canvas);
    ctx.clearRect(0, 0, width, height);
    drawSeal(ctx, width / 2, height / 2, Math.min(width, height) * 0.36, 1, 1, now / 1000);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
