// Generative soundtrack synthesized on the fly: a pad, an arpeggio, bass and light percussion whose
// layers and tempo follow the match (menu, horde, guardian, fury, victory). No audio files are loaded.
const LOOKAHEAD = 0.25;
const TICK_MS = 60;
// Root note (MIDI) of each realm and the minor progression i–VI–III–VII played over it.
const ROOTS = [57, 50, 52, 53, 55, 48];
const PROGRESSION = [[0, 3, 7], [-4, 0, 3], [3, 7, 10], [-2, 2, 5]];
const VICTORY = [[0, 4, 7], [5, 9, 12], [7, 11, 14], [0, 4, 7]];

export const MOODS = Object.freeze({
  silent: { layers: 0 },
  menu: { bpm: 70, layers: 1, pad: 0.05 },
  horde: { bpm: 96, layers: 3, pad: 0.035, arp: 0.022, kick: 0.05, bass: 0.03 },
  boss: { bpm: 128, layers: 4, pad: 0.03, arp: 0.024, kick: 0.08, bass: 0.05, hat: 0.018 },
  fury: { bpm: 148, layers: 5, pad: 0.03, arp: 0.026, kick: 0.09, bass: 0.06, hat: 0.024, lead: 0.02 },
  victory: { bpm: 84, layers: 2, pad: 0.05, arp: 0.02, major: true },
  defeat: { bpm: 60, layers: 1, pad: 0.035 }
});

/** Chooses the mood for what is on screen right now. */
export function moodFor(view, mode) {
  if (mode === 'menu' || !view) return 'menu';
  if (view.over) return view.victory ? 'victory' : 'defeat';
  const boss = view.enemies?.find(e => e.boss);
  if (boss) return boss.stage === 3 ? 'fury' : 'boss';
  return 'horde';
}

const frequency = midi => 440 * 2 ** ((midi - 69) / 12);

export function createMusic({ context, destination, noiseBuffer }) {
  const bus = context.createGain();
  bus.gain.value = 0.9;
  bus.connect(destination);
  let mood = 'silent', phase = 0, step = 0, nextTime = 0, timer = null;

  function voice(type, midi, start, duration, gain, { attack = 0.01, filter = 0 } = {}) {
    const osc = context.createOscillator();
    const amp = context.createGain();
    osc.type = type;
    osc.frequency.value = frequency(midi);
    amp.gain.setValueAtTime(0.0001, start);
    amp.gain.exponentialRampToValueAtTime(gain, start + attack);
    amp.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    let node = osc.connect(amp);
    if (filter) {
      const lowpass = context.createBiquadFilter();
      lowpass.type = 'lowpass'; lowpass.frequency.value = filter;
      node = node.connect(lowpass);
    }
    node.connect(bus);
    osc.start(start); osc.stop(start + duration + 0.05);
  }

  function kick(start, gain) {
    const osc = context.createOscillator();
    const amp = context.createGain();
    osc.frequency.setValueAtTime(120, start);
    osc.frequency.exponentialRampToValueAtTime(42, start + 0.16);
    amp.gain.setValueAtTime(gain, start);
    amp.gain.exponentialRampToValueAtTime(0.0001, start + 0.2);
    osc.connect(amp).connect(bus);
    osc.start(start); osc.stop(start + 0.22);
  }

  function hat(start, gain) {
    const source = context.createBufferSource();
    const highpass = context.createBiquadFilter();
    const amp = context.createGain();
    source.buffer = noiseBuffer;
    highpass.type = 'highpass'; highpass.frequency.value = 7000;
    amp.gain.setValueAtTime(gain, start);
    amp.gain.exponentialRampToValueAtTime(0.0001, start + 0.05);
    source.connect(highpass).connect(amp).connect(bus);
    source.start(start); source.stop(start + 0.06);
  }

  function schedule(time) {
    const cfg = MOODS[mood];
    const sixteenth = 60 / cfg.bpm / 4;
    const bar = Math.floor(step / 16);
    const chords = cfg.major ? VICTORY : PROGRESSION;
    const chord = chords[bar % chords.length].map(n => n + ROOTS[phase % ROOTS.length]);
    const beat = step % 16;
    if (cfg.pad && beat === 0) {
      for (const note of chord) voice('triangle', note, time, sixteenth * 16 * 0.98, cfg.pad, { attack: 0.6, filter: 1400 });
    }
    if (cfg.arp && step % 2 === 0) {
      const pattern = [0, 1, 2, 1, 0, 2, 1, 2];
      const note = chord[pattern[(step / 2) % pattern.length]] + 12 + (mood === 'fury' && beat >= 8 ? 12 : 0);
      voice('triangle', note, time, sixteenth * 1.8, cfg.arp, { filter: 3200 });
    }
    if (cfg.bass && step % 4 !== 3) voice('sawtooth', chord[0] - 24, time, sixteenth * 1.6, cfg.bass, { filter: 420 });
    if (cfg.kick && beat % 4 === 0) kick(time, cfg.kick);
    if (cfg.hat && step % 2 === 1) hat(time, cfg.hat);
    if (cfg.lead && beat % 8 === 6) voice('square', chord[2] + 24, time, sixteenth * 3, cfg.lead, { filter: 2400 });
    return sixteenth;
  }

  function pump() {
    if (mood === 'silent') return;
    while (nextTime < context.currentTime + LOOKAHEAD) {
      nextTime += schedule(Math.max(nextTime, context.currentTime));
      step++;
    }
  }

  return {
    get mood() { return mood; },
    set(nextMood, nextPhase = 0) {
      if (!MOODS[nextMood]) return;
      if (nextMood === mood && nextPhase === phase) return;
      // Changing mood restarts on a bar line so layers enter in time.
      if (nextMood !== mood) { step = 0; nextTime = context.currentTime + 0.05; }
      mood = nextMood; phase = nextPhase;
      if (!timer && mood !== 'silent') timer = setInterval(pump, TICK_MS);
      if (timer && mood === 'silent') { clearInterval(timer); timer = null; }
    }
  };
}
