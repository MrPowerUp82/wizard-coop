// @ts-check
// Canvas font compatibility for nx.js.
//
// The shared renderer sets fonts such as '700 11px Inter' or '14px serif'. In nx.js 1.0.0-beta.6 a
// `ctx.font` whose family/weight pair was never registered is silently ignored (the previous font
// stays), and 'system-ui' with a non-normal weight registers the system font again on every call.
// So the Switch build registers Inter and Cinzel (converted from the web's @fontsource files by
// build.mjs) and rewrites every font string to a registered family/weight once, cached.

/** @type {Array<[string, number]>} */
const FACES = [
  ['Inter', 400], ['Inter', 500], ['Inter', 600], ['Inter', 700], ['Inter', 800],
  ['Cinzel', 600], ['Cinzel', 700]
];
const WEIGHTS = { Inter: [400, 500, 600, 700, 800], Cinzel: [600, 700] };
const FONT = /^\s*(?:(italic|oblique|normal)\s+)?(?:(\d{3}|bold|bolder|lighter|normal)\s+)?([\d.]+px)\s+(.+?)\s*$/;
const cache = new Map();

/** Registers the bundled fonts; files are produced by build.mjs under romfs:/fonts/. */
export async function loadFonts() {
  for (const [family, weight] of FACES) {
    const data = await Switch.readFile(`romfs:/fonts/${family.toLowerCase()}-${weight}.ttf`);
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
    const family = familyList.split(',').map(name => name.trim().replace(/^["']|["']$/g, '')).find(name => WEIGHTS[name]);
    // Symbols drawn with "serif" (power icons, runes) and unknown families use the console's system font.
    font = family ? `${nearest(WEIGHTS[family], weight)} ${size} ${family}` : `${size} system-ui`;
  }
  cache.set(value, font);
  return font;
}

/** Routes every `ctx.font = …` of this context class through normalizeFont. */
export function installFontCompat(ctx) {
  const proto = Object.getPrototypeOf(ctx);
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'font');
  if (!descriptor?.set || proto.__arcanaFonts) return;
  Object.defineProperty(proto, 'font', {
    configurable: true,
    enumerable: descriptor.enumerable,
    get: descriptor.get,
    set(value) { descriptor.set.call(this, normalizeFont(value)); }
  });
  Object.defineProperty(proto, '__arcanaFonts', { value: true });
}
