// Headless balance probe: bots play full campaigns against the real simulation.
// Usage: npm run sim -- [runs=8] [players=1] [quick|classic|endless] [max] [out.json] [curse,curse]
import { activateDash, activateSpecial, applyPower, createGameState, createPlayer, updateGame } from '../server/game.js';
import { META_UPGRADES } from '../server/meta.js';
import fs from 'node:fs';
import { PHASES, PHASE_DURATION } from '../server/phases.js';

const runs = Number(process.argv[2] || 8);
const playerCount = Number(process.argv[3] || 1);
const campaign = ['classic', 'endless'].includes(process.argv[4]) ? process.argv[4] : 'quick';
const permanent = process.argv[5] === 'max' ? Object.fromEntries(Object.entries(META_UPGRADES).map(([id, p]) => [id, p.costs.length])) : null;
const TICK = 1 / 30;
const PREFERENCE = ['constellation', 'tempest', 'sanctuary', 'minefield', 'covenant', 'solarcrown', 'stormrunes', 'avalanche', 'hellfire',
  'bramble', 'fullmoon', 'multishot', 'orbit', 'arcane', 'chain', 'haste', 'shatter', 'burn', 'ricochet', 'boomerang', 'aura', 'familiar',
  'vitality', 'runes', 'armor', 'bond', 'guardian', 'lifelink', 'magnet', 'swiftness'];
const curses = (process.argv[7] || '').split(',').filter(Boolean);

function seeded(seed) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
}

/** Kites away from enemies and hazards, sidesteps shots and drifts toward drops. */
function steer(s, p) {
  let ax = 0, ay = 0;
  for (const e of s.enemies) {
    const dx = p.x - e.x, dy = p.y - e.y, d = Math.hypot(dx, dy) + 1, r = e.boss ? 260 : 170;
    if (d < r) { const w = (r - d) / r * 3; ax += dx / d * w; ay += dy / d * w; }
  }
  for (const h of s.hazards) {
    const dx = p.x - h.x, dy = p.y - h.y, d = Math.hypot(dx, dy) + 1;
    if (d < h.radius + 30) { ax += dx / d * 6; ay += dy / d * 6; }
  }
  for (const shot of s.enemyShots) {
    // Dodge like a player would: step sideways from shots whose path passes close within a second.
    const rx = p.x - shot.x, ry = p.y - shot.y, v2 = shot.vx ** 2 + shot.vy ** 2 || 1;
    const t = Math.max(0, (rx * shot.vx + ry * shot.vy) / v2);
    if (t > 1) continue;
    const cx = rx - shot.vx * t, cy = ry - shot.vy * t, miss = Math.hypot(cx, cy);
    if (miss < 60) { const w = (60 - miss) / 60 * 5; ax += (cx || -shot.vy) / (miss || 1) * w; ay += (cy || shot.vx) / (miss || 1) * w; }
  }
  let best = null, bestD = 500;
  for (const gem of s.gems) { const d = Math.hypot(gem.x - p.x, gem.y - p.y); if (d < bestD) { bestD = d; best = gem; } }
  if (best) { ax += (best.x - p.x) / bestD; ay += (best.y - p.y) / bestD; }
  const boss = s.enemies.find(e => e.boss);
  if (boss) { const dx = boss.x - p.x, dy = boss.y - p.y, d = Math.hypot(dx, dy); if (d > 380) { ax += dx / d * 0.8; ay += dy / d * 0.8; } }
  const fallen = Object.values(s.players).find(q => !q.alive);
  if (fallen) { const dx = fallen.x - p.x, dy = fallen.y - p.y, d = Math.hypot(dx, dy) + 1; ax += dx / d * 2; ay += dy / d * 2; }
  const altar = s.altar;
  if (altar && ['waiting', 'active'].includes(altar.status) && p.hp > p.maxHp * 0.5 && !fallen) {
    const dx = altar.x - p.x, dy = altar.y - p.y, d = Math.hypot(dx, dy) + 1;
    if (d > 35) { ax += dx / d * 2; ay += dy / d * 2; }
  }
  const length = Math.hypot(ax, ay);
  return length ? { x: ax / length, y: ay / length } : { x: 0, y: 0 };
}

function play(seed) {
  const random = seeded(seed);
  const s = createGameState(campaign, { curses });
  for (let n = 0; n < playerCount; n++) s.players[`p${n}`] = createPlayer(`p${n}`, 'bot', (seed + n) % 4, permanent);
  const players = Object.values(s.players);
  const bosses = [];
  let bossStart = null, peakEnemies = 0, firstHit = null, lowest = 1;
  let altars = 0, lastAltarPhase = -1;
  const milestones = [];
  while (!s.over && s.time < PHASES.length * (PHASE_DURATION + 180)) {
    for (const p of players) {
      if (!p.alive) continue;
      p.input = steer(s, p);
      if (p.pendingPowers) applyPower(p, PREFERENCE.find(id => p.pendingPowers.includes(id)) || p.pendingPowers[0]);
      if (p.specialCharge >= 100) activateSpecial(s, p.id, random);
      if (s.enemies.some(e => e.hp > 0 && Math.hypot(e.x - p.x, e.y - p.y) < 90)
        || s.hazards.some(h => h.warning < 0.4 && Math.hypot(h.x - p.x, h.y - p.y) < h.radius)) activateDash(s, p.id, p.input);
    }
    const status = s.phaseStatus;
    updateGame(s, TICK, random);
    if (status !== 'boss' && s.phaseStatus === 'boss') { bossStart = s.time; milestones.push({ phase: s.phase + 1, levels: players.map(p => p.level), ranks: players.map(p => Object.values(p.powers).reduce((a, b) => a + b, 0)) }); }
    if (status === 'boss' && s.phaseStatus !== 'boss') bosses.push(Math.round(s.time - bossStart));
    peakEnemies = Math.max(peakEnemies, s.enemies.length);
    if (s.altar?.status === 'complete' && lastAltarPhase !== s.phase) { altars++; lastAltarPhase = s.phase; }
    for (const p of players) {
      if (firstHit === null && p.hp < p.maxHp) firstHit = Math.round(s.time);
      if (p.alive) lowest = Math.min(lowest, p.hp / p.maxHp);
    }
  }
  const lead = players[0];
  return {
    seed, campaign, meta: permanent ? 'max' : 'none', end: Math.round(s.time), victory: s.victory, phase: s.phase + 1, status: s.phaseStatus,
    level: lead.level, bossSeconds: bosses, peakEnemies, firstHit, lowestHp: Math.round(lowest * 100),
    weapons: Object.keys(lead.powers).filter(id => ['orbit', 'aura', 'chain', 'runes', 'familiar'].includes(id)).join('+') || '-',
    kills: lead.stats.kills, coins: lead.coins, levels: players.map(p => p.level), altars, milestones
  };
}

const results = Array.from({ length: runs }, (_, n) => play(11 + n * 7));
console.table(results.map(r => ({ ...r, milestones: undefined, levels: r.levels.join('/'), bossSeconds: r.bossSeconds.join('/') })));
if (process.argv[6]) fs.writeFileSync(process.argv[6], JSON.stringify(results, null, 2));
const wins = results.filter(r => r.victory).length;
const bossTimes = results.flatMap(r => r.bossSeconds);
console.log(`${playerCount} jogador(es): ${wins}/${runs} vitórias · chefe médio ${bossTimes.length ? Math.round(bossTimes.reduce((a, b) => a + b, 0) / bossTimes.length) : '-'}s · fim médio ${Math.round(results.reduce((a, r) => a + r.end, 0) / runs)}s`);
