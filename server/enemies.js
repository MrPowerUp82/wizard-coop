import { BEHAVIORS, ENEMIES, PHASES } from './phases.js';
import { CONTACT, DIFFICULTY, ELITE, ENCOUNTERS, ENDLESS, LIMITS, PHASE_SCHEDULE, SEPARATION } from './balance.js';
import { CURSE_EFFECTS, hasCurse } from './curses.js';
import { distanceSq, hurt, pushEvent, spawnEnemy } from './combat.js';
import { bossBrain } from './bosses.js';
import { phaseClock } from './campaign.js';
import { retainTail } from './arrays.js';

/** `s` is optional: it adds the endless lap and the run's curses on top of the base ramp. */
export function difficultyAt(phaseTime, playerCount = 1, phase = 0, s = null) {
  const d = DIFFICULTY;
  const minutes = phase * d.phaseOffsetMinutes + phaseTime / 60;
  const extraPlayers = Math.max(0, playerCount - 1);
  const loop = s?.loop || 0;
  const spawnCount = 1 + Math.floor(minutes / d.spawnCountEveryMinutes) + Math.floor(extraPlayers / 2) + loop;
  return {
    spawnInterval: Math.max(d.spawnInterval.min, d.spawnInterval.start - minutes * d.spawnInterval.perMinute),
    hpScale: (1 + minutes * d.hpPerMinute + minutes * minutes * d.hpPerMinuteSquared) * (1 + extraPlayers * d.hpPerExtraPlayer)
      * (1 + loop * ENDLESS.hpPerLoop),
    damageScale: Math.min(d.damage.max, 1 + minutes * d.damage.perMinute) * (1 + loop * 0.15),
    speedScale: Math.min(d.speed.max, 1 + minutes * d.speed.perMinute) * (hasCurse(s, 'frenzy') ? CURSE_EFFECTS.frenzy.speed : 1),
    spawnCount: hasCurse(s, 'swarm') ? Math.ceil(spawnCount * CURSE_EFFECTS.swarm.spawnCount) : spawnCount
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
  while (s.scheduleCursor < PHASE_SCHEDULE.length && phaseClock(s) >= PHASE_SCHEDULE[s.scheduleCursor].at) {
    const beat = PHASE_SCHEDULE[s.scheduleCursor++];
    // Skip beats that were jumped over (e.g. a long pause or a test fast-forward).
    if (phaseClock(s) - beat.at > 2) continue;
    const phase = PHASES[s.phase];
    if (beat.kind === 'opening') {
      for (const focus of alive) for (let n = 0; n < 8; n++) spawnAround(ctx, focus, n * Math.PI / 4 + random() * 0.3, phase.enemies[0]);
    } else if (beat.kind === 'elite') {
      const count = hasCurse(s, 'nobility') ? CURSE_EFFECTS.nobility.elites : 1;
      for (let n = 0; n < count; n++) {
        const focus = alive[Math.floor(random() * alive.length)];
        const type = phase.enemies[Math.floor(random() * 2)];
        const elite = spawnAround(ctx, focus, random() * Math.PI * 2, type, { elite: true }, 480);
        if (elite) pushEvent(s, 'elite', { x: Math.round(elite.x), y: Math.round(elite.y), type });
      }
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
  const crowd = hasCurse(s, 'swarm') ? CURSE_EFFECTS.swarm.adaptiveLimit : 1;
  const adaptiveLimit = Math.min(LIMITS.enemies, Math.floor((a.base + Math.floor(phaseClock(s) * a.perPhaseSecond) + s.phase * a.perPhase + alive.length * a.perPlayer) * crowd));
  if (s.spawn > 0 || s.enemies.length >= adaptiveLimit) return;
  s.spawn = difficulty.spawnInterval;
  const batchSize = Math.min(difficulty.spawnCount, adaptiveLimit - s.enemies.length, DIFFICULTY.maxBatch);
  const angleOffset = random() * Math.PI * 2;
  for (let n = 0; n < batchSize; n++) {
    const focus = alive[(s.spawnCursor + n) % alive.length];
    const angle = angleOffset + n * (Math.PI * 2 / batchSize) + random() * 0.25;
    const distance = DIFFICULTY.spawnDistance.min + random() * DIFFICULTY.spawnDistance.spread;
    spawnAround(ctx, focus, angle, pickType(s.phase, phaseClock(s), random), {}, distance);
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
  if (!alive.length) return;
  s.tick = (s.tick || 0) + 1;
  const tick = s.tick;
  const DISTANT_SQ = 820 * 820;

  for (const enemy of s.enemies) {
    if (enemy.hp <= 0) continue;
    enemy.age += dt;
    enemy.burningFor = Math.max(0, (enemy.burningFor || 0) - dt);
    enemy.rootFor = Math.max(0, (enemy.rootFor || 0) - dt);
    enemy.freezeFor = Math.max(0, (enemy.freezeFor || 0) - dt);
    if (!enemy.boss && enemy.freezeFor > 0) continue;

    // Find nearest living player and minimum squared distance without allocations
    let target = alive[0];
    let d2Min = (enemy.x - target.x) ** 2 + (enemy.y - target.y) ** 2;
    for (let i = 1; i < alive.length; i++) {
      const p = alive[i];
      const d2 = (enemy.x - p.x) ** 2 + (enemy.y - p.y) ** 2;
      if (d2 < d2Min) {
        d2Min = d2;
        target = p;
      }
    }

    const type = ENEMIES[enemy.type];
    const isDistant = !enemy.boss && !enemy.elite && d2Min > DISTANT_SQ;
    enemy.distant = isDistant;

    // Fast-path: distant enemies without active conditions/threats update steering at 20 Hz
    const hasStatus = (enemy.rootFor > 0) || (enemy.slowFor > 0) || (enemy.fuse > 0) || (enemy.windup > 0) || (enemy.dash > 0);
    if (isDistant && !hasStatus) {
      if (enemy.vx === undefined || ((Number(enemy.id) || 0) + tick) % 3 === 0) {
        const angle = Math.atan2(target.y - enemy.y, target.x - enemy.x);
        const speed = type.speed * difficulty.speedScale;
        if (enemy.thief) {
          const flee = angle + Math.PI + Math.sin(enemy.age * 2.3) * 0.6;
          const pace = type.speed * ENCOUNTERS.thief.speed;
          enemy.vx = Math.cos(flee) * pace;
          enemy.vy = Math.sin(flee) * pace;
        } else {
          enemy.vx = Math.cos(angle) * speed;
          enemy.vy = Math.sin(angle) * speed;
        }
      }
      enemy.x += enemy.vx * dt;
      enemy.y += enemy.vy * dt;
      continue;
    }

    enemy.vx = undefined;
    const angle = Math.atan2(target.y - enemy.y, target.x - enemy.x);
    enemy.slowFor = Math.max(0, (enemy.slowFor || 0) - dt);
    enemy.touchCooldown = Math.max(0, (enemy.touchCooldown || 0) - dt);
    const slow = enemy.slowFor > 0 ? (enemy.boss ? 0.85 : 0.6) : 1;
    let speed = type.speed * slow * difficulty.speedScale * (enemy.elite ? ELITE.speed : 1);
    if (enemy.rootFor > 0) speed *= enemy.boss ? 0.75 : 0;
    if (enemy.boss) {
      bossBrain(ctx, enemy, target);
      if (enemy.dash > 0) speed = enemy.dashSpeed;
      const heading = enemy.dash > 0 ? enemy.dashAngle : angle;
      if (!(enemy.dashWarn > 0)) { enemy.x += Math.cos(heading) * speed * dt; enemy.y += Math.sin(heading) * speed * dt; }
    } else if (enemy.thief) {
      // The thief never fights: it runs from the nearest arcanist, weaving slightly to stay catchable.
      const flee = angle + Math.PI + Math.sin(enemy.age * 2.3) * 0.6;
      const pace = type.speed * ENCOUNTERS.thief.speed * slow * (enemy.rootFor > 0 ? 0 : 1);
      enemy.x += Math.cos(flee) * pace * dt; enemy.y += Math.sin(flee) * pace * dt;
      continue;
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

let curEnemy = null;
let curRadius = 0;
let sepPx = 0, sepPy = 0;

function accumulateSeparation(other, d2) {
  if (other === curEnemy || other.boss || d2 === 0) return;
  const d = Math.sqrt(d2);
  const push = (curRadius - d) / curRadius;
  sepPx += (curEnemy.x - other.x) / d * push;
  sepPy += (curEnemy.y - other.y) / d * push;
}

/** Soft push between overlapping enemies so hordes spread into a crowd instead of one stacked line. */
function separate(s, grid) {
  grid.clear();
  for (const enemy of s.enemies) if (enemy.hp > 0 && !enemy.distant) grid.insert(enemy);
  const { radius, strength } = SEPARATION;
  curRadius = radius;
  for (const enemy of s.enemies) {
    if (enemy.hp <= 0 || enemy.boss || enemy.distant || ENEMIES[enemy.type].behavior === 'flier') continue;
    curEnemy = enemy;
    sepPx = 0;
    sepPy = 0;
    grid.query(enemy.x, enemy.y, radius, accumulateSeparation);
    enemy.x += sepPx * radius * strength * 0.5;
    enemy.y += sepPy * radius * strength * 0.5;
  }
  curEnemy = null;
}

export function updateEnemyShots({ s, dt, alive }) {
  for (const shot of s.enemyShots) {
    shot.x += shot.vx * dt; shot.y += shot.vy * dt; shot.ttl -= dt;
    if (shot.ttl <= 0) continue;
    for (const p of alive) {
      if (p.alive && distanceSq(shot, p) < (shot.radius + 18) ** 2) { hurt(p, shot.damage, s); shot.ttl = 0; break; }
    }
  }
  retainTail(s.enemyShots, shot => shot.ttl > 0, LIMITS.enemyShots);
}
