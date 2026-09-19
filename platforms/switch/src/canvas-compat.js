// @ts-check
// Canvas 2D compatibility for nx.js 1.0.0-beta.6.
//
// Filling a path (arc, ellipse, polygon) with a radial gradient draws nothing in nx.js — in both the
// CPU and GPU renderers — while fillRect with the same gradient works. The game uses radial
// gradients for every glow (spells, auras, zones), so fill() with a radial gradient is routed through
// clip() + fillRect(): the same pixels, inside the same path, with the path left intact for a later
// stroke(). Found with the on-console primitive diagnostic described in README.md.

const radialBounds = new WeakMap();

/** Patches the context class of `ctx` (and of OffscreenCanvas contexts) once. */
export function installCanvasCompat(ctx) {
  for (const proto of new Set([Object.getPrototypeOf(ctx), Object.getPrototypeOf(new OffscreenCanvas(1, 1).getContext('2d'))])) {
    if (!proto || proto.__arcanaCanvas) continue;
    const createRadialGradient = proto.createRadialGradient;
    const fill = proto.fill;
    proto.createRadialGradient = function (x0, y0, r0, x1, y1, r1) {
      const gradient = createRadialGradient.call(this, x0, y0, r0, x1, y1, r1);
      const r = Math.max(Number(r0) || 0, Number(r1) || 0);
      const cx = typeof x1 === 'number' ? x1 : (Number(x0) || 0);
      const cy = typeof y1 === 'number' ? y1 : (Number(y0) || 0);
      radialBounds.set(gradient, [cx - r - 2, cy - r - 2, (r + 2) * 2, (r + 2) * 2]);
      return gradient;
    };
    proto.fill = function (...args) {
      const bounds = radialBounds.get(this.fillStyle);
      if (args.length || !bounds) return fill.apply(this, args);
      this.save();
      this.clip();
      this.fillRect(bounds[0], bounds[1], bounds[2], bounds[3]);
      this.restore();
    };
    Object.defineProperty(proto, '__arcanaCanvas', { value: true });
  }
}
