// @ts-check
// Nintendo Switch replacement for src/platform.js. build.mjs swaps it in when bundling, so the shared
// renderer (sprites.js, terrain.js) runs unchanged on nx.js.

/** nx.js has no DOM: baked sprites and floor tiles live in OffscreenCanvas surfaces. */
export function createCanvas(width, height) {
  return new OffscreenCanvas(width, height);
}

/** public/ assets are copied into the NRO's RomFS by build.mjs. */
export const assetUrl = path => `romfs:/${path}`;

/** nx.js benefits from avoiding hundreds of per-projectile CanvasGradient objects in late hordes. */
export const RENDER_TUNING = Object.freeze({ fastTrails: true, atmosphere: false, simpleShadows: true, cachedGlows: true, crowdShadows: false, enemyHealthBars: 'damaged', terrainMacro: 2, fastCrowdSprites: true });
