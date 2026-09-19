import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { createSolidPng } from '../scripts/gen-livearea.mjs';
import { validateLiveArea } from '../scripts/validate-livearea.mjs';

// Decode the actual indexed output, checking artwork/alpha as well as its header.
const image = await loadImage(createSolidPng(8, 8, 14, 28, 36));
const canvas = createCanvas(8, 8), ctx = canvas.getContext('2d');
ctx.drawImage(image, 0, 0);
assert.deepEqual([...ctx.getImageData(0, 0, 1, 1).data], [44, 58, 66, 255]);
assert.deepEqual([...ctx.getImageData(4, 4, 1, 1).data], [14, 28, 36, 255]);

await validateLiveArea(fileURLToPath(new URL('../sce_sys/', import.meta.url)));
const dir = mkdtempSync(join(tmpdir(), 'arcana-livearea-'));
try {
  cpSync(new URL('../sce_sys/', import.meta.url), dir, { recursive: true });
  const icon = join(dir, 'icon0.png'), original = readFileSync(icon);
  writeFileSync(icon, createCanvas(128, 128).toBuffer('image/png'));
  await assert.rejects(validateLiveArea(dir), /PNG indexado/);
  writeFileSync(icon, original);
  const xml = join(dir, 'livearea/contents/template.xml');
  writeFileSync(xml, readFileSync(xml, 'utf8').replaceAll('startup-image', 'startup'));
  await assert.rejects(validateLiveArea(dir), /startup-image/);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log('livearea ok: PNG-8, dimensions, palette, template and invalid-input rejection');
