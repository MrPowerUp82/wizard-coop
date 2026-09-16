import { INVULNERABLE_AFTER_CHOICE } from './balance.js';

// kind: passive | weapon | signature (one character only) | coop (2+ players) | evolution (unlocked by requirements)
export const POWERS = Object.freeze({
  arcane: { title: 'Poder arcano', max: 5, kind: 'passive' },
  haste: { title: 'Cadência', max: 5, kind: 'passive' },
  vitality: { title: 'Vitalidade', max: 5, kind: 'passive' },
  swiftness: { title: 'Passos do vento', max: 5, kind: 'passive' },
  multishot: { title: 'Disparo múltiplo', max: 3, kind: 'passive' },
  magnet: { title: 'Magnetismo', max: 4, kind: 'passive' },
  armor: { title: 'Armadura rúnica', max: 5, kind: 'passive' },
  orbit: { title: 'Orbes arcanos', max: 5, kind: 'weapon' },
  aura: { title: 'Aura sagrada', max: 5, kind: 'weapon' },
  chain: { title: 'Corrente de raios', max: 5, kind: 'weapon' },
  runes: { title: 'Runas explosivas', max: 5, kind: 'weapon' },
  familiar: { title: 'Familiar arcano', max: 5, kind: 'weapon' },
  shatter: { title: 'Estilhaço glacial', max: 1, kind: 'signature', color: 0, minLevel: 4 },
  burn: { title: 'Chão em chamas', max: 1, kind: 'signature', color: 1, minLevel: 4 },
  ricochet: { title: 'Ricochete', max: 1, kind: 'signature', color: 2, minLevel: 4 },
  boomerang: { title: 'Lua crescente', max: 1, kind: 'signature', color: 3, minLevel: 4 },
  bond: { title: 'Elo arcano', max: 3, kind: 'coop' },
  lifelink: { title: 'Vínculo vital', max: 3, kind: 'coop' },
  guardian: { title: 'Guardião', max: 2, kind: 'coop' },
  constellation: { title: 'Constelação', max: 1, kind: 'evolution', requires: { orbit: 5, arcane: 3 } },
  sanctuary: { title: 'Santuário', max: 1, kind: 'evolution', requires: { aura: 5, vitality: 3 } },
  tempest: { title: 'Tempestade', max: 1, kind: 'evolution', requires: { chain: 5, haste: 3 } },
  minefield: { title: 'Campo minado', max: 1, kind: 'evolution', requires: { runes: 5, magnet: 2 } },
  covenant: { title: 'Pacto ancestral', max: 1, kind: 'evolution', requires: { familiar: 5, swiftness: 2 } },
  avalanche: { title: 'Avalanche', max: 1, kind: 'evolution', requires: { shatter: 1, multishot: 3 } },
  hellfire: { title: 'Inferno', max: 1, kind: 'evolution', requires: { burn: 1, aura: 3 } },
  bramble: { title: 'Espinheiro', max: 1, kind: 'evolution', requires: { ricochet: 1, chain: 3 } },
  fullmoon: { title: 'Lua cheia', max: 1, kind: 'evolution', requires: { boomerang: 1, orbit: 3 } },
  stormrunes: { title: 'Runas de tempestade', max: 1, kind: 'evolution', requires: { runes: 3, chain: 3 } },
  solarcrown: { title: 'Coroa solar', max: 1, kind: 'evolution', requires: { orbit: 3, aura: 3 } }
});

const WEIGHTS = { passive: 1, weapon: 1.25, signature: 1.6, coop: 0.8, evolution: 1000 };

export const rankOf = (player, id) => player.powers[id] || 0;

export function isEligible(player, id, context = {}) {
  const power = POWERS[id];
  if (!power || rankOf(player, id) >= power.max) return false;
  if (power.kind === 'signature') return player.color === power.color && player.level >= power.minLevel;
  if (power.kind === 'coop') return Boolean(context.coop);
  if (power.kind === 'evolution') return Object.entries(power.requires).every(([req, rank]) => rankOf(player, req) >= rank);
  return true;
}

/** Up to three distinct choices, weighted so evolutions always appear once unlocked. */
export function availablePowers(player, random = Math.random, context = {}, exclude = []) {
  const pool = Object.keys(POWERS).filter(id => !exclude.includes(id) && isEligible(player, id, context));
  const choices = [];
  while (pool.length && choices.length < 3) {
    const total = pool.reduce((sum, id) => sum + WEIGHTS[POWERS[id].kind], 0);
    let roll = random() * total;
    let index = pool.findIndex(id => (roll -= WEIGHTS[POWERS[id].kind]) < 0);
    if (index < 0) index = pool.length - 1;
    choices.push(pool.splice(index, 1)[0]);
  }
  return choices;
}

export function offerPowers(player, random, context) {
  const choices = availablePowers(player, random, context);
  player.pendingPowers = choices.length ? choices : null;
  player.powerTimer = 0;
  return player.pendingPowers;
}

export function applyPower(player, powerId) {
  if (!player.pendingPowers?.includes(powerId)) return false;
  const power = POWERS[powerId];
  const rank = rankOf(player, powerId);
  if (!power || rank >= power.max) return false;
  player.powers[powerId] = rank + 1;
  if (powerId === 'arcane') player.damage *= 1.25;
  if (powerId === 'haste') player.attackDelay = Math.max(0.18, player.attackDelay * 0.88);
  if (powerId === 'vitality') { player.maxHp += 22; player.hp = Math.min(player.maxHp, player.hp + 30); }
  if (powerId === 'swiftness') player.speed *= 1.12;
  if (powerId === 'multishot') player.projectiles = Math.min(4, player.projectiles + 1);
  if (powerId === 'magnet') player.pickupRadius += 55;
  if (powerId === 'armor') player.armor += 1.5;
  player.pendingPowers = null;
  player.powerTimer = 0;
  player.invulnerableFor = INVULNERABLE_AFTER_CHOICE;
  return true;
}

export function rerollPowers(player, random = Math.random, context = {}) {
  if (!player.pendingPowers || !(player.rerolls > 0)) return false;
  const previous = player.pendingPowers.filter(id => isEligible(player, id, context));
  // Prefer options the player has not just seen; top up with the old ones when the pool is small.
  const choices = [...availablePowers(player, random, context, previous), ...previous].slice(0, 3);
  player.rerolls--;
  player.pendingPowers = choices.length ? choices : null;
  player.powerTimer = 0;
  return true;
}
