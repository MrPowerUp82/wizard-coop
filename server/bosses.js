import { ENEMIES, PHASES } from './phases.js';
import { BOSS, LIMITS } from './balance.js';
import { nextId, pushEvent, spawnEnemy } from './combat.js';
import { campaignOf } from './campaign.js';

export function summonBoss(s, alive) {
  const type = PHASES[s.phase].boss;
  const hp = BOSS.health[s.phase] * campaignOf(s).bossHp * (1 + (alive.length - 1) * BOSS.extraPlayerHp);
  s.altar = null;
  s.enemies = [{ id: nextId(s), type, boss: true, hp, maxHp: hp, age: 0, stage: 1,
    x: alive[0].x + 330, y: alive[0].y - 180, attackCooldown: 2.5, rangedCooldown: 1.5 }];
  s.shots = [];
  s.phaseStatus = 'boss';
  pushEvent(s, 'boss', { type });
}

const stageOf = enemy => {
  const ratio = enemy.hp / enemy.maxHp;
  return ratio > BOSS.stageThresholds[0] ? 1 : ratio > BOSS.stageThresholds[1] ? 2 : 3;
};

function addHazard(s, hazard) {
  if (s.hazards.length >= LIMITS.hazards) return;
  s.hazards.push({ warning: 1.3, ttl: 1.65, fired: false, ...hazard, warn0: hazard.warning ?? 1.3 });
}

function fire(s, enemy, angle, sprite, speed) {
  if (s.enemyShots.length >= LIMITS.enemyShots) return;
  s.enemyShots.push({ x: enemy.x, y: enemy.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
    sprite, ttl: 4, damage: ENEMIES[enemy.type].damage * BOSS.shotDamage, radius: BOSS.shotRadius });
}

function enterStage(ctx, enemy, stage) {
  const { s, random } = ctx;
  enemy.stage = stage;
  const { radius, warning, damage } = BOSS.shockwave;
  addHazard(s, { x: enemy.x, y: enemy.y, radius, warning, ttl: warning + 0.35, damage: ENEMIES[enemy.type].damage + damage });
  const minion = PHASES[s.phase].enemies[0];
  const count = BOSS.stageMinions + ctx.alive.length * 2;
  for (let n = 0; n < count; n++) {
    const angle = n * Math.PI * 2 / count + random() * 0.2;
    spawnEnemy(s, minion, enemy.x + Math.cos(angle) * 240, enemy.y + Math.sin(angle) * 240, 1 + s.phase * 0.8, { minion: true });
  }
  enemy.attackCooldown = Math.min(enemy.attackCooldown, 2);
  pushEvent(s, 'stage', { x: Math.round(enemy.x), y: Math.round(enemy.y), stage });
}

function areaAttack(ctx, enemy, target) {
  const { s, alive, random } = ctx;
  const damage = ENEMIES[enemy.type].damage + 8;
  const stage = enemy.stage;
  if (enemy.type === 'treant') {
    addHazard(s, { x: enemy.x, y: enemy.y, radius: 175, damage });
    if (stage >= 2) {
      // A line of roots erupts toward the target.
      const angle = Math.atan2(target.y - enemy.y, target.x - enemy.x);
      for (let n = 1; n <= 4; n++) addHazard(s, { x: enemy.x + Math.cos(angle) * (140 + n * 110), y: enemy.y + Math.sin(angle) * (140 + n * 110), radius: 70, damage, warning: 1 + n * 0.15, ttl: 1.35 + n * 0.15 });
    }
  } else if (enemy.type === 'lich') {
    const targets = stage >= 3 ? alive : [target];
    for (const p of targets) addHazard(s, { x: p.x, y: p.y, radius: 100, damage });
    if (stage >= 2 && targets.length === 1 && alive.length === 1) addHazard(s, { x: target.x + (random() - 0.5) * 300, y: target.y + (random() - 0.5) * 300, radius: 100, damage });
  } else if (enemy.type === 'bogwarden') {
    // A ring of pools leaves the center safe until the later fury stages.
    const count = stage === 3 ? 8 : 6;
    for (let n = 0; n < count; n++) {
      const angle = n * Math.PI * 2 / count;
      const warning = 1.4 + n * 0.08;
      addHazard(s, { x: target.x + Math.cos(angle) * 170, y: target.y + Math.sin(angle) * 170,
        radius: 62, damage, warning, ttl: warning + 0.35 });
    }
    if (stage >= 2) addHazard(s, { x: target.x, y: target.y, radius: 75, damage, warning: 1.8, ttl: 2.15 });
  } else if (enemy.type === 'archon') {
    const centers = [[0, 0], [-150, 0], [150, 0], [0, -150], [0, 150]];
    if (stage === 3) centers.push([-150, -150], [150, -150], [-150, 150], [150, 150]);
    for (const [x, y] of centers) addHazard(s, { x: target.x + x, y: target.y + y, radius: 65, damage, warning: 1.4, ttl: 1.75 });
  } else if (enemy.type === 'umbra') {
    // Fissures sweep through the target's recorded position, leaving time to move out.
    const angle = Math.atan2(target.y - enemy.y, target.x - enemy.x);
    for (let line = 0; line < (stage >= 2 ? 2 : 1); line++) {
      const direction = angle + line * Math.PI / 2;
      for (let n = -2; n <= 2; n++) {
        if (line && n === 0) continue;
        const warning = 1.1 + (n + 2) * 0.18;
        addHazard(s, { x: target.x + Math.cos(direction) * n * 120, y: target.y + Math.sin(direction) * n * 120,
          radius: 58, damage, warning, ttl: warning + 0.35 });
      }
    }
  } else {
    for (const n of [-1, 0, 1]) addHazard(s, { x: target.x + n * 140, y: target.y, radius: 100, damage });
    if (stage >= 3) for (let n = 0; n < 3; n++) {
      addHazard(s, { x: target.x + (random() - 0.5) * 520, y: target.y + (random() - 0.5) * 520, radius: 80, damage, warning: 1.1, ttl: 1.45 });
    }
  }
}

function rangedAttack(ctx, enemy, target) {
  const { s } = ctx;
  const stage = enemy.stage;
  const angle = Math.atan2(target.y - enemy.y, target.x - enemy.x);
  const sprite = ['treant', 'bogwarden'].includes(enemy.type) ? 'thorn' : ['lich', 'archon'].includes(enemy.type) ? 'bolt' : enemy.type === 'umbra' ? 'blade' : 'fire';
  const speed = ['lich', 'archon'].includes(enemy.type) ? 230 : 200;
  const radial = (count, offset = 0) => { for (let n = 0; n < count; n++) fire(s, enemy, offset + n * Math.PI * 2 / count, sprite, speed * 0.85); };
  const fan = count => { for (let n = 0; n < count; n++) fire(s, enemy, angle + (n - (count - 1) / 2) * 0.23, sprite, speed); };
  if (enemy.type === 'bogwarden') { fan(3 + stage * 2); if (stage === 3) radial(8, s.time); }
  else if (enemy.type === 'archon') { radial(4 + stage * 4, s.time * 0.45); if (stage === 3) fan(3); }
  else if (enemy.type === 'umbra') { radial(6 + stage * 4, s.time * 0.6); if (stage >= 2) fan(5); }
  else if (stage === 1) fan(enemy.type === 'demon' ? 5 : 3);
  else if (enemy.type === 'lich') radial(stage === 2 ? 12 : 16, s.time);
  else if (enemy.type === 'treant') { fan(5); if (stage === 3) radial(10, s.time); }
  else fan(7);
}

function dashAttack(ctx, enemy, target) {
  enemy.dashTimer = (enemy.dashTimer ?? 4) - ctx.dt;
  if (enemy.dashWarn > 0) {
    enemy.dashWarn -= ctx.dt;
    if (enemy.dashWarn <= 0) { enemy.dash = 0.5; enemy.dashSpeed = 560; }
    return;
  }
  if (enemy.dash > 0) { enemy.dash -= ctx.dt; return; }
  if (enemy.dashTimer <= 0) {
    enemy.dashTimer = 6;
    enemy.dashWarn = 0.8;
    enemy.dashAngle = Math.atan2(target.y - enemy.y, target.x - enemy.x);
    pushEvent(ctx.s, 'dash', { x: Math.round(enemy.x), y: Math.round(enemy.y), a: Math.round(enemy.dashAngle * 100) / 100 });
  }
}

export function bossBrain(ctx, enemy, target) {
  const { dt } = ctx;
  enemy.stage ??= 1;
  const stage = stageOf(enemy);
  if (stage > enemy.stage) enterStage(ctx, enemy, stage);
  const pace = BOSS.stageCooldown[enemy.stage - 1];
  enemy.attackCooldown -= dt;
  if (enemy.attackCooldown <= 0) {
    enemy.attackCooldown = BOSS.areaCooldown[enemy.type] * pace;
    areaAttack(ctx, enemy, target);
  }
  enemy.rangedCooldown = (enemy.rangedCooldown ?? 1.5) - dt;
  if (enemy.rangedCooldown <= 0) {
    enemy.rangedCooldown = BOSS.rangedCooldown[enemy.type] * pace;
    rangedAttack(ctx, enemy, target);
  }
  if ((enemy.type === 'demon' && enemy.stage >= 2) || (enemy.type === 'umbra' && enemy.stage === 3)) dashAttack(ctx, enemy, target);
}
