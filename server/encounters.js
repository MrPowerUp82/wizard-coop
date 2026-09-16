import { ENCOUNTERS } from './balance.js';
import { phaseDuration } from './campaign.js';
import { addDrop, distanceSq, pushEvent, spawnEnemy } from './combat.js';
import { PHASES } from './phases.js';

export const ENCOUNTER_KINDS = Object.freeze(['merchant', 'shrine', 'thief']);

function place(focus, random, distance) {
  const angle = random() * Math.PI * 2;
  return { x: focus.x + Math.cos(angle) * distance, y: focus.y + Math.sin(angle) * distance };
}

function start(ctx) {
  const { s, alive, random, difficulty } = ctx;
  const kind = ENCOUNTER_KINDS[Math.floor(random() * ENCOUNTER_KINDS.length)];
  const focus = alive[Math.floor(random() * alive.length)];
  s.encounterSpawned = true;
  if (kind === 'thief') {
    const cfg = ENCOUNTERS.thief;
    const at = place(focus, random, 260);
    const thief = spawnEnemy(s, PHASES[s.phase].enemies[0], at.x, at.y, difficulty.hpScale * cfg.hp,
      { elite: true, thief: true });
    if (!thief) return;
    s.encounter = { kind, x: thief.x, y: thief.y, radius: 0, progress: 0, ttl: cfg.ttl, status: 'active', enemyId: thief.id };
  } else {
    const cfg = ENCOUNTERS[kind];
    const at = place(focus, random, 320);
    s.encounter = { kind, ...at, radius: cfg.radius, progress: 0, ttl: cfg.ttl, status: 'waiting', buyers: [] };
  }
  pushEvent(s, 'encounter', { x: Math.round(s.encounter.x), y: Math.round(s.encounter.y), encounter: kind });
}

function updateMerchant(ctx, encounter) {
  const { s, alive, dt } = ctx;
  const cfg = ENCOUNTERS.merchant;
  for (const p of alive) {
    const inside = !p.pendingPowers && distanceSq(p, encounter) < encounter.radius ** 2;
    if (!inside || encounter.buyers.includes(p.id) || p.coins < cfg.cost) { p.shopProgress = 0; continue; }
    encounter.status = 'active';
    p.shopProgress = (p.shopProgress || 0) + dt;
    if (p.shopProgress < cfg.seconds) continue;
    p.shopProgress = 0;
    p.coins -= cfg.cost;
    p.pendingChests++;
    encounter.buyers.push(p.id);
    pushEvent(s, 'merchantSale', { x: Math.round(encounter.x), y: Math.round(encounter.y), player: p.id });
  }
  encounter.progress = Math.max(0, ...alive.map(p => p.shopProgress || 0));
  if (Object.keys(s.players).every(id => encounter.buyers.includes(id))) encounter.status = 'complete';
}

function updateShrine(ctx, encounter) {
  const { s, alive, dt } = ctx;
  const cfg = ENCOUNTERS.shrine;
  if (!alive.some(p => !p.pendingPowers && distanceSq(p, encounter) < encounter.radius ** 2)) return;
  encounter.status = 'active';
  encounter.progress = Math.min(cfg.seconds, encounter.progress + dt);
  if (encounter.progress < cfg.seconds) return;
  encounter.status = 'complete';
  s.bloodPact = true;
  for (const p of Object.values(s.players)) { p.pendingChests++; p.coins += cfg.coins; }
  pushEvent(s, 'shrineAccepted', { x: Math.round(encounter.x), y: Math.round(encounter.y) });
}

function updateThief(ctx, encounter) {
  const { s } = ctx;
  const thief = s.enemies.find(e => e.id === encounter.enemyId);
  if (thief?.hp <= 0) return; // A kill is resolved by thiefDown in combat.
  if (thief) { encounter.x = thief.x; encounter.y = thief.y; }
  // Running out of time, or outrunning everyone far enough to be culled, both count as an escape.
  if (thief && encounter.ttl > 0) return;
  if (thief) { thief.hp = 0; thief.escaped = true; }
  encounter.status = 'expired';
  pushEvent(s, 'thiefEscaped', { x: Math.round(encounter.x), y: Math.round(encounter.y) });
}

/** A second, randomly chosen mid-realm encounter: a merchant, a cursed shrine or a thief fleeing with loot. */
export function updateEncounter(ctx) {
  const { s, dt } = ctx;
  if (s.phaseStatus !== 'horde') return;
  if (!s.encounter && !s.encounterSpawned && s.phaseTime >= phaseDuration(s) * ENCOUNTERS.appearsAt && ctx.alive.length) start(ctx);
  const encounter = s.encounter;
  if (!encounter || ['complete', 'expired'].includes(encounter.status)) return;
  encounter.ttl -= dt;
  if (encounter.kind === 'thief') return updateThief(ctx, encounter);
  if (encounter.ttl <= 0) { encounter.status = 'expired'; return; }
  if (encounter.kind === 'merchant') updateMerchant(ctx, encounter);
  else updateShrine(ctx, encounter);
}

/** Called from combat when the thief dies: the stolen purse bursts open. */
export function thiefDown(s, enemy) {
  const cfg = ENCOUNTERS.thief;
  for (let n = 0; n < cfg.purses; n++) addDrop(s, enemy.x + (n - 1) * 22, enemy.y + 20, 'coin', cfg.coins);
  if (s.encounter?.enemyId === enemy.id) s.encounter.status = 'complete';
  pushEvent(s, 'thiefDown', { x: Math.round(enemy.x), y: Math.round(enemy.y) });
}
