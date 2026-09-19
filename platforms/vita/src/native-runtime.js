import { NativeCanvas } from './native-canvas.js';

// Runs before shared modules create Images, read storage or request a frame.
const host = globalThis;
const native = host.ArcanaNative;
if (native) {
  const context = new NativeCanvas(native);
  host.screen = { width: 960, height: 544, getContext: () => context };
  host.performance = { now: () => native.now() };
  const textures = new Map();
  host.Image = class {
    set src(path) {
      if (!textures.has(path)) textures.set(path, native.loadTexture(path));
      const [id, width, height] = textures.get(path);
      Object.assign(this, { id, width, height, naturalWidth: width, naturalHeight: height, complete: true });
    }
  };
  let data = Object.create(null), dirty = false, flushAt = 0;
  try { data = Object.assign(Object.create(null), JSON.parse(native.readSave() || '{}')); } catch { /* new/corrupt save */ }
  function flush() { if (dirty) { native.writeSave(JSON.stringify(data)); dirty = false; } }
  host.localStorage = {
    getItem: key => Object.hasOwn(data, key) ? data[key] : null,
    setItem(key, value) { data[key] = String(value); dirty = true; },
    removeItem(key) { delete data[key]; dirty = true; }
  };
  host.Pads = { read: port => native.pad(port) };
  host.Vita = { exit() { flush(); native.exit(); }, readFile: path => native.readFile(path), capture: index => native.capture(index) };
  host.addEventListener = () => {};
  host.console = { log: (...args) => native.log(args.join(' ')), error: (...args) => native.log(args.join(' ')) };
  let next = 1;
  let frames = new Map(), dispatchFrames = new Map();
  const timers = new Map();
  host.requestAnimationFrame = callback => { const id = next++; frames.set(id, callback); return id; };
  host.cancelAnimationFrame = id => { frames.delete(id); dispatchFrames.delete(id); };
  host.setTimeout = (callback, delay = 0) => { const id = next++; timers.set(id, { callback, at: native.now() + delay }); return id; };
  host.clearTimeout = id => timers.delete(id);
  host.__arcanaFrame = now => {
    context.beginFrame();
    for (const [id, timer] of timers) if (now >= timer.at) { timers.delete(id); timer.callback(); }
    // Ping-pong the RAF queues. The old implementation cloned all callbacks into a new Array
    // every frame, which is unnecessary pressure on QuickJS' GC.
    const pending = frames;
    frames = dispatchFrames;
    dispatchFrames = pending;
    frames.clear();
    for (const callback of dispatchFrames.values()) callback(now);
    dispatchFrames.clear();
    if (now >= flushAt) { flush(); flushAt = now + 2000; }
  };
  host.__arcanaShutdown = flush;
}
