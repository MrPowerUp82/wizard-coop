// @ts-check
// Builds the PlayStation Vita homebrew bundle and .vpk for Arcana Survivors:
//   build/assets/main.js    the game bundled by esbuild (src/platform.js swapped for the Vita one)
//   build/assets/*.webp     sprite atlases copied from public/assets/
//   build/assets/fonts/     Inter and Cinzel as TTF (converted from @fontsource WOFF) and DejaVu Sans
//   build/sce_sys/          param.sfo, icon0.png, LiveArea assets
//   ArcanaSurvivors.vpk     final packaged homebrew ZIP
//
// Flags:
//   --debug: enables DEBUG_CONTROLLERS profiler and controller debug panel
//   --vpk: packages the build directory into ArcanaSurvivors.vpk

import { build } from 'esbuild';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync, inflateSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const buildDir = join(here, 'build');
const debug = process.argv.includes('--debug') || process.env.DEBUG_CONTROLLERS === 'true';
const makeVpk = process.argv.includes('--vpk') || process.argv.includes('vpk');

/** Converts a WOFF 1.0 font (zlib-compressed tables) back into TTF/SFNT. */
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

/** Extracts unicode code points a TrueType/OpenType font maps. */
export function fontCodePoints(font) {
  let cmap = 0;
  for (let i = 0; i < font.readUInt16BE(4); i++) {
    if (font.toString('ascii', 12 + i * 16, 16 + i * 16) === 'cmap') {
      cmap = font.readUInt32BE(12 + i * 16 + 8);
    }
  }
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

/** Pure Node CRC32 implementation. */
function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Generates a valid Sony PARAM.SFO binary file. */
export function generateParamSfo(entries) {
  // Sort keys alphabetically as required by SFO spec
  const sorted = Object.keys(entries).sort().map(key => ({ key, ...entries[key] }));
  const count = sorted.length;

  let keyTableLen = 0;
  sorted.forEach(e => { e.keyOffset = keyTableLen; keyTableLen += e.key.length + 1; });
  const paddedKeyTableLen = (keyTableLen + 3) & ~3;

  let dataTableLen = 0;
  sorted.forEach(e => {
    e.dataOffset = dataTableLen;
    if (e.type === 'utf8') {
      const valBuf = Buffer.from(e.value + '\0', 'utf8');
      e.buf = valBuf;
      e.dataLen = valBuf.length;
      e.maxLen = (valBuf.length + 3) & ~3;
    } else if (e.type === 'uint32') {
      const valBuf = Buffer.alloc(4);
      valBuf.writeUInt32LE(Number(e.value), 0);
      e.buf = valBuf;
      e.dataLen = 4;
      e.maxLen = 4;
    }
    dataTableLen += e.maxLen;
  });

  const headerLen = 20;
  const indexTableLen = count * 16;
  const keyTableOffset = headerLen + indexTableLen;
  const dataTableOffset = keyTableOffset + paddedKeyTableLen;
  const totalLen = dataTableOffset + dataTableLen;

  const out = Buffer.alloc(totalLen);
  // Header: PSF magic (\0PSF)
  out.write('\0PSF', 0, 4, 'ascii');
  out.writeUInt32LE(0x00000101, 4); // SFO version 1.1
  out.writeUInt32LE(keyTableOffset, 8);
  out.writeUInt32LE(dataTableOffset, 12);
  out.writeUInt32LE(count, 16);

  // Index table
  sorted.forEach((e, i) => {
    const at = headerLen + i * 16;
    out.writeUInt16LE(e.keyOffset, at);
    out.writeUInt16LE(e.type === 'utf8' ? 0x0204 : 0x0404, at + 2);
    out.writeUInt32LE(e.dataLen, at + 4);
    out.writeUInt32LE(e.maxLen, at + 8);
    out.writeUInt32LE(e.dataOffset, at + 12);
  });

  // Key table
  sorted.forEach(e => {
    out.write(e.key + '\0', keyTableOffset + e.keyOffset, 'ascii');
  });

  // Data table
  sorted.forEach(e => {
    e.buf.copy(out, dataTableOffset + e.dataOffset);
  });

  return out;
}

/** Pure Node ZIP (.vpk) writer. */
export function createVpkZip(sourceDir, outputFile) {
  function collectFiles(dir, base = '') {
    const list = [];
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const rel = base ? `${base}/${name}` : name;
      if (statSync(full).isDirectory()) {
        list.push(...collectFiles(full, rel));
      } else {
        list.push({ path: full, name: rel });
      }
    }
    return list;
  }

  const files = collectFiles(sourceDir);
  const localChunks = [];
  const centralChunks = [];
  let currentOffset = 0;

  for (const f of files) {
    const uncompressed = readFileSync(f.path);
    const compressed = deflateRawSync(uncompressed);
    const useCompressed = compressed.length < uncompressed.length;
    const data = useCompressed ? compressed : uncompressed;
    const method = useCompressed ? 8 : 0;
    const fileCrc = crc32(uncompressed);
    const nameBuf = Buffer.from(f.name.replace(/\\/g, '/'), 'utf8');

    // Local Header
    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0); // Signature
    local.writeUInt16LE(20, 4);          // Version needed
    local.writeUInt16LE(0, 6);           // Flags
    local.writeUInt16LE(method, 8);      // Method
    local.writeUInt16LE(0, 10);          // Mod time
    local.writeUInt16LE(0, 12);          // Mod date
    local.writeUInt32LE(fileCrc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(uncompressed.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    nameBuf.copy(local, 30);

    localChunks.push(local, data);

    // Central Directory Record
    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0); // Signature
    central.writeUInt16LE(20, 4);          // Version made by
    central.writeUInt16LE(20, 6);          // Version needed
    central.writeUInt16LE(0, 8);           // Flags
    central.writeUInt16LE(method, 10);     // Method
    central.writeUInt16LE(0, 12);          // Mod time
    central.writeUInt16LE(0, 14);          // Mod date
    central.writeUInt32LE(fileCrc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(uncompressed.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);          // Extra len
    central.writeUInt16LE(0, 32);          // Comment len
    central.writeUInt16LE(0, 34);          // Disk start
    central.writeUInt16LE(0, 36);          // Internal attr
    central.writeUInt32LE(0x81a40000, 38); // External attr (-rw-r--r--)
    central.writeUInt32LE(currentOffset, 42);
    nameBuf.copy(central, 46);

    centralChunks.push(central);
    currentOffset += local.length + data.length;
  }

  const centralOffset = currentOffset;
  let centralSize = 0;
  centralChunks.forEach(c => { centralSize += c.length; });

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);       // EOCD signature
  eocd.writeUInt16LE(0, 4);                // Disk num
  eocd.writeUInt16LE(0, 6);                // Start disk
  eocd.writeUInt16LE(files.length, 8);     // Entries on disk
  eocd.writeUInt16LE(files.length, 10);    // Total entries
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  eocd.writeUInt16LE(0, 20);

  const finalZip = Buffer.concat([...localChunks, ...centralChunks, eocd]);
  writeFileSync(outputFile, finalZip);
}

// -------------------------------------------------------------------------------------------------
// Main Build Execution
// -------------------------------------------------------------------------------------------------

rmSync(buildDir, { recursive: true, force: true });
mkdirSync(join(buildDir, 'assets', 'fonts'), { recursive: true });
mkdirSync(join(buildDir, 'sce_sys', 'livearea', 'contents'), { recursive: true });

// 1. Fonts: Convert @fontsource WOFF to TTF and copy DejaVu Sans
const fonts = [
  ['Inter', 400, 'node_modules/@fontsource/inter/files/inter-latin-400-normal.woff', 'inter-400.ttf'],
  ['Inter', 500, 'node_modules/@fontsource/inter/files/inter-latin-500-normal.woff', 'inter-500.ttf'],
  ['Inter', 600, 'node_modules/@fontsource/inter/files/inter-latin-600-normal.woff', 'inter-600.ttf'],
  ['Inter', 700, 'node_modules/@fontsource/inter/files/inter-latin-700-normal.woff', 'inter-700.ttf'],
  ['Inter', 800, 'node_modules/@fontsource/inter/files/inter-latin-800-normal.woff', 'inter-800.ttf'],
  ['Cinzel', 600, 'node_modules/@fontsource/cinzel/files/cinzel-latin-600-normal.woff', 'cinzel-600.ttf'],
  ['Cinzel', 700, 'node_modules/@fontsource/cinzel/files/cinzel-latin-700-normal.woff', 'cinzel-700.ttf']
];

for (const [, , woffPath, ttfName] of fonts) {
  const fullWoff = join(root, woffPath);
  const sfnt = woffToSfnt(readFileSync(fullWoff));
  writeFileSync(join(buildDir, 'assets', 'fonts', ttfName), sfnt);
}

// DejaVu Sans for glyphs that Inter does not cover
const dejavuPkg = join(here, 'node_modules', 'dejavu-fonts-ttf', 'ttf');
if (existsSync(join(dejavuPkg, 'DejaVuSans.ttf'))) {
  copyFileSync(join(dejavuPkg, 'DejaVuSans.ttf'), join(buildDir, 'assets', 'fonts', 'dejavu-400.ttf'));
  copyFileSync(join(dejavuPkg, 'DejaVuSans-Bold.ttf'), join(buildDir, 'assets', 'fonts', 'dejavu-700.ttf'));
} else {
  // Fallback to switch package if shared
  const alt = join(root, 'platforms', 'switch', 'node_modules', 'dejavu-fonts-ttf', 'ttf');
  if (existsSync(join(alt, 'DejaVuSans.ttf'))) {
    copyFileSync(join(alt, 'DejaVuSans.ttf'), join(buildDir, 'assets', 'fonts', 'dejavu-400.ttf'));
    copyFileSync(join(alt, 'DejaVuSans-Bold.ttf'), join(buildDir, 'assets', 'fonts', 'dejavu-700.ttf'));
  }
}

// 2. Sprite Atlases
const assetsDir = join(root, 'public', 'assets');
for (const file of readdirSync(assetsDir)) {
  if (file.endsWith('.webp') || file.endsWith('.png')) {
    copyFileSync(join(assetsDir, file), join(buildDir, 'assets', file));
  }
}

// 3. Extract Inter symbols for font fallback
const interSymbols = [...fontCodePoints(readFileSync(join(buildDir, 'assets', 'fonts', 'inter-400.ttf')))]
  .filter(point => point >= 0x250).map(point => String.fromCodePoint(point)).join('');

// 4. Bundle JS with esbuild
const webPlatform = join(root, 'src', 'platform.js');
const platformPlugin = {
  name: 'vita-platform',
  setup(builder) {
    builder.onResolve({ filter: /platform\.js$/ }, args => {
      const target = resolve(args.resolveDir, args.path);
      return target === webPlatform ? { path: join(here, 'src', 'platform.js') } : undefined;
    });
  }
};

await build({
  entryPoints: [join(here, 'src', 'main.js')],
  outfile: join(buildDir, 'assets', 'main.js'),
  bundle: true,
  format: 'esm',
  target: 'es2022',
  platform: 'neutral',
  define: {
    DEBUG_CONTROLLERS: String(debug),
    INTER_SYMBOLS: JSON.stringify(interSymbols)
  },
  plugins: [platformPlugin],
  banner: {
    js: '// Arcana Survivors · PlayStation Vita'
  }
});

// 4. LiveArea and param.sfo
const sceSys = join(here, 'sce_sys');
if (existsSync(join(sceSys, 'icon0.png'))) copyFileSync(join(sceSys, 'icon0.png'), join(buildDir, 'sce_sys', 'icon0.png'));
if (existsSync(join(sceSys, 'livearea', 'contents', 'bg.png'))) {
  copyFileSync(join(sceSys, 'livearea', 'contents', 'bg.png'), join(buildDir, 'sce_sys', 'livearea', 'contents', 'bg.png'));
}
if (existsSync(join(sceSys, 'livearea', 'contents', 'startup.png'))) {
  copyFileSync(join(sceSys, 'livearea', 'contents', 'startup.png'), join(buildDir, 'sce_sys', 'livearea', 'contents', 'startup.png'));
}
if (existsSync(join(sceSys, 'livearea', 'contents', 'template.xml'))) {
  copyFileSync(join(sceSys, 'livearea', 'contents', 'template.xml'), join(buildDir, 'sce_sys', 'livearea', 'contents', 'template.xml'));
}

const sfoData = generateParamSfo({
  APP_VER: { value: '01.00', type: 'utf8' },
  CATEGORY: { value: 'gda', type: 'utf8' },
  CONTENT_ID: { value: 'ARCS00001-0000000000000000', type: 'utf8' },
  TITLE: { value: 'Arcana Survivors', type: 'utf8' },
  TITLE_ID: { value: 'ARCS00001', type: 'utf8' },
  VERSION: { value: '01.00', type: 'utf8' }
});
writeFileSync(join(buildDir, 'sce_sys', 'param.sfo'), sfoData);

// 5. Executable stub / base eboot.bin
// If precompiled eboot.bin exists in runtime/, copy it into build root
const runtimeEboot = join(here, 'runtime', 'eboot.bin');
if (existsSync(runtimeEboot)) {
  copyFileSync(runtimeEboot, join(buildDir, 'eboot.bin'));
} else {
  // Create a minimal placeholder stub so VPK structure is intact
  writeFileSync(join(buildDir, 'eboot.bin'), Buffer.from('SCE_EXEC_PLACEHOLDER'));
}

console.log(`Build PS Vita concluído em ${buildDir} (debug: ${debug})`);

// 6. Generate VPK if requested
if (makeVpk) {
  const vpkFile = join(here, 'ArcanaSurvivors.vpk');
  createVpkZip(buildDir, vpkFile);
  console.log(`VPK gerado com sucesso: ${vpkFile} (${(statSync(vpkFile).size / 1048576).toFixed(2)} MB)`);
}
