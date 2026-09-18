import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const runtime = resolve(dirname(fileURLToPath(import.meta.url)), '../runtime');
// Only the MIT-licensed QuickJS core is used; the host/graphics bindings are ours.
const revision = 'd6962f2a547e0be24db923bf1d553ef62ed85a10';
const upstream = join(runtime, 'upstream');
const sdk = process.env.VITASDK;
if (!sdk) throw new Error('Defina VITASDK para o diretório do VitaSDK e instale libvita2d, freetype, libpng, libjpeg-turbo, zlib e bzip2.');
const env = { ...process.env, PATH: `${join(sdk, 'bin')}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH}` };
function run(command, args, cwd = runtime) {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit' });
  if (result.error || result.status !== 0) throw result.error || new Error(`${command} falhou (${result.status})`);
}
if (!existsSync(join(upstream, '.git'))) run('git', ['clone', 'https://github.com/AlphaSystemsPL/PSVitaJS.git', upstream]);
run('git', ['checkout', '--detach', revision], upstream);
const out = join(runtime, 'build'); mkdirSync(out, { recursive: true });
const qjs = join(upstream, 'quickjs');
const version = readFileSync(join(qjs, 'VERSION'), 'utf8').trim();
const suffix = process.platform === 'win32' ? '.exe' : '';
const compiler = join(sdk, 'bin', `arm-vita-eabi-gcc${suffix}`);
const sources = ['src/main.c', ...['quickjs.c', 'dtoa.c', 'libregexp.c', 'libunicode.c', 'cutils.c'].map(f => `upstream/quickjs/${f}`)];
const objects = [];
for (const source of sources) {
  const object = join(out, source.replaceAll('/', '_') + '.o'); objects.push(object);
  if (!process.argv.includes('--clean') && existsSync(object) && statSync(object).mtimeMs > statSync(join(runtime, source)).mtimeMs) continue;
  run(compiler, ['-c', join(runtime, source), '-o', object, '-O2', '-std=gnu11', '-fwrapv', '-fno-short-enums', '-D_GNU_SOURCE', '-include', 'malloc.h', `-DCONFIG_VERSION="${version}"`, '-I', qjs, '-Wall', '-Wno-unused-parameter']);
}
const elf = join(out, 'ArcanaSurvivors.elf'), velf = join(out, 'ArcanaSurvivors.velf'), eboot = join(runtime, 'eboot.bin');
run(compiler, ['-Wl,-q', '-o', elf, ...objects, '-lvita2d', '-lfreetype', '-lpng', '-ljpeg', '-lbz2', '-lz',
  ...['SceDisplay', 'SceGxm', 'SceCtrl', 'ScePower', 'ScePgf', 'ScePvf', 'SceSysmodule', 'SceAppMgr', 'SceCommonDialog'].map(l => `-l${l}_stub`), '-lpthread', '-lm', '-lc']);
run(join(sdk, 'bin', `vita-elf-create${suffix}`), [elf, velf]);
run(join(sdk, 'bin', `vita-make-fself${suffix}`), ['-s', '1048576', '-c', velf, eboot]);
writeFileSync(join(runtime, 'runtime.json'), JSON.stringify({ abi: 1, quickjsRevision: revision,
  sha256: createHash('sha256').update(readFileSync(eboot)).digest('hex'),
  sourceSha256: createHash('sha256').update(readFileSync(join(runtime, 'src/main.c'))).digest('hex') }, null, 2) + '\n');
console.log('Runtime QuickJS/vita2d compilado: ' + eboot);
