// @ts-check
// Web Audio compatibility layer for PlayStation Vita.
//
// The game's synthesized sound effects (src/audio.js) and generative music track (src/music.js)
// use OscillatorNode, BiquadFilterNode and GainNode.
// This module provides a software synthesis pipeline in JS: waveforms and filters are rendered
// into PCM buffers (cached for repeated notes) and played through SceAudioOut / Web Audio buffer sources.
// Every finished note is disconnected immediately to prevent unbounded audio graph growth.

const BLOCK = 32;           // samples between automation / filter updates
const MAX_CACHE = 512;      // max cached notes
const TAU = Math.PI * 2;
const SAMPLE_RATE = 48000;

class VirtualParam {
  constructor(value) { this.value = value; this.events = []; }
  setValueAtTime(value, time) { this.events.push({ kind: 'set', value, time }); return this; }
  exponentialRampToValueAtTime(value, time) { this.events.push({ kind: 'exp', value, time }); return this; }
  linearRampToValueAtTime(value, time) { this.events.push({ kind: 'lin', value, time }); return this; }
  cancelScheduledValues() { this.events.length = 0; return this; }
  key(t0) { return `${this.value}` + this.events.map(e => `|${e.kind}${e.value}@${(e.time - t0).toFixed(4)}`).join(''); }
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

/** Biquad low/high-pass filter, applied in place. */
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

export function patchAudioContext(context) {
  const sampleRate = context.sampleRate || SAMPLE_RATE;
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

export function installAudioCompat() {
  const global = /** @type {any} */ (globalThis);
  const NativeAudioContext = global.AudioContext;
  if (!NativeAudioContext || NativeAudioContext.__arcanaVita) return;
  function CompatAudioContext(options) {
    return patchAudioContext(new NativeAudioContext(options));
  }
  CompatAudioContext.__arcanaVita = true;
  global.AudioContext = CompatAudioContext;
}
