// @ts-check
// PlayStation Vita replacement for src/platform.js. build.mjs swaps it in when bundling, so the shared
// renderer (sprites.js, terrain.js) runs unchanged on the PS Vita runtime.

/** PS Vita has no DOM: baked sprites and floor tiles live in OffscreenCanvas surfaces. */
export function createCanvas(width, height) {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(width, height);
  }
  // Fallback if the runtime creates offscreen canvases through screen or document shim
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  throw new Error('No offscreen canvas implementation available in PS Vita runtime');
}

/** public/ assets are copied into the VPK's assets/ directory by build.mjs. */
export const assetUrl = path => `app0:/${path.replace(/^\.?\//, '')}`;

/** Vita keeps gameplay and signature effects, while trimming the least visible per-frame decoration. */
export const RENDER_TUNING = Object.freeze({ fastTrails: true, atmosphere: false, simpleShadows: true, cachedGlows: false, crowdShadows: true, enemyHealthBars: 'all', terrainMacro: 1, fastCrowdSprites: true, animatedSheets: false });
