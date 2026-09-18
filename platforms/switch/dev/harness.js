// Development harness: runs the Switch bundle (romfs/main.js) in a desktop browser by standing in for
// the nx.js globals it uses. Keyboard keys become sideways Joy-Cons (or a Pro Controller) reported in
// the Joy-Con's own device frame, so the real axis normalization in input/mappings.js is exercised.
// It is a layout/flow tool only: real Joy-Con reporting must be validated on hardware.

const HID = { A: 1, B: 2, X: 4, Y: 8, Plus: 1024, Minus: 2048, Left: 4096, Up: 8192, Right: 16384, Down: 32768,
  StickL: 16, StickR: 32, LeftSL: 16777216, LeftSR: 33554432, RightSL: 67108864, RightSR: 134217728 };
const STYLE = { FullKey: 1, JoyLeft: 8, JoyRight: 16 };
const DEVICE = { FullKey: 1, JoyLeft: 16, JoyRight: 32 };

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('screen'));
const context = canvas.getContext('2d');
Object.defineProperty(window, 'screen', { configurable: true, value: { width: 1280, height: 720, getContext: () => context } });

const romfs = path => path.replace('romfs:/', '../romfs/');
const NativeImage = window.Image;
window.Image = class extends NativeImage {
  set src(value) { super.src = romfs(value); }
  get src() { return super.src; }
};
window.fonts = document.fonts;
window.Switch = {
  readFile: async path => (await fetch(romfs(path))).arrayBuffer(),
  exit() { location.reload(); },
  memoryUsage: () => ({ usedHeapSize: performance.memory?.usedJSHeapSize || 0 })
};

// --- Virtual controllers -----------------------------------------------------------------------------
const keys = new Set();
addEventListener('keydown', event => { keys.add(event.code); if (event.code.startsWith('Arrow') || event.code === 'Space') event.preventDefault(); });
addEventListener('keyup', event => keys.delete(event.code));
const axis = (minus, plus) => (keys.has(plus) ? 1 : 0) - (keys.has(minus) ? 1 : 0);
const mask = map => Object.entries(map).reduce((bits, [code, bit]) => (keys.has(code) ? bits | bit : bits), 0);
const pro = new URLSearchParams(location.search).get('pad') === 'pro';

function gamepad(index, style, id, axes, raw) {
  return { index, id, connected: true, styleSet: STYLE[style], deviceType: DEVICE[style], axes, rawButtons: BigInt(raw),
    buttons: Array.from({ length: 16 }, () => ({ pressed: false, value: 0 })) };
}

function pads() {
  const list = Array(8).fill(null);
  const mx = axis('KeyA', 'KeyD'), my = axis('KeyW', 'KeyS');
  if (pro) {
    list[0] = gamepad(0, 'FullKey', 'Pro Controller (harness)', [mx, my, 0, 0],
      mask({ KeyJ: HID.A, KeyK: HID.B, KeyU: HID.Y, Enter: HID.Plus, ArrowUp: HID.Up, ArrowDown: HID.Down, ArrowLeft: HID.Left, ArrowRight: HID.Right }));
    return list;
  }
  // Joy-Con L sideways (turned counter-clockwise): the player's right is the device's down.
  list[0] = gamepad(0, 'JoyLeft', 'Joy-Con (L) (harness)', [-my, mx, 0, 0],
    mask({ KeyQ: HID.LeftSL, KeyE: HID.LeftSR, KeyF: HID.Down, KeyG: HID.Left, KeyR: HID.Right, Digit1: HID.Minus, KeyC: HID.StickL }));
  // Joy-Con R sideways (turned clockwise): the player's right is the device's up.
  const rx = axis('ArrowLeft', 'ArrowRight'), ry = axis('ArrowUp', 'ArrowDown');
  list[1] = gamepad(1, 'JoyRight', 'Joy-Con (R) (harness)', [0, 0, ry, -rx],
    mask({ KeyO: HID.RightSL, KeyP: HID.RightSR, KeyL: HID.X, KeyK: HID.A, KeyI: HID.Y, Digit0: HID.Plus, KeyM: HID.StickR }));
  return list;
}
Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: pads });

// requestAnimationFrame stays native; __step(n) pumps frames by hand where rAF is throttled.
// Frame times stay monotonic whether frames come from rAF or from __step.
let callback = null, clock = performance.now();
const nativeRaf = window.requestAnimationFrame.bind(window);
window.requestAnimationFrame = fn => {
  callback = fn;
  return nativeRaf(time => { if (callback === fn) { callback = null; clock = Math.max(time, clock + 1); fn(clock); } });
};
window.__step = (frames = 1) => {
  for (let i = 0; i < frames; i++) { const fn = callback; callback = null; clock += 1000 / 60; fn?.(clock); }
};
window.__keys = keys;

await import('../romfs/main.js');
