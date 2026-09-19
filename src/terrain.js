import { createCanvas, RENDER_TUNING } from './platform.js';

// Small cached tiles: the floor is drawn locally and never sent over WebSocket.
const palettes = [
  ['#101f1a', '#172b20', '#213b29', '#395439'],
  ['#111e2b', '#1b2f40', '#2a4355', '#547687'],
  ['#211719', '#302123', '#442c29', '#b95328'],
  ['#101e1c', '#1c3024', '#29442e', '#789153'],
  ['#131c30', '#202d43', '#2c3b51', '#a98b50'],
  ['#171020', '#281d37', '#382849', '#8c51b6']
];
const baseTiles = palettes.map((colors, phase) => {
  const tile = createCanvas(256, 256);
  const c = tile.getContext('2d');
  c.fillStyle = colors[0]; c.fillRect(0, 0, 256, 256);
  let seed = 391 + phase;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  if (phase === 0) {
    // Broken moss patches and soil, rather than the crypt's masonry.
    for (let n = 0; n < 70; n++) {
      const x = random() * 256, y = random() * 256, size = 8 + random() * 24;
      c.fillStyle = colors[1 + n % 2];
      c.fillRect(x, y, size, size / 2);
      c.fillRect(x + 4, y - 4, size / 2, size);
    }
  } else if (phase === 1) {
    for (let y = 0; y < 256; y += 32) for (let x = -64; x < 256; x += 64) {
      const offset = y % 64 ? 32 : 0;
      c.fillStyle = colors[1 + Math.floor(random() * 2)];
      c.fillRect(x + offset + 1, y + 1, 61, 29);
    }
  } else if (phase === 2 || phase === 5) {
    // Jagged cooled basalt with ember seams.
    for (let y = 0; y < 256; y += 64) for (let x = 0; x < 256; x += 64) {
      c.fillStyle = colors[1 + Math.floor(random() * 2)];
      c.beginPath(); c.moveTo(x + 8, y + 4); c.lineTo(x + 49, y + 2);
      c.lineTo(x + 62, y + 28); c.lineTo(x + 48, y + 59);
      c.lineTo(x + 10, y + 62); c.lineTo(x + 2, y + 30); c.closePath(); c.fill();
      c.strokeStyle = phase === 2 ? '#984323' : '#654080'; c.lineWidth = 1; c.stroke();
    }
  } else if (phase === 3) {
    // Still pools, reed clusters and moss keep the swamp readable beneath combat.
    for (let n = 0; n < 18; n++) {
      const x = random() * 256, y = random() * 256;
      c.fillStyle = colors[1];
      c.beginPath(); c.ellipse(x, y, 15 + random() * 24, 9 + random() * 12, 0, 0, Math.PI * 2); c.fill();
      c.strokeStyle = colors[2]; c.lineWidth = 2; c.stroke();
      c.strokeStyle = colors[3]; c.lineWidth = 1;
      c.beginPath(); c.moveTo(x + 18, y + 6); c.lineTo(x + 15, y - 3);
      c.moveTo(x + 20, y + 6); c.lineTo(x + 22, y - 6); c.stroke();
    }
  } else if (phase === 4) {
    // Inlaid astral tiles are baked once, like all other floors.
    for (let y = 0; y < 256; y += 64) for (let x = 0; x < 256; x += 64) {
      c.fillStyle = colors[1 + Math.floor(random() * 2)];
      c.fillRect(x + 2, y + 2, 60, 60);
      c.strokeStyle = colors[3]; c.lineWidth = 1; c.globalAlpha = 0.4;
      c.strokeRect(x + 7, y + 7, 50, 50);
      c.beginPath(); c.moveTo(x + 32, y + 18); c.lineTo(x + 42, y + 32);
      c.lineTo(x + 32, y + 46); c.lineTo(x + 22, y + 32); c.closePath(); c.stroke();
      c.globalAlpha = 1;
    }
  }
  for (let n = 0; n < 110; n++) {
    const x = Math.floor(random() * 256), y = Math.floor(random() * 256);
    c.fillStyle = colors[n % 4];
    c.fillRect(x, y, 2 + Math.floor(random() * 5), phase === 0 ? 5 : 2);
  }
  c.strokeStyle = colors[3]; c.lineWidth = phase === 2 ? 2 : 1;
  c.globalAlpha = phase === 2 ? 0.55 : 0.25;
  for (let n = 0; n < 5; n++) {
    const x = random() * 230, y = random() * 210;
    c.beginPath(); c.moveTo(x, y); c.lineTo(x + 13, y + 10);
    c.lineTo(x + 8, y + 22); c.lineTo(x + 25, y + 36); c.stroke();
  }
  return tile;
});

// Switch renders two cameras in co-op. A 2×2 macro-tile is pixel-identical to four 256px tiles but
// cuts floor draw calls roughly in half. Other platforms keep the original tile size.
const terrainMacro = Math.max(1, RENDER_TUNING.terrainMacro || 1);
const tileSize = 256 * terrainMacro;
const tiles = terrainMacro === 1 ? baseTiles : baseTiles.map(base => {
  const macro = createCanvas(tileSize, tileSize);
  const c = macro.getContext('2d');
  for (let y = 0; y < tileSize; y += 256) for (let x = 0; x < tileSize; x += 256) c.drawImage(base, x, y);
  return macro;
});

export function drawTerrain(ctx, phase, camX, camY, width, height) {
  const tile = tiles[phase] || tiles[0];
  const x0 = -((camX % tileSize + tileSize) % tileSize), y0 = -((camY % tileSize + tileSize) % tileSize);
  for (let y = y0; y < height; y += tileSize) for (let x = x0; x < width; x += tileSize) ctx.drawImage(tile, x, y);
  ctx.fillStyle = 'rgba(3, 8, 13, .3)'; ctx.fillRect(0, 0, width, height);
}
