// Generates valid PNGs for PS Vita LiveArea and icon0
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

export function createSolidPng(width, height, r, g, b, a = 255) {
  const rowSize = 1 + width;
  const raw = Buffer.alloc(rowSize * height);
  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowSize;
    raw[rowOffset] = 0; // Filter: None
    for (let x = 0; x < width; x++) {
      const px = rowOffset + 1 + x;
      // Same two-color artwork, encoded as PNG-8 for the real LiveArea installer.
      const isBorder = x < 2 || x >= width - 2 || y < 2 || y >= height - 2;
      raw[px] = isBorder ? 1 : 0;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // Bit depth
  ihdr[9] = 3; // Indexed palette (RGBA PNGs can fail promotion on hardware)
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('PLTE', Buffer.from([r, g, b, Math.min(255, r + 30), Math.min(255, g + 30), Math.min(255, b + 30)])),
    ...(a < 255 ? [chunk('tRNS', Buffer.from([a, a]))] : []),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function writePng(path, width, height, r, g, b) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, createSolidPng(width, height, r, g, b));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const sceSys = new URL('../sce_sys/', import.meta.url);
  writePng(fileURLToPath(new URL('icon0.png', sceSys)), 128, 128, 14, 28, 36);
  writePng(fileURLToPath(new URL('livearea/contents/bg.png', sceSys)), 840, 500, 9, 13, 24);
  writePng(fileURLToPath(new URL('livearea/contents/startup.png', sceSys)), 280, 158, 24, 60, 52);
  console.log('LiveArea assets generated successfully (indexed PNG-8)');
}
