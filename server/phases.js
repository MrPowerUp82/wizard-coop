export const PHASE_DURATION = 300;
export const TRANSITION_DURATION = 4;
export const PHASES = Object.freeze([
  { name: 'Bosque Desperto', floor: 'forest', color: '#83dfaa', enemies: ['mushroom', 'beetle'], boss: 'treant', bossName: 'Raiz Ancestral' },
  { name: 'Cripta Glacial', floor: 'ice', color: '#8cdfff', enemies: ['skeleton', 'wraith'], boss: 'lich', bossName: 'Rei do Inverno' },
  { name: 'Abismo de Brasas', floor: 'lava', color: '#ffac70', enemies: ['imp', 'scorpion'], boss: 'demon', bossName: 'Coração da Caldeira' }
]);

export const ENEMIES = Object.freeze({
  slime: { hp: 20, speed: 66, damage: 9 }, bat: { hp: 15, speed: 98, damage: 7 },
  eye: { hp: 30, speed: 60, damage: 12 }, brute: { hp: 75, speed: 47, damage: 20 },
  mushroom: { hp: 22, speed: 62, damage: 9 }, beetle: { hp: 16, speed: 94, damage: 7 },
  skeleton: { hp: 30, speed: 70, damage: 11 }, wraith: { hp: 20, speed: 104, damage: 9 },
  imp: { hp: 26, speed: 110, damage: 10 }, scorpion: { hp: 55, speed: 63, damage: 16 },
  treant: { hp: 1200, speed: 52, damage: 22, size: 170, radius: 58 },
  lich: { hp: 2200, speed: 64, damage: 24, size: 160, radius: 52 },
  demon: { hp: 3400, speed: 76, damage: 28, size: 185, radius: 64 }
});
