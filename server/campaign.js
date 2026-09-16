// Both rhythms visit every realm. Mechanics use the normalized 300-second phase clock.
export const CAMPAIGNS = Object.freeze({
  quick: { name: 'Ritual rápido', seconds: 120, xp: 1.25, coins: 1, bossHp: 0.8 },
  classic: { name: 'Ritual clássico', seconds: 300, xp: 0.5, coins: 0.4, bossHp: 1 },
  // Unlocked in the Grimório: the six realms repeat, harder every lap, until everyone falls.
  endless: { name: 'Ritual infinito', seconds: 120, xp: 1.25, coins: 1, bossHp: 0.8, endless: true }
});
export const campaignId = value => Object.hasOwn(CAMPAIGNS, value) ? value : 'quick';
export const campaignOf = s => CAMPAIGNS[s.campaign] || CAMPAIGNS.classic;
export const phaseDuration = s => campaignOf(s).seconds;
export const phaseClock = s => s.phaseTime * 300 / phaseDuration(s);
