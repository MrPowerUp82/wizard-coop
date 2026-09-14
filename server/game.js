import { ENEMIES, PHASES, PHASE_DURATION, TRANSITION_DURATION } from './phases.js';

export const LIMITS = Object.freeze({ enemies: 180, shots: 320, enemyShots: 96, drops: 220, hazards: 12 });
export const DROP_TTL = 24;
export const REVIVE = Object.freeze({ seconds: 4, radius: 44, health: 0.4 });
export const SPECIAL = Object.freeze({ max: 100, crystal: 25, shots: 12 });
export const SPELLS = Object.freeze([
  { name: 'Raio glacial', sprite: 'bolt', tint: '#76dfff', speed: 490, radius: 29, pierce: 1, slow: true },
  { name: 'Bola de fogo', sprite: 'fire', tint: '#ff9955', speed: 430, radius: 29, pierce: 1, splash: 75 },
  { name: 'Espinho', sprite: 'thorn', tint: '#92ed68', speed: 560, radius: 29, pierce: 3 },
  { name: 'Lâmina lunar', sprite: 'blade', tint: '#c4a0ff', speed: 400, radius: 48, pierce: 2 }
]);

export const POWERS = Object.freeze({
  arcane: { title: 'Poder arcano', max: 5 },
  haste: { title: 'Cadência', max: 5 },
  vitality: { title: 'Vitalidade', max: 5 },
  swiftness: { title: 'Passos do vento', max: 5 },
  multishot: { title: 'Disparo múltiplo', max: 3 },
  magnet: { title: 'Magnetismo', max: 4 },
  armor: { title: 'Armadura rúnica', max: 5 }
});

export function xpNeeded(level) {
  return Math.floor(5 + level * 3 + level * level * 0.65);
}

export function difficultyAt(time, playerCount = 1) {
  const minutes = time / 60;
  return {
    spawnInterval: Math.max(0.16, 0.82 - minutes * 0.055),
    hpScale: 1 + minutes * 0.19 + Math.max(0, playerCount - 1) * 0.12,
    damageScale: Math.min(2.25, 1 + minutes * 0.1),
    speedScale: Math.min(1.38, 1 + minutes * 0.035),
    spawnCount: 1 + Math.floor(minutes / 3) + Math.floor(Math.max(0, playerCount - 1) / 2)
  };
}

export function createGameState() {
  return { time: 0, players: {}, enemies: [], shots: [], enemyShots: [], gems: [], hazards: [], spawn: 0, spawnCursor: 0, over: false, cleanup: 0,
    phase: 0, phaseTime: 0, phaseStatus: 'horde', transitionTime: 0, victory: false };
}

export function createPlayer(id, name, color = 0) {
  return {
    id, name, color, x: color * 55, y: 0, hp: 100, maxHp: 100, xp: 0, level: 1,
    alive: true, input: { x: 0, y: 0 }, speed: 190, damage: 14, attackDelay: 0.62,
    attackCooldown: 0, projectiles: 1, pickupRadius: 105, armor: 0,
    hitCooldown: 0, invulnerableFor: 0, powers: {}, pendingPowers: null,
    specialCharge: 0, coins: 0, reviveProgress: 0, reviveBy: null, reviving: null,
    castCount: 0, castAngle: 0
  };
}

export function availablePowers(player, random = Math.random) {
  const pool = Object.keys(POWERS).filter(id => (player.powers[id] || 0) < POWERS[id].max);
  const choices = [];
  while (pool.length && choices.length < 3) choices.push(pool.splice(Math.floor(random() * pool.length), 1)[0]);
  return choices;
}

export function applyPower(player, powerId) {
  if (!player.pendingPowers?.includes(powerId)) return false;
  const power = POWERS[powerId];
  const rank = player.powers[powerId] || 0;
  if (!power || rank >= power.max) return false;
  player.powers[powerId] = rank + 1;
  if (powerId === 'arcane') player.damage *= 1.25;
  if (powerId === 'haste') player.attackDelay = Math.max(0.18, player.attackDelay * 0.88);
  if (powerId === 'vitality') { player.maxHp += 22; player.hp = Math.min(player.maxHp, player.hp + 30); }
  if (powerId === 'swiftness') player.speed *= 1.12;
  if (powerId === 'multishot') player.projectiles = Math.min(4, player.projectiles + 1);
  if (powerId === 'magnet') player.pickupRadius += 55;
  if (powerId === 'armor') player.armor += 1.5;
  player.pendingPowers = null;
  player.invulnerableFor = 3;
  return true;
}

function grantXp(player, amount, random) {
  player.xp += amount;
  while (!player.pendingPowers && player.xp >= xpNeeded(player.level)) {
    player.xp -= xpNeeded(player.level);
    player.level += 1;
    player.hp = Math.min(player.maxHp, player.hp + player.maxHp * 0.1);
    const choices = availablePowers(player, random);
    player.pendingPowers = choices.length ? choices : null;
  }
}

const distanceSq = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
const nearest = (origin, entities) => entities.reduce((a, b) => distanceSq(origin, b) < distanceSq(origin, a) ? b : a);
const entityId = () => globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

function playerShot(p, angle, special = false) {
  const spell = SPELLS[p.color];
  return { x: p.x, y: p.y, vx: Math.cos(angle) * spell.speed, vy: Math.sin(angle) * spell.speed,
    ttl: special ? 2 : 1.55, damage: p.damage * (special ? 3 : 1), color: p.color, special,
    pierce: spell.pierce, hitIds: [] };
}

export function activateSpecial(s, playerId) {
  const p = s.players[playerId];
  if (!p?.alive || s.over || s.phaseStatus === 'transition' || p.pendingPowers || p.specialCharge < SPECIAL.max
    || s.shots.length + SPECIAL.shots > LIMITS.shots) return false;
  p.specialCharge = 0;
  p.castCount++;
  for (let n = 0; n < SPECIAL.shots; n++) s.shots.push(playerShot(p, n * Math.PI * 2 / SPECIAL.shots, true));
  return true;
}

function dropLoot(s, enemy, random) {
  const add = (type, value) => {
    if (s.gems.length < LIMITS.drops) s.gems.push({ x: enemy.x, y: enemy.y, type, value, ttl: DROP_TTL });
  };
  add('gem', enemy.type === 'brute' ? 3 : 1);
  const roll = random();
  if (roll < 0.05) add('heart', 25);
  else if (roll < 0.25) add('greenGem', SPECIAL.crystal);
  else if (roll < 0.45) add('coin', 1);
}

function damageEnemy(s, enemy, damage, random, slow = false) {
  if (enemy.hp <= 0) return;
  enemy.hp -= damage;
  if (slow) enemy.slowFor = 1.2;
  if (enemy.hp <= 0) dropLoot(s, enemy, random);
}

function reviveAllies(players, fallen, dt) {
  for (const p of players) p.reviving = null;
  for (const p of fallen) {
    const canHelp = helper => helper.alive && !helper.pendingPowers && !helper.reviving
      && distanceSq(helper, p) <= REVIVE.radius ** 2;
    const helper = players.find(other => other.id === p.reviveBy && canHelp(other)) || players.find(canHelp);
    if (!helper) { p.reviveProgress = 0; p.reviveBy = null; continue; }
    if (p.reviveBy !== helper.id) p.reviveProgress = 0;
    p.reviveBy = helper.id;
    helper.reviving = p.id;
    p.reviveProgress = Math.min(REVIVE.seconds, p.reviveProgress + dt);
    if (p.reviveProgress >= REVIVE.seconds) {
      p.alive = true; p.hp = p.maxHp * REVIVE.health; p.invulnerableFor = 3;
      p.input = { x: 0, y: 0 }; p.hitCooldown = 0; p.pendingPowers = null;
      p.reviveProgress = 0; p.reviveBy = null; helper.reviving = null;
    }
  }
}

function hurt(player, damage) {
  if (!player.alive || player.hitCooldown > 0 || player.pendingPowers || player.invulnerableFor > 0) return;
  player.hp = Math.max(0, player.hp - Math.max(2, damage - player.armor));
  player.hitCooldown = 0.48;
  if (!player.hp) {
    player.alive = false;
    player.input = { x: 0, y: 0 };
    player.pendingPowers = null;
    player.reviveProgress = 0;
    player.reviveBy = null;
  }
}

function summonBoss(s, alive) {
  const type = PHASES[s.phase].boss;
  const hp = ENEMIES[type].hp * (1 + (alive.length - 1) * 0.65);
  s.enemies = [{ id: entityId(), type, boss: true, hp, maxHp: hp, age: 0,
    x: alive[0].x + 330, y: alive[0].y - 180, attackCooldown: 2.5, rangedCooldown: 1.5 }];
  s.shots = [];
  s.phaseStatus = 'boss';
}

function bossRangedAttack(s, enemy, target, dt) {
  enemy.rangedCooldown = (enemy.rangedCooldown ?? 1.5) - dt;
  if (enemy.rangedCooldown > 0) return;
  enemy.rangedCooldown = enemy.type === 'demon' ? 2.4 : 3;
  const sprite = enemy.type === 'treant' ? 'thorn' : enemy.type === 'lich' ? 'bolt' : 'fire';
  const count = enemy.type === 'demon' ? 5 : 3;
  const angle = Math.atan2(target.y - enemy.y, target.x - enemy.x);
  for (let n = 0; n < count && s.enemyShots.length < LIMITS.enemyShots; n++) {
    const direction = angle + (n - (count - 1) / 2) * 0.23;
    const speed = enemy.type === 'lich' ? 230 : 200;
    s.enemyShots.push({ x: enemy.x, y: enemy.y, vx: Math.cos(direction) * speed, vy: Math.sin(direction) * speed,
      sprite, ttl: 4, damage: ENEMIES[enemy.type].damage, radius: 14 });
  }
}

function bossAttack(s, enemy, target, dt) {
  enemy.attackCooldown -= dt;
  if (enemy.attackCooldown > 0) return;
  enemy.attackCooldown = enemy.type === 'demon' ? 3.4 : 4.5;
  const centers = enemy.type === 'treant' ? [{ x: enemy.x, y: enemy.y }]
    : enemy.type === 'lich' ? [{ x: target.x, y: target.y }]
      : [-1, 0, 1].map(n => ({ x: target.x + n * 140, y: target.y }));
  for (const center of centers) {
    if (s.hazards.length >= LIMITS.hazards) break;
    s.hazards.push({ ...center, radius: enemy.type === 'treant' ? 175 : 100,
      warning: 1.3, ttl: 1.65, damage: ENEMIES[enemy.type].damage + 8, fired: false });
  }
}

export function updateGame(s, dt, random = Math.random) {
  if (s.over) return;
  const players = Object.values(s.players);
  const alive = players.filter(p => p.alive);
  const fallen = players.filter(p => !p.alive);
  if (!alive.length) { s.over = players.length > 0; return; }
  s.time += dt;
  if (s.phaseStatus === 'transition') {
    s.transitionTime = Math.max(0, s.transitionTime - dt);
    if (!s.transitionTime) {
      s.phase++;
      s.phaseTime = 0;
      s.phaseStatus = 'horde';
      s.spawn = 0;
      for (const p of alive) { p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.35); p.invulnerableFor = 3; }
    }
    return;
  }
  if (s.phaseStatus === 'horde') {
    s.phaseTime = Math.min(PHASE_DURATION, s.phaseTime + dt);
    if (s.phaseTime >= PHASE_DURATION) summonBoss(s, alive);
  }
  const difficulty = difficultyAt(s.time, alive.length);

  for (const p of alive) {
    if (!p.pendingPowers) grantXp(p, 0, random);
    p.hitCooldown = Math.max(0, p.hitCooldown - dt);
    p.invulnerableFor = Math.max(0, p.invulnerableFor - dt);
    p.attackCooldown -= dt;
    if (!p.pendingPowers) {
      p.x += p.input.x * p.speed * dt;
      p.y += p.input.y * p.speed * dt;
    }
  }

  s.spawn -= dt;
  const adaptiveLimit = Math.min(LIMITS.enemies, 28 + Math.floor(s.time / 5) + alive.length * 18);
  if (s.phaseStatus === 'horde' && s.spawn <= 0 && s.enemies.length < adaptiveLimit) {
    s.spawn = difficulty.spawnInterval;
    const batchSize = Math.min(difficulty.spawnCount, adaptiveLimit - s.enemies.length, 6);
    const angleOffset = random() * Math.PI * 2;
    for (let n = 0; n < batchSize; n++) {
      const focus = alive[(s.spawnCursor + n) % alive.length];
      const angle = angleOffset + n * (Math.PI * 2 / batchSize) + random() * 0.25;
      const distance = 520 + random() * 120;
      const roll = random();
      const type = PHASES[s.phase].enemies[roll < 0.6 ? 0 : 1];
      const baseHp = ENEMIES[type].hp;
      const hp = baseHp * difficulty.hpScale;
      s.enemies.push({ id: entityId(), x: focus.x + Math.cos(angle) * distance, y: focus.y + Math.sin(angle) * distance, hp, maxHp: hp, type, age: 0 });
    }
    s.spawnCursor = (s.spawnCursor + batchSize) % alive.length;
  }

  for (const p of alive) {
    if (p.pendingPowers || p.attackCooldown > 0 || !s.enemies.length) continue;
    p.attackCooldown = p.attackDelay;
    const target = nearest(p, s.enemies);
    const baseAngle = Math.atan2(target.y - p.y, target.x - p.x);
    if (s.shots.length < LIMITS.shots) { p.castCount++; p.castAngle = baseAngle; }
    for (let n = 0; n < p.projectiles && s.shots.length < LIMITS.shots; n++) {
      const spread = (n - (p.projectiles - 1) / 2) * 0.16;
      const angle = baseAngle + spread;
      s.shots.push(playerShot(p, angle));
    }
  }

  for (const enemy of s.enemies) {
    enemy.age += dt;
    const target = nearest(enemy, alive);
    const angle = Math.atan2(target.y - enemy.y, target.x - enemy.x);
    if (enemy.hp <= 0) continue;
    enemy.slowFor = Math.max(0, (enemy.slowFor || 0) - dt);
    const baseSpeed = ENEMIES[enemy.type].speed * (enemy.slowFor > 0 ? (enemy.boss ? 0.85 : 0.6) : 1);
    enemy.x += Math.cos(angle) * baseSpeed * difficulty.speedScale * dt;
    enemy.y += Math.sin(angle) * baseSpeed * difficulty.speedScale * dt;
    if (enemy.boss) { bossAttack(s, enemy, target, dt); bossRangedAttack(s, enemy, target, dt); }
    if (distanceSq(enemy, target) < (enemy.boss ? ENEMIES[enemy.type].radius + 15 : 34) ** 2) hurt(target, ENEMIES[enemy.type].damage * difficulty.damageScale);
  }

  for (const hazard of s.hazards) {
    hazard.warning -= dt;
    hazard.ttl -= dt;
    if (hazard.warning <= 0 && !hazard.fired) {
      hazard.fired = true;
      for (const p of alive) if (distanceSq(hazard, p) < hazard.radius ** 2) hurt(p, hazard.damage);
    }
  }
  s.hazards = s.hazards.filter(h => h.ttl > 0);

  for (const shot of s.enemyShots) {
    shot.x += shot.vx * dt; shot.y += shot.vy * dt; shot.ttl -= dt;
    if (shot.ttl <= 0) continue;
    for (const p of alive) {
      if (p.alive && distanceSq(shot, p) < (shot.radius + 18) ** 2) {
        hurt(p, shot.damage); shot.ttl = 0; break;
      }
    }
  }
  s.enemyShots = s.enemyShots.filter(shot => shot.ttl > 0).slice(-LIMITS.enemyShots);

  for (const shot of s.shots) {
    shot.x += shot.vx * dt; shot.y += shot.vy * dt; shot.ttl -= dt;
    if (shot.ttl <= 0) continue;
    const spell = SPELLS[shot.color ?? 0];
    shot.hitIds ??= [];
    shot.pierce ??= spell.pierce;
    for (const enemy of s.enemies) {
      if (enemy.hp > 0 && !shot.hitIds.includes(enemy.id)
        && distanceSq(shot, enemy) < (enemy.boss ? ENEMIES[enemy.type].radius + spell.radius - 29 : spell.radius) ** 2) {
        shot.hitIds.push(enemy.id);
        damageEnemy(s, enemy, shot.damage, random, spell.slow);
        if (spell.splash) {
          for (const other of s.enemies) if (other !== enemy && distanceSq(enemy, other) < spell.splash ** 2)
            damageEnemy(s, other, shot.damage * 0.6, random);
        }
        if (--shot.pierce <= 0) { shot.ttl = 0; break; }
      }
    }
  }
  s.shots = s.shots.filter(shot => shot.ttl > 0).slice(-LIMITS.shots);
  s.enemies = s.enemies.filter(enemy => enemy.hp > 0);

  reviveAllies(players, fallen, dt);
  const survivors = players.filter(p => p.alive);
  for (const gem of s.gems) {
    gem.ttl -= dt;
    if (gem.ttl <= 0 || !survivors.length) continue;
    const eligible = survivors.filter(p => gem.type === 'heart' ? p.hp < p.maxHp : gem.type === 'greenGem' ? p.specialCharge < SPECIAL.max : true);
    if (!eligible.length) continue;
    const target = nearest(gem, eligible);
    const d2 = distanceSq(gem, target);
    if (d2 < target.pickupRadius ** 2) {
      const angle = Math.atan2(target.y - gem.y, target.x - gem.x);
      const step = Math.min(Math.sqrt(d2), 350 * dt);
      gem.x += Math.cos(angle) * step; gem.y += Math.sin(angle) * step;
    }
    if (distanceSq(gem, target) < 24 ** 2) {
      gem.dead = true;
      if (gem.type === 'heart') target.hp = Math.min(target.maxHp, target.hp + gem.value);
      else if (gem.type === 'greenGem') target.specialCharge = Math.min(SPECIAL.max, target.specialCharge + gem.value);
      else if (gem.type === 'coin') target.coins += gem.value;
      else grantXp(target, gem.value, random);
    }
  }

  s.cleanup -= dt;
  if (s.cleanup <= 0) {
    s.cleanup = 0.75;
    s.gems = s.gems.filter(gem => !gem.dead && gem.ttl > 0 && alive.some(p => distanceSq(gem, p) < 1500 ** 2)).slice(-LIMITS.drops);
    s.enemies = s.enemies.filter(enemy => enemy.boss || (enemy.age < 75 && alive.some(p => distanceSq(enemy, p) < 1450 ** 2))).slice(-LIMITS.enemies);
  } else {
    s.gems = s.gems.filter(gem => !gem.dead && gem.ttl > 0).slice(-LIMITS.drops);
  }
  if (players.every(p => !p.alive)) s.over = true;
  if (!s.over && s.phaseStatus === 'boss' && !s.enemies.some(e => e.boss)) {
    s.enemies = []; s.shots = []; s.enemyShots = []; s.gems = []; s.hazards = [];
    if (s.phase === PHASES.length - 1) {
      s.victory = true; s.over = true; s.phaseStatus = 'complete';
      for (const p of players) p.pendingPowers = null;
    } else {
      s.phaseStatus = 'transition'; s.transitionTime = TRANSITION_DURATION;
    }
  }
}

export function publicState(s) {
  return {
    time: s.time, over: s.over, victory: s.victory, phase: s.phase, phaseTime: s.phaseTime,
    phaseStatus: s.phaseStatus, transitionTime: s.transitionTime, hazards: s.hazards,
    players: Object.fromEntries(Object.entries(s.players).map(([id, p]) => [id, { ...p, input: undefined, attackCooldown: undefined, hitCooldown: undefined }])),
    enemies: s.enemies, shots: s.shots.map(({ hitIds, ...shot }) => shot), enemyShots: s.enemyShots, gems: s.gems
  };
}
