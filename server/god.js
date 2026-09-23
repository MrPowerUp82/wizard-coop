export const GOD = 6;
export const GOD_COST = 60_000;
// Twelve armor is the highest starting armor in the roster (also used by the Developer).
export const GOD_STATS = Object.freeze({ hp: 5, damage: 1.5, speed: 1.2, attackDelay: 0.85, armor: 12, projectiles: 0 });

// Passive celestial bodies use simulation time, so their positions match in solo and online play
// without adding another field to the snapshot protocol.
export const GOD_PLANETS = Object.freeze({ count: 2, radius: 66, speed: 2.5, hitRadius: 31, hitEvery: 0.6, damage: 0.75 });

export function godPlanetPosition(player, time, index) {
  const angle = time * GOD_PLANETS.speed + index * Math.PI * 2 / GOD_PLANETS.count;
  return { x: player.x + Math.cos(angle) * GOD_PLANETS.radius, y: player.y + Math.sin(angle) * GOD_PLANETS.radius };
}
