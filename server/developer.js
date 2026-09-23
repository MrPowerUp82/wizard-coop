// The secret is a discovery reward, not an account permission.
import { AURORA, AURORA_STATS } from './aurora.js';
import { GOD, GOD_STATS } from './god.js';
export const DEVELOPER = 4;
export const DEVELOPER_STATS = Object.freeze({ hp: 5, damage: 4, speed: 1.35, attackDelay: 0.5, armor: 12, projectiles: 2 });
const STANDARD_STATS = Object.freeze({ hp: 1, damage: 1, speed: 1, attackDelay: 1, armor: 0, projectiles: 0 });
const statsOf = color => color === DEVELOPER ? DEVELOPER_STATS : color === AURORA ? AURORA_STATS
  : color === GOD ? GOD_STATS : STANDARD_STATS;

/** Lobby-only change: reversible bonuses preserve permanent upgrades. */
export function selectPlayerCharacter(player, color) {
  const before = statsOf(player.color);
  const after = statsOf(color);
  if (before !== after) {
    player.hp *= after.hp / before.hp;
    player.maxHp *= after.hp / before.hp;
    player.damage *= after.damage / before.damage;
    player.speed *= after.speed / before.speed;
    player.attackDelay *= after.attackDelay / before.attackDelay;
    player.armor += after.armor - before.armor;
    player.projectiles += after.projectiles - before.projectiles;
  }
  player.color = color;
  player.x = color * 55;
}
