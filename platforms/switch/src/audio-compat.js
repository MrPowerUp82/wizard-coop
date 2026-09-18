// @ts-check
// Web Audio compatibility for nx.js.
//
// nx.js 1.0.0-beta.6 implements AudioContext, GainNode (with automation) and AudioBufferSourceNode
// natively, but createOscillator() and createBiquadFilter() throw "Method not implemented". The
// game's synthesized sound effects (src/audio.js) and generative soundtrack (src/music.js) are built
// from exactly those nodes. Instead of rewriting them, this shim hands out "virtual" oscillators,
// filters and buffer sources: once a virtual source has both its start and stop times, its waveform
// and every filter on its path are rendered in JS into an AudioBuffer (cached, since notes repeat)
// and played by a real AudioBufferSourceNode through the real gain nodes. The gameplay-facing API
// (`audio.play('boss')`, `audio.music('fury')`) does not change.

const BLOCK = 32;           // samples between automation / filter coefficient updates
const MAX_CACHE = 512;      // rendered notes kept for reuse
const TAU = Math.PI * 2;

class VirtualParam {
  constructor(value) { this.value = value; this.events = []; }
  setValueAtTime(value, time) { this.events.push({ kind: 'set', value, time }); return this; }
  exponentialRampToValueAtTime(value, time) { this.events.push({ kind: 'exp', value, time }); return this; }
  linearRampToValueAtTime(value, time) { this.events.push({ kind: 'lin', value, time }); return this; }
  cancelScheduledValues() { this.events.length = 0; return this; }
  /** Automation relative to `t0`, for cache keys. */
  key(t0) { return `${this.value}` + this.events.map(e => `|${e.kind}${e.value}@${(e.time - t0).toFixed(4)}`).join(''); }
  /** Value at absolute time `t` (Web Audio set / linear / exponential ramp semantics). */
  at(t, t0) {
    let time = t0, value = this.value;
    for (const e of this.events) {
      if (e.kind === 'set') {
        if (t < e.time) return value;
      } else if (t < e.time) {
        const f = Math.max(0, (t - time) / Math.max(1e-9, e.time - time));
        if (e.kind === 'lin') return value + (e.value - value) * f;
        return value && e.value && value * e.value > 0 ? value * (e.value / value) ** f : value;
      }
      time = e.time; value = e.value;
    }
    return value;
  }
}

const WAVES = {
  sine: phase => Math.sin(phase * TAU),
  square: phase => (phase < 0.5 ? 1 : -1),
  sawtooth: phase => phase * 2 - 1,
  triangle: phase => 1 - 4 * Math.abs(phase - 0.5)
};

class VirtualSource {
  constructor(shim, kind) {
    this.shim = shim; this.kind = kind; this.type = 'sine';
    this.frequency = new VirtualParam(440);
    this.buffer = null; this.next = null; this.startAt = null;
  }
  connect(node) { this.next = node; if (typeof node?.feeds === 'number') node.feeds++; return node; }
  disconnect() { this.next = null; }
  start(when = 0) { this.startAt = when; }
  stop(when = 0) { if (this.startAt !== null) this.shim.play(this, this.startAt, when); }
}

class VirtualFilter {
  constructor() {
    this.type = 'lowpass';
    this.frequency = new VirtualParam(350);
    this.Q = new VirtualParam(1);
    this.inputs = []; this.next = null;
  }
  connect(node) {
    this.next = node;
    for (const input of this.inputs) input.connect(node);
    return node;
  }
  disconnect() { this.next = null; }
}

/** Biquad low/high-pass (Web Audio spec formulas, Q in dB), applied in place. */
function filterInPlace(samples, filter, sampleRate, t0) {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0, b0 = 0, b1 = 0, b2 = 0, a1 = 0, a2 = 0;
  for (let i = 0; i < samples.length; i++) {
    if (i % BLOCK === 0) {
      const t = t0 + i / sampleRate;
      const f0 = Math.min(sampleRate / 2 - 1, Math.max(10, filter.frequency.at(t, t0)));
      const w0 = TAU * f0 / sampleRate, cos = Math.cos(w0);
      const alpha = Math.sin(w0) / (2 * 10 ** (filter.Q.at(t, t0) / 20));
      const a0 = 1 + alpha;
      if (filter.type === 'highpass') { b0 = (1 + cos) / 2 / a0; b1 = -(1 + cos) / a0; }
      else { b0 = (1 - cos) / 2 / a0; b1 = (1 - cos) / a0; }
      b2 = b0; a1 = -2 * cos / a0; a2 = (1 - alpha) / a0;
    }
    const x = samples[i];
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    samples[i] = y;
  }
}

/**
 * Wraps a real nx.js AudioContext so createOscillator/createBiquadFilter work. Real gain nodes are
 * patched so they can connect to a virtual filter.
 */
export function patchAudioContext(context) {
  const sampleRate = context.sampleRate;
  const cache = new Map();
  const bufferIds = new WeakMap();
  let nextBufferId = 1;
  const createGain = context.createGain.bind(context);
  const createBufferSource = context.createBufferSource.bind(context);

  function patchConnect(node) {
    const connect = node.connect.bind(node);
    node.feeds = 0;
    node.connect = (target, ...rest) => {
      node.next = target;
      if (typeof target?.feeds === 'number') target.feeds++;
      if (target instanceof VirtualFilter) {
        target.inputs.push(node);
        if (target.next) node.connect(target.next);
        return target;
      }
      return connect(target, ...rest);
    };
    return node;
  }

  function render(source, filters, t0, length) {
    const samples = new Float32Array(length);
    if (source.kind === 'oscillator') {
      const wave = WAVES[source.type] || WAVES.sine;
      let phase = 0, step = 0;
      for (let i = 0; i < length; i++) {
        if (i % BLOCK === 0) step = source.frequency.at(t0 + i / sampleRate, t0) / sampleRate;
        samples[i] = wave(phase);
        phase = (phase + step) % 1;
      }
    } else if (source.buffer) {
      // Without loop, a buffer source ends with its buffer, as in the browser.
      const data = source.buffer.getChannelData(0);
      samples.set(data.subarray(0, Math.min(length, data.length)));
    }
    for (const filter of filters) filterInPlace(samples, filter, sampleRate, t0);
    return samples;
  }

  function bufferFor(source, filters, t0, length) {
    let bufferId = 0;
    if (source.buffer) {
      if (!bufferIds.has(source.buffer)) bufferIds.set(source.buffer, nextBufferId++);
      bufferId = bufferIds.get(source.buffer);
    }
    const key = `${source.kind}:${source.type}:${bufferId}:${length}:${source.frequency.key(t0)}`
      + filters.map(f => `/${f.type}:${f.frequency.key(t0)}:${f.Q.key(t0)}`).join('');
    let buffer = cache.get(key);
    if (!buffer) {
      buffer = context.createBuffer(1, length, sampleRate);
      buffer.getChannelData(0).set(render(source, filters, t0, length));
      if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value);
      cache.set(key, buffer);
    }
    return buffer;
  }

  const shim = {
    play(source, start, stop) {
      // Walk the path: virtual filters are baked in, the first real node receives the sound.
      const filters = [];
      let node = source.next, target = null;
      for (let hops = 0; node && hops < 16; hops++) {
        if (node instanceof VirtualFilter) filters.push(node);
        else if (!target) target = node;
        node = node.next;
      }
      if (!target) return;
      const length = Math.max(1, Math.ceil(Math.max(0, stop - start) * sampleRate));
      const player = createBufferSource();
      player.buffer = bufferFor(source, filters, start, length);
      player.connect(target);
      // nx.js keeps connected nodes in its native graph (and mixes them) until they are disconnected:
      // without this, every note ever played stays alive and the audio thread gets slower each second.
      // A gain fed only by this note is the note's own envelope; shared gains (master, music bus) stay.
      player.onended = () => {
        player.disconnect();
        if (target.feeds === 1) target.disconnect();
      };
      player.start(Math.max(0, start));
    }
  };

  context.createGain = () => patchConnect(createGain());
  context.createOscillator = () => new VirtualSource(shim, 'oscillator');
  context.createBufferSource = () => new VirtualSource(shim, 'buffer');
  context.createBiquadFilter = () => new VirtualFilter();
  return context;
}

/** Makes `new AudioContext()` (as called by src/audio.js) return a patched native context. */
export function installAudioCompat() {
  const global = /** @type {any} */ (globalThis);
  const NativeAudioContext = global.AudioContext;
  if (!NativeAudioContext || NativeAudioContext.__arcana) return;
  function CompatAudioContext(options) { return patchAudioContext(new NativeAudioContext(options)); }
  CompatAudioContext.__arcana = true;
  global.AudioContext = CompatAudioContext;
}
