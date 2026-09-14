// Visual state only: never modifies the authoritative game or collision positions.
export const MAX_EFFECTS = 128;
export const MAX_NUMBERS = 60;
const TAU = Math.PI * 2;
const colors = ['#76dfff', '#ff9955', '#92ed68', '#c4a0ff'];
const EVENT_COLORS = { boom: '#ffb36b', elite: '#ffd36b', chest: '#ffe08a', magnet: '#8fd8ff', revive: '#9dffca', phoenix: '#ffb35c' };

/** @param {{ onHit?: (entity: any, amount: number) => void, onKill?: (actor: any) => void }} [hooks] */
export function createAnimator({ onHit, onKill } = {}) {
  const actors = new Map();
  const effects = [];
  const numbers = [];
  let time = 0;
  let previousPhase;
  let reduced = false;
  let shake = 0;
  let freezeFor = 0;
  let lastEventId = null;

  function trim() {
    if (effects.length > MAX_EFFECTS) effects.splice(0, effects.length - MAX_EFFECTS);
  }

  function burst(x, y, color, count = 7, radius = 32) {
    if (reduced) return;
    effects.push({ kind: 'ring', x, y, color, age: 0, life: 0.45, radius });
    for (let i = 0; i < count; i++) {
      const angle = TAU * i / count;
      effects.push({ kind: 'spark', x, y, color, age: 0, life: 0.3 + i % 3 * 0.1,
        vx: Math.cos(angle) * (35 + i % 3 * 18), vy: Math.sin(angle) * 65 - 18 });
    }
    trim();
  }

  function addNumber(actor, x, y, amount) {
    const recent = actor.number;
    if (recent && recent.age < 0.18 && numbers.includes(recent)) {
      recent.value += amount; recent.age = Math.min(recent.age, 0.08); recent.x = x; recent.y = y;
      return;
    }
    const number = { x: x + (Math.random() - 0.5) * 14, y, value: amount, age: 0, life: 0.75, boss: actor.boss };
    actor.number = number;
    numbers.push(number);
    if (numbers.length > MAX_NUMBERS) numbers.splice(0, numbers.length - MAX_NUMBERS);
  }

  function handleEvent(event) {
    if (event.kind === 'chain' && !reduced) {
      effects.push({ kind: 'chain', points: event.points, color: colors[event.color] || '#bfe8ff', age: 0, life: 0.28, seed: event.id });
    } else if (event.kind === 'boom') {
      burst(event.x, event.y, event.color >= 0 ? colors[event.color] : EVENT_COLORS.boom, 12, event.r || 70);
      shake = Math.max(shake, 3);
    } else if (event.kind === 'stage') {
      burst(event.x, event.y, '#ff8a7a', 18, 260);
      shake = Math.max(shake, 10);
    } else if (event.kind === 'bossDown') {
      shake = Math.max(shake, 18);
      freezeFor = 0.22;
    } else if (event.kind === 'special') {
      burst(event.x, event.y, colors[event.color], 16, 120);
      shake = Math.max(shake, 5);
    } else if (EVENT_COLORS[event.kind] && event.x !== undefined) {
      burst(event.x, event.y, EVENT_COLORS[event.kind], event.kind === 'magnet' ? 20 : 12, event.kind === 'magnet' ? 220 : 80);
    }
    trim();
  }

  return {
    reset() {
      actors.clear(); effects.length = 0; numbers.length = 0; time = 0; previousPhase = undefined;
      shake = 0; freezeFor = 0; lastEventId = null;
    },
    update(game, dt, options = {}) {
      reduced = Boolean(options.reduced);
      if (reduced) { effects.length = 0; shake = 0; }
      if (options.paused) return;
      dt = Math.max(0, Math.min(dt, 0.05));
      if (freezeFor > 0) { freezeFor -= dt; return; }
      time += dt;
      shake = Math.max(0, shake - dt * 28);
      for (let i = effects.length - 1; i >= 0; i--) {
        effects[i].age += dt;
        if (effects[i].age >= effects[i].life) effects.splice(i, 1);
      }
      for (let i = numbers.length - 1; i >= 0; i--) {
        numbers[i].age += dt;
        if (numbers[i].age >= numbers[i].life) numbers.splice(i, 1);
      }
      const events = game.events || [];
      if (lastEventId === null) lastEventId = events.reduce((max, event) => Math.max(max, event.id), 0);
      for (const event of events) if (event.id > lastEventId) { lastEventId = event.id; handleEvent(event); }

      const seen = new Set();
      const track = (entity, key, player) => {
        seen.add(key);
        const old = actors.get(key);
        const alive = player ? entity.alive !== false : entity.hp > 0;
        const color = player ? colors[entity.color ?? 0] : entity.elite ? '#ffd36b' : '#ffbc86';
        if (!old) {
          actors.set(key, { x: entity.x, y: entity.y, hp: entity.hp, alive, type: entity.type,
            boss: entity.boss, elite: entity.elite, color, seed: actors.size * 2.39, movedAt: -10, dx: 0,
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
          if (!player) {
            addNumber(old, entity.x, entity.y - (entity.boss ? 70 : 26), old.hp - Math.max(0, entity.hp));
            onHit?.(entity, old.hp - entity.hp);
          }
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
            type: actor.type, boss: actor.boss, elite: actor.elite, age: 0, life: 0.24 });
          onKill?.(actor);
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
    shake(amount) { if (!reduced) shake = Math.max(shake, amount); },
    get shakeOffset() {
      if (!shake) return { x: 0, y: 0 };
      return { x: Math.sin(time * 91) * shake, y: Math.cos(time * 67) * shake };
    },
    get time() { return time; },
    get effects() { return effects; },
    get numbers() { return numbers; },
    get actorCount() { return actors.size; }
  };
}

function jagged(ctx, points, seed, progress) {
  ctx.beginPath();
  ctx.moveTo(points[0], points[1]);
  for (let i = 2; i < points.length; i += 2) {
    const x0 = points[i - 2], y0 = points[i - 1], x1 = points[i], y1 = points[i + 1];
    const nx = -(y1 - y0), ny = x1 - x0, length = Math.hypot(nx, ny) || 1;
    for (let k = 1; k <= 3; k++) {
      const t = k / 4, wobble = Math.sin(seed * 12.9898 + i * 78.233 + k * 3.1 + progress * 20) * 12;
      ctx.lineTo(x0 + (x1 - x0) * t + nx / length * wobble, y0 + (y1 - y0) * t + ny / length * wobble);
    }
    ctx.lineTo(x1, y1);
  }
  ctx.stroke();
}

export function drawEffects(ctx, animator, drawGhost, visible) {
  for (const fx of animator.effects) {
    if (fx.kind !== 'chain' && !visible(fx.x, fx.y)) continue;
    const progress = fx.age / fx.life;
    ctx.save();
    ctx.globalAlpha = 1 - progress;
    ctx.strokeStyle = fx.color; ctx.fillStyle = fx.color; ctx.lineWidth = 2;
    if (fx.kind === 'ring') {
      ctx.beginPath(); ctx.arc(fx.x, fx.y, 5 + progress * fx.radius, 0, TAU); ctx.stroke();
    } else if (fx.kind === 'spark') {
      ctx.fillRect(fx.x + fx.vx * fx.age, fx.y + fx.vy * fx.age + 35 * fx.age ** 2, 3, 3);
    } else if (fx.kind === 'chain') {
      ctx.lineWidth = 5; ctx.globalAlpha = (1 - progress) * 0.35; jagged(ctx, fx.points, fx.seed, progress);
      ctx.lineWidth = 2; ctx.globalAlpha = 1 - progress; ctx.strokeStyle = '#f4fbff'; jagged(ctx, fx.points, fx.seed, progress);
    } else drawGhost(fx, progress);
    ctx.restore();
  }
}

export function drawNumbers(ctx, animator, visible, reduced) {
  ctx.textAlign = 'center';
  for (const number of animator.numbers) {
    if (!visible(number.x, number.y)) continue;
    const progress = number.age / number.life;
    const rise = reduced ? 0 : progress * 26;
    const big = number.value >= 60 || number.boss;
    ctx.globalAlpha = Math.min(1, (1 - progress) * 1.6);
    ctx.font = `800 ${big ? 17 : 12}px Inter, system-ui, sans-serif`;
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(8, 10, 16, .85)';
    const text = String(Math.round(number.value));
    ctx.strokeText(text, number.x, number.y - rise);
    ctx.fillStyle = big ? '#ffd36b' : '#fff3e6';
    ctx.fillText(text, number.x, number.y - rise);
  }
  ctx.globalAlpha = 1;
}
