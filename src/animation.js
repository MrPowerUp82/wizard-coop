import { drawSoftGlow } from './glow.js';
// Visual state only: never modifies the authoritative game or collision positions.
export const MAX_EFFECTS = 128;
export const MAX_NUMBERS = 60;
const TAU = Math.PI * 2;
const colors = ['#76dfff', '#ff9955', '#92ed68', '#c4a0ff'];
const SIGNAL_ICONS = { here: '⚑', help: '✚', danger: '⚠', look: '◉' };
const EVENT_COLORS = { boom: '#ffb36b', elite: '#ffd36b', chest: '#ffe08a', magnet: '#8fd8ff', revive: '#9dffca', phoenix: '#ffb35c' };
const FLOATING_TYPES = new Set(['wraith', 'eye', 'bat', 'lich', 'revenant', 'seer', 'voidling', 'archon']);

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
  let updateStamp = 0;
  const emptyPose = Object.freeze({ x: 0, y: 0, rotation: 0, sx: 1, sy: 1, alpha: 1, flash: 0 });
  const shakeResult = { x: 0, y: 0 };
  const flashResult = { color: '#ffffff', alpha: 0 };
  const signalScratch = [];

  let flash = null;

  function trim() {
    // Signature spell visuals are few and long-lived; drop the oldest sparks before them.
    while (effects.length > MAX_EFFECTS) {
      const index = effects.findIndex(fx => !fx.major);
      effects.splice(index < 0 ? 0 : index, 1);
    }
  }

  function motes(x, y, shape, color, count, { speed = 120, spread = 0, life = 0.8, gravity = 0, size = 4, drag = 2 } = {}) {
    for (let i = 0; i < count; i++) {
      const angle = TAU * (i + Math.random() * 0.6) / count;
      const velocity = speed * (0.45 + Math.random() * 0.75);
      const offset = spread * Math.random();
      effects.push({ kind: 'mote', shape, x: x + Math.cos(angle) * offset, y: y + Math.sin(angle) * offset,
        vx: Math.cos(angle) * velocity, vy: Math.sin(angle) * velocity, gravity, drag, color, size: size * (0.6 + Math.random() * 0.8),
        spin: (Math.random() - 0.5) * 8, age: 0, life: life * (0.7 + Math.random() * 0.3) });
    }
  }

  /** Alternative specials ("Segundo feitiço"); the damage zones themselves are drawn by the renderer. */
  function altSpecial(event, seed) {
    if (event.color === 0) {
      effects.push({ kind: 'nova', x: event.x, y: event.y, age: 0, life: 0.6, radius: 230, seed, major: true });
      motes(event.x, event.y, 'flake', '#e8fbff', 18, { speed: 160, spread: 120, life: 1.4, size: 6, gravity: 60, drag: 1.2 });
      flash = { color: '#bdf3ff', alpha: 0.18, life: 0.3, age: 0 };
    } else if (event.color === 1) {
      effects.push({ kind: 'impact', x: event.x, y: event.y, age: 0, life: 0.5, radius: 125, major: true });
      motes(event.x, event.y, 'ember', '#ffb347', 22, { speed: 220, spread: 40, life: 0.9, size: 5, gravity: -80 });
      flash = { color: '#ffb36b', alpha: 0.16, life: 0.25, age: 0 };
    } else if (event.color === 2) {
      effects.push({ kind: 'bloom', x: event.x, y: event.y, age: 0, life: 1.1, radius: 320, seed, major: true });
      motes(event.x, event.y, 'leaf', '#b8f57f', 16, { speed: 240, life: 1, size: 7, gravity: 30 });
      motes(event.x, event.y, 'heal', '#9dffca', 14, { speed: 90, spread: 90, life: 1.2, size: 7, gravity: -70 });
      flash = { color: '#9dffca', alpha: 0.18, life: 0.35, age: 0 };
    } else {
      const x = event.tx ?? event.x, y = event.ty ?? event.y;
      effects.push({ kind: 'implode', x, y, age: 0, life: 0.7, radius: 230, major: true });
      motes(x, y, 'star', '#f1e6ff', 14, { speed: -160, spread: 200, life: 0.8, size: 5 });
      flash = { color: '#cdb4ff', alpha: 0.14, life: 0.25, age: 0 };
    }
    shake = Math.max(shake, 5);
  }

  /** Each character's special gets its own layered effect: a shape, particles and a brief screen tint. */
  function special(event) {
    const seed = event.id * 7.31;
    if (event.variant === 1) return altSpecial(event, seed);
    if (event.color === 0) {
      effects.push({ kind: 'nova', x: event.x, y: event.y, age: 0, life: 0.9, radius: 280, seed, major: true });
      motes(event.x, event.y, 'flake', '#e8fbff', 26, { speed: 330, life: 1, size: 7, drag: 2.6 });
      flash = { color: '#bdf3ff', alpha: 0.28, life: 0.35, age: 0 };
      shake = Math.max(shake, 7);
    } else if (event.color === 1) {
      effects.push({ kind: 'meteor', x: event.tx ?? event.x, y: event.ty ?? event.y, age: 0, life: event.delay || 0.6, major: true });
      motes(event.x, event.y, 'ember', '#ffcf6b', 10, { speed: 90, life: 0.6, size: 4, gravity: -60 });
      shake = Math.max(shake, 3);
    } else if (event.color === 2) {
      effects.push({ kind: 'thorns', x: event.x, y: event.y, age: 0, life: 1.1, radius: 190, seed, major: true });
      motes(event.x, event.y, 'leaf', '#b8f57f', 18, { speed: 210, spread: 40, life: 1.1, size: 7, gravity: 40, drag: 1.8 });
      flash = { color: '#9cf58a', alpha: 0.16, life: 0.3, age: 0 };
      shake = Math.max(shake, 5);
    } else {
      const fromX = event.fx ?? event.x, fromY = event.fy ?? event.y;
      effects.push({ kind: 'lunar', x: event.x, y: event.y, fromX, fromY, age: 0, life: 0.75, major: true });
      motes((fromX + event.x) / 2, (fromY + event.y) / 2, 'star', '#f1e6ff', 16, { speed: 140, spread: 80, life: 0.9, size: 6 });
      flash = { color: '#cdb4ff', alpha: 0.2, life: 0.3, age: 0 };
      shake = Math.max(shake, 5);
    }
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
    if (event.kind === 'combo') {
      burst(event.x, event.y, '#ffe49b', 8, 90);
      if (event.team) burst(event.x, event.y, colors[event.helper] || '#ffffff', 10, 120);
      if (!reduced) effects.push({ kind: 'combo', x: event.x, y: event.y, color: event.team ? '#ffffff' : '#ffe49b', age: 0, life: event.team ? 1.1 : 0.8,
        text: `${event.reaction === 'thermal' ? 'CHOQUE TÉRMICO' : event.reaction === 'conduction' ? 'CONDUÇÃO' : 'ECLIPSE'}${event.team ? ' · EM EQUIPE' : ''}` });
    } else if (event.kind === 'convergence' && !reduced) {
      effects.push({ kind: 'convergence', x: event.x, y: event.y, radius: event.r || 320, colors: (event.colors || [0, 1]).map(c => colors[c]),
        age: 0, life: 1, major: true });
      motes(event.x, event.y, 'star', '#ffffff', 24, { speed: 380, life: 1, size: 7, drag: 2.2 });
      flash = { color: '#ffffff', alpha: 0.35, life: 0.4, age: 0 };
      shake = Math.max(shake, 16);
    } else if (event.kind === 'signal') {
      // Signals stay visible even with reduced motion: they carry information, not decoration.
      effects.push({ kind: 'signal', x: event.x, y: event.y, color: colors[event.color] || '#ffffff', name: event.name || '',
        icon: SIGNAL_ICONS[event.signal] || '⚑', age: 0, life: 3, major: true });
    } else if (event.kind === 'thiefDown' && !reduced) {
      motes(event.x, event.y, 'ember', '#ffd36b', 20, { speed: 260, life: 0.9, size: 5, gravity: 120 });
      burst(event.x, event.y, '#ffd36b', 14, 110);
    } else if ((event.kind === 'encounter' || event.kind === 'shrineAccepted') && event.x !== undefined) {
      burst(event.x, event.y, event.kind === 'shrineAccepted' ? '#ff7aa8' : '#ffd36b', 16, 140);
    } else if (event.kind === 'loop' && !reduced) {
      flash = { color: '#ffd36b', alpha: 0.25, life: 0.6, age: 0 };
      shake = Math.max(shake, 10);
    } else if (event.kind === 'evade') {
      burst(event.x, event.y, colors[event.color], 5, 50);
    } else if (event.kind === 'chain' && !reduced) {
      effects.push({ kind: 'chain', points: event.points, color: colors[event.color] || '#bfe8ff', age: 0, life: 0.28, seed: event.id });
    } else if (event.kind === 'familiar' && !reduced) {
      effects.push({ kind: 'familiar', x: event.x, y: event.y, points: event.points, color: colors[event.color] || '#ffffff',
        evolved: event.evolved, age: 0, life: 0.32, seed: event.id });
      for (let i = 0; i < event.points.length; i += 2) burst(event.points[i], event.points[i + 1], colors[event.color], 4, 26);
    } else if (event.kind === 'boom' && event.color === 1 && event.r >= 150 && !reduced) {
      // Meteor impact: a heavier shockwave than an ordinary rune explosion.
      effects.push({ kind: 'impact', x: event.x, y: event.y, age: 0, life: 0.7, radius: event.r, major: true });
      motes(event.x, event.y, 'ember', '#ffb347', 28, { speed: 360, spread: 30, life: 1.1, size: 6, gravity: -90, drag: 2.4 });
      motes(event.x, event.y, 'smoke', 'rgba(70, 45, 40, .5)', 8, { speed: 70, spread: 50, life: 1.2, size: 26, gravity: -30 });
      flash = { color: '#ffb36b', alpha: 0.32, life: 0.35, age: 0 };
      shake = Math.max(shake, 14);
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
      if (!reduced) special(event);
    } else if (EVENT_COLORS[event.kind] && event.x !== undefined) {
      burst(event.x, event.y, EVENT_COLORS[event.kind], event.kind === 'magnet' ? 20 : 12, event.kind === 'magnet' ? 220 : 80);
    }
    trim();
  }

  return {
    reset() {
      actors.clear(); effects.length = 0; numbers.length = 0; time = 0; previousPhase = undefined;
      shake = 0; freezeFor = 0; lastEventId = null; flash = null;
    },
    update(game, dt, options = {}) {
      reduced = Boolean(options.reduced);
      if (reduced) { for (let i = effects.length - 1; i >= 0; i--) if (effects[i].kind !== 'signal') effects.splice(i, 1); shake = 0; flash = null; freezeFor = 0; }
      if (options.paused) return;
      dt = Math.max(0, Math.min(dt, 0.05));
      if (freezeFor > 0) { freezeFor -= dt; return; }
      time += dt;
      shake = Math.max(0, shake - dt * 28);
      if (flash && (flash.age += dt) >= flash.life) flash = null;
      for (let i = effects.length - 1; i >= 0; i--) {
        const fx = effects[i];
        fx.age += dt;
        if (fx.age >= fx.life) { effects.splice(i, 1); continue; }
        if (fx.kind === 'mote') {
          const damping = Math.exp(-fx.drag * dt);
          fx.vx *= damping; fx.vy = fx.vy * damping + fx.gravity * dt;
          fx.x += fx.vx * dt; fx.y += fx.vy * dt;
        }
      }
      for (let i = numbers.length - 1; i >= 0; i--) {
        numbers[i].age += dt;
        if (numbers[i].age >= numbers[i].life) numbers.splice(i, 1);
      }
      const events = game.events || [];
      if (lastEventId === null) lastEventId = events.reduce((max, event) => Math.max(max, event.id), 0);
      for (const event of events) if (event.id > lastEventId) { lastEventId = event.id; handleEvent(event); }

      // Stamp actors instead of allocating a Set every frame just to discover removals.
      const stamp = ++updateStamp;
      const track = (entity, key, player) => {
        const old = actors.get(key);
        const alive = player ? entity.alive !== false : entity.hp > 0;
        const color = player ? colors[entity.color ?? 0] : entity.elite ? '#ffd36b' : '#ffbc86';
        if (!old) {
          actors.set(key, { x: entity.x, y: entity.y, hp: entity.hp, alive, type: entity.type,
            boss: entity.boss, elite: entity.elite, color, seed: actors.size * 2.39, movedAt: -10, dx: 0,
            stride: 0, walking: 0, hit: 0, cast: 0, down: alive ? 0 : 1, facing: 1,
            castCount: entity.castCount || 0, charge: entity.specialCharge || 0, level: entity.level,
            bossCooldown: entity.attackCooldown, rangedCooldown: entity.rangedCooldown,
            dashFor: entity.dashFor || 0, trailAt: -1, seen: stamp, poseStamp: -1,
            pose: { x: 0, y: 0, rotation: 0, sx: 1, sy: 1, alpha: 1, flash: 0 } });
          return;
        }
        const distance = Math.hypot(entity.x - old.x, entity.y - old.y);
        // Space stamps along real movement, including the last dash snapshot. Never bridge teleports.
        if (player && alive && !game.over && !reduced && distance > 0.5 && distance < 220
          && (entity.dashFor > 0 || old.dashFor > 0) && time - old.trailAt >= 0.025
          && previousPhase === `${game.phase}:${game.phaseStatus}`) {
          const count = Math.min(4, Math.max(1, Math.ceil(distance / 18)));
          for (let i = 0; i < count; i++) {
            const t = i / count;
            effects.push({ kind: 'afterimage', x: old.x + (entity.x - old.x) * t, y: old.y + (entity.y - old.y) * t,
              color, character: entity.color ?? 0, facing: old.facing, age: 0, life: 0.24 });
          }
          old.trailAt = time;
        }
        if (distance > 0.1 && alive && !game.over) {
          old.movedAt = time; old.dx = Math.sign(entity.x - old.x);
          // Keep the last horizontal direction when stationary or moving vertically.
          // Position deltas work for both local simulation and remote snapshots.
          if (player && Math.abs(entity.x - old.x) > 0.1) old.facing = Math.sign(entity.x - old.x);
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
          burst(entity.x + (player ? 17 * old.facing : 0), entity.y - (player ? 12 : 0), color, 3, entity.boss ? 75 : 20);
          if (player && !reduced) effects.push({ kind: 'sigil', x: entity.x, y: entity.y + 22, color,
            age: 0, life: 0.32, radius: 31, seed: entity.castAngle || 0 });
        }
        if (player && (entity.specialCharge < old.charge || entity.level > old.level)) burst(entity.x, entity.y, color, 12, 95);
        if (player && entity.level > old.level && !reduced) {
          effects.push({ kind: 'ascend', x: entity.x, y: entity.y, color: '#ffe49b', age: 0, life: 1.15, radius: 85, major: true });
          motes(entity.x, entity.y, 'star', '#ffe49b', 12, { speed: 70, spread: 45, gravity: -100, life: 1.1, size: 5 });
        }
        // Direct assignment avoids one short-lived object per tracked entity per frame.
        old.x = entity.x; old.y = entity.y; old.hp = entity.hp; old.alive = alive;
        old.castCount = entity.castCount || 0; old.charge = entity.specialCharge || 0; old.level = entity.level;
        old.bossCooldown = entity.attackCooldown; old.rangedCooldown = entity.rangedCooldown;
        old.dashFor = entity.dashFor || 0; old.seen = stamp;
      };
      for (const id in game.players) { const p = game.players[id]; track(p, `p:${p.id}`, true); }
      for (const enemy of game.enemies) track(enemy, `e:${enemy.id}`, false);
      for (const [key, actor] of actors) if (actor.seen !== stamp) {
        let nearPlayer = false;
        if (!reduced && key.startsWith('e:') && previousPhase === `${game.phase}:${game.phaseStatus}`) {
          for (const id in game.players) {
            const p = game.players[id], dx = p.x - actor.x, dy = p.y - actor.y;
            if (dx * dx + dy * dy < 1000000) { nearPlayer = true; break; }
          }
        }
        if (nearPlayer) {
          burst(actor.x, actor.y, actor.color, 5, 30);
          if (effects.length < MAX_EFFECTS) effects.push({ kind: 'ghost', x: actor.x, y: actor.y,
            type: actor.type, boss: actor.boss, elite: actor.elite, age: 0, life: 0.24 });
          onKill?.(actor);
        }
        actors.delete(key);
      }
      trim();
      previousPhase = `${game.phase}:${game.phaseStatus}`;
    },
    pose(key) {
      const a = actors.get(key);
      if (!a) return emptyPose;
      // Split-screen may ask for the same enemy pose in both viewports. Cache the trigonometry once
      // per simulation/animation update instead of recomputing it once per camera.
      if (a.poseStamp === updateStamp) return a.pose;
      const out = a.pose;
      const down = reduced ? Number(!a.alive) : a.down;
      if (reduced) {
        out.x = 0; out.y = 0; out.rotation = 0; out.sx = a.facing; out.sy = 1; out.alpha = down ? 0.28 : 1; out.flash = 0;
      } else {
        const step = Math.sin(a.stride + a.seed) * a.walking * (1 - down);
        const breath = Math.sin(time * 2.8 + a.seed) * (1 - down);
        const floating = FLOATING_TYPES.has(a.type);
        const bounce = floating ? Math.sin(time * 3.5 + a.seed) * 4 : -Math.abs(step) * (a.boss ? 2 : 3.5);
        out.x = -Math.cos(a.castAngle || 0) * a.cast * 3;
        out.y = bounce + breath * 0.7 + down * 12;
        out.rotation = step * (a.boss ? 0.015 : 0.045) + a.dx * a.walking * 0.025 + down * 0.65 - a.cast * 0.07;
        out.sx = a.facing * (1 + breath * 0.015 + Math.abs(step) * 0.025 + a.cast * 0.06 + a.hit * 0.1);
        out.sy = 1 - breath * 0.015 - Math.abs(step) * 0.035 - down * 0.18 - a.hit * 0.08;
        out.alpha = 1 - down * 0.72; out.flash = a.hit;
      }
      a.poseStamp = updateStamp;
      return out;
    },
    shake(amount) { if (!reduced) shake = Math.max(shake, amount); },
    get shakeOffset() {
      if (reduced || !shake) { shakeResult.x = 0; shakeResult.y = 0; }
      else { shakeResult.x = Math.sin(time * 91) * shake; shakeResult.y = Math.cos(time * 67) * shake; }
      return shakeResult;
    },
    /** Full-screen tint that fades out after big spells, or null. */
    /** Active teammate signals, for off-screen arrows. */
    get signals() {
      signalScratch.length = 0;
      for (const fx of effects) if (fx.kind === 'signal') signalScratch.push(fx);
      return signalScratch;
    },
    get flash() {
      if (!flash) return null;
      flashResult.color = flash.color; flashResult.alpha = flash.alpha * (1 - flash.age / flash.life); return flashResult;
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

const easeOut = t => 1 - (1 - t) ** 3;

function glow(ctx, x, y, radius, color, alpha) {
  drawSoftGlow(ctx, x, y, radius, color, alpha);
}

function drawMote(ctx, fx, progress) {
  const fade = 1 - progress, r = fx.size;
  ctx.translate(fx.x, fx.y); ctx.rotate(fx.spin * fx.age);
  ctx.globalAlpha = fade; ctx.fillStyle = fx.color; ctx.strokeStyle = fx.color;
  if (fx.shape === 'flake') {
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let n = 0; n < 3; n++) { const a = n * Math.PI / 3; ctx.moveTo(-Math.cos(a) * r, -Math.sin(a) * r); ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
    ctx.stroke();
  } else if (fx.shape === 'ember') {
    ctx.globalCompositeOperation = 'lighter';
    glow(ctx, 0, 0, r * 2.4, fx.color, fade * 0.7);
    ctx.globalAlpha = fade; ctx.fillStyle = '#fff1c4'; ctx.beginPath(); ctx.arc(0, 0, r * 0.45 * fade + 0.8, 0, TAU); ctx.fill();
  } else if (fx.shape === 'leaf') {
    ctx.beginPath(); ctx.ellipse(0, 0, r, r * 0.42, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(40, 90, 40, .6)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-r, 0); ctx.lineTo(r, 0); ctx.stroke();
  } else if (fx.shape === 'star') {
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = fade * (0.6 + Math.abs(Math.sin(fx.age * 18 + fx.size)) * 0.4);
    ctx.beginPath();
    for (let n = 0; n < 8; n++) { const a = n * Math.PI / 4, d = n % 2 ? r * 0.28 : r; ctx[n ? 'lineTo' : 'moveTo'](Math.cos(a) * d, Math.sin(a) * d); }
    ctx.closePath(); ctx.fill();
  } else if (fx.shape === 'heal') {
    ctx.fillRect(-r / 2, -r / 6, r, r / 3); ctx.fillRect(-r / 6, -r / 2, r / 3, r);
  } else {
    ctx.globalAlpha = fade * 0.5; ctx.beginPath(); ctx.arc(0, 0, r * (0.6 + progress * 0.8), 0, TAU); ctx.fill();
  }
}

function drawNova(ctx, fx, progress) {
  const radius = fx.radius * easeOut(Math.min(1, progress * 1.6));
  const fade = 1 - progress;
  ctx.globalCompositeOperation = 'lighter';
  const gradient = ctx.createRadialGradient(fx.x, fx.y, radius * 0.55, fx.x, fx.y, Math.max(1, radius));
  gradient.addColorStop(0, 'rgba(118,223,255,0)'); gradient.addColorStop(0.85, 'rgba(160,236,255,.35)'); gradient.addColorStop(1, 'rgba(230,250,255,0)');
  ctx.globalAlpha = fade; ctx.fillStyle = gradient; ctx.beginPath(); ctx.arc(fx.x, fx.y, radius, 0, TAU); ctx.fill();
  ctx.strokeStyle = '#e8fbff'; ctx.lineWidth = 3 * fade + 1; ctx.beginPath(); ctx.arc(fx.x, fx.y, radius, 0, TAU); ctx.stroke();
  // Ice crystals ride the shockwave along twelve spokes.
  for (let n = 0; n < 12; n++) {
    const a = n * TAU / 12 + fx.seed;
    const reach = radius * (0.72 + (n % 3) * 0.1), length = 26 + (n % 4) * 8;
    ctx.save(); ctx.translate(fx.x + Math.cos(a) * reach, fx.y + Math.sin(a) * reach); ctx.rotate(a);
    ctx.globalAlpha = fade * 0.9; ctx.fillStyle = n % 2 ? '#bff4ff' : '#76dfff';
    ctx.beginPath(); ctx.moveTo(length, 0); ctx.lineTo(0, -6); ctx.lineTo(-length * 0.4, 0); ctx.lineTo(0, 6); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  glow(ctx, fx.x, fx.y, 90 * (1 - progress * 0.5), '#e8fbff', fade * 0.8);
}

function drawMeteor(ctx, fx, progress) {
  const t = progress ** 2;
  const startX = fx.x + 260, startY = fx.y - 520;
  const x = startX + (fx.x - startX) * t, y = startY + (fx.y - startY) * t;
  // The target reticle tightens as the rock falls.
  ctx.strokeStyle = '#ffd36b'; ctx.lineWidth = 2; ctx.globalAlpha = 0.5 + progress * 0.5;
  ctx.setLineDash([14, 10]); ctx.lineDashOffset = -progress * 60;
  ctx.beginPath(); ctx.arc(fx.x, fx.y, 165 * (1.25 - progress * 0.25), 0, TAU); ctx.stroke(); ctx.setLineDash([]);
  ctx.beginPath(); ctx.arc(fx.x, fx.y, 18 + (1 - progress) * 30, 0, TAU); ctx.stroke();
  ctx.globalCompositeOperation = 'lighter';
  const dx = fx.x - startX, dy = fx.y - startY, length = Math.hypot(dx, dy);
  const tailX = x - dx / length * 220, tailY = y - dy / length * 220;
  const trail = ctx.createLinearGradient(x, y, tailX, tailY);
  trail.addColorStop(0, 'rgba(255,200,110,.95)'); trail.addColorStop(0.4, 'rgba(255,110,40,.55)'); trail.addColorStop(1, 'rgba(255,60,20,0)');
  ctx.globalAlpha = 1; ctx.strokeStyle = trail; ctx.lineCap = 'round'; ctx.lineWidth = 26;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(tailX, tailY); ctx.stroke();
  glow(ctx, x, y, 60, '#ff9955', 0.9);
  ctx.globalAlpha = 1; ctx.fillStyle = '#fff1c4'; ctx.beginPath(); ctx.arc(x, y, 15, 0, TAU); ctx.fill();
}

function drawImpact(ctx, fx, progress) {
  const fade = 1 - progress;
  ctx.globalCompositeOperation = 'lighter';
  glow(ctx, fx.x, fx.y, fx.radius * (0.6 + progress * 0.6), '#ffb347', fade * 0.9);
  ctx.strokeStyle = '#ffe1a0'; ctx.globalAlpha = fade;
  for (let n = 0; n < 2; n++) {
    ctx.lineWidth = (8 - n * 4) * fade + 1;
    ctx.beginPath(); ctx.arc(fx.x, fx.y, fx.radius * easeOut(Math.min(1, progress * (1.8 - n * 0.5))) * (1.1 - n * 0.3), 0, TAU); ctx.stroke();
  }
}

function drawThorns(ctx, fx, progress) {
  const grow = easeOut(Math.min(1, progress * 2.5));
  const fade = progress > 0.7 ? 1 - (progress - 0.7) / 0.3 : 1;
  const gradient = ctx.createRadialGradient(fx.x, fx.y, 10, fx.x, fx.y, Math.max(11, fx.radius * grow));
  gradient.addColorStop(0, 'rgba(209,255,147,.35)'); gradient.addColorStop(1, 'rgba(60,160,70,0)');
  ctx.globalAlpha = fade; ctx.fillStyle = gradient; ctx.beginPath(); ctx.arc(fx.x, fx.y, fx.radius * grow, 0, TAU); ctx.fill();
  ctx.lineCap = 'round';
  for (let n = 0; n < 14; n++) {
    const a = n * TAU / 14 + fx.seed;
    const bend = (n % 2 ? 1 : -1) * 0.5;
    const reach = fx.radius * grow * (0.7 + (n * 37 % 10) / 33);
    const cx = fx.x + Math.cos(a + bend) * reach * 0.5, cy = fx.y + Math.sin(a + bend) * reach * 0.5;
    const ex = fx.x + Math.cos(a) * reach, ey = fx.y + Math.sin(a) * reach;
    ctx.strokeStyle = '#2f7a3a'; ctx.lineWidth = 7;
    ctx.beginPath(); ctx.moveTo(fx.x, fx.y); ctx.quadraticCurveTo(cx, cy, ex, ey); ctx.stroke();
    ctx.strokeStyle = '#92ed68'; ctx.lineWidth = 3; ctx.stroke();
    ctx.fillStyle = '#d1ff93';
    for (let k = 1; k <= 3; k++) {
      const t = k / 4, u = 1 - t;
      const px = u * u * fx.x + 2 * u * t * cx + t * t * ex, py = u * u * fx.y + 2 * u * t * cy + t * t * ey;
      const side = a + (k % 2 ? 1 : -1) * Math.PI / 2;
      ctx.beginPath(); ctx.moveTo(px + Math.cos(a) * 4, py + Math.sin(a) * 4); ctx.lineTo(px + Math.cos(side) * 9, py + Math.sin(side) * 9);
      ctx.lineTo(px - Math.cos(a) * 4, py - Math.sin(a) * 4); ctx.fill();
    }
    ctx.fillStyle = '#f0ffd2';
    ctx.beginPath(); ctx.moveTo(ex + Math.cos(a) * 16, ey + Math.sin(a) * 16);
    ctx.lineTo(ex + Math.cos(a + 1.3) * 6, ey + Math.sin(a + 1.3) * 6); ctx.lineTo(ex + Math.cos(a - 1.3) * 6, ey + Math.sin(a - 1.3) * 6); ctx.fill();
  }
}

function crescent(ctx, x, y, radius, angle) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(angle);
  ctx.beginPath(); ctx.arc(0, 0, radius, -Math.PI * 0.75, Math.PI * 0.75);
  ctx.arc(radius * 0.45, 0, radius * 0.8, Math.PI * 0.62, -Math.PI * 0.62, true);
  ctx.closePath(); ctx.fill(); ctx.restore();
}

function drawLunar(ctx, fx, progress) {
  const fade = 1 - progress;
  const angle = Math.atan2(fx.y - fx.fromY, fx.x - fx.fromX);
  ctx.globalCompositeOperation = 'lighter';
  // Afterimages trace the dash from where the mage left to where they landed.
  for (let n = 0; n < 5; n++) {
    const t = n / 4;
    ctx.globalAlpha = fade * (0.2 + t * 0.5); ctx.fillStyle = n === 4 ? '#f1e6ff' : '#c4a0ff';
    crescent(ctx, fx.fromX + (fx.x - fx.fromX) * t, fx.fromY + (fx.y - fx.fromY) * t, 18 + t * 10, angle);
  }
  const sweep = easeOut(Math.min(1, progress * 1.5));
  ctx.globalAlpha = fade; ctx.strokeStyle = '#e4d4ff'; ctx.lineWidth = 5 * fade + 1;
  ctx.beginPath(); ctx.arc(fx.x, fx.y, 40 + sweep * 150, angle - Math.PI * sweep, angle + Math.PI * sweep); ctx.stroke();
  ctx.lineWidth = 2; ctx.strokeStyle = '#c4a0ff';
  ctx.beginPath(); ctx.arc(fx.x, fx.y, 20 + sweep * 110, angle + Math.PI - Math.PI * sweep, angle + Math.PI + Math.PI * sweep); ctx.stroke();
  glow(ctx, fx.x, fx.y, 110, '#c4a0ff', fade * 0.6);
}

function drawFamiliarStrike(ctx, fx, progress) {
  const fade = 1 - progress, head = Math.min(1, progress * 3.5), u = 1 - head;
  ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
  for (let i = 0; i < fx.points.length; i += 2) {
    const tx = fx.points[i], ty = fx.points[i + 1];
    const mx = (fx.x + tx) / 2 + Math.sin(fx.seed + i) * 40, my = (fx.y + ty) / 2 - 50;
    ctx.globalAlpha = fade * 0.4; ctx.strokeStyle = fx.color; ctx.lineWidth = fx.evolved ? 10 : 7;
    ctx.beginPath(); ctx.moveTo(fx.x, fx.y); ctx.quadraticCurveTo(mx, my, tx, ty); ctx.stroke();
    ctx.globalAlpha = fade; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.stroke();
    glow(ctx, u * u * fx.x + 2 * u * head * mx + head * head * tx, u * u * fx.y + 2 * u * head * my + head * head * ty, 22, fx.color, fade);
  }
}

function drawBloom(ctx, fx, progress) {
  const fade = 1 - progress, grow = easeOut(Math.min(1, progress * 1.8));
  ctx.globalCompositeOperation = 'lighter';
  glow(ctx, fx.x, fx.y, fx.radius * grow, '#9dffca', fade * 0.45);
  ctx.globalAlpha = fade; ctx.strokeStyle = '#d1ff93'; ctx.lineWidth = 3 * fade + 1;
  ctx.beginPath(); ctx.arc(fx.x, fx.y, fx.radius * grow, 0, TAU); ctx.stroke();
  // Petals unfold around the caster.
  for (let n = 0; n < 8; n++) {
    const a = n * TAU / 8 + fx.seed + progress;
    ctx.save(); ctx.translate(fx.x + Math.cos(a) * 60 * grow, fx.y + Math.sin(a) * 60 * grow); ctx.rotate(a);
    ctx.fillStyle = n % 2 ? '#b8f57f' : '#f7ffd9'; ctx.globalAlpha = fade * 0.85;
    ctx.beginPath(); ctx.ellipse(0, 0, 26 * grow, 10 * grow, 0, 0, TAU); ctx.fill();
    ctx.restore();
  }
}

function drawImplode(ctx, fx, progress) {
  const fade = 1 - progress;
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = '#d9c2ff';
  for (let n = 0; n < 3; n++) {
    const r = fx.radius * Math.max(0, 1 - easeOut(Math.min(1, progress * 1.6 + n * 0.15)));
    ctx.globalAlpha = fade * (0.8 - n * 0.2); ctx.lineWidth = 3 - n;
    ctx.beginPath(); ctx.arc(fx.x, fx.y, r + 4, 0, TAU); ctx.stroke();
  }
  glow(ctx, fx.x, fx.y, 70, '#c4a0ff', fade * 0.7);
}

function drawConvergence(ctx, fx, progress) {
  const fade = 1 - progress, grow = easeOut(Math.min(1, progress * 1.5));
  ctx.globalCompositeOperation = 'lighter';
  glow(ctx, fx.x, fx.y, fx.radius * (0.4 + grow * 0.7), fx.colors[0], fade * 0.6);
  glow(ctx, fx.x, fx.y, fx.radius * (0.2 + grow * 0.5), fx.colors[1], fade * 0.6);
  for (let n = 0; n < 2; n++) {
    ctx.globalAlpha = fade; ctx.strokeStyle = fx.colors[n]; ctx.lineWidth = 6 * fade + 1;
    ctx.beginPath(); ctx.arc(fx.x, fx.y, fx.radius * grow * (1 - n * 0.25), 0, TAU); ctx.stroke();
  }
  // Twelve rays in alternating colors.
  ctx.lineCap = 'round';
  for (let n = 0; n < 12; n++) {
    const a = n * TAU / 12 + progress * 0.8;
    ctx.strokeStyle = fx.colors[n % 2]; ctx.lineWidth = 4 * fade; ctx.globalAlpha = fade;
    ctx.beginPath(); ctx.moveTo(fx.x + Math.cos(a) * 30, fx.y + Math.sin(a) * 30);
    ctx.lineTo(fx.x + Math.cos(a) * fx.radius * grow, fx.y + Math.sin(a) * fx.radius * grow); ctx.stroke();
  }
}

function drawSignal(ctx, fx, progress) {
  const pulse = (fx.age * 1.6) % 1;
  const fade = progress > 0.8 ? (1 - progress) / 0.2 : 1;
  ctx.globalAlpha = fade * (1 - pulse); ctx.strokeStyle = fx.color; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(fx.x, fx.y, 14 + pulse * 46, 0, TAU); ctx.stroke();
  ctx.globalAlpha = fade; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(fx.x, fx.y); ctx.lineTo(fx.x, fx.y - 48); ctx.stroke();
  ctx.fillStyle = '#0b1519'; ctx.beginPath(); ctx.arc(fx.x, fx.y - 60, 15, 0, TAU); ctx.fill(); ctx.stroke();
  ctx.fillStyle = fx.color; ctx.textAlign = 'center'; ctx.font = '700 16px serif'; ctx.fillText(fx.icon, fx.x, fx.y - 54);
  ctx.font = '700 10px Inter'; ctx.fillStyle = '#e6f5ef'; ctx.fillText(fx.name, fx.x, fx.y - 82);
}

function drawSigil(ctx, fx, progress) {
  const radius = fx.radius * (0.7 + easeOut(progress) * 0.3);
  ctx.translate(fx.x, fx.y); ctx.scale(1, 0.42); ctx.rotate(fx.seed + progress * 0.5);
  ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = (1 - progress) ** 2 * 0.7;
  ctx.strokeStyle = fx.color; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(0, 0, radius, 0, TAU); ctx.stroke();
  ctx.beginPath();
  for (let i = 0; i <= 6; i++) {
    const angle = i * TAU / 6;
    ctx[i ? 'lineTo' : 'moveTo'](Math.cos(angle) * radius * 0.72, Math.sin(angle) * radius * 0.72);
  }
  ctx.stroke();
  for (let i = 0; i < 6; i++) {
    const angle = i * TAU / 6;
    ctx.beginPath(); ctx.moveTo(Math.cos(angle) * radius * 0.88, Math.sin(angle) * radius * 0.88);
    ctx.lineTo(Math.cos(angle) * radius * 1.15, Math.sin(angle) * radius * 1.15); ctx.stroke();
  }
}

function drawAscend(ctx, fx, progress) {
  const fade = Math.sin(Math.PI * progress) * (1 - progress);
  const radius = fx.radius * (0.4 + easeOut(progress) * 0.6);
  ctx.globalCompositeOperation = 'lighter';
  const beam = ctx.createLinearGradient(fx.x, fx.y + 24, fx.x, fx.y - 150);
  beam.addColorStop(0, '#ffe49b'); beam.addColorStop(1, 'rgba(255,228,155,0)');
  ctx.fillStyle = beam; ctx.globalAlpha = fade * 0.3;
  ctx.beginPath(); ctx.moveTo(fx.x - 28, fx.y + 24); ctx.lineTo(fx.x - 48, fx.y - 150);
  ctx.lineTo(fx.x + 48, fx.y - 150); ctx.lineTo(fx.x + 28, fx.y + 24); ctx.fill();
  ctx.globalAlpha = (1 - progress) ** 2; ctx.strokeStyle = fx.color; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.ellipse(fx.x, fx.y + 24, radius, radius * 0.38, 0, 0, TAU); ctx.stroke();
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = Math.min(1, (1 - progress) * 3);
  ctx.font = '800 12px Inter, system-ui, sans-serif'; ctx.textAlign = 'center';
  ctx.lineWidth = 4; ctx.strokeStyle = '#15151d'; ctx.fillStyle = fx.color;
  const y = fx.y - 54 - easeOut(progress) * 26;
  ctx.strokeText('NÍVEL +', fx.x, y); ctx.fillText('NÍVEL +', fx.x, y);
}

const DRAWERS = { sigil: drawSigil, ascend: drawAscend, bloom: drawBloom, implode: drawImplode, convergence: drawConvergence, signal: drawSignal, mote: drawMote, nova: drawNova, meteor: drawMeteor, impact: drawImpact, thorns: drawThorns, lunar: drawLunar, familiar: drawFamiliarStrike };
const UNCULLED = new Set(['chain', 'familiar', 'lunar', 'convergence']);

export function drawEffects(ctx, animator, drawGhost, visible) {
  for (const fx of animator.effects) {
    if (fx.kind === 'afterimage') continue; // Drawn behind actors by the world renderer.
    if (!UNCULLED.has(fx.kind) && !visible(fx.x, fx.y)) continue;
    const progress = fx.age / fx.life;
    ctx.save();
    ctx.globalAlpha = 1 - progress;
    ctx.strokeStyle = fx.color; ctx.fillStyle = fx.color; ctx.lineWidth = 2;
    if (fx.kind === 'ring') {
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = (1 - progress) ** 2;
      ctx.lineWidth = 1 + (1 - progress) * 2;
      ctx.beginPath(); ctx.arc(fx.x, fx.y, 5 + easeOut(progress) * fx.radius, 0, TAU); ctx.stroke();
    } else if (fx.kind === 'spark') {
      const x = fx.x + fx.vx * fx.age, y = fx.y + fx.vy * fx.age + 35 * fx.age ** 2;
      ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round'; ctx.lineWidth = 2 * (1 - progress) + 0.5;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - fx.vx * 0.045, y - (fx.vy + 70 * fx.age) * 0.045); ctx.stroke();
    } else if (fx.kind === 'chain') {
      ctx.lineWidth = 5; ctx.globalAlpha = (1 - progress) * 0.35; jagged(ctx, fx.points, fx.seed, progress);
      ctx.lineWidth = 2; ctx.globalAlpha = 1 - progress; ctx.strokeStyle = '#f4fbff'; jagged(ctx, fx.points, fx.seed, progress);
    } else if (DRAWERS[fx.kind]) {
      DRAWERS[fx.kind](ctx, fx, progress);
    } else if (fx.kind === 'combo') {
      ctx.font = '800 11px Inter'; ctx.textAlign = 'center'; ctx.fillText(fx.text, fx.x, fx.y - 35 - progress * 25);
    } else drawGhost(fx, progress);
    ctx.restore();
  }
}

export function drawNumbers(ctx, animator, visible, reduced) {
  ctx.textAlign = 'center';
  for (const number of animator.numbers) {
    if (!visible(number.x, number.y)) continue;
    const progress = number.age / number.life;
    const rise = reduced ? 0 : easeOut(progress) * 32;
    const big = number.value >= 60 || number.boss;
    ctx.globalAlpha = Math.min(1, (1 - progress) * 1.6);
    const pop = reduced ? 1 : 1 + Math.sin(Math.min(1, progress / 0.3) * Math.PI) * 0.3;
    ctx.font = `800 ${(big ? 17 : 12) * pop}px Inter, system-ui, sans-serif`;
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(8, 10, 16, .85)';
    const text = String(Math.round(number.value));
    ctx.strokeText(text, number.x, number.y - rise);
    ctx.fillStyle = big ? '#ffd36b' : '#fff3e6';
    ctx.fillText(text, number.x, number.y - rise);
  }
  ctx.globalAlpha = 1;
}
