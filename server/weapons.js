import { ENEMIES } from './phases.js';
import { COOP, LIMITS, SPECIAL, SPECIAL_COOLDOWN, WEAPONS } from './balance.js';
import { healingScale } from './curses.js';
import { dashDirection } from './movement.js';
import { rankOf } from './powers.js';
import { damageEnemy, distanceSq, nextId, pushEvent } from './combat.js';
import { retainTail } from './arrays.js';

export const SPELLS = Object.freeze([
  { name: 'Raio glacial', sprite: 'bolt', tint: '#76dfff', speed: 490, radius: 29, pierce: 1, slow: true },
  { name: 'Bola de fogo', sprite: 'fire', tint: '#ff9955', speed: 430, radius: 29, pierce: 1, splash: 75 },
  { name: 'Espinho', sprite: 'thorn', tint: '#92ed68', speed: 560, radius: 29, pierce: 3 },
  { name: 'Lâmina lunar', sprite: 'blade', tint: '#c4a0ff', speed: 400, radius: 48, pierce: 2 }
]);
export const SPECIALS = Object.freeze([
  { name: 'Nova glacial', description: 'Congela inimigos próximos; desacelera chefes.' },
  { name: 'Meteoro', description: 'Explode sobre o inimigo mais próximo e deixa brasas.' },
  { name: 'Jardim de espinhos', description: 'Prende inimigos em raízes e causa dano por 4s.' },
  { name: 'Passo lunar', description: 'Avança na direção do movimento e lança lâminas que retornam.' }
]);
// Unlocked with "Segundo feitiço": one alternative special per character.
export const ALT_SPECIALS = Object.freeze([
  { name: 'Tempestade de granizo', description: 'Granizo cai ao seu redor por 3,5s, ferindo e desacelerando.' },
  { name: 'Égide flamejante', description: 'Um escudo de fogo gira com você por 5s e queima projéteis inimigos.' },
  { name: 'Florescer', description: 'Cura você e aliados próximos em 30% e dispara 16 espinhos.' },
  { name: 'Eclipse', description: 'Um vórtice puxa inimigos para um ponto e explode depois de 2s.' }
]);
export const specialOf = p => (p?.specialVariant === 1 ? ALT_SPECIALS : SPECIALS)[p?.color ?? 0];

const ATTACK_RANGE = 900;
const BOOMERANG_TURN = 0.8;
const MAX_BOSS_RADIUS = 64;

function nearestEnemy(enemies, origin, range) {
  let target = null, best = range * range;
  for (const enemy of enemies) {
    if (enemy.hp <= 0) continue;
    const d2 = distanceSq(origin, enemy);
    if (d2 < best) { best = d2; target = enemy; }
  }
  return target;
}

function playerShot(p, angle, special = false) {
  const spell = SPELLS[p.color];
  const shot = { x: p.x, y: p.y, vx: Math.cos(angle) * spell.speed, vy: Math.sin(angle) * spell.speed,
    ttl: special ? 2 : 1.55, damage: p.damage * (special ? 3 : 1), color: p.color, special,
    pierce: spell.pierce, hitIds: [], owner: p.id };
  if (!special && p.color === 3 && rankOf(p, 'boomerang')) { shot.boomerang = true; shot.fullmoon = Boolean(rankOf(p, 'fullmoon')); }
  if (!special && p.color === 2 && rankOf(p, 'bramble')) {
    shot.pierce += WEAPONS.evolutions.bramble.pierce;
    shot.damage *= WEAPONS.evolutions.bramble.damage;
  }
  return shot;
}

export function activateSpecial(s, playerId, random = Math.random) {
  const p = s.players[playerId];
  if (!p?.alive || s.over || s.phaseStatus === 'transition' || p.pendingPowers || p.specialCharge < SPECIAL.max
    || p.specialCooldown > 0) return false;
  const alt = p.specialVariant === 1;
  if (alt ? p.color === 2 && s.shots.length + 16 > LIMITS.shots : p.color === 3 && s.shots.length + 8 > LIMITS.shots) return false;
  if ((alt ? p.color !== 2 : p.color === 1 || p.color === 2) && s.zones.length >= LIMITS.zones) return false;
  p.specialCharge = 0;
  p.specialCooldown = SPECIAL_COOLDOWN;
  p.castCount++;
  const event = { x: Math.round(p.x), y: Math.round(p.y), color: p.color, variant: alt ? 1 : 0 };
  if (alt) castAltSpecial(s, p, event);
  else if (p.color === 0) {
    for (const enemy of [...s.enemies]) if (distanceSq(p, enemy) < 280 ** 2 && enemy.hp > 0) {
      enemy.freezeFor = enemy.boss ? 0 : 2;
      damageEnemy(s, enemy, p.damage * 4, random, { slow: true, source: p, kind: 'special' });
    }
    s.enemyShots = s.enemyShots.filter(shot => distanceSq(p, shot) > 220 ** 2);
  } else if (p.color === 1) {
    const target = nearestEnemy(s.enemies, p, 500);
    const direction = dashDirection(p);
    const zone = { id: nextId(s), x: target?.x ?? p.x + direction.x * 180, y: target?.y ?? p.y + direction.y * 180,
      radius: 165, ttl: 3.6, warning: 0.6, kind: 'meteor', damage: p.damage * 9, dps: p.damage * 0.5, owner: p.id, color: 1 };
    s.zones.push(zone);
    Object.assign(event, { tx: Math.round(zone.x), ty: Math.round(zone.y), delay: zone.warning });
  } else if (p.color === 2) {
    s.zones.push({ id: nextId(s), x: p.x, y: p.y, radius: 190, ttl: 4, kind: 'roots', dps: p.damage * 2, owner: p.id, color: 2 });
  } else {
    const direction = dashDirection(p);
    const from = { x: p.x, y: p.y };
    p.x += direction.x * 170; p.y += direction.y * 170;
    Object.assign(event, { x: Math.round(p.x), y: Math.round(p.y), fx: Math.round(from.x), fy: Math.round(from.y) });
    p.motionId = (p.motionId || 0) + 1;
    p.invulnerableFor = Math.max(p.invulnerableFor, 0.3);
    for (let n = 0; n < 8; n++) {
      const shot = playerShot({ ...p, ...from }, n * Math.PI / 4, true);
      shot.boomerang = true;
      s.shots.push(shot);
    }
  }
  pushEvent(s, 'special', event);
  converge(s, p, random);
  return true;
}

function castAltSpecial(s, p, event) {
  if (p.color === 0) {
    s.zones.push({ id: nextId(s), x: p.x, y: p.y, radius: 230, ttl: 3.5, kind: 'hail', dps: p.damage * 2.4, slow: true, owner: p.id, color: 0 });
  } else if (p.color === 1) {
    s.zones.push({ id: nextId(s), x: p.x, y: p.y, radius: 125, ttl: 5, kind: 'flameshield', dps: p.damage * 3, follow: true, owner: p.id, color: 1 });
  } else if (p.color === 2) {
    for (const ally of Object.values(s.players)) {
      if (ally.alive && distanceSq(ally, p) < 320 ** 2) ally.hp = Math.min(ally.maxHp, ally.hp + ally.maxHp * 0.3 * healingScale(s));
    }
    for (let n = 0; n < 16; n++) s.shots.push(playerShot(p, n * Math.PI / 8, true));
  } else {
    const target = nearestEnemy(s.enemies, p, 450);
    const direction = dashDirection(p);
    const x = target?.x ?? p.x + direction.x * 200, y = target?.y ?? p.y + direction.y * 200;
    s.zones.push({ id: nextId(s), x, y, radius: 230, ttl: 2.2, kind: 'vortex', dps: p.damage, pull: 260,
      damage: p.damage * 8, owner: p.id, color: 3 });
    Object.assign(event, { tx: Math.round(x), ty: Math.round(y) });
  }
}

/** Two arcanists casting specials close together within a moment trigger a Convergence blast between them. */
function converge(s, p, random) {
  const cfg = COOP.convergence;
  s.recentSpecials = (s.recentSpecials || []).filter(entry => s.time - entry.t <= cfg.window && s.players[entry.id]?.alive);
  const partnerEntry = s.recentSpecials.find(entry => entry.id !== p.id && (entry.x - p.x) ** 2 + (entry.y - p.y) ** 2 < cfg.range ** 2);
  if (!partnerEntry) { s.recentSpecials.push({ id: p.id, t: s.time, x: p.x, y: p.y }); return; }
  s.recentSpecials = s.recentSpecials.filter(entry => entry !== partnerEntry);
  const partner = s.players[partnerEntry.id];
  const x = (p.x + partner.x) / 2, y = (p.y + partner.y) / 2;
  const damage = (p.damage + partner.damage) * cfg.damage;
  for (const enemy of [...s.enemies]) {
    if (enemy.hp > 0 && distanceSq({ x, y }, enemy) < cfg.radius ** 2) damageEnemy(s, enemy, damage, random, { source: p, kind: 'convergence' });
  }
  pushEvent(s, 'convergence', { x: Math.round(x), y: Math.round(y), r: cfg.radius, colors: [p.color, partner.color] });
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
  const { radius, ttl, dps } = rankOf(owner, 'hellfire') ? WEAPONS.evolutions.hellfire : WEAPONS.burn;
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
  // Scratch arrays are reused for every projectile. Keeping candidates ordered while the spatial
  // query runs avoids Array.sort() + repeated distanceSq() calls in projectile-heavy late hordes.
  const hits = [];
  const hitDistances = [];
  for (const shot of s.shots) {
    const owner = shot.owner ? s.players[shot.owner] : null;
    const spell = SPELLS[shot.color ?? 0];
    shot.hitIds ??= [];
    shot.pierce ??= spell.pierce;
    if (shot.boomerang && owner?.alive) {
      if (!shot.returning && shot.ttl <= BOOMERANG_TURN) {
        shot.returning = true; shot.hitIds = []; shot.pierce = spell.pierce;
        if (shot.fullmoon) shot.damage *= WEAPONS.evolutions.fullmoon.returnDamage;
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
    hitDistances.length = 0;
    const reach = shot.fullmoon && shot.returning ? WEAPONS.evolutions.fullmoon.size : 1;
    grid.query(shot.x, shot.y, spell.radius * reach + MAX_BOSS_RADIUS, (enemy, d2) => {
      if (!(enemy.hp > 0 && d2 < (hitRadius(enemy, spell) * reach) ** 2) || shot.hitIds.includes(enemy.id)) return;
      let at = hits.length;
      // Candidate sets are small because the spatial grid has already culled the world. Insertion is
      // cheaper than a general sort here and preserves the exact nearest-first collision semantics.
      while (at > 0 && hitDistances[at - 1] > d2) {
        hits[at] = hits[at - 1];
        hitDistances[at] = hitDistances[at - 1];
        at--;
      }
      hits[at] = enemy;
      hitDistances[at] = d2;
    });
    if (!hits.length) continue;
    for (const enemy of hits) {
      shot.hitIds.push(enemy.id);
      const kind = shot.special ? 'special' : shot.shard ? 'shatter' : shot.returning ? 'boomerang' : 'spell';
      damageEnemy(s, enemy, shot.damage, random, { slow: spell.slow, source: owner, shard: shot.shard, kind,
        element: shot.color === 1 ? 'fire' : shot.color === 3 ? 'moon' : '' });
      if (spell.splash) {
        grid.query(enemy.x, enemy.y, spell.splash, other => {
          if (other !== enemy) damageEnemy(s, other, shot.damage * 0.6, random, { source: owner, element: 'fire', kind });
        });
        if (owner && rankOf(owner, 'burn')) addBurnZone(s, owner, enemy.x, enemy.y);
      }
      if (--shot.pierce <= 0) { shot.ttl = 0; break; }
      if (owner && shot.color === 2 && rankOf(owner, 'ricochet')) { redirect(shot, grid, enemy); break; }
    }
  }
  retainTail(s.shots, shot => shot.ttl > 0, LIMITS.shots);
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
  const solar = rankOf(p, 'solarcrown');
  const damage = p.damage * (cfg.damage + cfg.damagePerRank * rank) * (evolved ? WEAPONS.evolutions.constellation.damage : 1)
    * (solar ? WEAPONS.evolutions.solarcrown.damage : 1);
  p.orbitAngle = ((p.orbitAngle || 0) + cfg.speed * dt) % (Math.PI * 2);
  for (let n = 0; n < count; n++) {
    const angle = p.orbitAngle + n * Math.PI * 2 / count;
    const x = p.x + Math.cos(angle) * radius, y = p.y + Math.sin(angle) * radius;
    grid.query(x, y, cfg.size + (evolved ? 26 : 18), enemy => {
      if (enemy.hp > 0 && hitOnce(enemy, `o${p.id}`, s.time, cfg.hitEvery)) {
        damageEnemy(s, enemy, damage, random, { source: p, kind: 'orbit', element: solar ? 'fire' : '' });
      }
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
    damageEnemy(s, enemy, damage, random, { source: p, slow: evolved && !enemy.boss, kind: 'aura' });
  });
  if (evolved) {
    for (const ally of alive) {
      if (distanceSq(ally, p) < radius ** 2 && (ally.sanctuaryAt || 0) <= s.time) {
        ally.hp = Math.min(ally.maxHp, ally.hp + WEAPONS.evolutions.sanctuary.heal);
        ally.sanctuaryAt = s.time + WEAPONS.aura.every;
      }
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
    damageEnemy(s, target, damage, random, { source: p, element: 'lightning', kind: 'chain' });
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

const FAMILIAR_ELEMENTS = ['', 'fire', '', 'moon'];
const ZONE_ELEMENTS = { burn: 'fire', meteor: 'fire', flameshield: 'fire', roots: '', hail: '', vortex: 'moon' };
const familiarTargets = [];
const familiarDistances = [];

/** Runas de tempestade: every rune blast arcs lightning through nearby enemies. */
function stormArc(s, owner, rune, grid, random) {
  const cfg = WEAPONS.evolutions.stormrunes;
  const hit = new Set();
  const points = [Math.round(rune.x), Math.round(rune.y)];
  /** @type {any} */
  let from = rune;
  for (let n = 0; n < cfg.jumps; n++) {
    /** @type {any} */
    let target = null;
    let best = Infinity;
    grid.query(from.x, from.y, cfg.jumpRange, (enemy, d2) => { if (enemy.hp > 0 && !hit.has(enemy) && d2 < best) { best = d2; target = enemy; } });
    if (!target) break;
    hit.add(target);
    points.push(Math.round(target.x), Math.round(target.y));
    damageEnemy(s, target, owner.damage * cfg.damage, random, { source: owner, element: 'lightning', kind: 'runes' });
    from = target;
  }
  if (points.length > 2) pushEvent(s, 'chain', { points, color: owner.color });
}

/** Where the familiar hovers beside its owner when it is not lunging at a target. */
export function placeFamiliar(p, time) {
  const cfg = WEAPONS.familiar;
  const angle = time * 1.4 + p.color;
  return { x: p.x + Math.cos(angle) * cfg.hover, y: p.y + Math.sin(angle) * cfg.hover * 0.55 - 26 };
}

function updateFamiliar(ctx, p, rank) {
  const { s, dt, random, grid } = ctx;
  const cfg = WEAPONS.familiar;
  const evolved = rankOf(p, 'covenant');
  const home = placeFamiliar(p, s.time);
  p.familiar ??= { ...home, timer: 0.4 };
  const pet = p.familiar;
  // Teleport back if the owner dashed or revived far away; otherwise glide smoothly.
  if ((pet.x - p.x) ** 2 + (pet.y - p.y) ** 2 > 400 ** 2) Object.assign(pet, home);
  const follow = 1 - Math.exp(-cfg.follow * dt);
  pet.x += (home.x - pet.x) * follow; pet.y += (home.y - pet.y) * follow;
  pet.timer -= dt;
  if (pet.timer > 0) return;
  const count = cfg.targets[rank - 1] + (evolved ? WEAPONS.evolutions.covenant.targets : 0);
  familiarTargets.length = 0; familiarDistances.length = 0;
  // Keep only the nearest N while querying. Gameplay remains nearest-first, but large hordes no longer
  // allocate a pair for every candidate, sort the whole list and then slice most of it away.
  grid.query(pet.x, pet.y, cfg.range, (enemy, d2) => {
    if (enemy.hp <= 0) return;
    const length = familiarTargets.length;
    if (length >= count && d2 >= familiarDistances[length - 1]) return;
    let pos = Math.min(length, count - 1);
    if (length < count) { familiarTargets.push(enemy); familiarDistances.push(d2); }
    while (pos > 0 && familiarDistances[pos - 1] > d2) {
      familiarDistances[pos] = familiarDistances[pos - 1]; familiarTargets[pos] = familiarTargets[pos - 1]; pos--;
    }
    familiarDistances[pos] = d2; familiarTargets[pos] = enemy;
  });
  if (!familiarTargets.length) { pet.timer = 0.2; return; }
  const cooldown = Math.max(0.35, cfg.cooldown - cfg.cooldownPerRank * rank) * (evolved ? WEAPONS.evolutions.covenant.cooldown : 1);
  pet.timer = cooldown;
  const damage = p.damage * (cfg.damage + cfg.damagePerRank * rank) * (evolved ? WEAPONS.evolutions.covenant.damage : 1);
  const points = [];
  for (const enemy of familiarTargets) {
    points.push(Math.round(enemy.x), Math.round(enemy.y));
    damageEnemy(s, enemy, damage, random, { source: p, slow: p.color === 0, element: FAMILIAR_ELEMENTS[p.color], kind: 'familiar' });
    if (p.color === 2 && !enemy.boss) enemy.rootFor = Math.max(enemy.rootFor || 0, 0.35);
  }
  pushEvent(s, 'familiar', { x: Math.round(pet.x), y: Math.round(pet.y), points, color: p.color, evolved: evolved ? 1 : 0 });
  // A little lunge toward the first victim sells the attack; the follow spring pulls it back.
  pet.x += (points[0] - pet.x) * cfg.lunge; pet.y += (points[1] - pet.y) * cfg.lunge;
}

export function updateWeapons(ctx) {
  const { s, dt, random, grid } = ctx;
  for (const p of ctx.alive) {
    if (p.pendingPowers) continue;
    const orbit = rankOf(p, 'orbit'), aura = rankOf(p, 'aura'), chain = rankOf(p, 'chain'), runes = rankOf(p, 'runes');
    const familiar = rankOf(p, 'familiar');
    if (orbit) updateOrbit(ctx, p, orbit);
    if (aura) updateAura(ctx, p, aura);
    if (chain) updateChain(ctx, p, chain);
    if (runes) updateRunes(ctx, p, runes);
    if (familiar) updateFamiliar(ctx, p, familiar);
  }
  for (const rune of s.runes) {
    rune.ttl -= dt; rune.arm -= dt;
    if (rune.arm > 0 || rune.ttl <= 0) continue;
    let triggered = false;
    grid.query(rune.x, rune.y, WEAPONS.runes.trigger + 20, enemy => (triggered = enemy.hp > 0));
    if (!triggered) continue;
    rune.ttl = 0;
    const owner = s.players[rune.owner] || null;
    grid.query(rune.x, rune.y, rune.radius, enemy => { damageEnemy(s, enemy, rune.damage, random, { source: owner, element: 'fire', kind: 'runes' }); });
    pushEvent(s, 'boom', { x: Math.round(rune.x), y: Math.round(rune.y), r: Math.round(rune.radius), color: rune.color });
    if (owner && rankOf(owner, 'stormrunes')) stormArc(s, owner, rune, grid, random);
  }
  retainTail(s.runes, rune => rune.ttl > 0);
  for (const zone of s.zones) {
    zone.ttl -= dt;
    const owner = s.players[zone.owner] || null;
    if (zone.follow) {
      if (!owner?.alive) { zone.ttl = 0; continue; }
      zone.x = owner.x; zone.y = owner.y;
      retainTail(s.enemyShots, shot => distanceSq(shot, zone) > zone.radius ** 2);
    }
    if (zone.kind === 'meteor' && zone.warning > 0) {
      zone.warning -= dt;
      if (zone.warning > 0) continue;
      grid.query(zone.x, zone.y, zone.radius, enemy => { damageEnemy(s, enemy, zone.damage, random, { source: owner, element: 'fire', kind: 'special' }); });
      pushEvent(s, 'boom', { x: zone.x, y: zone.y, r: zone.radius, color: 1 });
    }
    const kind = zone.kind && zone.kind !== 'burn' ? 'special' : 'burn';
    const element = ZONE_ELEMENTS[zone.kind || 'burn'] ?? 'fire';
    grid.query(zone.x, zone.y, zone.radius, (enemy, d2) => {
      if (zone.kind === 'roots') { enemy.rootFor = 0.5; if (owner) enemy.rootBy = owner.id; }
      if (zone.pull && !enemy.boss && d2 > 400) {
        const d = Math.sqrt(d2), step = Math.min(d - 20, zone.pull * dt);
        enemy.x += (zone.x - enemy.x) / d * step; enemy.y += (zone.y - enemy.y) / d * step;
      }
      damageEnemy(s, enemy, zone.dps * dt, random, { source: owner, element, slow: Boolean(zone.slow), kind });
    });
    if (zone.kind === 'vortex' && zone.ttl <= 0) {
      grid.query(zone.x, zone.y, zone.radius, enemy => { damageEnemy(s, enemy, zone.damage, random, { source: owner, element: 'moon', kind: 'special' }); });
      pushEvent(s, 'boom', { x: Math.round(zone.x), y: Math.round(zone.y), r: zone.radius, color: 3 });
    }
  }
  retainTail(s.zones, zone => zone.ttl > 0);
}

/** Rough sustained single-target DPS, used to size boss health to the group's real strength. */
export function estimateDps(p) {
  const { orbit, aura, chain, runes, familiar } = WEAPONS;
  let dps = p.damage * p.projectiles / p.attackDelay;
  const r = id => rankOf(p, id);
  if (r('orbit')) dps += p.damage * (orbit.damage + orbit.damagePerRank * r('orbit')) / orbit.hitEvery * 0.35 * (r('constellation') ? 2 : 1)
    * (r('solarcrown') ? WEAPONS.evolutions.solarcrown.damage : 1);
  if (r('aura')) dps += p.damage * (aura.damage + aura.damagePerRank * r('aura')) / aura.every * 0.6;
  if (r('chain')) dps += p.damage * (chain.damage + chain.damagePerRank * r('chain')) / Math.max(0.9, chain.cooldown - chain.cooldownPerRank * r('chain'));
  if (r('runes')) dps += p.damage * (runes.damage + runes.damagePerRank * r('runes')) / (runes.cooldown - runes.cooldownPerRank * r('runes')) * 0.3;
  if (r('familiar')) {
    const cov = r('covenant') ? WEAPONS.evolutions.covenant : null;
    const cooldown = Math.max(0.35, familiar.cooldown - familiar.cooldownPerRank * r('familiar')) * (cov ? cov.cooldown : 1);
    dps += p.damage * (familiar.damage + familiar.damagePerRank * r('familiar')) * (cov ? cov.damage : 1) / cooldown;
  }
  return dps;
}
