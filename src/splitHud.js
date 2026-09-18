import { REVIVE, SPECIAL, SPELLS, xpNeeded } from '../server/game.js';
import { specialOf } from '../server/weapons.js';
import { POWER_INFO } from './powerInfo.js';

/** Keys shown on each split-screen panel, by local player slot. */
export const SPLIT_KEYS = [
  { special: 'ESPAÇO', dash: 'SHIFT ESQ' },
  { special: 'ENTER', dash: 'SHIFT DIR' }
];

function bar(ctx, x, y, width, height, ratio, color) {
  ctx.fillStyle = '#16242a'; ctx.fillRect(x, y, width, height);
  ctx.fillStyle = color; ctx.fillRect(x, y, width * Math.max(0, Math.min(1, ratio)), height);
}

/**
 * Per-player status for split screen, drawn at the bottom of that player's viewport:
 * name, level, health, experience, special charge, dash and owned powers. `keys` labels the controls
 * (keyboard by default; the Switch build passes controller labels).
 */
export function drawPlayerPanel(ctx, player, { slot, ox, W, H, dpr, blocked, keys = SPLIT_KEYS[slot] }) {
  const tint = SPELLS[player.color ?? 0].tint;
  const width = Math.min(340, W - 32), height = 78;
  const x = ox + (W - width) / 2, y = H - height - 16;
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = 'rgba(7, 14, 20, .82)'; ctx.strokeStyle = tint; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.roundRect(x, y, width, height, 10); ctx.fill();
  ctx.globalAlpha = 0.55; ctx.stroke(); ctx.globalAlpha = 1;

  const pad = 12, inner = width - pad * 2;
  ctx.textBaseline = 'alphabetic';
  ctx.font = '700 11px Inter'; ctx.textAlign = 'left'; ctx.fillStyle = tint;
  ctx.fillText(`J${slot + 1}`, x + pad, y + 18);
  ctx.fillStyle = '#e6f5ef';
  ctx.fillText((player.name || '').toUpperCase(), x + pad + 24, y + 18);
  ctx.textAlign = 'right'; ctx.fillStyle = '#83d9bf';
  ctx.fillText(`NÍVEL ${player.level}`, x + width - pad, y + 18);

  bar(ctx, x + pad, y + 25, inner, 6, player.hp / player.maxHp, '#e0607a');
  bar(ctx, x + pad, y + 34, inner, 3, player.xp / xpNeeded(player.level), '#60d5b3');

  ctx.font = '600 10px Inter';
  if (player.alive === false) {
    ctx.textAlign = 'center'; ctx.fillStyle = '#ffb58e';
    ctx.fillText(player.reviveBy ? `Aliado ressuscitando você… ${Math.ceil(REVIVE.seconds - (player.reviveProgress || 0))}s`
      : 'Caído — seu aliado pode reviver você no círculo', x + width / 2, y + 58);
  } else {
    const charge = Math.round(player.specialCharge || 0);
    const special = specialOf(player);
    const half = (inner - 10) / 2;
    bar(ctx, x + pad, y + 44, half, 4, charge / SPECIAL.max, tint);
    ctx.textAlign = 'left';
    ctx.fillStyle = charge >= SPECIAL.max && !blocked && !(player.specialCooldown > 0) ? '#f4fbff' : '#819796';
    ctx.fillText(player.specialCooldown > 0 ? `${special.name} · ${Math.ceil(player.specialCooldown)}s`
      : charge >= SPECIAL.max ? `${special.name} · ${keys.special}` : `${special.name} ${charge}%`, x + pad, y + 62, half);
    ctx.textAlign = 'right';
    ctx.fillStyle = player.dashCooldown > 0 || blocked ? '#819796' : '#c6eee2';
    ctx.fillText(player.dashCooldown > 0 ? `Esquiva · ${Math.ceil(player.dashCooldown)}s` : `➤ Esquiva · ${keys.dash}`, x + width - pad, y + 62, half);
  }

  const owned = Object.entries(player.powers || {}).filter(([, rank]) => rank > 0);
  if (owned.length) {
    ctx.font = '14px serif'; ctx.textAlign = 'left'; ctx.fillStyle = '#e6f5ef';
    const step = Math.min(20, width / owned.length);
    owned.forEach(([id], index) => ctx.fillText(POWER_INFO[id]?.[0] || '?', x + index * step + 2, y - 6));
  }
  ctx.restore();
}

/** The seam between the two viewports. */
export function drawDivider(ctx, x, H, dpr) {
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#050a10'; ctx.fillRect(x - 2, 0, 4, H);
  ctx.fillStyle = 'rgba(131, 225, 196, .35)'; ctx.fillRect(x - 0.5, 0, 1, H);
  ctx.restore();
}
