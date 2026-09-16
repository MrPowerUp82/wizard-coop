// Optional run modifiers: each one makes the ritual harder and pays extra coins.
export const CURSES = Object.freeze({
  swarm: { title: 'Enxame', icon: '☍', description: 'Ondas 35% maiores e mais inimigos na tela', reward: 0.25 },
  frenzy: { title: 'Frenesi', icon: '⚚', description: 'Inimigos 15% mais rápidos', reward: 0.2 },
  brittle: { title: 'Fragilidade', icon: '✧', description: 'Você recebe 25% mais dano', reward: 0.25 },
  famine: { title: 'Fome', icon: '☠', description: 'Corações e curas restauram metade', reward: 0.15 },
  tyrant: { title: 'Tirania', icon: '♛', description: 'Guardiões com 40% mais vida', reward: 0.25 },
  nobility: { title: 'Nobreza sombria', icon: '⚜', description: 'Cada chamado de elite traz duas elites', reward: 0.2 }
});

export const CURSE_EFFECTS = Object.freeze({
  swarm: { spawnCount: 1.35, adaptiveLimit: 1.2 },
  frenzy: { speed: 1.15 },
  brittle: { damageTaken: 1.25 },
  famine: { healing: 0.5 },
  tyrant: { bossHp: 1.4 },
  nobility: { elites: 2 }
});

export function sanitizeCurses(raw) {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter(id => typeof id === 'string' && Object.hasOwn(CURSES, id)))];
}

export const hasCurse = (s, id) => Boolean(s?.curses?.includes(id));
export const curseReward = s => 1 + (s?.curses || []).reduce((sum, id) => sum + (CURSES[id]?.reward || 0), 0);
export const healingScale = s => hasCurse(s, 'famine') ? CURSE_EFFECTS.famine.healing : 1;

/** Deterministic pseudo-random generator (mulberry32) so a seed replays the same ritual. */
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The daily ritual: everyone gets the same seed, two curses and a character for the calendar day. */
export function dailyChallenge(date = new Date()) {
  const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
  let seed = 2166136261;
  for (const char of key) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619) >>> 0;
  const random = seededRandom(seed);
  const pool = Object.keys(CURSES);
  const curses = [];
  while (curses.length < 2) {
    const id = pool.splice(Math.floor(random() * pool.length), 1)[0];
    curses.push(id);
  }
  return { key, seed, curses, character: Math.floor(random() * 4) };
}
