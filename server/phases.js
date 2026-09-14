export const PHASE_DURATION = 300;
export const TRANSITION_DURATION = 4;
// `enemies` are the two core types; `specials` join the spawn table once their `after` second is reached.
export const PHASES = Object.freeze([
  { name: 'Bosque Desperto', floor: 'forest', color: '#83dfaa', enemies: ['mushroom', 'beetle'], boss: 'treant', bossName: 'Raiz Ancestral',
    specials: [{ type: 'slime', after: 60, weight: 0.18 }] },
  { name: 'Cripta Glacial', floor: 'ice', color: '#8cdfff', enemies: ['skeleton', 'wraith'], boss: 'lich', bossName: 'Rei do Inverno',
    specials: [{ type: 'eye', after: 45, weight: 0.16 }] },
  { name: 'Abismo de Brasas', floor: 'lava', color: '#ffac70', enemies: ['imp', 'scorpion'], boss: 'demon', bossName: 'Coração da Caldeira',
    specials: [{ type: 'bat', after: 45, weight: 0.16 }, { type: 'brute', after: 150, weight: 0.08 }] }
]);

// behavior: walker (default) | charger | splitter | shooter | bomber | flier
export const ENEMIES = Object.freeze({
  slime: { name: 'Lodo', hp: 34, speed: 58, damage: 9, behavior: 'splitter', xp: 2 },
  slimelet: { name: 'Lodinho', hp: 10, speed: 84, damage: 5, xp: 1, sprite: 'slime', size: 40 },
  bat: { name: 'Morcego de brasa', hp: 18, speed: 128, damage: 6, behavior: 'bomber', xp: 2 },
  eye: { name: 'Olho gélido', hp: 30, speed: 70, damage: 12, behavior: 'shooter', xp: 3 },
  brute: { name: 'Golem de magma', hp: 140, speed: 47, damage: 22, xp: 8, size: 92 },
  mushroom: { name: 'Cogumelo', hp: 22, speed: 62, damage: 9 },
  beetle: { name: 'Besouro de espinhos', hp: 18, speed: 94, damage: 7, behavior: 'charger' },
  skeleton: { name: 'Esqueleto', hp: 30, speed: 70, damage: 11 },
  wraith: { name: 'Espectro', hp: 20, speed: 104, damage: 9, behavior: 'flier' },
  imp: { name: 'Diabrete', hp: 26, speed: 108, damage: 10 },
  scorpion: { name: 'Escorpião', hp: 55, speed: 63, damage: 16, behavior: 'charger' },
  treant: { hp: 1200, speed: 52, damage: 22, size: 170, radius: 58 },
  lich: { hp: 2200, speed: 64, damage: 24, size: 160, radius: 52 },
  demon: { hp: 3400, speed: 76, damage: 28, size: 185, radius: 64 }
});

export const BEHAVIORS = Object.freeze({
  charger: { range: 320, every: 3.4, windup: 0.5, dash: 0.45, speed: 3.2 },
  shooter: { keepAway: 260, every: 2.8, shotSpeed: 190, sprite: 'bolt' },
  bomber: { fuseRange: 60, fuse: 0.6, radius: 70, damage: 2.2 },
  splitter: { children: 2, type: 'slimelet' }
});

export function enemyXp(type) {
  const enemy = ENEMIES[type];
  return enemy?.xp ?? Math.max(1, Math.round((enemy?.hp ?? 14) / 14));
}
