import { ALTAR } from './balance.js';
import { phaseDuration } from './campaign.js';
import { distanceSq, pushEvent, spawnEnemy } from './combat.js';
import { PHASES } from './phases.js';

/** One optional altar per realm: progress is retained when retreating, but the deadline keeps ticking. */
export function updateObjective(ctx) {
  const { s, alive, dt, random, difficulty } = ctx;
  if (s.phaseStatus !== 'horde') return;
  if (!s.altar && !s.altarSpawned && s.phaseTime >= phaseDuration(s) * ALTAR.appearsAt) {
    const focus = alive[0], angle = random() * Math.PI * 2;
    s.altarSpawned = true;
    s.altar = { x: focus.x + Math.cos(angle) * 300, y: focus.y + Math.sin(angle) * 300,
      radius: ALTAR.radius, progress: 0, ttl: ALTAR.expiresAfter, status: 'waiting', wave: 0 };
    pushEvent(s, 'altar', { x: s.altar.x, y: s.altar.y });
  }
  const altar = s.altar;
  if (!altar || ['complete', 'expired'].includes(altar.status)) return;
  altar.ttl -= dt;
  if (altar.ttl <= 0) { altar.status = 'expired'; pushEvent(s, 'altarExpired'); return; }
  const defending = alive.some(p => p.alive && !p.pendingPowers && distanceSq(p, altar) < altar.radius ** 2);
  if (!defending) return;
  altar.status = 'active';
  altar.progress = Math.min(ALTAR.seconds, altar.progress + dt);
  if (altar.progress >= altar.wave * 5 && altar.wave < 3) {
    altar.wave++;
    for (let n = 0; n < 6; n++) {
      const angle = n * Math.PI / 3;
      spawnEnemy(s, PHASES[s.phase].enemies[1], altar.x + Math.cos(angle) * 300,
        altar.y + Math.sin(angle) * 300, difficulty.hpScale);
    }
  }
  if (altar.progress >= ALTAR.seconds) {
    altar.status = 'complete';
    for (const p of Object.values(s.players)) { p.pendingChests++; p.coins += ALTAR.coins; }
    pushEvent(s, 'altarComplete', { x: altar.x, y: altar.y });
  }
}
