import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadImage } from '@napi-rs/canvas';

// Vita3K accepts RGBA assets that ScePromoterUtility may reject. Validate the shipped files,
// not just the generator. Reference: https://github.com/vitasdk/samples#notes-on-images
export async function validateLiveArea(sceSys) {
  for (const [name, width, height] of [
    ['icon0.png', 128, 128], ['livearea/contents/bg.png', 840, 500],
    ['livearea/contents/startup.png', 280, 158]
  ]) {
    const bytes = readFileSync(join(sceSys, name));
    assert.ok(bytes.length >= 33 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')), `${name}: PNG inválido`);
    assert.ok(bytes.length <= 420 * 1024, `${name}: excede 420 KiB`);
    assert.equal(bytes[24], 8, `${name}: use PNG de 8 bits`);
    assert.equal(bytes[25], 3, `${name}: use PNG indexado (PNG-8), não RGB/RGBA`);
    assert.equal(bytes[28], 0, `${name}: PNG não deve ser entrelaçado`);
    const image = await loadImage(bytes);
    assert.equal(image.width, width, `${name}: largura incorreta`);
    assert.equal(image.height, height, `${name}: altura incorreta`);
  }
  const xml = readFileSync(join(sceSys, 'livearea/contents/template.xml'), 'utf8');
  assert.ok(Buffer.byteLength(xml) <= 32 * 1024, 'template.xml: excede 32 KiB');
  assert.match(xml, /<livearea\s[^>]*format-ver="01\.00"[^>]*>/, 'template.xml: falta format-ver');
  assert.match(xml, /<livearea-background>\s*<image>bg\.png<\/image>\s*<\/livearea-background>/);
  assert.match(xml, /<gate>\s*<startup-image>startup\.png<\/startup-image>\s*<\/gate>/,
    'template.xml: gate exige startup-image, não startup');
}
