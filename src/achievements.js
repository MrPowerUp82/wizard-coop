import { earnsAurora } from '../server/aurora.js';

// Like the Grimório, campaign rewards belong to this browser's save.
export function createAchievements(storage = null) {
  const key = 'arcana-classic-victory';
  let earned = false;
  const hasAurora = () => {
    try { return earned || (storage ?? localStorage).getItem(key) === '1'; } catch { return earned; }
  };
  return {
    get aurora() { return hasAurora(); },
    recordVictory(result) {
      if (!earnsAurora(result) || hasAurora()) return false;
      earned = true;
      try { (storage ?? localStorage).setItem(key, '1'); } catch { /* Keep the reward for this session. */ }
      return true;
    }
  };
}
