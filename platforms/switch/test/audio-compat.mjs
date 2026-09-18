// Checks the Web Audio shim's rendering: oscillator pitch and sweeps, low-pass filtering, gain
// passthrough to the real node, and note caching.
import assert from 'node:assert/strict';
import { patchAudioContext } from '../src/audio-compat.js';

const played = [];
class Node { constructor() { this.connections = []; this.disconnected = false; } connect(node) { this.connections.push(node); return node; } disconnect() { this.disconnected = true; } }
const context = patchAudioContext({
  sampleRate: 48000, currentTime: 0, destination: new Node(),
  createGain() { const node = new Node(); node.gain = { value: 1, setValueAtTime() { return this; }, exponentialRampToValueAtTime() { return this; } }; return node; },
  createBuffer(channels, length) { const data = new Float32Array(length); return { length, getChannelData: () => data }; },
  createBufferSource() { const node = new Node(); node.start = when => played.push({ node, when }); return node; }
});

const crossings = data => { let count = 0; for (let i = 1; i < data.length; i++) if ((data[i - 1] < 0) !== (data[i] < 0)) count++; return count; };
const energy = data => data.reduce((sum, v) => sum + v * v, 0) / data.length;

// 440 Hz sine for 0.1 s ≈ 88 zero crossings, routed into the gain node it was connected to.
const master = context.createGain();
master.connect(context.destination);
const amp = context.createGain();
const osc = context.createOscillator();
osc.type = 'sine';
osc.frequency.setValueAtTime(440, 1);
osc.connect(amp).connect(master);
osc.start(1); osc.stop(1.1);
let { node } = played.at(-1);
assert.equal(played.at(-1).when, 1);
assert.equal(node.connections[0], amp, 'buffer plays into the note gain');
assert.ok(Math.abs(crossings(node.buffer.getChannelData(0)) - 88) <= 2, 'oscillator pitch');

// Exponential sweep 200 → 800 Hz has more crossings in the second half.
const sweep = context.createOscillator();
sweep.frequency.setValueAtTime(200, 0);
sweep.frequency.exponentialRampToValueAtTime(800, 0.2);
sweep.connect(amp);
sweep.start(0); sweep.stop(0.2);
const data = played.at(-1).node.buffer.getChannelData(0);
assert.ok(crossings(data.subarray(data.length / 2)) > crossings(data.subarray(0, data.length / 2)) * 1.5, 'frequency ramp');

// Noise through a 300 Hz low-pass keeps far less energy than unfiltered noise.
const noise = context.createBuffer(1, 24000, 48000);
const samples = noise.getChannelData(0);
for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
const raw = context.createBufferSource();
raw.buffer = noise; raw.connect(amp); raw.start(0); raw.stop(0.4);
const rawEnergy = energy(played.at(-1).node.buffer.getChannelData(0));
const filtered = context.createBufferSource();
const lowpass = context.createBiquadFilter();
lowpass.type = 'lowpass'; lowpass.frequency.value = 300;
filtered.buffer = noise; filtered.connect(lowpass).connect(amp); filtered.start(0); filtered.stop(0.4);
({ node } = played.at(-1));
assert.equal(node.connections[0], amp, 'filters are baked; the real gain still receives the sound');
assert.ok(energy(node.buffer.getChannelData(0)) < rawEnergy * 0.1, 'low-pass attenuates');

// Filter placed after a gain (music voices: osc → amp → lowpass → bus).
const bus = context.createGain();
const voiceAmp = context.createGain();
const voice = context.createOscillator();
const voiceFilter = context.createBiquadFilter();
voice.frequency.value = 220;
let chain = voice.connect(voiceAmp);
chain = chain.connect(voiceFilter);
chain.connect(bus);
voice.start(2); voice.stop(2.5);
({ node } = played.at(-1));
assert.equal(node.connections[0], voiceAmp);
assert.ok(voiceAmp.connections.includes(bus), 'gain reconnected past the virtual filter');

// The same note relative to its start time is rendered once.
const again = context.createOscillator();
again.frequency.value = 220;
again.connect(voiceAmp);
const first = context.createOscillator();
first.frequency.value = 220;
first.connect(voiceAmp);
first.start(5); first.stop(5.5);
again.start(9); again.stop(9.5);
assert.equal(played.at(-1).node.buffer, played.at(-2).node.buffer, 'cached note buffer');

// Finished notes leave the native graph: the source and its own gain disconnect, shared gains stay.
const noteGain = context.createGain();
noteGain.connect(master);
const note = context.createOscillator();
note.connect(noteGain);
note.start(20); note.stop(20.1);
const finished = played.at(-1).node;
finished.onended();
assert.ok(finished.disconnected, 'finished source disconnected');
assert.ok(noteGain.disconnected, 'note gain disconnected');
assert.ok(!master.disconnected, 'master gain kept');
voiceAmp.connections.length && played.find(p => p.node.connections[0] === voiceAmp)?.node.onended();
assert.ok(!bus.disconnected, 'music bus kept');

console.log('audio-compat ok');
