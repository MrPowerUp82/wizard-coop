// Browser services the renderer needs at load time. The Nintendo Switch build replaces this module
// with platforms/switch/src/platform.js (same exports), so no renderer code branches on the platform.

/** An offscreen drawing surface for baked sprites and floor tiles. */
export function createCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** URL of a file shipped in `public/`, relative to the page so GitHub Pages subdirectories keep working. */
export const assetUrl = path => `./${path}`;

/** Browser keeps the full visual treatment. Console ports override only expensive decorative paths. */
export const RENDER_TUNING = Object.freeze({ fastTrails: false, atmosphere: true, simpleShadows: false, cachedGlows: false, crowdShadows: true, enemyHealthBars: 'all', terrainMacro: 1, fastCrowdSprites: false });
