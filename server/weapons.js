import { ENEMIES } from './phases.js';
import { LIMITS, SPECIAL, WEAPONS } from './balance.js';
import { rankOf } from './powers.js';
import { damageEnemy, distanceSq, nextId, pushEvent } from './combat.js';

export const SPELLS = Object.freeze([
  { name: 'Raio glacial', sprite: 'bolt', tint: '#76dfff', speed: 490, radius: 29, pierce: 1, slow: true },
  { name: 'Bola de fogo', sprite: 'fire', tint: '#ff9955', speed: 430, radius: 29, pierce: 1, splash: 75 },
  { name: 'Espinho', sprite: 'thorn', tint: '#92ed68', speed: 560, radius: 29, pierce: 3 },
  { name: 'Lâmina lunar', sprite: 'blade', tint: '#c4a0ff', speed: 400, radius: 48, pierce: 2 }
]);

const ATTACK_RANGE = 900;
const BOOMERANG_TURN = 0.8;
const MAX_BOSS_RADIUS = 64;

function playerShot(p, angle, special = false) {
  const spell = SPELLS[p.color];
  const shot = { x: p.x, y: p.y, vx: Math.cos(angle) * spell.speed, vy: Math.sin(angle) * spell.speed,
    ttl: special ? 2 : 1.55, damage: p.damage * (special ? 3 : 1), color: p.color, special,
    pierce: spell.pierce, hitIds: [], owner: p.id };
  if (!special && p.color === 3 && rankOf(p, 'boomerang')) shot.boomerang = true;
  return shot;
}

export function activateSpecial(s, playerId) {
  const p = s.players[playerId];
  if (!p?.alive || s.over || s.phaseStatus === 'transition' || p.pendingPowers || p.specialCharge < SPECIAL.max
    || s.shots.length + SPECIAL.shots > LIMITS.shots) return false;
  p.specialCharge = 0;
  p.castCount++;
  for (let n = 0; n < SPECIAL.shots; n++) s.shots.push(playerShot(p, n * Math.PI * 2 / SPECIAL.shots, true));
  pushEvent(s, 'special', { x: Math.round(p.x), y: Math.round(p.y), color: p.color });
  return true;
}

/** Elo arcano: the strongest bond among nearby allies (including yourself) speeds up attacks. */
function bondHaste(p, alive) {
  let rank = 0;
  for (const q of alive) {
    const r = rankOf(q, 'bond');
    if (r > rank && (q === p || distanceSq(p, q) < WEAPONS.bond.range ** 2)) rank = r;
  }
  return rank * WEAPONS.bond.hastePerRank;
}

export function updatePlayerAttacks({ s, alive }) {
  if (!s.enemies.length) return;
  for (const p of alive) {
    if (p.pendingPowers || p.attackCooldown > 0) continue;
    let target = null, best = ATTACK_RANGE ** 2;
    for (const enemy of s.enemies) {
      const d2 = distanceSq(p, enemy);
      if (enemy.hp > 0 && d2 < best) { best = d2; target = enemy; }
    }
    if (!target) continue;
    p.attackCooldown = p.attackDelay * (1 - bondHaste(p, alive));
    const baseAngle = Math.atan2(target.y - p.y, target.x - p.x);
    if (s.shots.length < LIMITS.shots) { p.castCount++; p.castAngle = baseAngle; }
    for (let n = 0; n < p.projectiles && s.shots.length < LIMITS.shots; n++) {
      s.shots.push(playerShot(p, baseAngle + (n - (p.projectiles - 1) / 2) * 0.16));
    }
  }
}

function hitRadius(enemy, spell) {
  if (enemy.boss) return ENEMIES[enemy.type].radius + spell.radius - 29;
  return enemy.elite ? spell.radius + 8 : spell.radius;
}

function addBurnZone(s, owner, x, y) {
  const { radius, ttl, dps } = WEAPONS.burn;
  const existing = s.zones.find(zone => zone.owner === owner.id && (zone.x - x) ** 2 + (zone.y - y) ** 2 < 30 ** 2);
  if (existing) { existing.ttl = ttl; return; }
  if (s.zones.length < LIMITS.zones) s.zones.push({ id: nextId(s), x, y, radius, ttl, dps: owner.damage * dps, owner: owner.id, color: 1 });
}

function redirect(shot, grid, from) {
  /** @type {any} */
  let target = null;
  let best = Infinity;
  grid.query(from.x, from.y, WEAPONS.ricochet.range, (enemy, d2) => {
    if (enemy.hp > 0 && d2 < best && !shot.hitIds.includes(enemy.id)) { best = d2; target = enemy; }
  });
  if (!target) return;
  const speed = Math.hypot(shot.vx, shot.vy);
  const angle = Math.atan2(target.y - shot.y, target.x - shot.x);
  shot.vx = Math.cos(angle) * speed; shot.vy = Math.sin(angle) * speed;
}

export function updateShots({ s, dt, random, grid }) {
  const hits = [];
  for (const shot of s.shots) {
    const owner = shot.owner ? s.players[shot.owner] : null;
    const spell = SPELLS[shot.color ?? 0];
    shot.hitIds ??= [];
    shot.pierce ??= spell.pierce;
    if (shot.boomerang && owner?.alive) {
      if (!shot.returning && shot.ttl <= BOOMERANG_TURN) {
        shot.returning = true; shot.hitIds = []; shot.pierce = spell.pierce;
      }
      if (shot.returning) {
        const angle = Math.atan2(owner.y - shot.y, owner.x - shot.x);
        shot.vx = Math.cos(angle) * spell.speed; shot.vy = Math.sin(angle) * spell.speed;
        if (distanceSq(shot, owner) < 30 ** 2) shot.ttl = 0;
      }
    }
    shot.x += shot.vx * dt; shot.y += shot.vy * dt; shot.ttl -= dt;
    if (shot.ttl <= 0) continue;
    hits.length = 0;
    grid.query(shot.x, shot.y, spell.radius + MAX_BOSS_RADIUS, (enemy, d2) => {
      if (enemy.hp > 0 && d2 < hitRadius(enemy, spell) ** 2 && !shot.hitIds.includes(enemy.id)) hits.push([d2, enemy]);
    });
    if (!hits.length) continue;
    hits.sort((a, b) => a[0] - b[0]);
    for (const [, enemy] of hits) {
      shot.hitIds.push(enemy.id);
      damageEnemy(s, enemy, shot.damage, random, { slow: spell.slow, source: owner, shard: shot.shard });
      if (spell.splash) {
        grid.query(enemy.x, enemy.y, spell.splash, other => {
          if (other !== enemy) damageEnemy(s, other, shot.damage * 0.6, random, { source: owner });
        });
        if (owner && rankOf(owner, 'burn')) addBurnZone(s, owner, enemy.x, enemy.y);
      }
      if (--shot.pierce <= 0) { shot.ttl = 0; break; }
      if (owner && shot.color === 2 && rankOf(owner, 'ricochet')) { redirect(shot, grid, enemy); break; }
    }
  }
  s.shots = s.shots.filter(shot => shot.ttl > 0).slice(-LIMITS.shots);
}

function hitOnce(enemy, key, time, every) {
  enemy.hitAt ??= {};
  if ((enemy.hitAt[key] ?? -Infinity) > time) return false;
  enemy.hitAt[key] = time + every;
  return true;
}

function updateOrbit(ctx, p, rank) {
  const { s, dt, random, grid } = ctx;
  const cfg = WEAPONS.orbit;
  const evolved = rankOf(p, 'constellation');
  const count = cfg.counts[rank - 1] + (evolved ? WEAPONS.evolutions.constellation.extraOrbs : 0);
  const radius = orbitRadius(rank, evolved);
  const damage = p.damage * (cfg.damage + cfg.damagePerRank * rank) * (evolved ? WEAPONS.evolutions.constellation.damage : 1);
  p.orbitAngle = ((p.orbitAngle || 0) + cfg.speed * dt) % (Math.PI * 2);
  for (let n = 0; n < count; n++) {
    const angle = p.orbitAngle + n * Math.PI * 2 / count;
    const x = p.x + Math.cos(angle) * radius, y = p.y + Math.sin(angle) * radius;
    grid.query(x, y, cfg.size + (evolved ? 26 : 18), enemy => {
      if (enemy.hp > 0 && hitOnce(enemy, `o${p.id}`, s.time, cfg.hitEvery)) damageEnemy(s, enemy, damage, random, { source: p });
    });
  }
}

export const orbitRadius = (rank, evolved) => WEAPONS.orbit.radius + rank * 4 + (evolved ? 20 : 0);
export const auraRadius = (rank, evolved) => WEAPONS.aura.radius + rank * WEAPONS.aura.radiusPerRank + (evolved ? WEAPONS.evolutions.sanctuary.radius : 0);

function updateAura(ctx, p, rank) {
  const { s, dt, random, grid, alive } = ctx;
  p.auraTimer = (p.auraTimer ?? 0) - dt;
  if (p.auraTimer > 0) return;
  p.auraTimer = WEAPONS.aura.every;
  const evolved = rankOf(p, 'sanctuary');
  const radius = auraRadius(rank, evolved);
  const damage = p.damage * (WEAPONS.aura.damage + WEAPONS.aura.damagePerRank * rank);
  grid.query(p.x, p.y, radius, enemy => {
    if (enemy.hp <= 0) return;
    damageEnemy(s, enemy, damage, random, { source: p, slow: evolved && !enemy.boss });
  });
  if (evolved) {
    for (const ally of alive) {
      if (distanceSq(ally, p) < radius ** 2) ally.hp = Math.min(ally.maxHp, ally.hp + WEAPONS.evolutions.sanctuary.heal);
    }
  }
}

function updateChain(ctx, p, rank) {
  const { s, dt, random, grid } = ctx;
  const cfg = WEAPONS.chain;
  const evolved = rankOf(p, 'tempest');
  p.chainTimer = (p.chainTimer ?? 0) - dt;
  if (p.chainTimer > 0) return;
  let from = p, target = null;
  const findFrom = (origin, range, hit) => {
    let found = null, best = Infinity;
    grid.query(origin.x, origin.y, range, (enemy, d2) => {
      if (enemy.hp > 0 && d2 < best && !hit.has(enemy)) { best = d2; found = enemy; }
    });
    return found;
  };
  const hit = new Set();
  target = findFrom(p, cfg.range, hit);
  if (!target) { p.chainTimer = 0.25; return; }
  p.chainTimer = evolved ? WEAPONS.evolutions.tempest.cooldown : Math.max(0.9, cfg.cooldown - cfg.cooldownPerRank * rank);
  const jumps = evolved ? WEAPONS.evolutions.tempest.jumps : 1 + rank;
  const damage = p.damage * (cfg.damage + cfg.damagePerRank * rank);
  const points = [Math.round(p.x), Math.round(p.y)];
  for (let n = 0; n <= jumps && target; n++) {
    hit.add(target);
    points.push(Math.round(target.x), Math.round(target.y));
    damageEnemy(s, target, damage, random, { source: p });
    from = target;
    target = findFrom(from, cfg.jumpRange, hit);
  }
  pushEvent(s, 'chain', { points, color: p.color });
}

function updateRunes(ctx, p, rank) {
  const { s, dt } = ctx;
  const cfg = WEAPONS.runes;
  p.runeTimer = (p.runeTimer ?? cfg.arm) - dt;
  if (p.runeTimer > 0) return;
  p.runeTimer = cfg.cooldown - cfg.cooldownPerRank * rank;
  const evolved = rankOf(p, 'minefield');
  const count = evolved ? WEAPONS.evolutions.minefield.runes : 1;
  const radius = cfg.radius + cfg.radiusPerRank * rank + (evolved ? WEAPONS.evolutions.minefield.radius : 0);
  for (let n = 0; n < count && s.runes.length < LIMITS.runes; n++) {
    const angle = n * Math.PI * 2 / count + s.time;
    const offset = count > 1 ? 60 : 0;
    s.runes.push({ id: nextId(s), x: p.x + Math.cos(angle) * offset, y: p.y + Math.sin(angle) * offset,
      owner: p.id, color: p.color, radius, damage: p.damage * (cfg.damage + cfg.damagePerRank * rank), ttl: cfg.ttl, arm: cfg.arm });
  }
}

export function updateWeapons(ctx) {
  const { s, dt, random, grid } = ctx;
  for (const p of ctx.alive) {
    if (p.pendingPowers) continue;
    const orbit = rankOf(p, 'orbit'), aura = rankOf(p, 'aura'), chain = rankOf(p, 'chain'), runes = rankOf(p, 'runes');
    if (orbit) updateOrbit(ctx, p, orbit);
    if (aura) updateAura(ctx, p, aura);
    if (chain) updateChain(ctx, p, chain);
    if (runes) updateRunes(ctx, p, runes);
  }
  for (const rune of s.runes) {
    rune.ttl -= dt; rune.arm -= dt;
    if (rune.arm > 0 || rune.ttl <= 0) continue;
    let triggered = false;
    grid.query(rune.x, rune.y, WEAPONS.runes.trigger + 20, enemy => (triggered = enemy.hp > 0));
    if (!triggered) continue;
    rune.ttl = 0;
    const owner = s.players[rune.owner] || null;
    grid.query(rune.x, rune.y, rune.radius, enemy => { damageEnemy(s, enemy, rune.damage, random, { source: owner }); });
    pushEvent(s, 'boom', { x: Math.round(rune.x), y: Math.round(rune.y), r: Math.round(rune.radius), color: rune.color });
  }
  s.runes = s.runes.filter(rune => rune.ttl > 0);
  for (const zone of s.zones) {
    zone.ttl -= dt;
    const owner = s.players[zone.owner] || null;
    grid.query(zone.x, zone.y, zone.radius, enemy => { damageEnemy(s, enemy, zone.dps * dt, random, { source: owner }); });
  }
  s.zones = s.zones.filter(zone => zone.ttl > 0);
}

/** Rough sustained single-target DPS, used to size boss health to the group's real strength. */
export function estimateDps(p) {
  const { orbit, aura, chain, runes } = WEAPONS;
  let dps = p.damage * p.projectiles / p.attackDelay;
  const r = id => rankOf(p, id);
  if (r('orbit')) dps += p.damage * (orbit.damage + orbit.damagePerRank * r('orbit')) / orbit.hitEvery * 0.35 * (r('constellation') ? 2 : 1);
  if (r('aura')) dps += p.damage * (aura.damage + aura.damagePerRank * r('aura')) / aura.every * 0.6;
  if (r('chain')) dps += p.damage * (chain.damage + chain.damagePerRank * r('chain')) / Math.max(0.9, chain.cooldown - chain.cooldownPerRank * r('chain'));
  if (r('runes')) dps += p.damage * (runes.damage + runes.damagePerRank * r('runes')) / (runes.cooldown - runes.cooldownPerRank * r('runes')) * 0.3;
  return dps;
}
