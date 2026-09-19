// @ts-check
// Canvas 2D compatibility layer for PlayStation Vita.
//
// Polyfills and adjusts Canvas 2D methods that may differ or be missing in embedded
// vector backends (roundRect, ellipse, setLineDash, radial gradients).

const radial = new WeakSet();

/**
 * Ensures standard Canvas 2D methods (roundRect, ellipse, setLineDash) are present
 * on the 2D context prototype and fixes radial gradient fills.
 * @param {any} ctx
 */
export function installCanvasCompat(ctx) {
  const protos = new Set([
    Object.getPrototypeOf(ctx),
    typeof OffscreenCanvas !== 'undefined' ? Object.getPrototypeOf(new OffscreenCanvas(1, 1).getContext('2d')) : null
  ].filter(Boolean));

  for (const proto of protos) {
    if (proto.__arcanaVitaCanvas) continue;

    // 1. Radial gradient path fill fallback (clip + fillRect)
    if (proto.createRadialGradient && proto.fill) {
      const createRadialGradient = proto.createRadialGradient;
      const fill = proto.fill;
      proto.createRadialGradient = function (...args) {
        const gradient = createRadialGradient.apply(this, args);
        radial.add(gradient);
        return gradient;
      };
      proto.fill = function (...args) {
        if (args.length || !radial.has(this.fillStyle)) return fill.apply(this, args);
        const cw = this.canvas?.width || 960, ch = this.canvas?.height || 544;
        this.save();
        this.clip();
        this.fillRect(-cw, -ch, cw * 3, ch * 3);
        this.restore();
      };
    }

    // 2. roundRect polyfill if not present natively
    if (!proto.roundRect) {
      proto.roundRect = function (x, y, w, h, r = 0) {
        let radius = typeof r === 'number' ? r : (Array.isArray(r) ? r[0] : 0);
        radius = Math.min(radius, Math.min(w, h) / 2);
        if (radius <= 0) {
          this.rect(x, y, w, h);
          return;
        }
        this.moveTo(x + radius, y);
        this.arcTo(x + w, y, x + w, y + radius, radius);
        this.lineTo(x + w, y + h - radius);
        this.arcTo(x + w, y + h, x + w - radius, y + h, radius);
        this.lineTo(x + radius, y + h);
        this.arcTo(x, y + h, x, y + h - radius, radius);
        this.lineTo(x, y + radius);
        this.arcTo(x, y, x + radius, y, radius);
        this.closePath();
      };
    }

    // 3. ellipse polyfill
    if (!proto.ellipse) {
      proto.ellipse = function (x, y, rx, ry, rotation, startAngle, endAngle, counterclockwise = false) {
        if (rx === ry && !rotation) {
          this.arc(x, y, rx, startAngle, endAngle, counterclockwise);
          return;
        }
        this.save();
        this.translate(x, y);
        this.rotate(rotation);
        this.scale(rx, ry);
        this.arc(0, 0, 1, startAngle, endAngle, counterclockwise);
        this.restore();
      };
    }

    // 4. setLineDash polyfill
    if (!proto.setLineDash) {
      proto.setLineDash = function (_segments) {};
      proto.getLineDash = function () { return []; };
    }

    Object.defineProperty(proto, '__arcanaVitaCanvas', { value: true });
  }
}
