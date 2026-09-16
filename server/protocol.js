// Compact wire format for co-op snapshots. Entities become rounded number arrays and only what is near
// the viewer is sent; decodeState rebuilds the same shape publicState() produces for offline play.
import { ENEMIES } from './phases.js';

export const VIEW_RADIUS = 1250;
const ENEMY_TYPES = Object.keys(ENEMIES);
const DROP_TYPES = ['gem', 'heart', 'greenGem', 'coin', 'magnet', 'chest'];
const SPRITES = ['bolt', 'fire', 'thorn', 'blade'];
const STATUSES = ['horde', 'boss', 'transition', 'complete'];

const round = Math.round;
const tenth = value => Math.round(value * 10) / 10;
const hundredth = value => Math.round(value * 100) / 100;

const ENEMY_FLAGS = { boss: 1, elite: 2, slowed: 4, windup: 8, fuse: 16, dashWarn: 32 };
const SHOT_FLAGS = { special: 1, shard: 2, returning: 4 };

// Players travel as value arrays in PLAYER_KEYS order, so field names are not repeated on every tick.
const PLAYER_KEYS = ['id', 'name', 'color', 'x', 'y', 'hp', 'maxHp', 'xp', 'level', 'alive', 'speed', 'powers', 'pendingPowers',
  'specialCharge', 'coins', 'reviveProgress', 'reviveBy', 'reviving', 'castCount', 'castAngle', 'invulnerableFor', 'orbitAngle',
  'rerolls', 'phoenix', 'inputSeq', 'powerTimer', 'connected', 'dashFor', 'dashCooldown', 'dashX', 'dashY', 'moveX', 'moveY',
  'specialCooldown', 'motionId', 'stats', 'familiar'];

function encodePlayer(p) {
  return [
    p.id, p.name, p.color, tenth(p.x), tenth(p.y), tenth(p.hp), round(p.maxHp),
    round(p.xp), p.level, p.alive, round(p.speed), p.powers, p.pendingPowers,
    round(p.specialCharge), p.coins, hundredth(p.reviveProgress), p.reviveBy,
    p.reviving, p.castCount, hundredth(p.castAngle), tenth(p.invulnerableFor),
    hundredth(p.orbitAngle || 0), p.rerolls, p.phoenix, p.inputSeq,
    tenth(p.powerTimer || 0), p.connected !== false,
    hundredth(p.dashFor || 0), tenth(p.dashCooldown || 0),
    hundredth(p.dashX || 0), hundredth(p.dashY || 0),
    hundredth(p.moveX || 0), hundredth(p.moveY || 0),
    tenth(p.specialCooldown || 0), p.motionId || 0,
    { damage: round(p.stats.damage), kills: p.stats.kills, revives: p.stats.revives, taken: round(p.stats.taken) },
    p.familiar ? [round(p.familiar.x), round(p.familiar.y)] : null
  ];
}

function decodePlayer(row) {
  const player = Object.fromEntries(PLAYER_KEYS.map((key, i) => [key, row[i] ?? null]));
  if (player.familiar) player.familiar = { x: player.familiar[0], y: player.familiar[1] };
  return player;
}

export function encodeState(s, viewerId) {
  const players = Object.values(s.players);
  const viewer = s.players[viewerId];
  let foci = viewer?.alive ? [viewer] : players.filter(p => p.alive);
  if (!foci.length) foci = players;
  const near = entity => foci.some(f => (entity.x - f.x) ** 2 + (entity.y - f.y) ** 2 < VIEW_RADIUS ** 2);
  const enemies = [];
  for (const e of s.enemies) {
    if (!e.boss && !near(e)) continue;
    const flags = (e.boss ? ENEMY_FLAGS.boss : 0) | (e.elite ? ENEMY_FLAGS.elite : 0) | (e.slowFor > 0 ? ENEMY_FLAGS.slowed : 0)
      | (e.windup > 0 ? ENEMY_FLAGS.windup : 0) | (e.fuse > 0 ? ENEMY_FLAGS.fuse : 0) | (e.dashWarn > 0 ? ENEMY_FLAGS.dashWarn : 0)
      | (e.rootFor > 0 ? 64 : 0) | (e.freezeFor > 0 ? 128 : 0) | (e.burningFor > 0 ? 256 : 0);
    const row = [e.id, ENEMY_TYPES.indexOf(e.type), round(e.x), round(e.y), Math.ceil(e.hp), Math.ceil(e.maxHp), flags];
    if (e.boss) row.push(e.stage || 1, hundredth(e.dashAngle || 0));
    enemies.push(row);
  }
  return {
    ca: s.campaign || 'classic',
    a: s.altar ? [round(s.altar.x), round(s.altar.y), s.altar.radius, tenth(s.altar.progress), tenth(s.altar.ttl), s.altar.status] : null,
    t: hundredth(s.time), o: s.over ? 1 : 0, v: s.victory ? 1 : 0, ph: s.phase, pt: tenth(s.phaseTime),
    st: STATUSES.indexOf(s.phaseStatus), tt: tenth(s.transitionTime),
    p: players.map(encodePlayer),
    e: enemies,
    s: s.shots.filter(near).map(shot => [round(shot.x), round(shot.y), round(shot.vx), round(shot.vy), shot.color ?? 0,
      (shot.special ? SHOT_FLAGS.special : 0) | (shot.shard ? SHOT_FLAGS.shard : 0) | (shot.returning ? SHOT_FLAGS.returning : 0)]),
    es: s.enemyShots.filter(near).map(shot => [round(shot.x), round(shot.y), round(shot.vx), round(shot.vy), SPRITES.indexOf(shot.sprite)]),
    g: s.gems.filter(near).map(gem => [gem.id ?? 0, round(gem.x), round(gem.y), DROP_TYPES.indexOf(gem.type || 'gem'), gem.value]),
    h: s.hazards.map(h => [round(h.x), round(h.y), round(h.radius), hundredth(h.warning), hundredth(h.warn0 ?? 1.3), h.fired ? 1 : 0]),
    r: (s.runes || []).filter(near).map(rune => [rune.id, round(rune.x), round(rune.y), rune.color, rune.arm > 0 ? 0 : 1, round(rune.radius)]),
    z: (s.zones || []).filter(near).map(zone => [zone.id, round(zone.x), round(zone.y), round(zone.radius), zone.color, zone.kind || 'burn', hundredth(zone.warning || 0)]),
    ev: s.events || []
  };
}

export function decodeState(c) {
  const has = (flags, bit) => (flags & bit) !== 0;
  return {
    campaign: c.ca || 'classic',
    altar: c.a ? { x: c.a[0], y: c.a[1], radius: c.a[2], progress: c.a[3], ttl: c.a[4], status: c.a[5] } : null,
    time: c.t, over: Boolean(c.o), victory: Boolean(c.v), phase: c.ph, phaseTime: c.pt, phaseStatus: STATUSES[c.st], transitionTime: c.tt,
    players: Object.fromEntries(c.p.map(row => [row[0], decodePlayer(row)])),
    enemies: c.e.map(([id, type, x, y, hp, maxHp, flags, stage, dashAngle]) => ({
      id, type: ENEMY_TYPES[type], x, y, hp, maxHp, boss: has(flags, ENEMY_FLAGS.boss) || undefined, elite: has(flags, ENEMY_FLAGS.elite) || undefined,
      slowFor: has(flags, ENEMY_FLAGS.slowed) ? 1 : 0, windup: has(flags, ENEMY_FLAGS.windup) ? 1 : 0, fuse: has(flags, ENEMY_FLAGS.fuse) ? 1 : 0,
      dashWarn: has(flags, ENEMY_FLAGS.dashWarn) ? 1 : 0, stage, dashAngle
      , rootFor: has(flags, 64) ? 1 : 0, freezeFor: has(flags, 128) ? 1 : 0, burningFor: has(flags, 256) ? 1 : 0
    })),
    shots: c.s.map(([x, y, vx, vy, color, flags]) => ({ x, y, vx, vy, color, special: has(flags, SHOT_FLAGS.special),
      shard: has(flags, SHOT_FLAGS.shard), returning: has(flags, SHOT_FLAGS.returning) })),
    enemyShots: c.es.map(([x, y, vx, vy, sprite]) => ({ x, y, vx, vy, sprite: SPRITES[sprite] })),
    gems: c.g.map(([id, x, y, type, value]) => ({ id, x, y, type: DROP_TYPES[type], value, ttl: 24 })),
    hazards: c.h.map(([x, y, radius, warning, warn0, fired]) => ({ x, y, radius, warning, warn0, fired: Boolean(fired) })),
    runes: c.r.map(([id, x, y, color, armed, radius]) => ({ id, x, y, color, arm: armed ? 0 : 1, radius })),
    zones: c.z.map(([id, x, y, radius, color, kind, warning]) => ({ id, x, y, radius, color, kind: kind || 'burn', warning: warning || 0, ttl: 1 })),
    events: c.ev
  };
}
