import { DASH } from './balance.js';
import { pushEvent } from './combat.js';

export function dashDirection(p, input = p.input) {
  const x = Number.isFinite(input?.x) ? input.x : 0;
  const y = Number.isFinite(input?.y) ? input.y : 0;
  const length = Math.hypot(x, y);
  if (length > 0.01) return { x: x / length, y: y / length };
  const lastX = p.moveX || 0, lastY = p.moveY || 0, lastLength = Math.hypot(lastX, lastY);
  return lastLength ? { x: lastX / lastLength, y: lastY / lastLength } : { x: 0, y: 1 };
}

export function activateDash(s, id, input) {
  const p = s.players[id];
  if (!p?.alive || s.over || s.phaseStatus === 'transition' || p.pendingPowers || p.dashCooldown > 0) return false;
  const direction = dashDirection(p, input);
  p.dashX = direction.x; p.dashY = direction.y;
  p.dashFor = DASH.seconds; p.dashCooldown = DASH.cooldown;
  p.motionId = (p.motionId || 0) + 1;
  p.invulnerableFor = Math.max(p.invulnerableFor, DASH.seconds);
  pushEvent(s, 'evade', { x: p.x, y: p.y, color: p.color });
  return true;
}

export function movementDelta(p, input, dt) {
  const burst = Math.min(dt, Math.max(0, p.dashFor || 0));
  return { x: (p.dashX || 0) * DASH.speed * burst + input.x * p.speed * (dt - burst),
    y: (p.dashY || 0) * DASH.speed * burst + input.y * p.speed * (dt - burst) };
}
