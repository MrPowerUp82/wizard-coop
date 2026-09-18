// Exercise the actual native entrypoint: no DOM, AudioContext, OffscreenCanvas,
// FontFace or requestAnimationFrame supplied by the test. Only the C bridge ABI.
import assert from 'node:assert/strict';
import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';
import { readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { SceCtrlButton as B } from '../src/input/mappings.js';

const build = fileURLToPath(new URL('../build/', import.meta.url));
const output = createCanvas(960, 544), ctx = output.getContext('2d');
const textures = [], clips = [], calls = { image: 0, triangles: 0, text: 0 };
const pads = new Map([[0, { port: 0, buttons: 0, lx: 128, ly: 128, rx: 128, ry: 128 }]]);
let now = 0, saved = '{}', exited = false, clip = [0, 0, 960, 544], additive = false;
const log = console.log.bind(console);
const decoded = new Map(await Promise.all(readdirSync(join(build, 'assets/baked')).map(async name => [name, await loadImage(join(build, 'assets/baked', name))])));
for (const face of ['inter-400', 'cinzel-700', 'dejavu-400']) GlobalFonts.registerFromPath(join(build, 'assets/fonts', `${face}.ttf`), face);
const css = color => `rgba(${color & 255},${color >>> 8 & 255},${color >>> 16 & 255},${(color >>> 24) / 255})`;
function draw(fn) {
  ctx.save(); ctx.beginPath(); ctx.rect(clip[0], clip[1], Math.max(0, clip[2] - clip[0]), Math.max(0, clip[3] - clip[1])); ctx.clip();
  ctx.globalCompositeOperation = additive ? 'lighter' : 'source-over'; fn(); ctx.restore();
}
globalThis.ArcanaNative = {
  now: () => now, exit: () => { exited = true; }, log,
  pad: port => pads.get(port) || null,
  readSave: () => saved, writeSave: json => { JSON.parse(json); saved = json; },
  readFile: () => null, capture: () => {},
  loadTexture(path) {
    assert.ok(path.startsWith('app0:/assets/baked/'), `unexpected texture path ${path}`);
    const image = decoded.get(path.slice('app0:/assets/baked/'.length));
    assert.ok(image.width > 0); const id = textures.push(image) - 1; return [id, image.width, image.height];
  },
  clip(...bounds) { clip = bounds; clips.push(bounds); }, blend(value) { additive = value; },
  triangles(buffer, colors) {
    calls.triangles++;
    const vertices = new Float32Array(buffer), palette = new Uint32Array(colors);
    assert.equal(vertices.length % 9, 0); assert.equal(vertices.length / 3, palette.length);
    assert.ok(vertices.every(Number.isFinite));
    draw(() => { for (let i = 0; i < vertices.length; i += 9) {
      ctx.fillStyle = css(palette[i / 3]); ctx.beginPath(); ctx.moveTo(vertices[i], vertices[i + 1]);
      ctx.lineTo(vertices[i + 3], vertices[i + 4]); ctx.lineTo(vertices[i + 6], vertices[i + 7]); ctx.fill();
    } });
  },
  image(id, buffer, sx, sy, sw, sh, color) {
    calls.image++; const p = new Float32Array(buffer); assert.equal(p.length, 8); assert.ok(p.every(Number.isFinite));
    draw(() => { ctx.globalAlpha = (color >>> 24) / 255;
      ctx.setTransform((p[2] - p[0]) / sw, (p[3] - p[1]) / sw, (p[4] - p[0]) / sh, (p[5] - p[1]) / sh, p[0], p[1]);
      ctx.drawImage(textures[id], sx, sy, sw, sh, 0, 0, sw, sh);
    });
  },
  measure(face, size, value) { ctx.font = `${size}px "${face}"`; return ctx.measureText(value).width; },
  text(face, size, value, x, y, color) { calls.text++; draw(() => { ctx.font = `${size}px "${face}"`; ctx.fillStyle = css(color); ctx.fillText(value, x, y); }); }
};
await import('../build/assets/main.js');
const app = globalThis.__ARCANA_VITA__;
assert.ok(app, 'native entrypoint must reach game initialization');
function tick(count = 1) { for (let i = 0; i < count; i++) { now += 1000 / 60; globalThis.__arcanaFrame(now); } }
function press(button, port = 0) { pads.get(port).buttons = button; tick(); pads.get(port).buttons = 0; tick(); }
tick();
writeFileSync(join(build, 'native-menu.png'), output.toBuffer('image/png'));
press(B.CROSS); press(B.CROSS);
assert.equal(app.mode, 'offline', 'CROSS must start a real game');
const x = app.game.players.me.x;
pads.get(0).buttons = B.RIGHT; tick(30); pads.get(0).buttons = 0;
assert.ok(app.game.players.me.x > x + 40, 'D-pad moves player');
press(B.START); assert.equal(app.paused, true);
const time = app.game.time; tick(3); assert.equal(app.game.time, time);
press(B.START); assert.equal(app.paused, false);
tick(60);
writeFileSync(join(build, 'native-solo.png'), output.toBuffer('image/png'));
app.endGame();
// Sparse physical ports reproduce a real handheld/PSTV disconnection scenario.
pads.clear(); pads.set(1, { port: 1, buttons: 0, lx: 128, ly: 128 }); pads.set(3, { port: 3, buttons: 0, lx: 128, ly: 128 });
tick(); app.controllers.autoAssign(); app.startRun({ split: true }); tick();
assert.deepEqual(app.controllers.bindings, [1, 3]);
const players = app.game.players;
const p1x = players.me.x, p2x = players.p2.x;
pads.get(1).lx = 255; pads.get(3).lx = 0; tick(30);
assert.ok(players.me.x > p1x); assert.ok(players.p2.x < p2x);
assert.ok(clips.some(c => c.join() === '0,0,480,544'));
assert.ok(clips.some(c => c.join() === '480,0,960,544'));
const p2 = pads.get(3); pads.delete(3); tick(); assert.equal(app.paused, true);
pads.set(3, p2); tick(); assert.equal(app.game.players.p2, players.p2);
writeFileSync(join(build, 'native-coop.png'), output.toBuffer('image/png'));
localStorage.setItem('native-test', 'persist'); globalThis.__arcanaShutdown();
assert.equal(JSON.parse(saved)['native-test'], 'persist');
globalThis.Vita.exit(); assert.equal(exited, true);
assert.ok(calls.image > 100 && calls.triangles > 100 && calls.text > 100);
log('Native ABI smoke passed:', calls, `${textures.length} real PNG textures`);
