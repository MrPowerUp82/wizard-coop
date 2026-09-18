import { ENEMIES } from '../server/phases.js';
import { REVIVE, SPELLS } from '../server/game.js';
import { ENCOUNTERS, WEAPONS } from '../server/balance.js';
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
  const length = Math.min(shot.special ? 95 : shot.shard ? 25 : 58, speed * 0.14);
  const tx = shot.x - shot.vx / speed * length, ty = shot.y - shot.vy / speed * length;
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
  const trail = ctx.createLinearGradient(shot.x, shot.y, tx, ty);
  trail.addColorStop(0, color); trail.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.strokeStyle = trail; ctx.globalAlpha = 0.3; ctx.lineWidth = shot.special ? 14 : 7;
  ctx.beginPath(); ctx.moveTo(shot.x, shot.y); ctx.lineTo(tx, ty); ctx.stroke();
  ctx.globalAlpha = 0.85; ctx.lineWidth = shot.special ? 4 : 2; ctx.stroke();
  ctx.restore();
}

/** A fixed world grid keeps the atmosphere continuous as the camera moves, with no particle allocation. */
function drawAtmosphere(ctx, phase, camX, camY, W, H, time, reduced) {
  if (reduced) return;
  const spacing = 190;
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = ['#b8f57f', '#b9cbff', '#ffad68', '#a6e5bd', '#ffe49b', '#c4a0ff'][phase % 6];
  for (let gx = Math.floor((camX - 50) / spacing); gx <= Math.ceil((camX + W + 50) / spacing); gx++) {
    for (let gy = Math.floor((camY - 50) / spacing); gy <= Math.ceil((camY + H + 50) / spacing); gy++) {
      const seed = Math.sin(gx * 127.1 + gy * 311.7) * 43758.5453;
      const offset = seed - Math.floor(seed);
      const x = gx * spacing + offset * spacing + Math.sin(time * 0.35 + seed) * 24;
      const y = gy * spacing + ((offset * 7) % 1) * spacing + Math.cos(time * 0.45 + seed) * 30;
      const pulse = 0.5 + Math.sin(time * 1.2 + seed) * 0.5;
      ctx.globalAlpha = 0.035 + pulse * 0.08; circle(ctx, x, y, 5 + offset * 3); ctx.fill();
      ctx.globalAlpha = 0.12 + pulse * 0.3; circle(ctx, x, y, 0.8 + offset); ctx.fill();
    }
  }
  ctx.restore();
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

/** A small winged spirit tinted with its owner's element; the evolved form grows a halo of runes. */
function drawFamiliar(ctx, x, y, color, time, evolved, reduced) {
  const flap = reduced ? 0.6 : Math.sin(time * 16) * 0.5 + 0.5;
  const bob = reduced ? 0 : Math.sin(time * 3.2) * 4;
  const scale = evolved ? 1.3 : 1;
  ctx.save();
  ctx.translate(x, y + bob); ctx.scale(scale, scale);
  ctx.globalCompositeOperation = 'lighter';
  const aura = ctx.createRadialGradient(0, 0, 0, 0, 0, 34);
  aura.addColorStop(0, color); aura.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalAlpha = 0.45; ctx.fillStyle = aura; circle(ctx, 0, 0, 34); ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  // Wispy tail trailing below the body.
  ctx.globalAlpha = 0.55; ctx.fillStyle = color;
  ctx.beginPath(); ctx.moveTo(-7, 4);
  ctx.quadraticCurveTo(reduced ? 0 : Math.sin(time * 6) * 8, 18, reduced ? 0 : Math.sin(time * 6 + 1) * 5, 26);
  ctx.quadraticCurveTo(4, 14, 7, 4); ctx.fill();
  ctx.globalAlpha = 0.8;
  for (const side of [-1, 1]) {
    ctx.save(); ctx.scale(side, 1); ctx.rotate(-0.25 - flap * 0.55);
    ctx.beginPath(); ctx.moveTo(4, -2); ctx.quadraticCurveTo(22, -20, 26, -4); ctx.quadraticCurveTo(16, 0, 4, 3); ctx.fill();
    ctx.restore();
  }
  ctx.globalAlpha = 1; ctx.fillStyle = '#f4fbff';
  circle(ctx, 0, 0, 8.5); ctx.fill();
  ctx.fillStyle = color; circle(ctx, 0, 1.5, 6); ctx.fill();
  ctx.fillStyle = '#0d1420';
  circle(ctx, -2.6, -0.5, 1.5); ctx.fill(); circle(ctx, 2.6, -0.5, 1.5); ctx.fill();
  if (evolved) {
    ctx.strokeStyle = '#ffe49b'; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.85;
    ctx.beginPath(); ctx.ellipse(0, -14, 10, 3.5, 0, 0, TAU); ctx.stroke();
    for (let n = 0; n < 3; n++) {
      const a = (reduced ? 0 : time * 2) + n * TAU / 3;
      ctx.fillStyle = '#ffe49b'; circle(ctx, Math.cos(a) * 20, Math.sin(a) * 20, 2); ctx.fill();
    }
  }
  ctx.restore();
}

const ENCOUNTER_LOOK = {
  merchant: { color: '#ffd36b', icon: '⚖', label: 'MERCADOR', arrow: 'MERCADOR' },
  shrine: { color: '#ff7aa8', icon: '☥', label: 'SANTUÁRIO AMALDIÇOADO', arrow: 'SANTUÁRIO' },
  thief: { color: '#ffd36b', icon: '✪', label: '', arrow: 'LADRÃO' }
};

function drawEncounter(ctx, encounter, me, time, reduced) {
  const look = ENCOUNTER_LOOK[encounter.kind];
  if (!look || encounter.kind === 'thief') return;
  const done = ['complete', 'expired'].includes(encounter.status);
  const color = done ? '#61706b' : look.color;
  ctx.save();
  ctx.fillStyle = `${color}14`; circle(ctx, encounter.x, encounter.y, encounter.radius); ctx.fill();
  ctx.setLineDash([10, 8]); ctx.lineDashOffset = reduced ? 0 : -time * 20;
  ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke(); ctx.setLineDash([]);
  const seconds = encounter.kind === 'merchant' ? ENCOUNTERS.merchant.seconds : ENCOUNTERS.shrine.seconds;
  const progress = encounter.kind === 'merchant' ? (me?.shopProgress || 0) : encounter.progress;
  if (progress > 0 && !done) {
    ctx.lineWidth = 5; ctx.beginPath();
    ctx.arc(encounter.x, encounter.y, encounter.radius, -Math.PI / 2, -Math.PI / 2 + TAU * Math.min(1, progress / seconds)); ctx.stroke();
  }
  const bob = reduced ? 0 : Math.sin(time * 2.4) * 3;
  if (encounter.kind === 'merchant') {
    // A small hooded stall: canopy, table and a sack of wares.
    ctx.fillStyle = '#3b2a1a'; ctx.fillRect(encounter.x - 30, encounter.y - 2, 60, 20);
    ctx.fillStyle = '#7a4a1c'; ctx.fillRect(encounter.x - 34, encounter.y - 6, 68, 6);
    ctx.fillStyle = done ? '#4d5552' : '#b3413c';
    ctx.beginPath(); ctx.moveTo(encounter.x - 40, encounter.y - 34); ctx.lineTo(encounter.x + 40, encounter.y - 34); ctx.lineTo(encounter.x + 32, encounter.y - 18); ctx.lineTo(encounter.x - 32, encounter.y - 18); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#f0e2c0';
    for (let n = -30; n < 30; n += 20) { ctx.beginPath(); ctx.moveTo(encounter.x + n, encounter.y - 34); ctx.lineTo(encounter.x + n + 10, encounter.y - 34); ctx.lineTo(encounter.x + n + 8, encounter.y - 18); ctx.lineTo(encounter.x + n + 2, encounter.y - 18); ctx.fill(); }
    ctx.strokeStyle = '#5b3a1f'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(encounter.x - 34, encounter.y - 18); ctx.lineTo(encounter.x - 34, encounter.y + 18); ctx.moveTo(encounter.x + 34, encounter.y - 18); ctx.lineTo(encounter.x + 34, encounter.y + 18); ctx.stroke();
  } else {
    // A cracked obelisk with a pulsing crimson eye.
    ctx.fillStyle = done ? '#3a3f3e' : '#2a1826';
    ctx.beginPath(); ctx.moveTo(encounter.x - 18, encounter.y + 20); ctx.lineTo(encounter.x - 11, encounter.y - 46); ctx.lineTo(encounter.x, encounter.y - 58);
    ctx.lineTo(encounter.x + 11, encounter.y - 46); ctx.lineTo(encounter.x + 18, encounter.y + 20); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.stroke();
    if (!done) {
      ctx.globalCompositeOperation = 'lighter';
      const glowRadius = 22 + (reduced ? 0 : Math.sin(time * 5) * 5);
      const gradient = ctx.createRadialGradient(encounter.x, encounter.y - 24, 0, encounter.x, encounter.y - 24, glowRadius);
      gradient.addColorStop(0, '#ff7aa8'); gradient.addColorStop(1, 'rgba(255,60,120,0)');
      ctx.fillStyle = gradient; circle(ctx, encounter.x, encounter.y - 24, glowRadius); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
  }
  ctx.textAlign = 'center';
  ctx.font = '700 22px serif'; ctx.fillStyle = color; ctx.fillText(look.icon, encounter.x, encounter.y - 66 + bob);
  ctx.font = '700 11px Inter';
  const status = encounter.status === 'complete' ? (encounter.kind === 'merchant' ? 'ESGOTADO' : 'PACTO SELADO') : encounter.status === 'expired' ? 'PARTIU' : look.label;
  ctx.fillText(status, encounter.x, encounter.y + encounter.radius + 16);
  ctx.restore();
}

function drawSpecialZone(ctx, zone, time, reduced) {
  const spin = reduced ? 0 : time;
  if (zone.kind === 'hail') {
    const gradient = ctx.createRadialGradient(zone.x, zone.y, 10, zone.x, zone.y, zone.radius);
    gradient.addColorStop(0, 'rgba(200,245,255,.28)'); gradient.addColorStop(1, 'rgba(118,223,255,0)');
    ctx.globalAlpha = 1; ctx.fillStyle = gradient; circle(ctx, zone.x, zone.y, zone.radius); ctx.fill();
    ctx.strokeStyle = '#bff4ff'; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.6; ctx.stroke();
    if (reduced) return;
    // Hailstones: deterministic pseudo-random streaks falling inside the circle.
    ctx.strokeStyle = '#e8fbff'; ctx.lineCap = 'round';
    for (let n = 0; n < 22; n++) {
      const cycle = (time * 1.8 + n * 0.137) % 1;
      const a = n * 2.399, r = zone.radius * Math.sqrt((n * 0.618) % 1);
      const x = zone.x + Math.cos(a) * r, y = zone.y + Math.sin(a) * r;
      ctx.globalAlpha = 1 - cycle; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(x - 8 + cycle * 8, y - 40 + cycle * 40); ctx.lineTo(x + cycle * 8, y - 24 + cycle * 40); ctx.stroke();
      if (cycle > 0.85) { ctx.lineWidth = 1; circle(ctx, x + 8, y + 16, 6 + (cycle - 0.85) * 60); ctx.stroke(); }
    }
  } else if (zone.kind === 'flameshield') {
    ctx.globalCompositeOperation = 'lighter';
    const gradient = ctx.createRadialGradient(zone.x, zone.y, zone.radius * 0.5, zone.x, zone.y, zone.radius);
    gradient.addColorStop(0, 'rgba(255,120,40,0)'); gradient.addColorStop(0.8, 'rgba(255,140,60,.35)'); gradient.addColorStop(1, 'rgba(255,90,30,0)');
    ctx.globalAlpha = 1; ctx.fillStyle = gradient; circle(ctx, zone.x, zone.y, zone.radius); ctx.fill();
    for (let n = 0; n < 10; n++) {
      const a = spin * 3 + n * TAU / 10;
      const x = zone.x + Math.cos(a) * zone.radius * 0.85, y = zone.y + Math.sin(a) * zone.radius * 0.85;
      const flame = ctx.createRadialGradient(x, y, 0, x, y, 20);
      flame.addColorStop(0, '#fff1c4'); flame.addColorStop(0.4, '#ff9955'); flame.addColorStop(1, 'rgba(255,60,20,0)');
      ctx.fillStyle = flame; circle(ctx, x, y, 20); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  } else if (zone.kind === 'vortex') {
    const gradient = ctx.createRadialGradient(zone.x, zone.y, 0, zone.x, zone.y, zone.radius);
    gradient.addColorStop(0, 'rgba(20,6,40,.85)'); gradient.addColorStop(0.35, 'rgba(90,40,160,.45)'); gradient.addColorStop(1, 'rgba(196,160,255,0)');
    ctx.globalAlpha = 1; ctx.fillStyle = gradient; circle(ctx, zone.x, zone.y, zone.radius); ctx.fill();
    ctx.strokeStyle = '#d9c2ff'; ctx.lineCap = 'round';
    for (let arm = 0; arm < 4; arm++) {
      ctx.globalAlpha = 0.7; ctx.lineWidth = 2.5;
      ctx.beginPath();
      for (let k = 0; k <= 24; k++) {
        const f = k / 24, a = arm * TAU / 4 - spin * 4 + f * 3.4;
        const r = zone.radius * (1 - f) + 8;
        ctx[k ? 'lineTo' : 'moveTo'](zone.x + Math.cos(a) * r, zone.y + Math.sin(a) * r);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1; ctx.fillStyle = '#f1e6ff'; circle(ctx, zone.x, zone.y, 6 + Math.max(0, 1 - zone.ttl) * 10); ctx.fill();
  }
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

/**
 * Draws the world centred on `focus` into a W×H viewport whose top-left corner sits at (ox, oy) on screen,
 * so split screen can render each local player into its own half of the canvas.
 */
export function renderWorld(ctx, game, { me, focus, animator, W, H, dpr, reduced, offline, ox = 0, oy = 0 }) {
  const time = animator.time;
  const shake = animator.shakeOffset;
  const camX = focus.x - W / 2, camY = focus.y - H / 2;
  // The sprite camera folds in the viewport offset so world-space draws land inside this viewport.
  Object.assign(view, { dpr, camX: camX - ox, camY: camY - oy, shakeX: shake.x, shakeY: shake.y });
  const visible = (x, y, margin = 110) => x >= camX - margin && x <= camX + W + margin && y >= camY - margin && y <= camY + H + margin;
  const screenTransform = () => ctx.setTransform(dpr, 0, 0, dpr, ox * dpr, oy * dpr);

  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.beginPath(); ctx.rect(ox, oy, W, H); ctx.clip();
  screenTransform();
  drawTerrain(ctx, game.phase || 0, camX - shake.x, camY - shake.y, W, H);
  worldTransform(ctx);
  drawAtmosphere(ctx, game.phase || 0, camX, camY, W, H, time, reduced);

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

  if (game.encounter && visible(game.encounter.x, game.encounter.y, 200)) drawEncounter(ctx, game.encounter, me, time, reduced);

  for (const zone of game.zones || []) if (visible(zone.x, zone.y, zone.radius)) {
    if (['hail', 'flameshield', 'vortex'].includes(zone.kind)) { drawSpecialZone(ctx, zone, time, reduced); ctx.globalAlpha = 1; continue; }
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

  for (const hazard of game.hazards || []) if (visible(hazard.x, hazard.y, hazard.radius)) {
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
    if (gem.type === 'chest') { drawChest(ctx, gem.x, gem.y + bob, reduced ? 0 : time); continue; }
    if (gem.type === 'magnet') { drawMagnet(ctx, gem.x, gem.y + bob, reduced ? 0 : time); continue; }
    const [sprite, size] = gemLook(gem);
    const spin = !reduced && gem.type === 'coin' ? 0.2 + Math.abs(Math.cos(phase)) * 0.8 : 1;
    drawSprite(ctx, sprite, gem.x, gem.y + bob, size, 0, Math.min(0.95, (gem.ttl ?? 24) / 4), spin);
  }

  for (const shot of game.shots || []) if (visible(shot.x, shot.y)) {
    const spell = SPELLS[shot.color ?? 0];
    drawTrail(ctx, shot, spell.tint, reduced);
    const spin = spell.sprite === 'blade' && !reduced ? time * 9 : 0;
    const pulse = reduced ? 1 : 1 + Math.sin(time * 15 + shot.x * 0.05) * 0.06;
    const size = (shot.special ? 65 : shot.shard ? 24 : spell.sprite === 'blade' ? 52 : 38) * (shot.fullmoon && shot.returning ? WEAPONS.evolutions.fullmoon.size : 1);
    drawSprite(ctx, SHOT_SPRITES[shot.color ?? 0], shot.x, shot.y, size * pulse, Math.atan2(shot.vy, shot.vx) + spin);
  }
  for (const shot of game.enemyShots || []) if (visible(shot.x, shot.y)) {
    drawTrail(ctx, shot, '#ff7777', reduced);
    ctx.strokeStyle = '#ff6666'; ctx.lineWidth = 2;
    circle(ctx, shot.x, shot.y, 19); ctx.stroke();
    drawSprite(ctx, shot.sprite, shot.x, shot.y, 38, Math.atan2(shot.vy, shot.vx));
  }

  // Afterimages share the effect budget but sit below creatures, names and attack warnings.
  for (const fx of animator.effects) if (fx.kind === 'afterimage' && visible(fx.x, fx.y)) {
    const fade = (1 - fx.age / fx.life) ** 2;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    drawSprite(ctx, PLAYER_SPRITES[fx.character], fx.x, fx.y, 68, 0, fade * 0.3, fx.facing, 1, 0.5);
    ctx.globalAlpha = fade * 0.25; ctx.strokeStyle = fx.color; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(fx.x, fx.y + 24, 20, 6, 0, 0, TAU); ctx.stroke();
    ctx.restore();
  }

  for (const enemy of game.enemies || []) {
    const type = ENEMIES[enemy.type] || {};
    if (!enemy.boss && !visible(enemy.x, enemy.y)) continue;
    const size = (type.size || 64) * (enemy.elite ? 1.35 : 1);
    if (enemy.freezeFor > 0 || enemy.rootFor > 0) {
      ctx.strokeStyle = enemy.freezeFor > 0 ? '#8cdfff' : '#92ed68'; ctx.lineWidth = 3;
      circle(ctx, enemy.x, enemy.y, size * 0.45); ctx.stroke();
    }
    if (enemy.thief) {
      // The thief carries a glowing purse and leaves a golden dashed ring so it stands out in the crowd.
      ctx.save();
      ctx.setLineDash([6, 6]); ctx.lineDashOffset = reduced ? 0 : time * 30;
      ctx.strokeStyle = '#ffd36b'; ctx.lineWidth = 2;
      circle(ctx, enemy.x, enemy.y, size * 0.55); ctx.stroke();
      ctx.restore();
      ctx.font = '700 20px serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#ffd36b';
      ctx.fillText('✪', enemy.x, enemy.y - size * 0.62 + (reduced ? 0 : Math.sin(time * 8) * 3));
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
    if (alive && player.specialCharge >= 100) {
      ctx.save(); ctx.translate(player.x, player.y + 24); ctx.scale(1, 0.4);
      ctx.rotate(reduced ? 0 : time * 0.65);
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.globalAlpha = reduced ? 0.65 : 0.55 + Math.sin(time * 3) * 0.15;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath(); ctx.arc(0, 0, 33, i * TAU / 3, i * TAU / 3 + 1.5); ctx.stroke();
      }
      ctx.restore();
    }
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
    if (alive && powers.familiar && player.familiar) {
      drawFamiliar(ctx, player.familiar.x, player.familiar.y, color, time + (player.color ?? 0), powers.covenant, reduced);
    }
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

  screenTransform();
  const flash = animator.flash;
  if (flash && flash.alpha > 0.01) {
    ctx.globalAlpha = flash.alpha; ctx.fillStyle = flash.color; ctx.fillRect(0, 0, W, H);
  }
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
  const encounter = game.encounter;
  if (encounter && game.phaseStatus === 'horde' && !['complete', 'expired'].includes(encounter.status) && !inView(encounter)) {
    const look = ENCOUNTER_LOOK[encounter.kind];
    if (look) drawEdgeArrow(ctx, W, H, focus, encounter, look.color, look.arrow);
  }
  for (const mark of animator.signals) {
    if (!inView(mark)) drawEdgeArrow(ctx, W, H, focus, mark, mark.color, `${mark.icon} ${mark.name}`);
  }
  if (altar && ['waiting', 'active'].includes(altar.status) && !inView(altar)) drawEdgeArrow(ctx, W, H, focus, altar, '#ffd36b', 'ALTAR');
  ctx.restore();
}
