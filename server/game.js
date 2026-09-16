import { PHASES, TRANSITION_DURATION } from './phases.js';
import { COOP, DROPS, LIMITS, PLAYER_BASE, POWER_CHOICE_TIMEOUT, REVIVE, SIGNAL, SPECIAL, XP_CURVE } from './balance.js';
import { applyPower, offerPowers, rankOf } from './powers.js';
import { distanceSq, hurt, nearest, pushEvent } from './combat.js';
import { updatePlayerAttacks, updateShots, updateWeapons } from './weapons.js';
import { difficultyAt, spawnHorde, updateEnemies, updateEnemyShots } from './enemies.js';
import { summonBoss } from './bosses.js';
import { applyMeta } from './meta.js';
import { campaignOf, phaseClock, phaseDuration } from './campaign.js';
import { movementDelta } from './movement.js';
import { updateObjective } from './objectives.js';
import { updateEncounter } from './encounters.js';
import { healingScale, sanitizeCurses } from './curses.js';
import { createGrid } from './spatial.js';

export { DROP_TTL, LIMITS, REVIVE, SPECIAL } from './balance.js';
export { POWERS, applyPower, availablePowers, rerollPowers } from './powers.js';
export { SPELLS, activateSpecial } from './weapons.js';
export { difficultyAt } from './enemies.js';
export { activateDash } from './movement.js';

const EVENT_WINDOW = 1.5;
const grid = createGrid();

export function xpNeeded(level) {
  const { base, perLevel, perLevelSquared, scale } = XP_CURVE;
  return Math.floor((base + level * perLevel + level * level * perLevelSquared) * scale);
}

export function createGameState(campaign = 'classic', { curses = [], daily = null } = {}) {
  return { campaign: ['quick', 'endless'].includes(campaign) ? campaign : 'classic', altar: null, altarSpawned: false,
    curses: sanitizeCurses(curses), daily, loop: 0, encounter: null, encounterSpawned: false, bloodPact: false,
    time: 0, players: {}, enemies: [], shots: [], enemyShots: [], gems: [], hazards: [], runes: [], zones: [], events: [],
    spawn: 0, spawnCursor: 0, over: false, cleanup: 0, nextId: 0, eventSeq: 0, scheduleCursor: 0,
    phase: 0, phaseTime: 0, phaseStatus: 'horde', transitionTime: 0, victory: false };
}

export function createPlayer(id, name, color = 0, meta = null, loadout = null) {
  const player = {
    id, name, color, x: color * 55, y: 0, hp: PLAYER_BASE.hp, maxHp: PLAYER_BASE.hp, xp: 0, level: 1,
    alive: true, input: { x: 0, y: 0 }, speed: PLAYER_BASE.speed, damage: PLAYER_BASE.damage, attackDelay: PLAYER_BASE.attackDelay,
    attackCooldown: 0, projectiles: PLAYER_BASE.projectiles, pickupRadius: PLAYER_BASE.pickupRadius, armor: 0,
    hitCooldown: 0, invulnerableFor: 0, powers: {}, pendingPowers: null, powerTimer: 0, pendingChests: 0,
    specialCharge: 0, specialCooldown: 0, coins: 0, coinFrac: 0, coinMult: 1, xpMult: 1, rerolls: 1, phoenix: 0,
    dashFor: 0, dashCooldown: 0, dashX: 0, dashY: 1, moveX: 0, moveY: 1, motionId: 0,
    reviveProgress: 0, reviveBy: null, reviving: null, castCount: 0, castAngle: 0, orbitAngle: 0, inputSeq: 0,
    specialVariant: 0, signalAt: -Infinity,
    stats: { damage: 0, kills: 0, revives: 0, taken: 0, by: {} }
  };
  if (meta || loadout) applyMeta(player, meta, loadout);
  return player;
}

/** A player joining a running match starts beside an ally with catch-up XP instead of alone at level 1. */
export function addLatePlayer(s, player) {
  const others = Object.values(s.players);
  const anchor = others.find(p => p.alive) || others[0];
  if (anchor) { player.x = anchor.x + 60; player.y = anchor.y + 20; }
  const average = others.length ? others.reduce((sum, p) => sum + p.level, 0) / others.length : 1;
  const target = Math.max(1, Math.floor(average * 0.8));
  for (let level = 1; level < target; level++) player.xp += xpNeeded(level);
  player.invulnerableFor = 3;
  s.players[player.id] = player;
  return player;
}

function grantXp(ctx, player, amount) {
  player.xp += amount * (player.xpMult || 1);
  while (player.alive && !player.pendingPowers && player.xp >= xpNeeded(player.level)) {
    player.xp -= xpNeeded(player.level);
    player.level += 1;
    player.hp = Math.min(player.maxHp, player.hp + player.maxHp * 0.1 * healingScale(ctx.s));
    offerPowers(player, ctx.random, ctx);
  }
}

function progress(ctx, p) {
  if (p.pendingPowers) {
    // An idle player cannot stay invulnerable forever: the first option is taken for them.
    p.powerTimer = (p.powerTimer || 0) + ctx.dt;
    if (p.powerTimer >= POWER_CHOICE_TIMEOUT) applyPower(p, p.pendingPowers[0]);
    return;
  }
  if (p.pendingChests > 0) {
    p.pendingChests--;
    if (offerPowers(p, ctx.random, ctx)) return;
    p.coins += 10;
    p.hp = Math.min(p.maxHp, p.hp + 30 * healingScale(ctx.s));
  }
  grantXp(ctx, p, 0);
}

function reviveAllies(s, players, fallen, dt) {
  for (const p of players) p.reviving = null;
  for (const p of fallen) {
    const canHelp = helper => helper.alive && !helper.pendingPowers && !helper.reviving
      && distanceSq(helper, p) <= REVIVE.radius ** 2;
    const helper = players.find(other => other.id === p.reviveBy && canHelp(other)) || players.find(canHelp);
    if (!helper) { p.reviveProgress = 0; p.reviveBy = null; continue; }
    if (p.reviveBy !== helper.id) p.reviveProgress = 0;
    p.reviveBy = helper.id;
    helper.reviving = p.id;
    const guardian = rankOf(helper, 'guardian');
    p.reviveProgress = Math.min(REVIVE.seconds, p.reviveProgress + dt * (1 + guardian * COOP.guardian.reviveSpeedPerRank));
    if (p.reviveProgress >= REVIVE.seconds) {
      p.alive = true; p.hp = p.maxHp * (REVIVE.health + guardian * COOP.guardian.healthPerRank); p.invulnerableFor = 3;
      p.input = { x: 0, y: 0 }; p.hitCooldown = 0; p.pendingPowers = null;
      p.reviveProgress = 0; p.reviveBy = null; helper.reviving = null;
      if (helper.stats) helper.stats.revives++;
      pushEvent(s, 'revive', { x: Math.round(p.x), y: Math.round(p.y) });
    }
  }
}

function collect(ctx, gem, target) {
  const { s } = ctx;
  gem.dead = true;
  const type = gem.type || 'gem';
  if (type === 'heart') target.hp = Math.min(target.maxHp, target.hp + gem.value * healingScale(s));
  else if (type === 'greenGem') target.specialCharge = Math.min(SPECIAL.max, target.specialCharge + gem.value);
  else if (type === 'coin') {
    for (const p of Object.values(s.players)) {
      const earned = gem.value * campaignOf(s).coins * (p.coinMult || 1) + (p.coinFrac || 0);
      p.coins += Math.floor(earned);
      p.coinFrac = earned - Math.floor(earned);
    }
  } else if (type === 'magnet') {
    for (const other of s.gems) if ((other.type || 'gem') === 'gem') { other.pull = target.id; other.ttl = Math.max(other.ttl, 10); }
    pushEvent(s, 'magnet', { x: Math.round(target.x), y: Math.round(target.y) });
  } else if (type === 'chest') {
    for (const p of Object.values(s.players)) { p.pendingChests++; p.coins += 5; }
    pushEvent(s, 'chest', { x: Math.round(target.x), y: Math.round(target.y), player: target.id });
  } else {
    // Every teammate earns the same base XP, including a fallen ally awaiting rescue.
    const reward = gem.value * campaignOf(s).xp;
    for (const p of Object.values(s.players)) grantXp(ctx, p, reward);
  }
}

function collectDrops(ctx, survivors) {
  const { s, dt } = ctx;
  for (const gem of s.gems) {
    if (!gem.pull) gem.ttl -= dt;
    if (gem.ttl <= 0 || !survivors.length) continue;
    const type = gem.type || 'gem';
    let target = gem.pull ? survivors.find(p => p.id === gem.pull) : null;
    if (!target) {
      gem.pull = null;
      const eligible = survivors.filter(p => type === 'heart' ? p.hp < p.maxHp : type === 'greenGem' ? p.specialCharge < SPECIAL.max : true);
      if (!eligible.length) continue;
      target = nearest(gem, eligible);
    }
    const d2 = distanceSq(gem, target);
    if (gem.pull || d2 < target.pickupRadius ** 2) {
      const angle = Math.atan2(target.y - gem.y, target.x - gem.x);
      const step = Math.min(Math.sqrt(d2), (gem.pull ? DROPS.magnetSpeed : DROPS.pickupSpeed) * dt);
      gem.x += Math.cos(angle) * step; gem.y += Math.sin(angle) * step;
    }
    if (distanceSq(gem, target) < DROPS.collectRadius ** 2) collect(ctx, gem, target);
  }
}

function updateHazards({ s, dt, alive }) {
  for (const hazard of s.hazards) {
    hazard.warning -= dt;
    hazard.ttl -= dt;
    if (hazard.warning <= 0 && !hazard.fired) {
      hazard.fired = true;
      for (const p of alive) if (distanceSq(hazard, p) < hazard.radius ** 2) hurt(p, hazard.damage, s);
    }
  }
  s.hazards = s.hazards.filter(h => h.ttl > 0);
}

/** Vínculo vital: allies (not yourself) near a linked player slowly regenerate. */
function updateLifelink({ s, alive }) {
  for (const p of alive) {
    const rank = rankOf(p, 'lifelink');
    if (!rank || (p.lifelinkAt ?? 0) > s.time) continue;
    p.lifelinkAt = s.time + COOP.lifelink.every;
    for (const ally of alive) {
      if (ally !== p && distanceSq(ally, p) < COOP.lifelink.range ** 2) {
        ally.hp = Math.min(ally.maxHp, ally.hp + rank * COOP.lifelink.healPerRank * healingScale(s));
      }
    }
  }
}

/** Co-op callouts: a marker every teammate sees, rate-limited per player. */
export function sendSignal(s, playerId, kind, at = null) {
  const p = s.players[playerId];
  if (!p || s.over || !SIGNAL.kinds.includes(kind) || s.time - (p.signalAt ?? -Infinity) < SIGNAL.cooldown) return false;
  const x = Number.isFinite(at?.x) ? at.x : p.x, y = Number.isFinite(at?.y) ? at.y : p.y;
  if ((x - p.x) ** 2 + (y - p.y) ** 2 > SIGNAL.range ** 2) return false;
  p.signalAt = s.time;
  pushEvent(s, 'signal', { x: Math.round(x), y: Math.round(y), signal: kind, player: p.id, name: p.name, color: p.color });
  return true;
}

function startNextPhase(s, alive) {
  s.phase++;
  if (s.phase >= PHASES.length) {
    s.phase = 0;
    s.loop = (s.loop || 0) + 1;
    pushEvent(s, 'loop', { loop: s.loop });
  }
  s.phaseTime = 0;
  s.phaseStatus = 'horde';
  s.spawn = 0;
  s.scheduleCursor = 0;
  s.altar = null; s.altarSpawned = false;
  s.encounter = null; s.encounterSpawned = false; s.bloodPact = false;
  for (const p of alive) {
    p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.35 * healingScale(s));
    p.invulnerableFor = 3;
    p.pendingChests++; // The guardian's reward: a free power choice.
  }
}

export function updateGame(s, dt, random = Math.random) {
  if (s.over) return;
  const players = Object.values(s.players);
  const alive = players.filter(p => p.alive);
  const fallen = players.filter(p => !p.alive);
  if (!alive.length) { s.over = players.length > 0; return; }
  s.time += dt;
  s.events ??= [];
  s.runes ??= [];
  s.zones ??= [];
  if (s.events.length && s.events[0].t < s.time - EVENT_WINDOW) s.events = s.events.filter(event => event.t >= s.time - EVENT_WINDOW);
  if (s.phaseStatus === 'transition') {
    s.transitionTime = Math.max(0, s.transitionTime - dt);
    if (!s.transitionTime) startNextPhase(s, alive);
    return;
  }
  if (s.phaseStatus === 'horde') {
    s.phaseTime = Math.min(phaseDuration(s), s.phaseTime + dt);
    if (s.phaseTime >= phaseDuration(s)) summonBoss(s, alive);
  }
  const ctx = { s, dt, random, alive, grid, coop: players.length > 1,
    difficulty: difficultyAt(phaseClock(s), alive.length, s.phase, s) };

  for (const p of alive) {
    progress(ctx, p);
    p.hitCooldown = Math.max(0, p.hitCooldown - dt);
    p.invulnerableFor = Math.max(0, p.invulnerableFor - dt);
    p.attackCooldown -= dt;
    p.dashCooldown = Math.max(0, (p.dashCooldown || 0) - dt);
    p.specialCooldown = Math.max(0, (p.specialCooldown || 0) - dt);
    if (!p.pendingPowers) {
      if (p.input.x || p.input.y) { p.moveX = p.input.x; p.moveY = p.input.y; }
      const movement = movementDelta(p, p.input, dt);
      p.x += movement.x; p.y += movement.y;
    }
    p.dashFor = Math.max(0, (p.dashFor || 0) - dt);
  }

  if (s.phaseStatus === 'horde') spawnHorde(ctx);
  updateObjective(ctx);
  updateEncounter(ctx);
  updatePlayerAttacks(ctx);
  updateEnemies(ctx);
  grid.clear();
  for (const enemy of s.enemies) if (enemy.hp > 0) grid.insert(enemy);
  updateHazards(ctx);
  updateEnemyShots(ctx);
  updateShots(ctx);
  updateWeapons(ctx);
  s.enemies = s.enemies.filter(enemy => enemy.hp > 0);

  if (ctx.coop) updateLifelink(ctx);
  reviveAllies(s, players, fallen, dt);
  const survivors = players.filter(p => p.alive);
  collectDrops(ctx, survivors);

  s.cleanup -= dt;
  if (s.cleanup <= 0) {
    s.cleanup = 0.75;
    s.gems = s.gems.filter(gem => !gem.dead && gem.ttl > 0 && alive.some(p => distanceSq(gem, p) < 1500 ** 2)).slice(-LIMITS.drops);
    s.enemies = s.enemies.filter(enemy => enemy.boss || (enemy.age < 75 && alive.some(p => distanceSq(enemy, p) < 1450 ** 2))).slice(-LIMITS.enemies);
  } else {
    s.gems = s.gems.filter(gem => !gem.dead && gem.ttl > 0).slice(-LIMITS.drops);
  }
  if (players.every(p => !p.alive)) s.over = true;
  if (!s.over && s.phaseStatus === 'boss' && !s.enemies.some(e => e.boss)) {
    s.enemies = []; s.shots = []; s.enemyShots = []; s.gems = []; s.hazards = []; s.runes = []; s.zones = [];
    pushEvent(s, 'bossDown', { phase: s.phase, loop: s.loop || 0 });
    if (s.phase === PHASES.length - 1 && campaignOf(s).endless) {
      // Endless: the ritual circles back to the first realm, one lap harder (see startNextPhase).
      s.phaseStatus = 'transition'; s.transitionTime = TRANSITION_DURATION;
    } else if (s.phase === PHASES.length - 1) {
      s.victory = true; s.over = true; s.phaseStatus = 'complete';
      for (const p of players) p.pendingPowers = null;
    } else {
      s.phaseStatus = 'transition'; s.transitionTime = TRANSITION_DURATION;
    }
  }
}

const PLAYER_FIELDS = ['id', 'name', 'color', 'x', 'y', 'hp', 'maxHp', 'xp', 'level', 'alive', 'speed', 'powers', 'pendingPowers',
  'specialCharge', 'coins', 'reviveProgress', 'reviveBy', 'reviving', 'castCount', 'castAngle', 'invulnerableFor', 'orbitAngle',
  'rerolls', 'phoenix', 'stats', 'inputSeq', 'powerTimer', 'connected',
  'specialCooldown', 'dashFor', 'dashCooldown', 'dashX', 'dashY', 'moveX', 'moveY', 'motionId', 'familiar', 'specialVariant', 'shopProgress'];

/** The client-facing view of the state: what rendering and the HUD need, nothing private to the simulation. */
export function publicState(s) {
  return {
    campaign: s.campaign, altar: s.altar, encounter: s.encounter, curses: s.curses || [], loop: s.loop || 0, bloodPact: Boolean(s.bloodPact), time: s.time, over: s.over, victory: s.victory, phase: s.phase, phaseTime: s.phaseTime,
    phaseStatus: s.phaseStatus, transitionTime: s.transitionTime, hazards: s.hazards,
    players: Object.fromEntries(Object.entries(s.players).map(([id, p]) => [id, Object.fromEntries(PLAYER_FIELDS.map(key => [key, p[key]]))])),
    enemies: s.enemies.map(({ id, type, x, y, hp, maxHp, boss, elite, thief, stage, slowFor, windup, fuse, dashWarn, dashAngle }) =>
      ({ id, type, x, y, hp, maxHp, boss, elite, thief, stage, slowFor, windup, fuse, dashWarn, dashAngle })),
    shots: s.shots.map(({ x, y, vx, vy, color, special, shard, returning, fullmoon }) => ({ x, y, vx, vy, color, special, shard, returning, fullmoon })),
    enemyShots: s.enemyShots, gems: s.gems.map(({ id, x, y, type, value, ttl }) => ({ id, x, y, type, value, ttl })),
    runes: s.runes || [], zones: s.zones || [], events: s.events || []
  };
}

