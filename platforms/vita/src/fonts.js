// @ts-check
// Canvas font compatibility for PlayStation Vita.
//
// Normalizes font family/weight strings, provides DejaVu Sans fallbacks for symbols that
// Inter lacks, and registers TrueType fonts from app0:/assets/fonts/.

/** @type {Array<[string, number, string]>} family, weight, file */
const FACES = [
  ['Inter', 400, 'inter-400'], ['Inter', 500, 'inter-500'], ['Inter', 600, 'inter-600'], ['Inter', 700, 'inter-700'], ['Inter', 800, 'inter-800'],
  ['Cinzel', 600, 'cinzel-600'], ['Cinzel', 700, 'cinzel-700'],
  ['DejaVu Sans', 400, 'dejavu-400'], ['DejaVu Sans', 700, 'dejavu-700']
];
const WEIGHTS = { Inter: [400, 500, 600, 700, 800], Cinzel: [600, 700], 'DejaVu Sans': [400, 700] };
const SYMBOLS = 'DejaVu Sans';
const FONT = /^\s*(?:(italic|oblique|normal)\s+)?(?:(\d{3}|bold|bolder|lighter|normal)\s+)?([\d.]+px)\s+(.+?)\s*$/;
const SUBSTITUTES = { '᛭': '✱', 'ᛉ': 'Ψ', '⛨': '✠' };
const SUBSTITUTE = /[᛭ᛉ⛨]/g;
const INTER_DRAWS = new Set('​–—‘’‚“”„•…′″‹›⁄€™↑↓−﻿');
const cache = new Map();

/** Registers bundled fonts; files are copied by build.mjs to app0:/assets/fonts/. */
export async function loadFonts() {
  const global = /** @type {any} */ (globalThis);
  if (!global.FontFace || !global.fonts) return;
  for (const [family, weight, file] of FACES) {
    try {
      let data = null;
      if (global.Vita && global.Vita.readFile) {
        data = await global.Vita.readFile(`app0:/assets/fonts/${file}.ttf`);
      } else if (global.Switch && global.Switch.readFile) {
        data = await global.Switch.readFile(`romfs:/fonts/${file}.ttf`);
      }
      if (data) {
        global.fonts.add(new global.FontFace(family, data, { weight: String(weight) }));
        if (weight === 400) global.fonts.add(new global.FontFace(family, data));
      }
    } catch {
      /* font loading optional in mock environments */
    }
  }
}

const nearest = (list, weight) => list.reduce((best, w) => Math.abs(w - weight) < Math.abs(best - weight) ? w : best, list[0]);

/** Maps any CSS font shorthand the game uses to a registered font family. */
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
    font = family ? `${nearest(WEIGHTS[family], weight)} ${size} ${family}`
      : families.some(name => name === 'system-ui' || name === 'sans-serif') ? `${size} system-ui`
        : `${nearest(WEIGHTS[SYMBOLS], weight)} ${size} ${SYMBOLS}`;
  }
  if (cache.size > 2000) cache.clear();
  cache.set(value, font);
  return font;
}

function needsSymbols(text) {
  for (const char of text) if (char.codePointAt(0) >= 0x250 && !INTER_DRAWS.has(char)) return true;
  return false;
}

export function installFontCompat(ctx) {
  const proto = Object.getPrototypeOf(ctx);
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'font');
  if (!descriptor?.set || proto.__arcanaVitaFonts) return;
  Object.defineProperty(proto, 'font', {
    configurable: true,
    enumerable: descriptor.enumerable,
    get: descriptor.get,
    set(value) { this.__font = normalizeFont(value); descriptor.set.call(this, this.__font); }
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
  Object.defineProperty(proto, '__arcanaVitaFonts', { value: true });
}
