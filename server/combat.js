import { BEHAVIORS, ENEMIES, enemyXp } from './phases.js';
import { CONTACT, DROP_TTL, DROPS, ELITE, LIMITS, SPECIAL, WEAPONS } from './balance.js';
import { rankOf } from './powers.js';

export const distanceSq = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
export const nearest = (origin, entities) => entities.reduce((a, b) => distanceSq(origin, b) < distanceSq(origin, a) ? b : a);
export const nextId = s => (s.nextId = (s.nextId || 0) + 1);

const MAX_EVENTS = 64;
/** Transient happenings (explosions, chain zaps, boss stages) that clients turn into effects and sounds. */
export function pushEvent(s, kind, data = {}) {
  s.events ??= [];
  s.eventSeq = (s.eventSeq || 0) + 1;
  s.events.push({ id: s.eventSeq, kind, t: s.time, ...data });
  if (s.events.length > MAX_EVENTS) s.events.splice(0, s.events.length - MAX_EVENTS);
}

export function addDrop(s, x, y, type, value) {
  if (type === 'gem') {
    // Crowded floors fold new XP into a nearby crystal instead of losing it at the drop cap.
    const full = s.gems.length >= LIMITS.drops;
    if (full || s.gems.length >= DROPS.mergeAt) {
      let target = null, best = full ? Infinity : DROPS.mergeRadius ** 2;
      for (const gem of s.gems) {
        if ((gem.type || 'gem') !== 'gem' || gem.dead) continue;
        const d2 = (gem.x - x) ** 2 + (gem.y - y) ** 2;
        if (d2 < best) { best = d2; target = gem; }
      }
      if (target) { target.value += value; target.ttl = Math.max(target.ttl, DROP_TTL / 2); return; }
    }
  }
  if (s.gems.length < LIMITS.drops) s.gems.push({ id: nextId(s), x, y, type, value, ttl: DROP_TTL });
}

function dropLoot(s, enemy, random) {
  addDrop(s, enemy.x, enemy.y, 'gem', enemyXp(enemy.type) * (enemy.elite ? ELITE.xp : 1));
  if (enemy.elite) {
    addDrop(s, enemy.x + 18, enemy.y, 'chest', 1);
    addDrop(s, enemy.x - 18, enemy.y, 'magnet', 1);
    return;
  }
  if (enemy.minion) return;
  const roll = random();
  if (roll < DROPS.heart) addDrop(s, enemy.x, enemy.y, 'heart', 25);
  else if (roll < DROPS.heart + DROPS.greenGem) addDrop(s, enemy.x, enemy.y, 'greenGem', SPECIAL.crystal);
  else if (roll < DROPS.heart + DROPS.greenGem + DROPS.coin) addDrop(s, enemy.x, enemy.y, 'coin', 1);
}

export function spawnEnemy(s, type, x, y, hpScale = 1, extra = {}) {
  if (s.enemies.length >= LIMITS.enemies) return null;
  const hp = ENEMIES[type].hp * hpScale * (extra.elite ? ELITE.hp : 1);
  const enemy = { id: nextId(s), type, x, y, hp, maxHp: hp, age: 0, ...extra };
  s.enemies.push(enemy);
  return enemy;
}

function onKill(s, enemy, source, random, shard) {
  dropLoot(s, enemy, random);
  if (source) source.stats.kills++;
  const behavior = ENEMIES[enemy.type]?.behavior;
  if (behavior === 'splitter') {
    const { children, type } = BEHAVIORS.splitter;
    for (let n = 0; n < children; n++) {
      const angle = random() * Math.PI * 2;
      spawnEnemy(s, type, enemy.x + Math.cos(angle) * 18, enemy.y + Math.sin(angle) * 18, enemy.maxHp / ENEMIES[enemy.type].hp / (enemy.elite ? ELITE.hp : 1), { minion: true });
    }
  }
  if (source && !shard && enemy.slowFor > 0 && rankOf(source, 'shatter')) {
    const { shards, damage, ttl } = WEAPONS.shatter;
    const offset = random() * Math.PI;
    for (let n = 0; n < shards && s.shots.length < LIMITS.shots; n++) {
      const angle = offset + n * Math.PI * 2 / shards;
      s.shots.push({ x: enemy.x, y: enemy.y, vx: Math.cos(angle) * 420, vy: Math.sin(angle) * 420, ttl, color: 0,
        damage: source.damage * damage, pierce: 1, hitIds: [enemy.id], owner: source.id, shard: true });
    }
  }
  if (enemy.elite) pushEvent(s, 'eliteDown', { x: Math.round(enemy.x), y: Math.round(enemy.y) });
}

export function damageEnemy(s, enemy, damage, random, { slow = false, source = null, shard = false, element = '' } = {}) {
  if (enemy.hp <= 0) return false;
  // A target can react once per second. Reaction damage cannot recursively trigger reactions.
  const reaction = element === 'fire' && enemy.slowFor > 0 ? 'thermal'
    : element === 'lightning' && enemy.rootFor > 0 ? 'conduction'
      : element === 'moon' && enemy.burningFor > 0 ? 'eclipse' : null;
  if (reaction && (enemy.comboAt ?? -1) <= s.time) {
    enemy.comboAt = s.time + 1;
    damage += (source?.damage || damage) * 1.5;
    if (reaction === 'thermal') { enemy.slowFor = 0; enemy.freezeFor = 0; }
    pushEvent(s, 'combo', { x: enemy.x, y: enemy.y, color: source?.color ?? 0, reaction });
  }
  if (element === 'fire') enemy.burningFor = 1.5;
  if (source) source.stats.damage += Math.min(enemy.hp, damage);
  enemy.hp -= damage;
  if (slow) enemy.slowFor = 1.2;
  if (enemy.hp <= 0) { onKill(s, enemy, source, random, shard); return true; }
  return false;
}

/** Returns true when damage was applied. */
export function hurt(player, damage, s = null) {
  if (!player.alive || player.hitCooldown > 0 || player.pendingPowers || player.invulnerableFor > 0) return false;
  const taken = Math.max(2, damage - player.armor);
  player.hp = Math.max(0, player.hp - taken);
  player.hitCooldown = CONTACT.playerCooldown;
  if (player.stats) player.stats.taken += taken;
  if (!player.hp && player.phoenix > 0) {
    player.phoenix--;
    player.hp = player.maxHp * 0.5;
    player.invulnerableFor = 3;
    if (s) pushEvent(s, 'phoenix', { x: Math.round(player.x), y: Math.round(player.y), color: player.color });
    return true;
  }
  if (!player.hp) {
    player.alive = false;
    player.input = { x: 0, y: 0 };
    player.pendingPowers = null;
    player.reviveProgress = 0;
    player.reviveBy = null;
  }
  return true;
}
