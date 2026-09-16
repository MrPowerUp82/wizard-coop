export const PHASE_DURATION = 300;
export const TRANSITION_DURATION = 4;
// `enemies` are the two core types; `specials` join the spawn table once their `after` second is reached.
export const PHASES = Object.freeze([
  { name: 'Bosque Desperto', floor: 'forest', color: '#83dfaa', enemies: ['mushroom', 'beetle'], boss: 'treant', bossName: 'Raiz Ancestral',
    specials: [{ type: 'slime', after: 60, weight: 0.18 }] },
  { name: 'Cripta Glacial', floor: 'ice', color: '#8cdfff', enemies: ['skeleton', 'wraith'], boss: 'lich', bossName: 'Rei do Inverno',
    specials: [{ type: 'eye', after: 45, weight: 0.16 }] },
  { name: 'Abismo de Brasas', floor: 'lava', color: '#ffac70', enemies: ['imp', 'scorpion'], boss: 'demon', bossName: 'Coração da Caldeira',
    specials: [{ type: 'bat', after: 45, weight: 0.16 }, { type: 'brute', after: 150, weight: 0.08 }] },
  { name: 'Pântano Espectral', floor: 'swamp', color: '#b8df7c', enemies: ['spore', 'revenant'], boss: 'bogwarden', bossName: 'Matriarca do Brejo',
    specials: [{ type: 'slime', after: 45, weight: 0.18 }, { type: 'scorpion', after: 150, weight: 0.08 }] },
  { name: 'Cidadela Astral', floor: 'astral', color: '#ffe09b', enemies: ['sentinel', 'seer'], boss: 'archon', bossName: 'Arconte Solar',
    specials: [{ type: 'revenant', after: 60, weight: 0.16 }, { type: 'brute', after: 150, weight: 0.08 }] },
  { name: 'Eclipse do Vazio', floor: 'void', color: '#d3a4ff', enemies: ['voidling', 'voidscarab'], boss: 'umbra', bossName: 'Soberano do Eclipse',
    specials: [{ type: 'seer', after: 45, weight: 0.18 }, { type: 'revenant', after: 150, weight: 0.1 }] }
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
  demon: { hp: 3400, speed: 76, damage: 28, size: 185, radius: 64 },
  spore: { name: 'Esporo espectral', hp: 35, speed: 66, damage: 12, behavior: 'shooter', shotSprite: 'thorn', xp: 3 },
  revenant: { name: 'Alma do brejo', hp: 28, speed: 108, damage: 11, behavior: 'flier', xp: 2 },
  sentinel: { name: 'Sentinela solar', hp: 48, speed: 84, damage: 14, behavior: 'charger', xp: 3 },
  seer: { name: 'Oráculo astral', hp: 40, speed: 72, damage: 14, behavior: 'shooter', shotSprite: 'bolt', xp: 3 },
  voidling: { name: 'Asa do vazio', hp: 28, speed: 124, damage: 10, behavior: 'bomber', xp: 2 },
  voidscarab: { name: 'Escaravelho do eclipse', hp: 48, speed: 96, damage: 14, behavior: 'charger', xp: 3 },
  bogwarden: { hp: 4600, speed: 58, damage: 30, size: 180, radius: 60 },
  archon: { hp: 6000, speed: 66, damage: 32, size: 175, radius: 56 },
  umbra: { hp: 7800, speed: 72, damage: 34, size: 195, radius: 66 }
});

export const BEHAVIORS = Object.freeze({
  charger: { range: 320, every: 3.4, windup: 0.5, dash: 0.45, speed: 3.2 },
  shooter: { keepAway: 260, every: 3.5, shotSpeed: 170, sprite: 'bolt' },
  bomber: { fuseRange: 60, fuse: 0.6, radius: 70, damage: 2.2 },
  splitter: { children: 2, type: 'slimelet' }
});

export function enemyXp(type) {
  const enemy = ENEMIES[type];
  return enemy?.xp ?? Math.max(1, Math.round((enemy?.hp ?? 14) / 14));
}
