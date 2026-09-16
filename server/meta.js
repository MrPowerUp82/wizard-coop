// Permanent upgrades bought with coins between matches. Shared by the client shop and the server,
// which re-validates ranks before applying them to a player.
export const META_UPGRADES = Object.freeze({
  vigor: { title: 'Vigor', description: '+6 de vida máxima por grau (até +30)', costs: [40, 90, 160, 250, 360] },
  might: { title: 'Potência', description: '+3% de dano por grau (até +15%)', costs: [50, 110, 190, 290, 420] },
  wisdom: { title: 'Sabedoria', description: '+3% de experiência por grau (até +15%)', costs: [45, 100, 170, 260, 380] },
  greed: { title: 'Ganância', description: '+10% de moedas por grau (até +30%)', costs: [60, 140, 260] },
  reroll: { title: 'Destino', description: '+1 troca de poderes por partida', costs: [80, 180, 320] },
  phoenix: { title: 'Fênix', description: 'Renasce uma vez por partida com 50% da vida', costs: [600] }
});

export function sanitizeMeta(raw) {
  const meta = {};
  for (const [id, upgrade] of Object.entries(META_UPGRADES)) {
    const rank = raw?.[id];
    meta[id] = Number.isInteger(rank) ? Math.max(0, Math.min(upgrade.costs.length, rank)) : 0;
  }
  return meta;
}

export function applyMeta(player, raw) {
  const meta = sanitizeMeta(raw);
  player.maxHp += meta.vigor * 6;
  player.hp = player.maxHp;
  player.damage *= 1 + meta.might * 0.03;
  player.xpMult = 1 + meta.wisdom * 0.03;
  player.coinMult = 1 + meta.greed * 0.1;
  player.rerolls = 1 + meta.reroll;
  player.phoenix = meta.phoenix;
  return player;
}

export const nextCost = (id, rank) => META_UPGRADES[id]?.costs[rank] ?? null;
