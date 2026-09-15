import { BEHAVIORS, ENEMIES, PHASES } from './phases.js';
import { CONTACT, DIFFICULTY, ELITE, LIMITS, PHASE_SCHEDULE, SEPARATION } from './balance.js';
import { distanceSq, hurt, nearest, pushEvent, spawnEnemy } from './combat.js';
import { bossBrain } from './bosses.js';

export function difficultyAt(phaseTime, playerCount = 1, phase = 0) {
  const d = DIFFICULTY;
  const minutes = phase * d.phaseOffsetMinutes + phaseTime / 60;
  const extraPlayers = Math.max(0, playerCount - 1);
  return {
    spawnInterval: Math.max(d.spawnInterval.min, d.spawnInterval.start - minutes * d.spawnInterval.perMinute),
    hpScale: 1 + minutes * d.hpPerMinute + minutes * minutes * d.hpPerMinuteSquared + extraPlayers * d.hpPerExtraPlayer,
    damageScale: Math.min(d.damage.max, 1 + minutes * d.damage.perMinute),
    speedScale: Math.min(d.speed.max, 1 + minutes * d.speed.perMinute),
    spawnCount: 1 + Math.floor(minutes / d.spawnCountEveryMinutes) + Math.floor(extraPlayers / 2)
  };
}

function pickType(phase, phaseTime, random) {
  const { enemies, specials = [] } = PHASES[phase];
  const roll = random();
  let cursor = 0;
  for (const special of specials) {
    if (phaseTime < special.after) continue;
    cursor += special.weight;
    if (roll < cursor) return special.type;
  }
  // Remaining probability keeps the original 60/40 split between the two core enemies.
  const core = (roll - cursor) / (1 - cursor);
  return enemies[core < 0.6 ? 0 : 1];
}

function spawnAround(ctx, focus, angle, type, extra = {}, distance) {
  const { s, random, difficulty } = ctx;
  const d = distance ?? DIFFICULTY.spawnDistance.min + random() * DIFFICULTY.spawnDistance.spread;
  return spawnEnemy(s, type, focus.x + Math.cos(angle) * d, focus.y + Math.sin(angle) * d, difficulty.hpScale, extra);
}

function runSchedule(ctx) {
  const { s, alive, random } = ctx;
  s.scheduleCursor ??= 0;
  while (s.scheduleCursor < PHASE_SCHEDULE.length && s.phaseTime >= PHASE_SCHEDULE[s.scheduleCursor].at) {
    const beat = PHASE_SCHEDULE[s.scheduleCursor++];
    // Skip beats that were jumped over (e.g. a long pause or a test fast-forward).
    if (s.phaseTime - beat.at > 2) continue;
    const phase = PHASES[s.phase];
    if (beat.kind === 'opening') {
      for (const focus of alive) for (let n = 0; n < 8; n++) spawnAround(ctx, focus, n * Math.PI / 4 + random() * 0.3, phase.enemies[0]);
    } else if (beat.kind === 'elite') {
      const focus = alive[Math.floor(random() * alive.length)];
      const type = phase.enemies[Math.floor(random() * 2)];
      const elite = spawnAround(ctx, focus, random() * Math.PI * 2, type, { elite: true }, 480);
      if (elite) pushEvent(s, 'elite', { x: Math.round(elite.x), y: Math.round(elite.y), type });
    } else if (beat.kind === 'ring') {
      const focus = alive[Math.floor(random() * alive.length)];
      const count = Math.min(16 + alive.length * 4, LIMITS.enemies - s.enemies.length);
      for (let n = 0; n < count; n++) spawnAround(ctx, focus, n * Math.PI * 2 / count, phase.enemies[1], {}, 440);
      if (count > 0) pushEvent(s, 'ring', { x: Math.round(focus.x), y: Math.round(focus.y) });
    }
  }
}

export function spawnHorde(ctx) {
  const { s, dt, alive, random, difficulty } = ctx;
  runSchedule(ctx);
  s.spawn -= dt;
  const a = DIFFICULTY.adaptiveLimit;
  const adaptiveLimit = Math.min(LIMITS.enemies, a.base + Math.floor(s.phaseTime * a.perPhaseSecond) + s.phase * a.perPhase + alive.length * a.perPlayer);
  if (s.spawn > 0 || s.enemies.length >= adaptiveLimit) return;
  s.spawn = difficulty.spawnInterval;
  const batchSize = Math.min(difficulty.spawnCount, adaptiveLimit - s.enemies.length, DIFFICULTY.maxBatch);
  const angleOffset = random() * Math.PI * 2;
  for (let n = 0; n < batchSize; n++) {
    const focus = alive[(s.spawnCursor + n) % alive.length];
    const angle = angleOffset + n * (Math.PI * 2 / batchSize) + random() * 0.25;
    const distance = DIFFICULTY.spawnDistance.min + random() * DIFFICULTY.spawnDistance.spread;
    spawnAround(ctx, focus, angle, pickType(s.phase, s.phaseTime, random), {}, distance);
  }
  s.spawnCursor = (s.spawnCursor + batchSize) % alive.length;
}

function behave(ctx, enemy, target, angle, speed) {
  const { s, dt } = ctx;
  const type = ENEMIES[enemy.type];
  const behavior = type.behavior;
  const d2 = distanceSq(enemy, target);
  if (behavior === 'charger') {
    const cfg = BEHAVIORS.charger;
    enemy.chargeTimer = (enemy.chargeTimer ?? cfg.every * (0.5 + (Number(enemy.id) || 3) % 7 / 7)) - dt;
    if (enemy.windup > 0) {
      enemy.windup -= dt;
      if (enemy.windup <= 0) enemy.dash = cfg.dash;
      return null;
    }
    if (enemy.dash > 0) {
      enemy.dash -= dt;
      return { angle: enemy.dashAngle, speed: speed * cfg.speed };
    }
    if (enemy.chargeTimer <= 0 && d2 < cfg.range ** 2) {
      enemy.chargeTimer = cfg.every;
      enemy.windup = cfg.windup;
      enemy.dashAngle = angle;
      return null;
    }
  } else if (behavior === 'shooter') {
    const cfg = BEHAVIORS.shooter;
    enemy.shootTimer = (enemy.shootTimer ?? cfg.every) - dt;
    if (enemy.shootTimer <= 0 && d2 < 520 ** 2 && s.enemyShots.length < LIMITS.enemyShots) {
      enemy.shootTimer = cfg.every;
      s.enemyShots.push({ x: enemy.x, y: enemy.y, vx: Math.cos(angle) * cfg.shotSpeed, vy: Math.sin(angle) * cfg.shotSpeed,
        sprite: type.shotSprite || cfg.sprite, ttl: 4, damage: type.damage * ctx.difficulty.damageScale * CONTACT.damageScale, radius: 12 });
    }
    // Hover at range instead of walking into the player.
    if (d2 < cfg.keepAway ** 2) return { angle: angle + Math.PI, speed: speed * 0.6 };
    if (d2 < (cfg.keepAway + 60) ** 2) return { angle: angle + Math.PI / 2, speed: speed * 0.5 };
  } else if (behavior === 'bomber') {
    const cfg = BEHAVIORS.bomber;
    if (enemy.fuse > 0) {
      enemy.fuse -= dt;
      if (enemy.fuse <= 0) {
        enemy.hp = 0; // Explodes without dropping loot, so it never rewards letting it detonate.
        enemy.exploded = true;
        const damage = type.damage * cfg.damage * ctx.difficulty.damageScale;
        for (const p of ctx.alive) if (distanceSq(enemy, p) < cfg.radius ** 2) hurt(p, damage, s);
        pushEvent(s, 'boom', { x: Math.round(enemy.x), y: Math.round(enemy.y), r: cfg.radius, color: -1 });
      }
      return null;
    }
    if (d2 < cfg.fuseRange ** 2) { enemy.fuse = cfg.fuse; return null; }
  }
  return { angle, speed };
}

export function updateEnemies(ctx) {
  const { s, dt, alive, difficulty, grid } = ctx;
  for (const enemy of s.enemies) {
    if (enemy.hp <= 0) continue;
    enemy.age += dt;
    const target = nearest(enemy, alive);
    const angle = Math.atan2(target.y - enemy.y, target.x - enemy.x);
    enemy.slowFor = Math.max(0, (enemy.slowFor || 0) - dt);
    enemy.touchCooldown = Math.max(0, (enemy.touchCooldown || 0) - dt);
    const type = ENEMIES[enemy.type];
    const slow = enemy.slowFor > 0 ? (enemy.boss ? 0.85 : 0.6) : 1;
    let speed = type.speed * slow * difficulty.speedScale * (enemy.elite ? ELITE.speed : 1);
    if (enemy.boss) {
      bossBrain(ctx, enemy, target);
      if (enemy.dash > 0) speed = enemy.dashSpeed;
      const heading = enemy.dash > 0 ? enemy.dashAngle : angle;
      if (!(enemy.dashWarn > 0)) { enemy.x += Math.cos(heading) * speed * dt; enemy.y += Math.sin(heading) * speed * dt; }
    } else {
      const move = behave(ctx, enemy, target, angle, speed);
      if (move) { enemy.x += Math.cos(move.angle) * move.speed * dt; enemy.y += Math.sin(move.angle) * move.speed * dt; }
    }
    if (enemy.hp <= 0) continue;
    const reach = enemy.boss ? type.radius + 15 : enemy.elite ? CONTACT.radius + 10 : CONTACT.radius;
    if (enemy.touchCooldown <= 0 && distanceSq(enemy, target) < reach ** 2) {
      const multiplier = (enemy.elite ? ELITE.damage : 1) * (enemy.dash > 0 ? 1.5 : 1);
      if (hurt(target, type.damage * difficulty.damageScale * CONTACT.damageScale * multiplier, s)) enemy.touchCooldown = CONTACT.enemyCooldown;
    }
  }
  separate(s, grid);
}

/** Soft push between overlapping enemies so hordes spread into a crowd instead of one stacked line. */
function separate(s, grid) {
  grid.clear();
  for (const enemy of s.enemies) if (enemy.hp > 0) grid.insert(enemy);
  const { radius, strength } = SEPARATION;
  for (const enemy of s.enemies) {
    if (enemy.hp <= 0 || enemy.boss || ENEMIES[enemy.type].behavior === 'flier') continue;
    let px = 0, py = 0;
    grid.query(enemy.x, enemy.y, radius, (other, d2) => {
      if (other === enemy || other.boss || d2 === 0) return;
      const d = Math.sqrt(d2);
      const push = (radius - d) / radius;
      px += (enemy.x - other.x) / d * push; py += (enemy.y - other.y) / d * push;
    });
    enemy.x += px * radius * strength * 0.5;
    enemy.y += py * radius * strength * 0.5;
  }
}

export function updateEnemyShots({ s, dt, alive }) {
  for (const shot of s.enemyShots) {
    shot.x += shot.vx * dt; shot.y += shot.vy * dt; shot.ttl -= dt;
    if (shot.ttl <= 0) continue;
    for (const p of alive) {
      if (p.alive && distanceSq(shot, p) < (shot.radius + 18) ** 2) { hurt(p, shot.damage, s); shot.ttl = 0; break; }
    }
  }
  s.enemyShots = s.enemyShots.filter(shot => shot.ttl > 0).slice(-LIMITS.enemyShots);
}
