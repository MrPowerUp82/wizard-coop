// Synthesized sound effects: no audio files to download, and every sound is throttled so hordes
// never turn into noise.
const STORAGE_KEY = 'arcana-muted';
const THROTTLE = { shoot: 0.09, hit: 0.045, kill: 0.05, gem: 0.03, coin: 0.06, hurt: 0.15, boom: 0.08, chain: 0.1, warning: 0.3 };

function readMuted() {
  try { return localStorage.getItem(STORAGE_KEY) === '1'; } catch { return false; }
}

export function createAudio() {
  let context = null;
  let master = null;
  let noiseBuffer = null;
  let muted = readMuted();
  const lastPlayed = {};
  let combo = 0, comboAt = 0;

  function ensure() {
    if (!context) {
      const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AudioContext) return null;
      context = new AudioContext();
      master = context.createGain();
      master.gain.value = muted ? 0 : 0.32;
      master.connect(context.destination);
      noiseBuffer = context.createBuffer(1, context.sampleRate * 0.5, context.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    if (context.state === 'suspended') context.resume().catch(() => {});
    return context;
  }

  function tone({ type = 'sine', from, to = from, duration, gain = 0.2, delay = 0 }) {
    const t = context.currentTime + delay;
    const osc = context.createOscillator();
    const amp = context.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + duration);
    amp.gain.setValueAtTime(gain, t);
    amp.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(amp).connect(master);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  function noise({ duration, gain = 0.2, from = 1800, to = 400, delay = 0 }) {
    const t = context.currentTime + delay;
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const amp = context.createGain();
    source.buffer = noiseBuffer;
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(from, t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, to), t + duration);
    amp.gain.setValueAtTime(gain, t);
    amp.gain.exponentialRampToValueAtTime(0.001, t + duration);
    source.connect(filter).connect(amp).connect(master);
    source.start(t);
    source.stop(t + duration + 0.02);
  }

  const arpeggio = (notes, step = 0.07, type = 'triangle', gain = 0.12) =>
    notes.forEach((note, n) => tone({ type, from: note, duration: step * 1.8, gain, delay: n * step }));

  const SOUNDS = {
    shoot: () => tone({ type: 'triangle', from: 900, to: 520, duration: 0.05, gain: 0.035 }),
    hit: () => noise({ duration: 0.05, gain: 0.05, from: 2600, to: 900 }),
    kill: () => tone({ type: 'square', from: 320, to: 110, duration: 0.07, gain: 0.03 }),
    gem: pitch => tone({ type: 'sine', from: 760 * pitch, to: 1180 * pitch, duration: 0.06, gain: 0.05 }),
    coin: () => arpeggio([1320, 1760], 0.045, 'square', 0.03),
    heart: () => arpeggio([520, 780], 0.08, 'sine', 0.1),
    crystal: () => arpeggio([660, 990, 1320], 0.05, 'sine', 0.06),
    level: () => arpeggio([523, 659, 784, 1046], 0.08, 'triangle', 0.1),
    power: () => arpeggio([784, 1175], 0.07, 'sine', 0.09),
    hurt: () => { noise({ duration: 0.12, gain: 0.16, from: 900, to: 150 }); tone({ type: 'sawtooth', from: 180, to: 90, duration: 0.12, gain: 0.06 }); },
    warning: () => tone({ type: 'square', from: 440, to: 430, duration: 0.09, gain: 0.04 }),
    boom: () => { noise({ duration: 0.35, gain: 0.22, from: 1200, to: 60 }); tone({ type: 'sine', from: 120, to: 40, duration: 0.3, gain: 0.18 }); },
    chain: () => noise({ duration: 0.12, gain: 0.07, from: 6000, to: 2500 }),
    special: () => { tone({ type: 'sawtooth', from: 200, to: 1400, duration: 0.35, gain: 0.08 }); noise({ duration: 0.3, gain: 0.08, from: 4000, to: 500 }); },
    boss: () => { tone({ type: 'sawtooth', from: 70, to: 45, duration: 1.2, gain: 0.2 }); noise({ duration: 1, gain: 0.12, from: 500, to: 80 }); },
    stage: () => { tone({ type: 'square', from: 110, to: 55, duration: 0.6, gain: 0.14 }); noise({ duration: 0.5, gain: 0.16, from: 1500, to: 100 }); },
    bossDown: () => { noise({ duration: 1.2, gain: 0.25, from: 2000, to: 50 }); arpeggio([392, 523, 659, 784, 1046], 0.11, 'triangle', 0.12); },
    elite: () => arpeggio([220, 294, 220], 0.12, 'sawtooth', 0.07),
    chest: () => arpeggio([659, 880, 1109, 1319], 0.06, 'triangle', 0.1),
    magnet: () => tone({ type: 'sine', from: 300, to: 1500, duration: 0.4, gain: 0.08 }),
    revive: () => arpeggio([392, 494, 587, 784], 0.1, 'sine', 0.12),
    phoenix: () => { arpeggio([523, 784, 1046, 1568], 0.09, 'triangle', 0.14); noise({ duration: 0.6, gain: 0.08, from: 5000, to: 800 }); },
    victory: () => arpeggio([523, 659, 784, 1046, 784, 1046, 1319], 0.13, 'triangle', 0.13),
    defeat: () => arpeggio([392, 330, 262, 196], 0.18, 'sine', 0.12),
    click: () => tone({ type: 'sine', from: 900, to: 700, duration: 0.04, gain: 0.05 })
  };

  return {
    play(name, arg) {
      if (muted || !SOUNDS[name]) return;
      const now = performance.now() / 1000;
      if (THROTTLE[name] && now - (lastPlayed[name] || 0) < THROTTLE[name]) return;
      lastPlayed[name] = now;
      if (!ensure()) return;
      if (name === 'gem') {
        combo = now - comboAt < 0.6 ? Math.min(combo + 1, 16) : 0;
        comboAt = now;
        arg = 1 + combo * 0.05;
      }
      SOUNDS[name](arg);
    },
    unlock() { if (!muted) ensure(); },
    get muted() { return muted; },
    toggleMute() {
      muted = !muted;
      try { localStorage.setItem(STORAGE_KEY, muted ? '1' : '0'); } catch { /* preference only */ }
      if (master) master.gain.value = muted ? 0 : 0.32;
      return muted;
    }
  };
}
