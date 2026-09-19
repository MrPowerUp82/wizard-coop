// @ts-check
// Headless smoke test of the real PS Vita bundle (build/assets/main.js, debug build) in Node.
// Simulates the PS Vita runtime environment (960×544 canvas, SceCtrl multi-port inputs,
// AudioContext with synthesis shim, localStorage, Vita filesystem) and drives:
// menu → solo → wireless DualShock on PSTV, disconnect/reconnect, pause, power choice and game over (strictly full-screen 960×544).

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SceCtrlButton as B, SceCtrlType } from '../src/input/mappings.js';

const here = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 544;

// --- Canvas ---------------------------------------------------------------------------------------
const log = { clips: [], fonts: new Set(), draws: 0 };
class FakeContext {
  constructor(width, height, screen = false) {
    this.width = width;
    this.height = height;
    this.screen = screen;
    this._font = '10px sans-serif';
  }
  get font() { return this._font; }
  set font(value) { this._font = value; if (this.screen) log.fonts.add(value); }
  rect(x, y, w, h) { if (this.screen) log.clips.push([x, y, w, h]); }
  measureText(value) { return { width: String(value).length * 8 }; }
  createRadialGradient() { return { addColorStop() {} }; }
  createLinearGradient() { return { addColorStop() {} }; }
  getImageData(x, y, w, h) { return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h }; }
  drawImage() { log.draws++; }
}

for (const name of [
  'save', 'restore', 'setTransform', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'arc', 'ellipse',
  'fill', 'stroke', 'fillRect', 'strokeRect', 'clearRect', 'clip', 'fillText', 'strokeText',
  'translate', 'rotate', 'scale', 'quadraticCurveTo', 'bezierCurveTo', 'roundRect', 'setLineDash',
  'putImageData'
]) {
  FakeContext.prototype[name] = function () {};
}

const screenCtx = new FakeContext(W, H, true);
globalThis.screen = { width: W, height: H, getContext: () => screenCtx };
globalThis.OffscreenCanvas = class {
  constructor(w, h) { this.width = w; this.height = h; this.ctx = new FakeContext(w, h); }
  getContext() { return this.ctx; }
};
globalThis.Image = class {
  set src(value) { this._src = value; }
  get src() { return this._src; }
  get complete() { return true; }
  get naturalWidth() { return 1254; }
};

// --- Fonts / filesystem / storage -----------------------------------------------------------------
const registered = [];
globalThis.FontFace = class {
  constructor(family, data, descriptors = {}) {
    assert.ok(data.byteLength > 1000, `font ${family} empty`);
    Object.assign(this, { family, weight: descriptors.weight || 'normal' });
  }
};
globalThis.fonts = {
  add(face) { registered.push(`${face.weight} ${face.family}`); }
};

globalThis.Vita = {
  readFile: async path => {
    const rel = path.replace('app0:/assets/', 'build/assets/').replace('app0:/', 'build/');
    const file = readFileSync(join(here, '..', rel));
    return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
  },
  exit() { throw new Error('exit'); },
  memoryUsage: () => ({ usedHeapSize: 42 * 1048576 })
};

const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k)
};
globalThis.addEventListener = () => {};

// --- Audio: software synthesis shim ---------------------------------------------------------------
const audioLog = { started: 0, samples: 0 };
class FakeParam {
  constructor(v) { this.value = v; }
  setValueAtTime() { return this; }
  exponentialRampToValueAtTime() { return this; }
  linearRampToValueAtTime() { return this; }
}
class FakeNode {
  connect(node) { return node; }
  disconnect() {}
}
globalThis.AudioContext = class {
  constructor() {
    this.sampleRate = 48000;
    this.currentTime = 0;
    this.state = 'running';
    this.destination = new FakeNode();
  }
  createGain() { const n = new FakeNode(); n.gain = new FakeParam(1); return n; }
  createBuffer(channels, length) { const data = new Float32Array(length); return { length, getChannelData: () => data }; }
  createBufferSource() {
    const n = new FakeNode();
    n.start = () => {
      audioLog.started++;
      audioLog.samples += n.buffer.length;
      assert.ok(n.buffer.getChannelData(0).some(v => v !== 0), 'rendered silence');
    };
    return n;
  }
  createOscillator() { throw new Error('Method not implemented.'); }
  createBiquadFilter() { throw new Error('Method not implemented.'); }
  resume() { return Promise.resolve(); }
};

// --- Controllers: PS Vita SceCtrl ports 0..5 -------------------------------------------------------
const pads = Array(6).fill(null);
function pad(port, type = SceCtrlType.PHY, label = `Controle ${port}`) {
  pads[port] = {
    port,
    connected: true,
    type,
    label,
    buttons: 0,
    btns: 0,
    lx: 128,
    ly: 128,
    rx: 128,
    ry: 128
  };
  return pads[port];
}

globalThis.Pads = {
  read(port = 0) {
    return pads[port] || { port, connected: false, buttons: 0, btns: 0, lx: 128, ly: 128, rx: 128, ry: 128 };
  }
};

// --- Frames -----------------------------------------------------------------------------------------
let frameCallback = null;
globalThis.requestAnimationFrame = callback => { frameCallback = callback; return 1; };
let now = performance.now();
function tick(frames = 1) {
  for (let i = 0; i < frames; i++) {
    now += 1000 / 60;
    if (frameCallback) frameCallback(now);
  }
}
function press(target, mask, frames = 1) {
  target.buttons = target.btns = mask;
  tick(frames);
  target.buttons = target.btns = 0;
  tick();
}

// -------------------------------------------------------------------------------------------------
// Execution
// -------------------------------------------------------------------------------------------------

await import(pathToFileURL(join(here, '..', 'build', 'assets', 'main.js')).href);
const app = globalThis.__ARCANA_VITA__;
assert.ok(app, 'debug hook missing: build with --debug');

// 1. Boot and font registration
tick(2);
assert.equal(app.mode, 'menu');
for (const face of ['400 Inter', '700 Inter', '800 Inter', '700 Cinzel', '400 DejaVu Sans', '700 DejaVu Sans']) {
  assert.ok(registered.includes(face), `font ${face} not registered`);
}

// 2. Solo with PS Vita Handheld (Port 0): CROSS on "Jogar solo", CROSS on character screen
const vita = pad(0, SceCtrlType.PHY, 'PS Vita (Portátil)');
tick();
press(vita, B.CROSS);
// Solo selection screen
tick();
press(vita, B.CROSS);
assert.equal(app.mode, 'offline');
assert.deepEqual(Object.keys(app.game.players), ['me']);

log.clips.length = 0;
const x0 = app.game.players.me.x;
// Push stick right: lx = 255 (neutral 128)
vita.lx = 255;
tick(30);
vita.lx = 128;
assert.ok(app.game.players.me.x - x0 > 40, 'solo stick moves the player right');
assert.ok(log.clips.every(([x, y, w, h]) => x === 0 && y === 0 && w === W && h === H), 'solo renders one 960x544 viewport');
assert.equal(log.clips.length, 30, 'one world render per frame');

// Pause and unpause with START
press(vita, B.START);
assert.equal(app.paused, true, 'START pauses');
press(vita, B.DOWN);
press(vita, B.DOWN);
press(vita, B.CROSS); // Sair para o menu
assert.equal(app.mode, 'menu', 'pause menu returns to main menu');

// 3. PlayStation TV with DualShock 4 on Port 1 (PSTV / external pad)
pads[0] = null;
tick();
const ds4 = pad(1, SceCtrlType.DS4, 'DualShock 4');
tick();

// Start run with DualShock
press(ds4, B.CROSS); // Jogar solo
tick();
press(ds4, B.CROSS); // Confirm character
assert.equal(app.mode, 'offline', 'external controller starts solo run');

const players = app.game.players;
assert.deepEqual(Object.keys(players), ['me']);

// Movement on Port 1
log.clips.length = 0;
const startPos = { me: players.me.x, time: app.game.time };
ds4.lx = 255; // moves right
tick(30);
ds4.lx = 128;

assert.ok(players.me.x - startPos.me > 40, 'Port 1 moves Player right');
assert.ok(Math.abs(app.game.time - startPos.time - 30 / 60) < 0.02, 'simulation advances once per frame');
assert.equal(log.clips.length, 30, 'one full-screen viewport rendered per frame');
assert.ok(log.clips.every(([x, y, w, h]) => x === 0 && y === 0 && w === W && h === H), 'strictly full-screen 960x544, no split screen');

// Actions: Port 1 special (CROSS/R1)
players.me.specialCharge = 100;
press(ds4, B.CROSS);
assert.ok(players.me.specialCharge < 100, 'Port 1 fires special');

// Port 1 dash (CIRCLE/L1)
press(ds4, B.CIRCLE);
assert.ok(players.me.dashCooldown > 0, 'Port 1 dashes');

// Level up / Power choice
players.me.pendingPowers = ['arcane', 'haste', 'vitality'];
tick();
ds4.lx = 255; tick(); ds4.lx = 128; tick(); // Moves right to select second power
const focused = players.me.pendingPowers[1];
const rank = players.me.powers[focused] || 0;
press(ds4, B.CROSS);
assert.equal(players.me.powers[focused], rank + 1, 'picked focused power with controller');

// Disconnect controller: pauses automatically, state is preserved, reconnect restores
const snapshot = { hp: players.me.hp, level: players.me.level, powers: { ...players.me.powers } };
pads[1] = null;
tick(3);
assert.equal(app.paused, true, 'losing controller automatically pauses');
pads[1] = ds4;
tick(2);
assert.equal(app.controllers.pads[1].connected, true, 'controller reconnected on port 1');
assert.equal(app.controllers.connectedCount, 1);
assert.deepEqual({ hp: players.me.hp, level: players.me.level, powers: { ...players.me.powers } }, snapshot, 'player state fully preserved');
press(ds4, B.CROSS); // Resume
assert.equal(app.paused, false, 'resume after reconnect');

// Pause and unpause with START
press(ds4, B.START);
assert.equal(app.paused, true, 'START pauses');
press(ds4, B.START);
assert.equal(app.paused, false, 'START resumes');

// Audio verification
assert.ok(audioLog.started > 0, 'sounds played via software synthesis audio shim');

// Game over and coin deposit
app.game.over = true;
tick(65);
press(ds4, B.CROSS);
assert.equal(app.mode, 'menu');
assert.ok(Number(JSON.parse(store.get('arcana-meta') || '{}').coins ?? 0) >= 0, 'wallet saved');

console.log(`smoke ok · ${audioLog.started} sons renderizados · ${registered.length} fontes · ${log.draws} drawImage`);
process.exit(0);
