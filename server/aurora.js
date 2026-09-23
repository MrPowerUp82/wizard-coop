export const AURORA = 5;
export const AURORA_STATS = Object.freeze({ hp: 1.5, damage: 1.35, speed: 1.1, attackDelay: 0.85, armor: 3, projectiles: 0 });

export function earnsAurora(result) {
  return result?.over === true && result.victory === true && result.campaign === 'classic' && result.phase === 5;
}
