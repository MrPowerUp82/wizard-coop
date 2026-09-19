// Headless smoke test of the real Switch bundle (romfs/main.js, debug build) in Node.
// It stands in for the nx.js globals the game touches — screen, navigator.getGamepads(), Switch.*,
// OffscreenCanvas, Image, FontFace/fonts, localStorage and an AudioContext that, like nx.js
// 1.0.0-beta.6, has no createOscillator/createBiquadFilter — then drives menus, solo, split-screen
// co-op with two sideways Joy-Cons, disconnect/reconnect, pause, power choice and game over.
// It cannot prove how real hardware reports Joy-Cons; see README "Validação em hardware".

import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnEnemy } from '../../../server/combat.js';

const here = dirname(fileURLToPath(import.meta.url));
const W = 1280, H = 720;
// @nx.js/constants ships extensionless ESM imports (meant for bundlers), so bundle it for Node.
const constants = await build({ stdin: { contents: "export * from '@nx.js/constants'", resolveDir: here }, bundle: true, format: 'esm', write: false });
const { HidDeviceTypeBits, HidNpadButton: B, HidNpadStyleTag } = await import(`data:text/javascript,${encodeURIComponent(constants.outputFiles[0].text)}`);

// --- Canvas ---------------------------------------------------------------------------------------
const log = { clips: [], fonts: new Set(), draws: 0 };
class FakeContext {
  constructor(width, height, screen = false) { this.width = width; this.height = height; this.screen = screen; this._font = '10px sans-serif'; }
  get font() { return this._font; }
  set font(value) { this._font = value; if (this.screen) log.fonts.add(value); }
  rect(x, y, w, h) { if (this.screen) log.clips.push([x, y, w, h]); }
  measureText(value) { return { width: String(value).length * 8 }; }
  createRadialGradient() { return { addColorStop() {} }; }
  createLinearGradient() { return { addColorStop() {} }; }
  getImageData(x, y, w, h) { return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h }; }
  drawImage(image, ...args) {
    log.draws++;
    if (this.screen && args.length === 4 && args[2] === W && args[3] === H) log.worldSize = [image.width, image.height];
  }
}
for (const name of ['save', 'restore', 'setTransform', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'arc', 'ellipse', 'fill', 'stroke',
  'fillRect', 'strokeRect', 'clearRect', 'clip', 'fillText', 'strokeText', 'translate', 'rotate', 'scale', 'quadraticCurveTo',
  'bezierCurveTo', 'roundRect', 'setLineDash', 'putImageData']) FakeContext.prototype[name] = function () {};
const screenCtx = new FakeContext(W, H, true);
globalThis.screen = { width: W, height: H, getContext: () => screenCtx };
globalThis.OffscreenCanvas = class { constructor(w, h) { this.width = w; this.height = h; this.ctx = new FakeContext(w, h); } getContext() { return this.ctx; } };
globalThis.Image = class { set src(value) { this._src = value; } get src() { return this._src; } get complete() { return true; } get naturalWidth() { return 1254; } };

// --- Fonts / filesystem / storage -----------------------------------------------------------------
const registered = [];
globalThis.FontFace = class { constructor(family, data, descriptors = {}) { assert.ok(data.byteLength > 1000, `font ${family} empty`); Object.assign(this, { family, weight: descriptors.weight || 'normal' }); } };
globalThis.fonts = { add(face) { registered.push(`${face.weight} ${face.family}`); } };
globalThis.Switch = {
  readFile: async path => { const file = readFileSync(join(here, '..', path.replace('romfs:/', 'romfs/'))); return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength); },
  exit() { throw new Error('exit'); },
  memoryUsage: () => ({ usedHeapSize: 0 })
};
const store = new Map();
globalThis.localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
globalThis.addEventListener = () => {};

// --- Audio: nx.js-like context (buffer sources and gains only) ------------------------------------
const audioLog = { started: 0, samples: 0 };
class FakeParam { constructor(v) { this.value = v; } setValueAtTime() { return this; } exponentialRampToValueAtTime() { return this; } }
class FakeNode { connect(node) { return node; } }
globalThis.AudioContext = class {
  constructor() { this.sampleRate = 48000; this.currentTime = 0; this.state = 'running'; this.destination = new FakeNode(); }
  createGain() { const n = new FakeNode(); n.gain = new FakeParam(1); return n; }
  createBuffer(channels, length) { const data = new Float32Array(length); return { length, getChannelData: () => data }; }
  createBufferSource() {
    const n = new FakeNode();
    n.start = () => { audioLog.started++; audioLog.samples += n.buffer.length; assert.ok(n.buffer.getChannelData(0).some(v => v !== 0), 'rendered silence'); };
    return n;
  }
  createOscillator() { throw new Error('Method not implemented.'); }
  createBiquadFilter() { throw new Error('Method not implemented.'); }
  resume() { return Promise.resolve(); }
};

// --- Controllers ------------------------------------------------------------------------------------
const pads = Array(8).fill(null);
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { getGamepads: () => pads } });
function pad(index, kind) {
  const spec = {
    pro: [HidNpadStyleTag.FullKey, HidDeviceTypeBits.FullKey, 'Nintendo Switch Pro Controller (XAW1)'],
    joyLeft: [HidNpadStyleTag.JoyLeft, HidDeviceTypeBits.JoyLeft, 'Joy-Con (L) (XBW-L1)'],
    joyRight: [HidNpadStyleTag.JoyRight, HidDeviceTypeBits.JoyRight, 'Joy-Con (R) (XBW-R1)']
  }[kind];
  pads[index] = { index, connected: true, styleSet: spec[0], deviceType: spec[1], id: spec[2], axes: [0, 0, 0, 0], rawButtons: 0n,
    buttons: Array.from({ length: 16 }, () => ({ pressed: false })) };
  return pads[index];
}

// --- Frames -----------------------------------------------------------------------------------------
let frameCallback = null;
let app = null;
globalThis.requestAnimationFrame = callback => { frameCallback = callback; return 1; };
let now = performance.now();
let ticks = 0;
function tick(frames = 1) {
  if (process.env.SMOKE_TRACE && ++ticks % 20 === 0) console.log("tick", ticks, app?.mode, app?.paused, app?.game?.time?.toFixed(2));
  for (let i = 0; i < frames; i++) { now += 1000 / 60; const callback = frameCallback; callback(now); }
}
/** Holds `mask` for one frame, then releases it (one press). */
function press(target, mask, frames = 1) { target.rawButtons = BigInt(mask); tick(frames); target.rawButtons = 0n; tick(); }

await import(pathToFileURL(join(here, '..', 'romfs', 'main.js')).href);
app = globalThis.__ARCANA_SWITCH__;
assert.ok(app, 'debug hook missing: run the debug build');

// Boot and fonts
tick(2);
assert.equal(app.mode, 'menu');
for (const face of ['400 Inter', '700 Inter', '800 Inter', '700 Cinzel', '400 DejaVu Sans', '700 DejaVu Sans']) assert.ok(registered.includes(face), `font ${face} not registered`);
const known = /^(\d{3} [\d.]+px (Inter|Cinzel|DejaVu Sans)|[\d.]+px system-ui)$/;
const unknown = [...log.fonts].filter(f => !known.test(f) && f !== '10px sans-serif' && f !== '24px system-ui');
assert.deepEqual(unknown, [], 'font strings reaching nx.js must be registered families');

// Solo with a Pro Controller: A on "Jogar solo", A on the character screen.
const pro = pad(0, 'pro');
tick();
press(pro, B.A);
assert.equal(app.menu.screen, 'solo');
press(pro, B.A);
assert.equal(app.mode, 'offline');
assert.deepEqual(Object.keys(app.game.players), ['me']);
log.clips.length = 0;
const x0 = app.game.players.me.x;
pro.axes = [1, 0, 0, 0];
tick(30);
pro.axes = [0, 0, 0, 0];
assert.ok(app.game.players.me.x - x0 > 50, 'solo stick moves the player');
assert.ok(log.clips.every(([x, y, w, h]) => x === 0 && y === 0 && w === W && h === H), 'solo renders one full-screen viewport');
assert.equal(log.clips.length, 30, 'one world render per frame');
press(pro, B.Plus);
assert.equal(app.paused, true, 'Plus pauses');
press(pro, B.Down); press(pro, B.A);
assert.equal(app.mode, 'menu', 'pause menu returns to the main menu');

// Co-op: Joy-Con L and Joy-Con R held sideways, separate controllers (no Pro).
pads[0] = null;
tick();
const left = pad(0, 'joyLeft');
const right = pad(1, 'joyRight');
tick();
// Joy-Con L sideways: the player's "down" is the device's stick-left (axes[0] = -1).
left.axes = [-1, 0, 0, 0]; tick(); left.axes = [0, 0, 0, 0]; tick();
press(left, B.Down); // Joy-Con L confirm: D-pad Down is the rightmost face button when sideways
assert.equal(app.menu.screen, 'lobby', 'Joy-Con L navigates to co-op');
assert.equal(app.controllers.padFor(0)?.kind, 'joyLeft', 'Joy-Con L is player 1');
assert.equal(app.controllers.padFor(1)?.kind, 'joyRight', 'Joy-Con R is player 2');
press(left, B.Down);
press(right, B.X); // Joy-Con R confirm: X is the rightmost face button when sideways
assert.equal(app.mode, 'offline', 'both ready starts the run');
const players = app.game.players;
assert.deepEqual(Object.keys(players), ['me', 'p2']);
const p2 = players.p2;

// Simultaneous, independent movement: L pushes right (device down, axes[1]=1), R pushes left (device down, axes[3]=1).
log.clips.length = 0;
const start = { me: players.me.x, p2: p2.x, time: app.game.time };
left.axes = [0, 1, 0, 0];
right.axes = [0, 0, 0, 1];
tick(30);
left.axes = [0, 0, 0, 0]; right.axes = [0, 0, 0, 0];
assert.ok(players.me.x - start.me > 50, 'Joy-Con L moves player 1 right');
assert.ok(start.p2 - p2.x > 50, 'Joy-Con R moves player 2 left');
assert.ok(Math.abs(app.game.time - start.time - 30 / 60) < 0.02, 'simulation advances once per frame');
assert.equal(log.clips.length, 60, 'two viewports per frame');
assert.deepEqual(log.clips.slice(0, 2), [[0, 0, 640, 720], [640, 0, 640, 720]], 'existing split screen halves');

// SL on Joy-Con L casts player 1's special only.
players.me.specialCharge = 100; p2.specialCharge = 100;
press(left, B.LeftSL);
assert.ok(players.me.specialCharge < 100, 'SL fires player 1 special');
assert.equal(p2.specialCharge, 100, 'player 2 unaffected');
// SR on Joy-Con R dashes player 2 only.
press(right, B.RightSR);
assert.ok(p2.dashCooldown > 0, 'SR dashes player 2');

// Power choice belongs to player 2's controller (the run may offer its own choices meanwhile).
p2.pendingPowers = ['arcane', 'haste', 'vitality'];
tick();
press(left, B.Down); // player 1's confirm cannot choose for player 2
assert.ok(p2.pendingPowers, 'player 1 cannot pick player 2 power');
right.axes = [0, 0, 0, -1]; tick(); right.axes = [0, 0, 0, 0]; tick(); // player-right on a sideways Joy-Con R: device up
const focused = p2.pendingPowers[1];
const rank = p2.powers[focused] || 0;
press(right, B.X);
assert.equal(p2.powers[focused], rank + 1, 'player 2 picked the focused (second) power with Joy-Con R');

// Disconnect player 2's Joy-Con: pause, nothing about the player resets; reconnect rebinds.
const snapshot = { hp: p2.hp, level: p2.level, powers: { ...p2.powers }, color: p2.color };
pads[1] = null;
tick(3);
assert.equal(app.paused, true, 'losing a co-op controller pauses');
press(right, 0); // no-op while disconnected
pads[1] = right;
tick(2);
assert.equal(app.controllers.padFor(1), app.controllers.pads[1], 'same Joy-Con rebinds to player 2');
assert.equal(app.game.players.p2, p2, 'player 2 is the same object');
assert.deepEqual({ hp: p2.hp, level: p2.level, powers: { ...p2.powers }, color: p2.color }, snapshot, 'player 2 state preserved');
press(right, B.X); // "Continuar batalha"
assert.equal(app.paused, false, 'resume after reconnect');
press(right, B.Plus);
assert.equal(app.paused, true, 'Plus on Joy-Con R pauses');
press(left, B.Minus);
assert.equal(app.paused, false, 'Minus on Joy-Con L resumes');

// Audio went through the compat layer (oscillators rendered into buffers).
assert.ok(audioLog.started > 0, 'sounds played via AudioBufferSourceNode');

// Crossing the former resolution thresholds must keep drawing directly to the native screen.
for (const split of [false, true]) {
  app.startRun({ split, character: 0, secondCharacter: 1 });
  for (const player of Object.values(app.game.players)) player.invulnerableFor = 100;
  app.game.spawn = 1e9;
  app.game.scheduleCursor = 1e9;
  for (const count of [20, 60, 120, 180, 110, 80, 20]) {
    app.game.enemies.length = 0;
    for (let n = 0; n < count; n++) spawnEnemy(app.game, 'mushroom', 300 + n, 300, 10000);
    log.worldSize = null;
    log.clips.length = 0;
    tick();
    assert.equal(app.paused, false);
    assert.equal(log.worldSize, null, `${count} enemies: no intermediate fullscreen blit`);
    assert.ok(log.clips.some(rect => rect.join(',') === (split ? '0,0,640,720' : '0,0,1280,720')),
      `${count} enemies: world still renders on the native screen`);
    if (split) assert.ok(log.clips.some(rect => rect.join(',') === '640,0,640,720'));
  }
}

// Game over follows the existing rules and returns to the menu.
app.game.over = true;
tick(2);
assert.ok(app.results, 'results screen');
tick(65);
press(left, B.Down);
assert.equal(app.mode, 'menu');
assert.ok(Number(JSON.parse(store.get('arcana-meta') || '{}').coins ?? 0) >= 0, 'wallet saved');

console.log(`smoke ok · ${audioLog.started} sons renderizados · ${registered.length} fontes · ${log.draws} drawImage`);
// The soundtrack scheduler (src/music.js) keeps an interval alive, as it would on the console.
process.exit(0);
