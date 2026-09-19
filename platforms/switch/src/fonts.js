// @ts-check
// Canvas font compatibility for nx.js.
//
// The shared renderer sets fonts such as '700 11px Inter' or '14px serif'. In nx.js 1.0.0-beta.6 a
// `ctx.font` whose family/weight pair was never registered is silently ignored (the previous font
// stays), and 'system-ui' with a non-normal weight registers the system font again on every call.
// nx.js also draws each string with a single typeface (no per-glyph fallback), so symbols Inter lacks
// (power icons, ◀ ▶ ● ✓ …) would be empty boxes. So the Switch build:
// - registers Inter and Cinzel (converted from the web's fonts by build.mjs) plus DejaVu Sans;
// - rewrites every font string to a registered family/weight once, cached;
// - draws a string with DejaVu Sans when it contains a character Inter cannot draw.

/** @type {Array<[string, number, string]>} family, weight, file under romfs:/fonts/ */
const FACES = [
  ['Inter', 400, 'inter-400'], ['Inter', 500, 'inter-500'], ['Inter', 600, 'inter-600'], ['Inter', 700, 'inter-700'], ['Inter', 800, 'inter-800'],
  ['Cinzel', 600, 'cinzel-600'], ['Cinzel', 700, 'cinzel-700'],
  ['DejaVu Sans', 400, 'dejavu-400'], ['DejaVu Sans', 700, 'dejavu-700']
];
const WEIGHTS = { Inter: [400, 500, 600, 700, 800], Cinzel: [600, 700], 'DejaVu Sans': [400, 700] };
const SYMBOLS = 'DejaVu Sans';
const FONT = /^\s*(?:(italic|oblique|normal)\s+)?(?:(\d{3}|bold|bolder|lighter|normal)\s+)?([\d.]+px)\s+(.+?)\s*$/;
// Glyphs no bundled font has, replaced by the closest one DejaVu Sans has.
const SUBSTITUTES = { '᛭': '✱', 'ᛉ': 'Ψ', '⛨': '✠' };
const SUBSTITUTE = /[᛭ᛉ⛨]/g;
// Characters from U+0250 up that Inter draws; build.mjs reads them from the bundled font file.
const INTER_DRAWS = new Set(typeof INTER_SYMBOLS === 'string' ? INTER_SYMBOLS : '​–—‘’‚“”„•…′″‹›⁄€™↑↓−﻿');
const cache = new Map();

/** Registers the bundled fonts; files are produced by build.mjs under romfs:/fonts/. */
export async function loadFonts() {
  for (const [family, weight, file] of FACES) {
    const data = await Switch.readFile(`romfs:/fonts/${file}.ttf`);
    if (!data) continue;
    fonts.add(new FontFace(family, data, { weight: String(weight) }));
    // Font strings without a weight parse as "normal".
    if (weight === 400) fonts.add(new FontFace(family, data));
  }
}

const nearest = (list, weight) => list.reduce((best, w) => Math.abs(w - weight) < Math.abs(best - weight) ? w : best, list[0]);

/** Maps any CSS font shorthand the game uses to one nx.js has registered. */
export function normalizeFont(value) {
  let font = cache.get(value);
  if (font) return font;
  const match = FONT.exec(String(value));
  if (!match) font = value;
  else {
    const [, , rawWeight = 'normal', size, familyList] = match;
    const weight = rawWeight === 'bold' || rawWeight === 'bolder' ? 700 : /^\d+$/.test(rawWeight) ? Number(rawWeight) : 400;
    const families = familyList.split(',').map(name => name.trim().replace(/^["']|["']$/g, ''));
    const family = families.find(name => WEIGHTS[name]);
    // Icon text drawn with "serif" (power icons, runes) and unknown families use DejaVu Sans;
    // explicit system-ui / sans-serif keep the console's own font.
    font = family ? `${nearest(WEIGHTS[family], weight)} ${size} ${family}`
      : families.some(name => name === 'system-ui' || name === 'sans-serif') ? `${size} system-ui`
        : `${nearest(WEIGHTS[SYMBOLS], weight)} ${size} ${SYMBOLS}`;
  }
  // Damage numbers animate their size: keep the cache bounded.
  if (cache.size > 2000) cache.clear();
  cache.set(value, font);
  return font;
}

/** Whether `text` has a character Inter cannot draw. */
function needsSymbols(text) {
  for (const char of text) if (char.codePointAt(0) >= 0x250 && !INTER_DRAWS.has(char)) return true;
  return false;
}

/** Routes `ctx.font = …` and text drawing of this context class through the rules above. */
export function installFontCompat(ctx) {
  const proto = Object.getPrototypeOf(ctx);
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'font');
  if (!descriptor?.set || proto.__arcanaFonts) return;
  Object.defineProperty(proto, 'font', {
    configurable: true,
    enumerable: descriptor.enumerable,
    get: descriptor.get,
    set(value) {
      if (this.__rawFont === value) return;
      this.__rawFont = value;
      this.__font = normalizeFont(value);
      descriptor.set.call(this, this.__font);
    }
  });
  for (const name of ['fillText', 'strokeText', 'measureText']) {
    const draw = proto[name];
    proto[name] = function (text, ...rest) {
      const value = String(text).replace(SUBSTITUTE, char => SUBSTITUTES[char]);
      const current = this.__font || '10px sans-serif';
      if (current.endsWith(SYMBOLS) || !needsSymbols(value)) return draw.call(this, value, ...rest);
      const [, weight = '400', size = '10px'] = /^(?:(\d{3}) )?([\d.]+px)/.exec(current) || [];
      descriptor.set.call(this, `${Number(weight) >= 600 ? 700 : 400} ${size} ${SYMBOLS}`);
      try { return draw.call(this, value, ...rest); } finally { descriptor.set.call(this, current); }
    };
  }
  Object.defineProperty(proto, '__arcanaFonts', { value: true });
}
