// Bake the shared game's exact sprite variants and terrain with a real desktop Canvas.
// The Vita loads small PNGs instead of decoding WebP / recoloring pixels during play.
import { build } from 'esbuild';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';

export async function bakeAssets(root, output) {
  const spriteFile = join(root, 'src/sprites.js');
  const source = readFileSync(spriteFile, 'utf8');
  const bakeSource = source.replace(/const (\w+) = new Image\(\);\s*\1.src = assetUrl\('assets\/(\w+)\.webp'\);/g, 'const $1 = globalThis.atlases.$2;');
  const result = await build({
    stdin: { contents: `${bakeSource}\nexport const names = [...Object.keys(ATLAS_CELLS), ...Object.keys(PHASE_BOUNDS), ...Object.keys(PHASE2_BOUNDS), ...Object.keys(VARIANTS)];`, resolveDir: join(root, 'src') },
    bundle: true, format: 'iife', globalName: 'sprites', write: false,
    plugins: [{ name: 'bake-platform', setup(b) {
      b.onResolve({ filter: /platform\.js$/ }, () => ({ path: 'platform', namespace: 'bake' }));
      b.onLoad({ filter: /.*/, namespace: 'bake' }, () => ({ contents: 'export const createCanvas = globalThis.makeCanvas; export const assetUrl = p => p;' }));
    } }]
  });
  const atlases = Object.fromEntries(await Promise.all(['sprites', 'phases', 'phases2'].map(async name => [name, await loadImage(join(root, 'public/assets', `${name}.webp`))])));
  const sandbox = {
    makeCanvas: createCanvas,
    atlases,
    // Baking uses the Vita terrain setting. Keep it explicit so the VM never needs to import platform.js.
    renderTuning: Object.freeze({ terrainMacro: 1 })
  };
  runInNewContext(result.outputFiles[0].text, sandbox);
  mkdirSync(join(output, 'baked'), { recursive: true });
  for (const name of sandbox.sprites.names) {
    const sprite = sandbox.sprites.spriteFor(name);
    for (const key of ['canvas', 'flash']) {
      writeFileSync(join(output, 'baked', `${name}${key === 'flash' ? '-flash' : ''}.png`), sprite[key].toBuffer('image/png'));
    }
  }
  const terrain = readFileSync(join(root, 'src/terrain.js'), 'utf8')
    // terrain.js is an ES module, but this small bake step runs it inside node:vm as a classic script.
    // Do not match one exact import spelling: shared renderer tuning can add more platform exports over time.
    .replace(
      /^import\s+\{[^}]*\}\s+from\s+['"]\.\/platform\.js['"];?\s*$/m,
      'const createCanvas = globalThis.makeCanvas;\nconst RENDER_TUNING = globalThis.renderTuning;'
    )
    .replace('export function', 'function');
  runInNewContext(`${terrain}\nglobalThis.tiles = tiles;`, sandbox);
  sandbox.tiles.forEach((tile, i) => writeFileSync(join(output, 'baked', `terrain-${i}.png`), tile.toBuffer('image/png')));
  return source.replace(/const atlas = new Image\(\);[\s\S]*?(?=\/\*\* Shared camera)/,
    `const cache = new Map();\nexport function spriteFor(name) {\n if (!cache.has(name)) {\n const canvas = new Image(); canvas.src = assetUrl('assets/baked/' + name + '.png');\n const flash = new Image(); flash.src = assetUrl('assets/baked/' + name + '-flash.png');\n cache.set(name, { canvas, flash });\n }\n return cache.get(name);\n}\n\n`)
    .replace("import { assetUrl, createCanvas }", "import { assetUrl }");
}
