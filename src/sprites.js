import { assetUrl, createCanvas, RENDER_TUNING } from './platform.js';

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
const PHASE2_BOUNDS = {
  spore: [0, 0, 418, 418], revenant: [418, 0, 418, 418], bogwarden: [836, 0, 418, 418],
  sentinel: [0, 418, 418, 418], seer: [418, 418, 418, 418], archon: [836, 418, 418, 418],
  voidling: [0, 836, 418, 418], voidscarab: [418, 836, 418, 418], umbra: [836, 836, 418, 418]
};
const VARIANTS = {
  auroraBolt: { base: 'bolt', hue: -165, saturation: 0.8, lightness: 1.3 },
  godBolt: { base: 'bolt', hue: 0, saturation: 1.4, lightness: 1.3 },
  developerBolt: { base: 'bolt', hue: -35, saturation: 0.65, lightness: 1.35 },
  bladePurple: { base: 'blade', hue: 55 },
  batEmber: { base: 'bat', hue: 105, saturation: 1.2 },
  bruteMagma: { base: 'brute', hue: -18, saturation: 1.6, lightness: 1.08 },
  mushroomBog: { base: 'mushroom', hue: 65, saturation: 0.9 },
  wraithBog: { base: 'wraith', hue: -90, saturation: 1.2 },
  treantBog: { base: 'treant', hue: 35, saturation: 0.85 },
  skeletonGold: { base: 'skeleton', hue: 190, saturation: 1.2 },
  eyeGold: { base: 'eye', hue: 190, saturation: 1.2 },
  lichGold: { base: 'lich', hue: 190, saturation: 1.2 },
  batVoid: { base: 'bat', hue: -30, saturation: 1.3 },
  beetleVoid: { base: 'beetle', hue: 150, saturation: 1.1 },
  demonVoid: { base: 'demon', hue: -90, saturation: 1.1 },
  gemRare: { base: 'gem', hue: 70 },
  gemEpic: { base: 'gem', hue: 170, saturation: 1.2 }
};
export const PLAYER_SPRITES = ['player', 'player2', 'player3', 'player4', 'developer', 'aurora', 'god'];
export const ENEMY_SPRITES = { slimelet: 'slime', bat: 'batEmber', brute: 'bruteMagma' };
export const SHOT_SPRITES = ['bolt', 'fire', 'thorn', 'bladePurple', 'developerBolt', 'auroraBolt', 'godBolt'];

const atlas = new Image();
atlas.src = assetUrl('assets/sprites.webp');
const phaseAtlas = new Image();
phaseAtlas.src = assetUrl('assets/phases.webp');
const phase2Atlas = new Image();
phase2Atlas.src = assetUrl('assets/phases2.webp');
const developerImage = new Image();
developerImage.src = assetUrl('assets/developer.png');
const godImage = new Image();
godImage.src = assetUrl('assets/the-god.png');
const auroraImage = new Image();
auroraImage.src = assetUrl('assets/aurora.png');
const cache = new Map();
const animationSheets = new Map();
const animationVariants = new Map();
const ANIMATED = new Set([...PLAYER_SPRITES, ...Object.keys(PHASE_BOUNDS), ...Object.keys(PHASE2_BOUNDS),
  'slime', 'bat', 'brute', 'eye', ...Object.keys(VARIANTS).filter(name =>
    !['auroraBolt', 'godBolt', 'developerBolt', 'bladePurple', 'gemRare', 'gemEpic'].includes(name))]);
const FRAME = 128;
// Generated attack effects can reach a cell boundary. Keep a small transparent gutter
// so adjacent frames never leak into the current one when the sheet is sampled.
const FRAME_INSET = 6;
const CLEAN_SHEETS = new Set(['player', 'aurora', 'archon', 'scorpion']);

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
  const standalone = name === 'developer' || name === 'god' || name === 'aurora';
  const phase2 = PHASE2_BOUNDS[base];
  const phase = PHASE_BOUNDS[base];
  const source = name === 'developer' ? developerImage : name === 'god' ? godImage : name === 'aurora' ? auroraImage
    : phase2 ? phase2Atlas : phase ? phaseAtlas : atlas;
  if (!source.complete || !source.naturalWidth) return null;
  const bounds = standalone ? [0, 0, source.naturalWidth, source.naturalHeight]
    : phase2 || phase || [ATLAS_CELLS[base][0] * CELL, ATLAS_CELLS[base][1] * CELL, CELL, CELL];
  const resolution = (standalone || phase || phase2) ? 256 : 128;
  const canvas = createCanvas(resolution, resolution);
  const [sx, sy, sw, sh] = bounds;
  canvas.getContext('2d').drawImage(source, sx, sy, sw, sh, 0, 0, resolution, resolution);
  if (variant) recolor(canvas, variant);
  const flash = createCanvas(resolution, resolution);
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

function sheetFor(name) {
  if (!RENDER_TUNING.animatedSheets || !ANIMATED.has(name)) return null;
  const variant = VARIANTS[name];
  if (variant) {
    const base = sheetFor(variant.base);
    if (!base) return null;
    let colored = animationVariants.get(name);
    if (!colored) {
      colored = createCanvas(base.width, base.height);
      colored.getContext('2d').drawImage(base, 0, 0);
      recolor(colored, variant);
      animationVariants.set(name, colored);
    }
    return colored;
  }
  let sheet = animationSheets.get(name);
  if (!sheet) {
    sheet = new Image();
    sheet.src = assetUrl(`assets/animated/${name}.webp`);
    animationSheets.set(name, sheet);
  }
  return sheet.complete && sheet.naturalWidth ? sheet : null;
}

/** Shared camera so sprite draws can set one transform instead of save/translate/rotate/restore. */
export const view = { dpr: 1, zoom: 1, ox: 0, oy: 0, camX: 0, camY: 0, shakeX: 0, shakeY: 0 };

export function worldTransform(ctx) {
  const zoom = view.zoom || 1;
  const dpr = view.dpr * zoom;
  const tx = ((view.shakeX - view.camX) * zoom + (view.ox || 0)) * view.dpr;
  const ty = ((view.shakeY - view.camY) * zoom + (view.oy || 0)) * view.dpr;
  ctx.setTransform(dpr, 0, 0, dpr, tx, ty);
  ctx.globalAlpha = 1;
}

function createFlipped(source) {
  const c = createCanvas(source.width, source.height);
  const ctx = c.getContext('2d');
  ctx.translate(source.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(source, 0, 0);
  return c;
}

export function drawSprite(ctx, name, x, y, size, rotation = 0, alpha = 1, sx = 1, sy = 1, flash = 0) {
  const sprite = spriteFor(name);
  if (!sprite || alpha <= 0) return;

  // Axis-aligned blit fast-path: skips two setTransform calls and avoids Skia batch flushes
  if (rotation === 0 && (sx === 1 || sx === -1) && sy === 1) {
    const img = sx === 1 ? sprite.canvas : (sprite.flipCanvas || (sprite.flipCanvas = createFlipped(sprite.canvas)));
    if (alpha !== 1) ctx.globalAlpha = alpha;
    const half = size / 2;
    ctx.drawImage(img, x - half, y - half, size, size);
    if (flash > 0) {
      const fimg = sx === 1 ? sprite.flash : (sprite.flipFlash || (sprite.flipFlash = createFlipped(sprite.flash)));
      ctx.globalAlpha = alpha * Math.min(1, flash) * 0.6;
      ctx.drawImage(fimg, x - half, y - half, size, size);
    }
    if (alpha !== 1 || flash > 0) ctx.globalAlpha = 1;
    return;
  }

  const zoom = view.zoom || 1;
  const dpr = view.dpr * zoom;
  const cos = Math.cos(rotation), sin = Math.sin(rotation);
  const tx = ((x + view.shakeX - view.camX) * zoom + (view.ox || 0)) * view.dpr;
  const ty = ((y + view.shakeY - view.camY) * zoom + (view.oy || 0)) * view.dpr;
  ctx.setTransform(dpr * cos * sx, dpr * sin * sx, -dpr * sin * sy, dpr * cos * sy, tx, ty);
  ctx.globalAlpha = alpha;
  const half = size / 2;
  ctx.drawImage(sprite.canvas, -half, -half, size, size);
  if (flash > 0) {
    ctx.globalAlpha = alpha * Math.min(1, flash) * 0.6;
    ctx.drawImage(sprite.flash, -half, -half, size, size);
  }
  worldTransform(ctx);
}

/** Draw one frame from a 4-column sheet. Rows: idle, move, attack, interact, hurt. */
export function drawAnimatedSprite(ctx, name, x, y, size, pose, alpha = 1, flash = 0) {
  const sheet = sheetFor(name);
  if (!sheet) {
    drawSprite(ctx, name, x, y, size, pose.rotation, alpha, pose.sx, pose.sy, flash);
    return;
  }
  const row = Math.max(0, Math.min(4, pose.animationRow || 0));
  const frame = Math.max(0, Math.min(3, pose.animationFrame || 0));
  const zoom = view.zoom || 1;
  const dpr = view.dpr * zoom;
  const cos = Math.cos(pose.rotation), sin = Math.sin(pose.rotation);
  const tx = ((x + view.shakeX - view.camX) * zoom + (view.ox || 0)) * view.dpr;
  const ty = ((y + view.shakeY - view.camY) * zoom + (view.oy || 0)) * view.dpr;
  ctx.setTransform(dpr * cos * pose.sx, dpr * sin * pose.sx,
    -dpr * sin * pose.sy, dpr * cos * pose.sy, tx, ty);
  ctx.globalAlpha = alpha;
  const inset = CLEAN_SHEETS.has(name) ? 0 : FRAME_INSET;
  const cropped = FRAME - inset * 2;
  // The blue wizard occupies less of its generated cell than the other three.
  // Match their visible height and keep the feet on the same baseline.
  const blueWizard = name === 'player';
  const drawnSize = size * cropped / FRAME * (blueWizard ? 1.25 : 1);
  const offsetY = blueWizard ? -size * 0.11 : 0;
  ctx.drawImage(sheet, frame * FRAME + inset, row * FRAME + inset,
    cropped, cropped, -drawnSize / 2, -drawnSize / 2 + offsetY, drawnSize, drawnSize);
  if (flash > 0) {
    const sprite = spriteFor(name);
    if (sprite) {
      ctx.globalAlpha = alpha * Math.min(1, flash) * 0.6;
      ctx.drawImage(sprite.flash, -size / 2, -size / 2, size, size);
    }
  }
  worldTransform(ctx);
}
