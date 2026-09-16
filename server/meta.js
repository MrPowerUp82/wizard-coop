// Permanent upgrades bought with coins between matches. Shared by the client shop and the server,
// which re-validates ranks before applying them to a player.
export const META_UPGRADES = Object.freeze({
  vigor: { title: 'Vigor', description: '+6 de vida máxima por grau (até +30)', costs: [40, 90, 160, 250, 360] },
  might: { title: 'Potência', description: '+3% de dano por grau (até +15%)', costs: [50, 110, 190, 290, 420] },
  celerity: { title: 'Celeridade', description: 'Ataques 3% mais rápidos por grau (até 12%)', costs: [70, 150, 260, 400] },
  stride: { title: 'Agilidade', description: '+4% de velocidade de movimento por grau (até +12%)', costs: [45, 110, 200] },
  ward: { title: 'Égide', description: '+0,5 de armadura por grau (até +2)', costs: [60, 130, 230, 360] },
  reach: { title: 'Alcance', description: '+15 de raio de coleta por grau (até +45)', costs: [30, 70, 130] },
  wisdom: { title: 'Sabedoria', description: '+3% de experiência por grau (até +15%)', costs: [45, 100, 170, 260, 380] },
  greed: { title: 'Ganância', description: '+10% de moedas por grau (até +30%)', costs: [60, 140, 260] },
  channel: { title: 'Canalização', description: 'Começa com +20% de carga especial por grau (até 60%)', costs: [55, 130, 240] },
  reroll: { title: 'Destino', description: '+1 troca de poderes por partida', costs: [80, 180, 320] },
  pact: { title: 'Pacto familiar', description: 'Começa a partida com um Familiar arcano invocado', costs: [450] },
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
  player.attackDelay *= 1 - meta.celerity * 0.03;
  player.speed *= 1 + meta.stride * 0.04;
  player.armor += meta.ward * 0.5;
  player.pickupRadius += meta.reach * 15;
  player.xpMult = 1 + meta.wisdom * 0.03;
  player.coinMult = 1 + meta.greed * 0.1;
  player.specialCharge = meta.channel * 20;
  player.rerolls = 1 + meta.reroll;
  if (meta.pact) player.powers.familiar = Math.max(player.powers.familiar || 0, 1);
  player.phoenix = meta.phoenix;
  return player;
}

export const nextCost = (id, rank) => META_UPGRADES[id]?.costs[rank] ?? null;
