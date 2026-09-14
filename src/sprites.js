// Sprites are cut from the atlases once into small canvases, with recolored and flash variants baked in
// ahead of time. Drawing never uses ctx.filter (slow in Chrome, missing in Safari).
const CELL = 313.5;
const ATLAS_CELLS = {
  player: [0, 0], player2: [1, 0], player3: [2, 0], player4: [3, 0],
  slime: [0, 1], bat: [1, 1], brute: [2, 1], eye: [3, 1],
  bolt: [0, 2], fire: [1, 2], blade: [2, 2], thorn: [3, 2],
  gem: [0, 3], greenGem: [1, 3], coin: [2, 3], heart: [3, 3]
};
// Source bounds follow the generated campaign atlas (1254 × 1254).
const PHASE_BOUNDS = {
  mushroom: [0, 0, 418, 442], beetle: [418, 0, 408, 442], treant: [826, 0, 428, 440],
  skeleton: [0, 442, 418, 410], wraith: [418, 442, 408, 410], lich: [826, 440, 428, 408],
  imp: [0, 852, 418, 402], scorpion: [418, 852, 408, 402], demon: [826, 848, 428, 406]
};
const VARIANTS = {
  bladePurple: { base: 'blade', hue: 55 },
  batEmber: { base: 'bat', hue: 105, saturation: 1.2 },
  bruteMagma: { base: 'brute', hue: -18, saturation: 1.6, lightness: 1.08 },
  gemRare: { base: 'gem', hue: 70 },
  gemEpic: { base: 'gem', hue: 170, saturation: 1.2 }
};
export const PLAYER_SPRITES = ['player', 'player2', 'player3', 'player4'];
export const ENEMY_SPRITES = { slimelet: 'slime', bat: 'batEmber', brute: 'bruteMagma' };
export const SHOT_SPRITES = ['bolt', 'fire', 'thorn', 'bladePurple'];

const atlas = new Image();
atlas.src = './assets/sprites.webp';
const phaseAtlas = new Image();
phaseAtlas.src = './assets/phases.png';
const cache = new Map();

function rgbToHsl(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}
function hslToRgb(h, s, l) {
  if (!s) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const channel = t => {
    t = (t + 1) % 1;
    return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p;
  };
  return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)];
}

function recolor(canvas, { hue = 0, saturation = 1, lightness = 1 }) {
  const c = canvas.getContext('2d', { willReadFrequently: true });
  const image = c.getImageData(0, 0, canvas.width, canvas.height);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    if (!data[i + 3]) continue;
    const [h, s, l] = rgbToHsl(data[i] / 255, data[i + 1] / 255, data[i + 2] / 255);
    const [r, g, b] = hslToRgb((h + hue / 360 + 1) % 1, Math.min(1, s * saturation), Math.min(1, l * lightness));
    data[i] = r * 255; data[i + 1] = g * 255; data[i + 2] = b * 255;
  }
  c.putImageData(image, 0, 0);
}

function bake(name) {
  const variant = VARIANTS[name];
  const base = variant?.base || name;
  const phase = PHASE_BOUNDS[base];
  const source = phase ? phaseAtlas : atlas;
  if (!source.complete || !source.naturalWidth) return null;
  const bounds = phase || [ATLAS_CELLS[base][0] * CELL, ATLAS_CELLS[base][1] * CELL, CELL, CELL];
  const resolution = phase ? 256 : 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = resolution;
  const [sx, sy, sw, sh] = bounds;
  canvas.getContext('2d').drawImage(source, sx, sy, sw, sh, 0, 0, resolution, resolution);
  if (variant) recolor(canvas, variant);
  const flash = document.createElement('canvas');
  flash.width = flash.height = resolution;
  const f = flash.getContext('2d');
  f.drawImage(canvas, 0, 0);
  f.globalCompositeOperation = 'source-atop';
  f.fillStyle = '#fff';
  f.fillRect(0, 0, resolution, resolution);
  const sprite = { canvas, flash };
  cache.set(name, sprite);
  return sprite;
}

export const spriteFor = name => cache.get(name) || bake(name);

/** Shared camera so sprite draws can set one transform instead of save/translate/rotate/restore. */
export const view = { dpr: 1, camX: 0, camY: 0, shakeX: 0, shakeY: 0 };

export function worldTransform(ctx) {
  ctx.setTransform(view.dpr, 0, 0, view.dpr, (view.shakeX - view.camX) * view.dpr, (view.shakeY - view.camY) * view.dpr);
  ctx.globalAlpha = 1;
}

export function drawSprite(ctx, name, x, y, size, rotation = 0, alpha = 1, sx = 1, sy = 1, flash = 0) {
  const sprite = spriteFor(name);
  if (!sprite || alpha <= 0) return;
  const { dpr } = view;
  const cos = Math.cos(rotation), sin = Math.sin(rotation);
  ctx.setTransform(dpr * cos * sx, dpr * sin * sx, -dpr * sin * sy, dpr * cos * sy,
    (x + view.shakeX - view.camX) * dpr, (y + view.shakeY - view.camY) * dpr);
  ctx.globalAlpha = alpha;
  const half = size / 2;
  ctx.drawImage(sprite.canvas, -half, -half, size, size);
  if (flash > 0) {
    ctx.globalAlpha = alpha * Math.min(1, flash) * 0.6;
    ctx.drawImage(sprite.flash, -half, -half, size, size);
  }
  worldTransform(ctx);
}
