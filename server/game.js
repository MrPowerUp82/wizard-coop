export const LIMITS = Object.freeze({ enemies: 180, shots: 320, drops: 220 });
export const DROP_TTL = 24;

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
  return { time: 0, players: {}, enemies: [], shots: [], gems: [], spawn: 0, over: false, cleanup: 0 };
}

export function createPlayer(id, name, color = 0) {
  return {
    id, name, color, x: color * 55, y: 0, hp: 100, maxHp: 100, xp: 0, level: 1,
    alive: true, input: { x: 0, y: 0 }, speed: 190, damage: 14, attackDelay: 0.62,
    attackCooldown: 0, projectiles: 1, pickupRadius: 105, armor: 0,
    hitCooldown: 0, powers: {}, pendingPowers: null
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
  return true;
}

function grantXp(player, amount, random) {
  player.xp += amount;
  while (!player.pendingPowers && player.xp >= xpNeeded(player.level)) {
    player.xp -= xpNeeded(player.level);
    player.level += 1;
    player.hp = Math.min(player.maxHp, player.hp + player.maxHp * 0.1);
    player.pendingPowers = availablePowers(player, random);
  }
}

const distanceSq = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
const nearest = (origin, entities) => entities.reduce((a, b) => distanceSq(origin, b) < distanceSq(origin, a) ? b : a);
const entityId = () => globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

export function updateGame(s, dt, random = Math.random) {
  if (s.over) return;
  const players = Object.values(s.players);
  const alive = players.filter(p => p.alive);
  if (!alive.length) { s.over = players.length > 0; return; }
  s.time += dt;
  const difficulty = difficultyAt(s.time, alive.length);

  for (const p of alive) {
    p.hitCooldown = Math.max(0, p.hitCooldown - dt);
    p.attackCooldown -= dt;
    if (!p.pendingPowers) {
      p.x += p.input.x * p.speed * dt;
      p.y += p.input.y * p.speed * dt;
    }
  }

  s.spawn -= dt;
  if (s.spawn <= 0 && s.enemies.length < LIMITS.enemies) {
    s.spawn = difficulty.spawnInterval;
    for (let n = 0; n < difficulty.spawnCount && s.enemies.length < LIMITS.enemies; n++) {
      const focus = alive[Math.floor(random() * alive.length)];
      const angle = random() * Math.PI * 2;
      const roll = random();
      const type = s.time < 40 ? (roll < 0.72 ? 'slime' : 'bat') : roll < 0.48 ? 'slime' : roll < 0.76 ? 'bat' : roll < 0.93 ? 'eye' : 'brute';
      const baseHp = { slime: 20, bat: 15, eye: 30, brute: 75 }[type];
      const hp = baseHp * difficulty.hpScale;
      s.enemies.push({ id: entityId(), x: focus.x + Math.cos(angle) * 560, y: focus.y + Math.sin(angle) * 560, hp, maxHp: hp, type, age: 0, farFor: 0 });
    }
  }

  for (const p of alive) {
    if (p.pendingPowers || p.attackCooldown > 0 || !s.enemies.length) continue;
    p.attackCooldown = p.attackDelay;
    const target = nearest(p, s.enemies);
    const baseAngle = Math.atan2(target.y - p.y, target.x - p.x);
    for (let n = 0; n < p.projectiles && s.shots.length < LIMITS.shots; n++) {
      const spread = (n - (p.projectiles - 1) / 2) * 0.16;
      const angle = baseAngle + spread;
      s.shots.push({ x: p.x, y: p.y, vx: Math.cos(angle) * 490, vy: Math.sin(angle) * 490, ttl: 1.55, damage: p.damage });
    }
  }

  for (const enemy of s.enemies) {
    enemy.age += dt;
    const target = nearest(enemy, alive);
    const angle = Math.atan2(target.y - enemy.y, target.x - enemy.x);
    const baseSpeed = enemy.type === 'bat' ? 98 : enemy.type === 'brute' ? 47 : enemy.type === 'eye' ? 60 : 66;
    enemy.x += Math.cos(angle) * baseSpeed * difficulty.speedScale * dt;
    enemy.y += Math.sin(angle) * baseSpeed * difficulty.speedScale * dt;
    if (distanceSq(enemy, target) < 34 ** 2 && target.hitCooldown <= 0 && !target.pendingPowers) {
      const baseDamage = { slime: 9, bat: 7, eye: 12, brute: 20 }[enemy.type];
      target.hp = Math.max(0, target.hp - Math.max(2, baseDamage * difficulty.damageScale - target.armor));
      target.hitCooldown = 0.48;
      if (target.hp <= 0) {
        target.alive = false;
        target.input = { x: 0, y: 0 };
        target.pendingPowers = null;
      }
    }
  }

  for (const shot of s.shots) {
    shot.x += shot.vx * dt; shot.y += shot.vy * dt; shot.ttl -= dt;
    if (shot.ttl <= 0) continue;
    for (const enemy of s.enemies) {
      if (enemy.hp > 0 && distanceSq(shot, enemy) < 29 ** 2) {
        enemy.hp -= shot.damage; shot.ttl = 0;
        if (enemy.hp <= 0) s.gems.push({ x: enemy.x, y: enemy.y, value: enemy.type === 'brute' ? 3 : 1, ttl: DROP_TTL });
        break;
      }
    }
  }
  s.shots = s.shots.filter(shot => shot.ttl > 0).slice(-LIMITS.shots);
  s.enemies = s.enemies.filter(enemy => enemy.hp > 0);

  for (const gem of s.gems) {
    gem.ttl -= dt;
    const target = nearest(gem, alive);
    const d2 = distanceSq(gem, target);
    if (d2 < target.pickupRadius ** 2) {
      const angle = Math.atan2(target.y - gem.y, target.x - gem.x);
      gem.x += Math.cos(angle) * 350 * dt; gem.y += Math.sin(angle) * 350 * dt;
    }
    if (distanceSq(gem, target) < 24 ** 2) { gem.dead = true; grantXp(target, gem.value, random); }
  }

  s.cleanup -= dt;
  if (s.cleanup <= 0) {
    s.cleanup = 0.75;
    s.gems = s.gems.filter(gem => !gem.dead && gem.ttl > 0 && alive.some(p => distanceSq(gem, p) < 1500 ** 2)).slice(-LIMITS.drops);
    s.enemies = s.enemies.filter(enemy => enemy.age < 75 && alive.some(p => distanceSq(enemy, p) < 1450 ** 2)).slice(-LIMITS.enemies);
  } else {
    s.gems = s.gems.filter(gem => !gem.dead);
  }
  if (players.every(p => !p.alive)) s.over = true;
}

export function publicState(s) {
  return {
    time: s.time, over: s.over,
    players: Object.fromEntries(Object.entries(s.players).map(([id, p]) => [id, { ...p, input: undefined, attackCooldown: undefined, hitCooldown: undefined }])),
    enemies: s.enemies, shots: s.shots, gems: s.gems
  };
}
