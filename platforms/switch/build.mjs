// Builds the Nintendo Switch RomFS for nx.js:
//   romfs/main.js      the game bundled by esbuild (src/platform.js swapped for the Switch one)
//   romfs/assets/      the same sprite atlases as the web (public/assets, copied, not duplicated in git)
//   romfs/fonts/       Inter and Cinzel as TrueType, converted from the web's @fontsource WOFF files
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
    define: { DEBUG_CONTROLLERS: String(debug) },
    plugins: [switchPlatform],
    logLevel: 'warning'
  });

  for (const file of readdirSync(join(root, 'public', 'assets'))) {
    if (file.endsWith('.webp')) copyFileSync(join(root, 'public', 'assets', file), join(romfs, 'assets', file));
  }

  const requireFromRoot = createRequire(join(root, 'package.json'));
  const fonts = [['inter', [400, 500, 600, 700, 800]], ['cinzel', [600, 700]]];
  for (const [family, weights] of fonts) {
    const dir = dirname(requireFromRoot.resolve(`@fontsource/${family}/package.json`));
    for (const weight of weights) {
      const woff = readFileSync(join(dir, 'files', `${family}-latin-${weight}-normal.woff`));
      writeFileSync(join(romfs, 'fonts', `${family}-${weight}.ttf`), woffToSfnt(woff));
    }
  }
  console.log(`RomFS pronto em ${romfs} (${debug ? 'debug: DEBUG_CONTROLLERS ativo' : 'release'})`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
