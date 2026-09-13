// Small cached tiles: the floor is drawn locally and never sent over WebSocket.
const palettes = [
  ['#101f1a', '#172b20', '#213b29', '#395439'],
  ['#111e2b', '#1b2f40', '#2a4355', '#547687'],
  ['#211719', '#302123', '#442c29', '#b95328']
];
const tiles = palettes.map((colors, phase) => {
  const tile = document.createElement('canvas');
  tile.width = tile.height = 256;
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
  } else {
    // Jagged cooled basalt with ember seams.
    for (let y = 0; y < 256; y += 64) for (let x = 0; x < 256; x += 64) {
      c.fillStyle = colors[1 + Math.floor(random() * 2)];
      c.beginPath(); c.moveTo(x + 8, y + 4); c.lineTo(x + 49, y + 2);
      c.lineTo(x + 62, y + 28); c.lineTo(x + 48, y + 59);
      c.lineTo(x + 10, y + 62); c.lineTo(x + 2, y + 30); c.closePath(); c.fill();
      c.strokeStyle = '#984323'; c.lineWidth = 1; c.stroke();
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

export function drawTerrain(ctx, phase, camX, camY, width, height) {
  const tile = tiles[phase] || tiles[0];
  const x0 = -((camX % 256 + 256) % 256), y0 = -((camY % 256 + 256) % 256);
  for (let y = y0; y < height; y += 256) for (let x = x0; x < width; x += 256) ctx.drawImage(tile, x, y);
  ctx.fillStyle = 'rgba(3, 8, 13, .3)'; ctx.fillRect(0, 0, width, height);
}
