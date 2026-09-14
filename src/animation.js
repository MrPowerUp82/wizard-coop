// Visual state only: never modifies the authoritative game or collision positions.
export const MAX_EFFECTS = 128;
const TAU = Math.PI * 2;
const colors = ['#76dfff', '#ff9955', '#92ed68', '#c4a0ff'];

export function createAnimator() {
  const actors = new Map();
  const effects = [];
  let time = 0;
  let previousPhase;
  let reduced = false;

  function burst(x, y, color, count = 7, radius = 32) {
    if (reduced) return;
    effects.push({ kind: 'ring', x, y, color, age: 0, life: 0.45, radius });
    for (let i = 0; i < count; i++) {
      const angle = TAU * i / count;
      effects.push({ kind: 'spark', x, y, color, age: 0, life: 0.3 + i % 3 * 0.1,
        vx: Math.cos(angle) * (35 + i % 3 * 18), vy: Math.sin(angle) * 65 - 18 });
    }
    if (effects.length > MAX_EFFECTS) effects.splice(0, effects.length - MAX_EFFECTS);
  }

  return {
    reset() { actors.clear(); effects.length = 0; time = 0; previousPhase = undefined; },
    update(game, dt, options = {}) {
      reduced = Boolean(options.reduced);
      if (reduced) effects.length = 0;
      if (options.paused) return;
      dt = Math.max(0, Math.min(dt, 0.05));
      time += dt;
      for (let i = effects.length - 1; i >= 0; i--) {
        effects[i].age += dt;
        if (effects[i].age >= effects[i].life) effects.splice(i, 1);
      }
      const seen = new Set();
      const track = (entity, key, player) => {
        seen.add(key);
        const old = actors.get(key);
        const alive = player ? entity.alive !== false : entity.hp > 0;
        const color = player ? colors[entity.color ?? 0] : '#ffbc86';
        if (!old) {
          actors.set(key, { x: entity.x, y: entity.y, hp: entity.hp, alive, type: entity.type,
            boss: entity.boss, color, seed: actors.size * 2.39, movedAt: -10, dx: 0,
            stride: 0, walking: 0, hit: 0, cast: 0, down: alive ? 0 : 1,
            castCount: entity.castCount || 0, charge: entity.specialCharge || 0, level: entity.level,
            bossCooldown: entity.attackCooldown, rangedCooldown: entity.rangedCooldown });
          return;
        }
        const distance = Math.hypot(entity.x - old.x, entity.y - old.y);
        if (distance > 0.1 && alive && !game.over) {
          old.movedAt = time; old.dx = Math.sign(entity.x - old.x);
        }
        old.walking += ((time - old.movedAt < 0.14 && alive && !game.over ? 1 : 0) - old.walking) * Math.min(1, dt * 14);
        old.stride += dt * (player ? 13 : entity.boss ? 6 : 11) * old.walking;
        old.hit = Math.max(0, old.hit - dt * 6);
        old.cast = Math.max(0, old.cast - dt * 5);
        old.down += ((alive ? 0 : 1) - old.down) * Math.min(1, dt * 12);
        if (entity.hp < old.hp) {
          old.hit = 1;
          burst(entity.x, entity.y, player ? '#ffc0bd' : color, 4, entity.boss ? 65 : 25);
        }
        if (alive && !old.alive) burst(entity.x, entity.y, '#9dffca', 12, 65);
        if (!alive && old.alive) burst(entity.x, entity.y, color, 8, 40);
        const cast = player ? (entity.castCount || 0) !== old.castCount
          : entity.attackCooldown > old.bossCooldown || entity.rangedCooldown > old.rangedCooldown;
        if (cast && alive) {
          old.cast = 1;
          old.castAngle = entity.castAngle || 0;
          burst(entity.x + (player ? 17 : 0), entity.y - (player ? 12 : 0), color, 3, entity.boss ? 75 : 20);
        }
        if (player && (entity.specialCharge < old.charge || entity.level > old.level)) burst(entity.x, entity.y, color, 12, 95);
        Object.assign(old, { x: entity.x, y: entity.y, hp: entity.hp, alive,
          castCount: entity.castCount || 0, charge: entity.specialCharge || 0, level: entity.level,
          bossCooldown: entity.attackCooldown, rangedCooldown: entity.rangedCooldown });
      };
      for (const p of Object.values(game.players)) track(p, `p:${p.id}`, true);
      for (const enemy of game.enemies) track(enemy, `e:${enemy.id}`, false);
      for (const [key, actor] of actors) if (!seen.has(key)) {
        if (!reduced && key.startsWith('e:') && previousPhase === `${game.phase}:${game.phaseStatus}`
          && Object.values(game.players).some(p => Math.hypot(p.x - actor.x, p.y - actor.y) < 1000)) {
          burst(actor.x, actor.y, actor.color, 5, 30);
          if (effects.length < MAX_EFFECTS) effects.push({ kind: 'ghost', x: actor.x, y: actor.y,
            type: actor.type, boss: actor.boss, age: 0, life: 0.24 });
        }
        actors.delete(key);
      }
      previousPhase = `${game.phase}:${game.phaseStatus}`;
    },
    pose(key) {
      const a = actors.get(key);
      if (!a) return { x: 0, y: 0, rotation: 0, sx: 1, sy: 1, alpha: 1, flash: 0 };
      const down = reduced ? Number(!a.alive) : a.down;
      if (reduced) return { x: 0, y: 0, rotation: 0, sx: 1, sy: 1, alpha: down ? 0.28 : 1, flash: 0 };
      const step = Math.sin(a.stride + a.seed) * a.walking * (1 - down);
      const breath = Math.sin(time * 2.8 + a.seed) * (1 - down);
      const floating = ['wraith', 'eye', 'bat', 'lich'].includes(a.type);
      const bounce = floating ? Math.sin(time * 3.5 + a.seed) * 4 : -Math.abs(step) * (a.boss ? 2 : 3.5);
      return {
        x: -Math.cos(a.castAngle || 0) * a.cast * 3,
        y: bounce + breath * 0.7 + down * 12,
        rotation: step * (a.boss ? 0.015 : 0.045) + a.dx * a.walking * 0.025 + down * 0.65 - a.cast * 0.07,
        sx: 1 + breath * 0.015 + Math.abs(step) * 0.025 + a.cast * 0.06,
        sy: 1 - breath * 0.015 - Math.abs(step) * 0.035 - down * 0.18,
        alpha: 1 - down * 0.72, flash: a.hit
      };
    },
    get time() { return time; },
    get effects() { return effects; },
    get actorCount() { return actors.size; }
  };
}

export function drawEffects(ctx, animator, drawGhost, visible) {
  for (const fx of animator.effects) {
    if (!visible(fx.x, fx.y)) continue;
    const progress = fx.age / fx.life;
    ctx.save();
    ctx.globalAlpha = 1 - progress;
    ctx.strokeStyle = fx.color; ctx.fillStyle = fx.color; ctx.lineWidth = 2;
    if (fx.kind === 'ring') {
      ctx.beginPath(); ctx.arc(fx.x, fx.y, 5 + progress * fx.radius, 0, TAU); ctx.stroke();
    } else if (fx.kind === 'spark') {
      ctx.fillRect(fx.x + fx.vx * fx.age, fx.y + fx.vy * fx.age + 35 * fx.age ** 2, 3, 3);
    } else drawGhost(fx, progress);
    ctx.restore();
  }
}
