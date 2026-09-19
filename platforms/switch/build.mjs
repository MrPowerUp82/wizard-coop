// Builds the Nintendo Switch RomFS for nx.js:
//   romfs/main.js      the game bundled by esbuild (src/platform.js swapped for the Switch one)
//   romfs/assets/      the same sprite atlases as the web (public/assets, copied, not duplicated in git)
//   romfs/fonts/       Inter and Cinzel as TrueType (converted from the web's @fontsource WOFF files) and
//                      DejaVu Sans for symbols, with their licenses
// Then `npm run nro` (nxjs-nro) packs romfs/ + package.json + icon.jpg into ArcanaSurvivors.nro.
//
// Flags: --debug (or DEBUG_CONTROLLERS=true) enables the controller debug panel and the profiler.

import { build } from 'esbuild';
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const romfs = join(here, 'romfs');
const debug = process.argv.includes('--debug') || process.env.DEBUG_CONTROLLERS === 'true';
// nx.js canvas renderer written to romfs/nxjs.ini: cpu | gpu | auto (see README, "Renderer").
const renderer = (process.argv.find(arg => arg.startsWith('--renderer='))?.split('=')[1] || process.env.NXJS_RENDERER || 'auto').toLowerCase();
if (!['cpu', 'gpu', 'auto'].includes(renderer)) throw new Error(`--renderer must be cpu, gpu or auto (got ${renderer})`);

/** Converts a WOFF 1.0 font (zlib-compressed tables) back into the SFNT (TTF/OTF) FreeType loads. */
export function woffToSfnt(woff) {
  if (woff.toString('ascii', 0, 4) !== 'wOFF') throw new Error('not a WOFF 1.0 file');
  const flavor = woff.readUInt32BE(4);
  const count = woff.readUInt16BE(12);
  const tables = [];
  for (let i = 0; i < count; i++) {
    const at = 44 + i * 20;
    const tag = woff.readUInt32BE(at), offset = woff.readUInt32BE(at + 4), compLength = woff.readUInt32BE(at + 8);
    const origLength = woff.readUInt32BE(at + 12), checksum = woff.readUInt32BE(at + 16);
    const raw = woff.subarray(offset, offset + compLength);
    const data = compLength < origLength ? inflateSync(raw) : Buffer.from(raw);
    if (data.length !== origLength) throw new Error('corrupt WOFF table');
    tables.push({ tag, checksum, data });
  }
  const power = 2 ** Math.floor(Math.log2(count));
  const header = Buffer.alloc(12 + count * 16);
  header.writeUInt32BE(flavor, 0);
  header.writeUInt16BE(count, 4);
  header.writeUInt16BE(power * 16, 6);
  header.writeUInt16BE(Math.log2(power), 8);
  header.writeUInt16BE(count * 16 - power * 16, 10);
  const chunks = [header];
  let offset = header.length;
  tables.forEach((table, i) => {
    const at = 12 + i * 16;
    header.writeUInt32BE(table.tag, at);
    header.writeUInt32BE(table.checksum, at + 4);
    header.writeUInt32BE(offset, at + 8);
    header.writeUInt32BE(table.data.length, at + 12);
    const padded = Buffer.alloc((table.data.length + 3) & ~3);
    table.data.copy(padded);
    chunks.push(padded);
    offset += padded.length;
  });
  return Buffer.concat(chunks);
}

/** Unicode code points a TrueType/OpenType font maps (cmap formats 4 and 12). */
export function fontCodePoints(font) {
  let cmap = 0;
  for (let i = 0; i < font.readUInt16BE(4); i++) if (font.toString('ascii', 12 + i * 16, 16 + i * 16) === 'cmap') cmap = font.readUInt32BE(12 + i * 16 + 8);
  const points = new Set();
  for (let i = 0; i < font.readUInt16BE(cmap + 2); i++) {
    const table = cmap + font.readUInt32BE(cmap + 8 + i * 8);
    const format = font.readUInt16BE(table);
    if (format === 4) {
      const segments = font.readUInt16BE(table + 6) / 2;
      for (let s = 0; s < segments; s++) {
        const end = font.readUInt16BE(table + 14 + s * 2), start = font.readUInt16BE(table + 16 + segments * 2 + s * 2);
        for (let c = start; c <= end && c !== 0xffff; c++) points.add(c);
      }
    } else if (format === 12) {
      for (let g = 0; g < font.readUInt32BE(table + 12); g++) {
        for (let c = font.readUInt32BE(table + 16 + g * 12); c <= font.readUInt32BE(table + 20 + g * 12); c++) points.add(c);
      }
    }
  }
  return points;
}

/** esbuild plugin: every import of src/platform.js resolves to the Switch implementation. */
const switchPlatform = {
  name: 'switch-platform',
  setup(builder) {
    const web = join(root, 'src', 'platform.js');
    builder.onResolve({ filter: /platform\.js$/ }, args => {
      const target = resolve(args.resolveDir, args.path);
      return target === web ? { path: join(here, 'src', 'platform.js') } : undefined;
    });
  }
};

async function main() {
  rmSync(romfs, { recursive: true, force: true });
  mkdirSync(join(romfs, 'assets'), { recursive: true });
  mkdirSync(join(romfs, 'fonts'), { recursive: true });

  const requireFromRoot = createRequire(join(root, 'package.json'));
  const fonts = [['inter', [400, 500, 600, 700, 800]], ['cinzel', [600, 700]]];
  for (const [family, weights] of fonts) {
    const dir = dirname(requireFromRoot.resolve(`@fontsource/${family}/package.json`));
    for (const weight of weights) {
      const woff = readFileSync(join(dir, 'files', `${family}-latin-${weight}-normal.woff`));
      writeFileSync(join(romfs, 'fonts', `${family}-${weight}.ttf`), woffToSfnt(woff));
    }
  }
  // Symbols (power icons, ◀ ▶ ● ✓ …) that Inter lacks come from DejaVu Sans (free license, see LICENSE files).
  const dejavu = join(here, 'node_modules', 'dejavu-fonts-ttf');
  copyFileSync(join(dejavu, 'ttf', 'DejaVuSans.ttf'), join(romfs, 'fonts', 'dejavu-400.ttf'));
  copyFileSync(join(dejavu, 'ttf', 'DejaVuSans-Bold.ttf'), join(romfs, 'fonts', 'dejavu-700.ttf'));
  copyFileSync(join(dejavu, 'LICENSE'), join(romfs, 'fonts', 'LICENSE-DejaVu.txt'));
  for (const family of ['inter', 'cinzel']) {
    copyFileSync(join(dirname(requireFromRoot.resolve(`@fontsource/${family}/package.json`)), 'LICENSE'), join(romfs, 'fonts', `LICENSE-${family}.txt`));
  }
  // Characters beyond Latin that Inter itself can draw; anything else is drawn with DejaVu Sans.
  const interSymbols = [...fontCodePoints(readFileSync(join(romfs, 'fonts', 'inter-400.ttf')))]
    .filter(point => point >= 0x250).map(point => String.fromCodePoint(point)).join('');

  await build({
    entryPoints: [join(here, 'src', 'main.js')],
    outfile: join(romfs, 'main.js'),
    bundle: true,
    format: 'esm',
    target: 'es2022',
    platform: 'neutral',
    mainFields: ['module', 'main'],
    sourcemap: true,
    minifySyntax: true, // folds `if (false)` so release builds carry no debug code
    sourcesContent: false,
    legalComments: 'none',
    define: { DEBUG_CONTROLLERS: String(debug), INTER_SYMBOLS: JSON.stringify(interSymbols) },
    plugins: [switchPlatform],
    logLevel: 'warning'
  });

  for (const file of readdirSync(join(root, 'public', 'assets'))) {
    if (file.endsWith('.webp')) copyFileSync(join(root, 'public', 'assets', file), join(romfs, 'assets', file));
  }

  writeFileSync(join(romfs, 'nxjs.ini'), `[renderer]
; cpu | gpu | auto — chosen by build.mjs --renderer
mode = ${renderer}
; Arcana keeps many immutable sprite/offscreen textures alive. beta.6 can retain a larger Ganesh cache
; in application mode, reducing texture eviction/re-upload churn during late split-screen hordes.
gpu_cache = 128

[v8]
; Full JIT is selected automatically in application mode; applet mode stays memory-safe/jitless.
jit = auto
`);
  console.log(`RomFS pronto em ${romfs} (${debug ? 'debug: DEBUG_CONTROLLERS ativo' : 'release'}, renderer ${renderer})`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
