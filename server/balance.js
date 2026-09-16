// Every tuning number of the simulation lives here, so balance passes never touch logic.

export const LIMITS = Object.freeze({ enemies: 180, shots: 320, enemyShots: 96, drops: 220, hazards: 12, runes: 24, zones: 24 });
export const DROP_TTL = 24;
export const REVIVE = Object.freeze({ seconds: 4, radius: 44, health: 0.4 });
export const SPECIAL = Object.freeze({ max: 100, crystal: 25, shots: 12 });
export const DASH = Object.freeze({ cooldown: 4, seconds: 0.18, speed: 850 });
export const SPECIAL_COOLDOWN = 8;
export const ALTAR = Object.freeze({ appearsAt: 0.3, radius: 120, seconds: 15, expiresAfter: 45, coins: 20 });
// Mid-realm encounter, rolled once per horde after the altar.
export const ENCOUNTERS = Object.freeze({
  appearsAt: 0.6,
  merchant: { radius: 80, seconds: 1.5, cost: 20, ttl: 40 },
  shrine: { radius: 90, seconds: 3, ttl: 40, coins: 15, enemyDamage: 1.3 },
  thief: { ttl: 20, hp: 4, speed: 1.45, purses: 3, coins: 4 }
});
export const ENDLESS = Object.freeze({ bossHpPerLoop: 0.9, hpPerLoop: 0.6 });
export const SIGNAL = Object.freeze({ cooldown: 0.8, kinds: ['here', 'help', 'danger', 'look'], range: 2500 });
export const COOP = Object.freeze({
  teamCombo: { damage: 2, charge: 6 },
  convergence: { window: 1.5, range: 420, radius: 320, damage: 4 },
  lifelink: { range: 240, every: 2, healPerRank: 2 },
  guardian: { reviveSpeedPerRank: 0.5, healthPerRank: 0.15 }
});
export const POWER_CHOICE_TIMEOUT = 15;
export const INVULNERABLE_AFTER_CHOICE = 3;

export const PLAYER_BASE = Object.freeze({
  hp: 100, speed: 190, damage: 14, attackDelay: 0.62, pickupRadius: 105, projectiles: 1
});

export const DIFFICULTY = Object.freeze({
  // Each phase starts this many "minutes" into the ramp instead of inheriting the global clock.
  phaseOffsetMinutes: 3,
  spawnInterval: { start: 0.5, perMinute: 0.04, min: 0.25 },
  hpPerMinute: 0.2,
  hpPerMinuteSquared: 0.018,
  hpPerExtraPlayer: 0.3,
  damage: { perMinute: 0.085, max: 2.1 },
  speed: { perMinute: 0.028, max: 1.22 },
  spawnCountEveryMinutes: 1.5,
  adaptiveLimit: { base: 45, perPhaseSecond: 0.3, perPhase: 20, perPlayer: 18 },
  spawnDistance: { min: 520, spread: 120 },
  maxBatch: 6
});

export const CONTACT = Object.freeze({
  // Each enemy bites on its own cooldown, so crowds are dangerous but a single enemy is not.
  damageScale: 0.7, enemyCooldown: 0.8, playerCooldown: 0.1, radius: 34
});

export const SEPARATION = Object.freeze({ radius: 30, strength: 0.5 });

export const DROPS = Object.freeze({
  heart: 0.05, greenGem: 0.2, coin: 0.03,
  mergeAt: 140, mergeRadius: 90,
  magnetSpeed: 620, pickupSpeed: 350, collectRadius: 24
});

export const ELITE = Object.freeze({ hp: 7, damage: 1.5, speed: 0.9, xp: 6 });

// Scheduled beats inside every 300s horde.
export const PHASE_SCHEDULE = Object.freeze([
  { at: 6, kind: 'opening' },
  { at: 90, kind: 'elite' },
  { at: 135, kind: 'ring' },
  { at: 180, kind: 'elite' },
  { at: 230, kind: 'ring' },
  { at: 270, kind: 'elite' }
]);

export const BOSS = Object.freeze({
  health: [4500, 14000, 26000, 40000, 58000, 76000],
  // Boss HP targets this many seconds of the group's estimated sustained damage.
  timeToKill: [45, 60, 70, 75, 80, 90],
  dpsEfficiency: 0.7,
  extraPlayerHp: 0.6,
  stageThresholds: [0.66, 0.33],
  stageCooldown: [1, 0.8, 0.65],
  stageMinions: 4,
  shockwave: { radius: 210, warning: 1, damage: 12 },
  shotDamage: 0.45,
  shotRadius: 10,
  rangedCooldown: { treant: 3.6, lich: 3.2, demon: 2.6, bogwarden: 3.4, archon: 3.6, umbra: 3.2 },
  areaCooldown: { treant: 4.5, lich: 4.5, demon: 3.6, bogwarden: 4.8, archon: 4.5, umbra: 4.6 }
});

export const WEAPONS = Object.freeze({
  orbit: { counts: [1, 2, 2, 3, 3], radius: 78, speed: 2.7, damage: 0.55, damagePerRank: 0.1, hitEvery: 0.5, size: 16 },
  aura: { radius: 70, radiusPerRank: 10, every: 0.5, damage: 0.25, damagePerRank: 0.08 },
  chain: { cooldown: 2.4, cooldownPerRank: 0.2, range: 260, jumpRange: 150, damage: 0.8, damagePerRank: 0.1 },
  runes: { cooldown: 3.2, cooldownPerRank: 0.25, trigger: 26, radius: 70, radiusPerRank: 8, damage: 1.6, damagePerRank: 0.3, ttl: 8, arm: 0.4 },
  burn: { radius: 55, ttl: 2, dps: 0.5 },
  shatter: { shards: 4, damage: 0.6, ttl: 0.5 },
  ricochet: { range: 220 },
  bond: { range: 240, hastePerRank: 0.08 },
  familiar: { range: 380, cooldown: 1.3, cooldownPerRank: 0.12, damage: 0.9, damagePerRank: 0.22, hover: 62, follow: 6, lunge: 0.35, targets: [1, 1, 2, 2, 3] },
  evolutions: {
    constellation: { extraOrbs: 2, damage: 2 },
    sanctuary: { radius: 30, heal: 2, slow: true },
    tempest: { cooldown: 1, jumps: 8 },
    minefield: { runes: 3, radius: 30 },
    covenant: { targets: 2, cooldown: 0.6, damage: 1.4 },
    avalanche: { shards: 8, damage: 0.9 },
    hellfire: { radius: 80, ttl: 3, dps: 0.75 },
    bramble: { pierce: 2, damage: 1.15 },
    fullmoon: { returnDamage: 1.6, size: 1.35 },
    stormrunes: { jumps: 3, damage: 0.7, jumpRange: 170 },
    solarcrown: { damage: 1.3 }
  }
});
