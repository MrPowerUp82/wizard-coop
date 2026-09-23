import { META_UPGRADES, nextCost, sanitizeMeta } from '../server/meta.js';
import { GOD_COST } from '../server/god.js';

// Coins and permanent upgrades persist in this browser only.
const KEY = 'arcana-meta';

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    const upgrades = sanitizeMeta(saved.upgrades);
    // Existing saves keep every purchased rank and can refund their original costs.
    const historical = Object.entries(upgrades).reduce((sum, [id, rank]) => sum + META_UPGRADES[id].costs.slice(0, rank).reduce((a, b) => a + b, 0), 0);
    return { coins: Number.isSafeInteger(saved.coins) && saved.coins > 0 ? saved.coins : 0, upgrades,
      invested: Number.isSafeInteger(saved.invested) && saved.invested >= 0 ? saved.invested : historical,
      godUnlocked: saved.godUnlocked === true };
  } catch {
    return { coins: 0, upgrades: sanitizeMeta({}), invested: 0, godUnlocked: false };
  }
}

export function createWallet() {
  let data = load();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* storage may be unavailable */ } };
  return {
    get coins() { return data.coins; },
    get upgrades() { return { ...data.upgrades }; },
    get invested() { return data.invested; },
    get godUnlocked() { return load().godUnlocked; },
    respec() {
      data = load();
      const refund = data.invested;
      data.coins += refund; data.invested = 0; data.upgrades = sanitizeMeta({});
      save();
      return refund;
    },
    deposit(amount) {
      if (!(amount > 0)) return;
      data = load(); // Another tab may have spent or earned coins meanwhile.
      data.coins += Math.floor(amount);
      save();
    },
    buy(id) {
      data = load();
      if (id === 'theGod') {
        if (data.godUnlocked || data.coins < GOD_COST) return false;
        data.coins -= GOD_COST;
        data.godUnlocked = true;
        save();
        return true;
      }
      const cost = nextCost(id, data.upgrades[id]);
      if (cost === null || data.coins < cost) return false;
      data.coins -= cost;
      data.invested += cost;
      data.upgrades[id]++;
      save();
      return true;
    },
    offers() {
      data = load();
      return [...Object.entries(META_UPGRADES).map(([id, upgrade]) => ({
        id, ...upgrade, rank: data.upgrades[id], max: upgrade.costs.length, cost: nextCost(id, data.upgrades[id])
      })), { id: 'theGod', title: 'The God', description: 'Personagem · 500 de vida, +50% dano, +20% velocidade, armadura máxima, ataques 15% mais rápidos, disparos que atravessam três inimigos e dois planetas orbitais.',
        rank: Number(data.godUnlocked), max: 1, cost: data.godUnlocked ? null : GOD_COST, unlock: true }];
    }
  };
}
