import { ENEMIES } from '../server/phases.js';
import { REVIVE, SPELLS } from '../server/game.js';
import { WEAPONS } from '../server/balance.js';
import { auraRadius, orbitRadius } from '../server/weapons.js';
import { drawTerrain } from './terrain.js';
import { drawEffects, drawNumbers } from './animation.js';
import { ENEMY_SPRITES, PLAYER_SPRITES, SHOT_SPRITES, drawSprite, view, worldTransform } from './sprites.js';

const TAU = Math.PI * 2;
const PLAYER_COLORS = SPELLS.map(spell => spell.tint);

function circle(ctx, x, y, radius) { ctx.beginPath(); ctx.arc(x, y, radius, 0, TAU); }

function drawTrail(ctx, shot, color, reduced) {
  if (reduced) return;
  const speed = Math.hypot(shot.vx, shot.vy) || 1;
  const length = shot.special ? 42 : shot.shard ? 14 : 24;
  ctx.globalAlpha = shot.special ? 0.45 : 0.25;
  ctx.strokeStyle = color; ctx.lineWidth = shot.special ? 6 : 3; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(shot.x, shot.y);
  ctx.lineTo(shot.x - shot.vx / speed * length, shot.y - shot.vy / speed * length); ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawChest(ctx, x, y, time) {
  const glow = 0.35 + Math.sin(time * 5) * 0.15;
  ctx.fillStyle = `rgba(255, 211, 107, ${glow})`;
  circle(ctx, x, y, 26); ctx.fill();
  ctx.fillStyle = '#7a4a1c'; ctx.fillRect(x - 15, y - 8, 30, 20);
  ctx.fillStyle = '#9c6428'; ctx.fillRect(x - 15, y - 14, 30, 8);
  ctx.fillStyle = '#ffd36b'; ctx.fillRect(x - 15, y - 7, 30, 3); ctx.fillRect(x - 3, y - 10, 6, 9);
}

function drawMagnet(ctx, x, y, time) {
  ctx.save();
  ctx.translate(x, y); ctx.rotate(Math.sin(time * 4) * 0.25);
  ctx.lineWidth = 7; ctx.lineCap = 'butt';
  ctx.strokeStyle = '#e0585f';
  ctx.beginPath(); ctx.arc(0, -2, 10, Math.PI, 0); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-10, -2); ctx.lineTo(-10, 8); ctx.moveTo(10, -2); ctx.lineTo(10, 8); ctx.stroke();
  ctx.strokeStyle = '#dfe8ef';
  ctx.beginPath(); ctx.moveTo(-10, 8); ctx.lineTo(-10, 13); ctx.moveTo(10, 8); ctx.lineTo(10, 13); ctx.stroke();
  ctx.restore();
}

function gemLook(gem) {
  const type = gem.type || 'gem';
  if (type !== 'gem') return [type, 28];
  return gem.value >= 20 ? ['gemEpic', 40] : gem.value >= 5 ? ['gemRare', 33] : ['gem', 26];
}

function drawEdgeArrow(ctx, W, H, from, target, color, label) {
  const dx = target.x - from.x, dy = target.y - from.y;
  const angle = Math.atan2(dy, dx), cos = Math.cos(angle), sin = Math.sin(angle);
  const reach = Math.min((W / 2 - 55) / Math.max(0.001, Math.abs(cos)), (H / 2 - 75) / Math.max(0.001, Math.abs(sin)));
  const x = W / 2 + cos * reach, y = H / 2 + sin * reach;
  ctx.save();
  ctx.translate(x, y); ctx.rotate(angle);
  ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 12;
  ctx.beginPath(); ctx.moveTo(15, 0); ctx.lineTo(-9, -9); ctx.lineTo(-5, 0); ctx.lineTo(-9, 9); ctx.closePath(); ctx.fill();
  ctx.restore();
  ctx.fillStyle = '#e6f5ef'; ctx.font = '600 9px Inter'; ctx.textAlign = 'center';
  ctx.fillText(`${label} • ${Math.round(Math.hypot(dx, dy) / 10)}m`, x, y + 22);
}

export function renderWorld(ctx, game, { me, focus, animator, W, H, dpr, reduced, offline }) {
  const time = animator.time;
  const shake = animator.shakeOffset;
  Object.assign(view, { dpr, camX: focus.x - W / 2, camY: focus.y - H / 2, shakeX: shake.x, shakeY: shake.y });
  const { camX, camY } = view;
  const visible = (x, y, margin = 110) => x >= camX - margin && x <= camX + W + margin && y >= camY - margin && y <= camY + H + margin;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawTerrain(ctx, game.phase || 0, camX - shake.x, camY - shake.y, W, H);
  worldTransform(ctx);

  const altar = game.altar;
  if (altar && visible(altar.x, altar.y, 180)) {
    ctx.save();
    const color = altar.status === 'complete' ? '#8dffcc' : altar.status === 'expired' ? '#61706b' : '#ffd36b';
    ctx.fillStyle = `${color}18`; circle(ctx, altar.x, altar.y, altar.radius); ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
    ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(altar.x, altar.y, altar.radius, -Math.PI / 2, -Math.PI / 2 + TAU * altar.progress / 15); ctx.stroke();
    ctx.translate(altar.x, altar.y); ctx.rotate(Math.PI / 4);
    ctx.fillStyle = '#17342f'; ctx.fillRect(-26, -26, 52, 52); ctx.strokeRect(-26, -26, 52, 52);
    ctx.rotate(-Math.PI / 4); ctx.font = '700 26px serif'; ctx.textAlign = 'center'; ctx.fillStyle = color; ctx.fillText('◇', 0, 9);
    ctx.font = '700 11px Inter'; ctx.fillText(altar.status === 'complete' ? 'PURIFICADO' : altar.status === 'expired' ? 'APAGADO' : 'DEFENDA O ALTAR', 0, -48);
    ctx.restore();
  }

  for (const zone of game.zones || []) if (visible(zone.x, zone.y)) {
    ctx.globalAlpha = 0.32 + (reduced ? 0 : Math.sin(time * 14 + zone.x) * 0.08);
    const gradient = ctx.createRadialGradient(zone.x, zone.y, 4, zone.x, zone.y, zone.radius);
    const roots = zone.kind === 'roots';
    gradient.addColorStop(0, roots ? '#d1ff93' : '#ffcf6b'); gradient.addColorStop(0.6, roots ? '#55c46a' : '#ff6a2b'); gradient.addColorStop(1, roots ? 'rgba(50,180,80,0)' : 'rgba(255,80,30,0)');
    ctx.fillStyle = gradient; circle(ctx, zone.x, zone.y, zone.radius); ctx.fill();
    if (zone.warning > 0 || roots) {
      ctx.globalAlpha = 0.8; ctx.strokeStyle = roots ? '#92ed68' : '#ffd36b'; ctx.lineWidth = 2; ctx.stroke();
      if (roots) for (let n = 0; n < 8; n++) {
        const a = n * TAU / 8;
        ctx.beginPath(); ctx.moveTo(zone.x, zone.y); ctx.lineTo(zone.x + Math.cos(a) * zone.radius, zone.y + Math.sin(a) * zone.radius); ctx.stroke();
      }
      else { ctx.textAlign = 'center'; ctx.font = '700 12px Inter'; ctx.fillStyle = '#ffe8a8'; ctx.fillText('METEORO', zone.x, zone.y); }
    }
  }
  ctx.globalAlpha = 1;
  for (const rune of game.runes || []) if (visible(rune.x, rune.y)) {
    const armed = rune.arm <= 0;
    ctx.strokeStyle = PLAYER_COLORS[rune.color] || '#c4a0ff';
    ctx.globalAlpha = armed ? 0.85 : 0.35;
    ctx.lineWidth = 2;
    circle(ctx, rune.x, rune.y, 15 + (armed && !reduced ? Math.sin(time * 8 + rune.id) * 2 : 0)); ctx.stroke();
    ctx.beginPath();
    for (let n = 0; n < 5; n++) {
      const a = n * TAU * 2 / 5 - Math.PI / 2 + (reduced ? 0 : time);
      ctx[n ? 'lineTo' : 'moveTo'](rune.x + Math.cos(a) * 11, rune.y + Math.sin(a) * 11);
    }
    ctx.closePath(); ctx.stroke();
  }
  ctx.globalAlpha = 1;

  for (const hazard of game.hazards || []) {
    circle(ctx, hazard.x, hazard.y, hazard.radius);
    ctx.fillStyle = hazard.fired ? 'rgba(255,150,75,.55)' : 'rgba(245,85,80,.12)'; ctx.fill();
    ctx.strokeStyle = hazard.fired ? '#ffc778' : '#ef7f78'; ctx.lineWidth = 2; ctx.stroke();
    if (!hazard.fired) {
      circle(ctx, hazard.x, hazard.y, hazard.radius * Math.max(0, Math.min(1, 1 - hazard.warning / (hazard.warn0 || 1.3))));
      ctx.stroke();
    }
  }

  for (const gem of game.gems || []) if (visible(gem.x, gem.y)) {
    const phase = time * 2.9 + gem.x * 0.017 + gem.y * 0.013;
    const bob = reduced ? 0 : Math.sin(phase) * 3;
    if (gem.type === 'chest') { drawChest(ctx, gem.x, gem.y + bob, time); continue; }
    if (gem.type === 'magnet') { drawMagnet(ctx, gem.x, gem.y + bob, time); continue; }
    const [sprite, size] = gemLook(gem);
    const spin = !reduced && gem.type === 'coin' ? 0.2 + Math.abs(Math.cos(phase)) * 0.8 : 1;
    drawSprite(ctx, sprite, gem.x, gem.y + bob, size, 0, Math.min(0.95, (gem.ttl ?? 24) / 4), spin);
  }

  for (const shot of game.shots || []) if (visible(shot.x, shot.y)) {
    const spell = SPELLS[shot.color ?? 0];
    drawTrail(ctx, shot, spell.tint, reduced);
    const spin = spell.sprite === 'blade' && !reduced ? time * 9 : 0;
    const pulse = reduced ? 1 : 1 + Math.sin(time * 15 + shot.x * 0.05) * 0.06;
    const size = shot.special ? 65 : shot.shard ? 24 : spell.sprite === 'blade' ? 52 : 38;
    drawSprite(ctx, SHOT_SPRITES[shot.color ?? 0], shot.x, shot.y, size * pulse, Math.atan2(shot.vy, shot.vx) + spin);
  }
  for (const shot of game.enemyShots || []) if (visible(shot.x, shot.y)) {
    drawTrail(ctx, shot, '#ff7777', reduced);
    ctx.strokeStyle = '#ff6666'; ctx.lineWidth = 2;
    circle(ctx, shot.x, shot.y, 19); ctx.stroke();
    drawSprite(ctx, shot.sprite, shot.x, shot.y, 38, Math.atan2(shot.vy, shot.vx));
  }

  for (const enemy of game.enemies || []) {
    const type = ENEMIES[enemy.type] || {};
    if (!enemy.boss && !visible(enemy.x, enemy.y)) continue;
    const size = (type.size || 64) * (enemy.elite ? 1.35 : 1);
    if (enemy.freezeFor > 0 || enemy.rootFor > 0) {
      ctx.strokeStyle = enemy.freezeFor > 0 ? '#8cdfff' : '#92ed68'; ctx.lineWidth = 3;
      circle(ctx, enemy.x, enemy.y, size * 0.45); ctx.stroke();
    }
    if (enemy.elite) {
      ctx.globalAlpha = 0.45 + (reduced ? 0 : Math.sin(time * 6 + enemy.id) * 0.15);
      ctx.strokeStyle = '#ffd36b'; ctx.lineWidth = 3;
      circle(ctx, enemy.x, enemy.y + size * 0.3, size * 0.42); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (enemy.fuse > 0) {
      ctx.fillStyle = `rgba(255, 90, 60, ${0.15 + (reduced ? 0.1 : Math.abs(Math.sin(time * 22)) * 0.2)})`;
      circle(ctx, enemy.x, enemy.y, 70); ctx.fill();
    }
    if (enemy.dashWarn > 0) {
      ctx.save();
      ctx.translate(enemy.x, enemy.y); ctx.rotate(enemy.dashAngle || 0);
      ctx.fillStyle = 'rgba(245, 85, 80, .18)'; ctx.strokeStyle = '#ef7f78'; ctx.lineWidth = 2;
      ctx.fillRect(0, -45, 300, 90); ctx.strokeRect(0, -45, 300, 90);
      ctx.restore();
    }
    const pose = animator.pose(`e:${enemy.id}`);
    ctx.fillStyle = `rgba(0,0,0,${pose.alpha * 0.24})`;
    ctx.beginPath(); ctx.ellipse(enemy.x, enemy.y + size * 0.36, size * 0.28, size * 0.09, 0, 0, TAU); ctx.fill();
    drawSprite(ctx, ENEMY_SPRITES[enemy.type] || type.sprite || enemy.type, enemy.x + pose.x, enemy.y + pose.y, size,
      pose.rotation, pose.alpha, pose.sx, pose.sy, Math.max(pose.flash, enemy.windup > 0 ? 0.45 : 0));
    if (enemy.windup > 0) {
      ctx.fillStyle = '#ff6b5e'; ctx.font = '800 18px Inter'; ctx.textAlign = 'center';
      ctx.fillText('!', enemy.x, enemy.y - size * 0.55);
    }
    if (enemy.boss) continue;
    const barWidth = enemy.elite ? 56 : 40;
    const barY = enemy.y - size * 0.53;
    ctx.fillStyle = '#10151a'; ctx.fillRect(enemy.x - barWidth / 2, barY, barWidth, enemy.elite ? 5 : 3);
    ctx.fillStyle = enemy.elite ? '#ffc34d' : '#b95465';
    ctx.fillRect(enemy.x - barWidth / 2, barY, barWidth * Math.max(0, enemy.hp / enemy.maxHp), enemy.elite ? 5 : 3);
  }

  for (const player of Object.values(game.players)) {
    if (!visible(player.x, player.y, 260)) continue;
    const alive = player.alive !== false;
    const color = PLAYER_COLORS[player.color ?? 0];
    const powers = player.powers || {};
    if (alive && powers.aura) {
      const radius = auraRadius(powers.aura, powers.sanctuary);
      ctx.globalAlpha = 0.1 + (reduced ? 0 : Math.sin(time * 4) * 0.03);
      ctx.fillStyle = powers.sanctuary ? '#9dffca' : color;
      circle(ctx, player.x, player.y, radius); ctx.fill();
      ctx.globalAlpha = 0.35; ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (!alive && !game.over) {
      ctx.strokeStyle = '#eaaa91'; ctx.lineWidth = 2;
      circle(ctx, player.x, player.y, REVIVE.radius); ctx.stroke();
      ctx.strokeStyle = '#8dffcc'; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(player.x, player.y, REVIVE.radius, -Math.PI / 2, -Math.PI / 2 + TAU * (player.reviveProgress || 0) / REVIVE.seconds); ctx.stroke();
      if (player.reviveProgress > 0 && !reduced) {
        ctx.fillStyle = '#9dffca';
        for (let i = 0; i < 3; i++) {
          const angle = time * 2.2 + i * TAU / 3;
          circle(ctx, player.x + Math.cos(angle) * REVIVE.radius, player.y + Math.sin(angle) * REVIVE.radius, 3); ctx.fill();
        }
      }
    }
    if (alive && (player.pendingPowers?.length || player.invulnerableFor > 0)) {
      const pulse = 40 + (reduced ? 0 : Math.sin(time * 7.7) * 4);
      ctx.strokeStyle = 'rgba(126, 237, 205, .82)'; ctx.lineWidth = 2;
      circle(ctx, player.x, player.y, pulse); ctx.stroke();
      ctx.fillStyle = 'rgba(87, 215, 180, .08)'; ctx.fill();
    }
    const pose = animator.pose(`p:${player.id}`);
    ctx.globalAlpha = player.connected === false ? 0.4 : 1;
    ctx.fillStyle = `rgba(0,0,0,${pose.alpha * 0.24})`;
    ctx.beginPath(); ctx.ellipse(player.x, player.y + 24, 19, 6, 0, 0, TAU); ctx.fill();
    drawSprite(ctx, PLAYER_SPRITES[player.color ?? 0], player.x + pose.x, player.y + pose.y, 68, pose.rotation,
      pose.alpha * (player.connected === false ? 0.45 : 1), pose.sx, pose.sy, pose.flash);
    if (alive && powers.orbit) {
      const evolved = powers.constellation;
      const count = WEAPONS.orbit.counts[powers.orbit - 1] + (evolved ? WEAPONS.evolutions.constellation.extraOrbs : 0);
      const radius = orbitRadius(powers.orbit, evolved);
      for (let n = 0; n < count; n++) {
        const angle = (player.orbitAngle || 0) + n * TAU / count;
        const x = player.x + Math.cos(angle) * radius, y = player.y + Math.sin(angle) * radius;
        ctx.fillStyle = color; ctx.globalAlpha = 0.3;
        circle(ctx, x, y, evolved ? 17 : 12); ctx.fill();
        ctx.globalAlpha = 1; ctx.fillStyle = '#f4fbff';
        circle(ctx, x, y, evolved ? 8 : 5.5); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    ctx.font = '600 10px Inter'; ctx.textAlign = 'center';
    ctx.fillStyle = alive ? '#c6eee2' : '#8b5961';
    const label = !alive ? (game.over ? 'DERROTADO' : `REVIVER · ${Math.ceil(REVIVE.seconds - (player.reviveProgress || 0))}s`)
      : player.connected === false ? `${player.name} (reconectando)` : (player.name || 'Aliado');
    ctx.fillText(label, player.x, player.y - (alive ? 41 : 65));
  }

  drawEffects(ctx, animator, (fx, progress) => {
    const size = (ENEMIES[fx.type]?.size || 64) * (fx.elite ? 1.35 : 1) * (1 - progress * 0.35);
    drawSprite(ctx, ENEMY_SPRITES[fx.type] || ENEMIES[fx.type]?.sprite || fx.type, fx.x, fx.y + progress * 10, size, progress * 0.3, (1 - progress) * 0.65);
  }, (x, y) => visible(x, y));
  drawNumbers(ctx, animator, (x, y) => visible(x, y), reduced);

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalAlpha = 1;
  const inView = entity => {
    const sx = entity.x - camX, sy = entity.y - camY;
    return sx >= 45 && sx <= W - 45 && sy >= 65 && sy <= H - 55;
  };
  if (!offline) {
    for (const player of Object.values(game.players)) {
      if (player === focus || player === me || inView(player)) continue;
      drawEdgeArrow(ctx, W, H, focus, player, player.alive === false ? '#ffb58e' : '#83e1c4', `${player.alive === false ? 'REVIVER ' : ''}${player.name}`);
    }
  }
  const boss = game.enemies.find(e => e.boss);
  if (boss && !inView(boss)) drawEdgeArrow(ctx, W, H, focus, boss, '#ff6b5e', 'GUARDIÃO');
  if (altar && ['waiting', 'active'].includes(altar.status) && !inView(altar)) drawEdgeArrow(ctx, W, H, focus, altar, '#ffd36b', 'ALTAR');
}
