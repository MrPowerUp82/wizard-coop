// @ts-check
// Canvas 2D compatibility for nx.js 1.0.0-beta.6.
//
// Filling a path (arc, ellipse, polygon) with a radial gradient draws nothing in nx.js — in both the
// CPU and GPU renderers — while fillRect with the same gradient works. The game uses radial
// gradients for every glow (spells, auras, zones), so fill() with a radial gradient is routed through
// clip() + fillRect(): the same pixels, inside the same path, with the path left intact for a later
// stroke(). Found with the on-console primitive diagnostic described in README.md.

const radial = new WeakSet();
const HUGE = 1e5;

/** Patches the context class of `ctx` (and of OffscreenCanvas contexts) once. */
export function installCanvasCompat(ctx) {
  for (const proto of new Set([Object.getPrototypeOf(ctx), Object.getPrototypeOf(new OffscreenCanvas(1, 1).getContext('2d'))])) {
    if (!proto || proto.__arcanaCanvas) continue;
    const createRadialGradient = proto.createRadialGradient;
    const fill = proto.fill;
    proto.createRadialGradient = function (...args) {
      const gradient = createRadialGradient.apply(this, args);
      radial.add(gradient);
      return gradient;
    };
    proto.fill = function (...args) {
      if (args.length || !radial.has(this.fillStyle)) return fill.apply(this, args);
      this.save();
      this.clip();
      this.fillRect(-HUGE, -HUGE, HUGE * 2, HUGE * 2);
      this.restore();
    };
    Object.defineProperty(proto, '__arcanaCanvas', { value: true });
  }
}
