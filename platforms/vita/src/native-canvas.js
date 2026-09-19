// Canvas subset used by Arcana, backed by the bundled QuickJS/vita2d bridge.
// Hot paths intentionally avoid per-draw typed-array/object allocation: QuickJS GC is one of the
// biggest frame-time costs once a horde fills the screen.
import earcut from 'earcut';

const TAU = Math.PI * 2;
const EPS = 1e-5;
const MAX_REUSED_VERTICES = 4096;
const clamp = v => Math.max(0, Math.min(1, v));
const colors = new Map();
const measureCache = new Map();
const fontCache = new Map();

function rgba(value) {
  let c = colors.get(value);
  if (c) return c;
  if (value === 'transparent') c = [0, 0, 0, 0];
  else if (typeof value === 'string' && value.charCodeAt(0) === 35 /* # */) {
    let hex = value.slice(1);
    if (hex.length === 3 || hex.length === 4) hex = [...hex].map(s => s + s).join('');
    c = [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16),
      hex.length === 8 ? parseInt(hex.slice(6), 16) / 255 : 1];
  } else {
    const values = String(value).match(/[\d.]+/g);
    c = values ? values.map(Number) : [255, 255, 255];
    if (c.length === 3) c.push(1);
  }
  if (colors.size > 2048) {
    const iter = colors.keys();
    for (let i = 0; i < 512; i++) {
      const next = iter.next();
      if (next.done) break;
      colors.delete(next.value);
    }
  }
  colors.set(value, c);
  return c;
}

function packed(c, alpha) {
  return ((Math.round(clamp(c[3] * alpha) * 255) << 24) | (Math.round(c[2]) << 16) | (Math.round(c[1]) << 8) | Math.round(c[0])) >>> 0;
}

class Gradient {
  constructor(kind, points) { this.kind = kind; this.points = points; this.stops = []; }
  addColorStop(at, color) {
    const stop = [at, rgba(color)];
    let i = this.stops.length;
    while (i > 0 && this.stops[i - 1][0] > at) i--;
    this.stops.splice(i, 0, stop);
  }
  ratio(x, y) {
    const p = this.points;
    const dx = p[2] - p[0], dy = p[3] - p[1];
    return clamp(this.kind === 'radial' ? Math.hypot(x - p[2], y - p[3]) / (p[4] || 1)
      : ((x - p[0]) * dx + (y - p[1]) * dy) / (dx * dx + dy * dy || 1));
  }
  packedAt(x, y, alpha) {
    if (!this.stops.length) return 0;
    const t = this.ratio(x, y);
    let left = this.stops[0];
    for (let i = 1; i < this.stops.length; i++) {
      const right = this.stops[i];
      if (t <= right[0]) {
        const f = clamp((t - left[0]) / (right[0] - left[0] || 1));
        const a = left[1], b = right[1];
        return packed([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f,
          a[2] + (b[2] - a[2]) * f, a[3] + (b[3] - a[3]) * f], alpha);
      }
      left = right;
    }
    return packed(left[1], alpha);
  }
}

const STATE = ['fillStyle', 'strokeStyle', 'globalAlpha', 'globalCompositeOperation', 'lineWidth', 'lineCap', 'lineJoin', 'font', 'textAlign', 'textBaseline', 'shadowBlur', 'shadowColor', 'lineDashOffset'];

export class NativeCanvas {
  constructor(native, width = 960, height = 544) {
    this.native = native; this.canvas = { width, height };
    this.fillStyle = this.strokeStyle = '#000'; this.globalAlpha = 1;
    this.globalCompositeOperation = 'source-over'; this.lineWidth = 1;
    this.font = '16px Inter'; this.textAlign = 'left'; this.textBaseline = 'alphabetic';
    this.transform = [1, 0, 0, 1, 0, 0]; this.stack = []; this.stackDepth = 0;
    this.bounds = [0, 0, width, height]; this.dash = []; this.paths = []; this.path = null;
    this.pathPool = []; this.pointPool = [];
    this.simpleCircle = null;

    this.imageCorners = new Float32Array(8);
    this.imageCornersBuffer = this.imageCorners.buffer;
    this.rectVertices = new Float32Array(18);
    this.rectVerticesBuffer = this.rectVertices.buffer;
    this.rectColors = new Uint32Array(6);
    this.rectColorsBuffer = this.rectColors.buffer;
    for (let i = 2; i < 18; i += 3) this.rectVertices[i] = 0.5;

    this.triangleVertices = new Float32Array(MAX_REUSED_VERTICES * 3);
    this.triangleColors = new Uint32Array(MAX_REUSED_VERTICES);
    this.triangleVerticesBuffer = this.triangleVertices.buffer;
    this.triangleColorsBuffer = this.triangleColors.buffer;
    for (let i = 2; i < this.triangleVertices.length; i += 3) this.triangleVertices[i] = 0.5;

    this.preparedBounds = [NaN, NaN, NaN, NaN];
    this.preparedBlend = null;
  }

  /** Called by the native frame pump after vita2d resets clip state. */
  beginFrame() {
    this.preparedBounds[0] = NaN;
    this.preparedBlend = null;
  }

  point(x, y) {
    const m = this.transform;
    return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  }
  pathPoint(x, y) {
    const p = this.pointPool.pop() || [0, 0], m = this.transform;
    p[0] = m[0] * x + m[2] * y + m[4]; p[1] = m[1] * x + m[3] * y + m[5];
    return p;
  }
  recyclePath(path) {
    for (let i = 0; i < path.length; i++) this.pointPool.push(path[i]);
    path.length = 0; path.closed = false; this.pathPool.push(path);
  }
  setTransform(a, b, c, d, e, f) {
    const m = this.transform; m[0] = a; m[1] = b; m[2] = c; m[3] = d; m[4] = e; m[5] = f;
  }
  resetTransform() { this.setTransform(1, 0, 0, 1, 0, 0); }
  translate(x, y) {
    const m = this.transform, px = m[0] * x + m[2] * y + m[4], py = m[1] * x + m[3] * y + m[5];
    m[4] = px; m[5] = py;
  }
  scale(x, y) { const m = this.transform; m[0] *= x; m[1] *= x; m[2] *= y; m[3] *= y; }
  rotate(r) {
    const m = this.transform, a = m[0], b = m[1], c = m[2], d = m[3], s = Math.sin(r), co = Math.cos(r);
    m[0] = a * co + c * s; m[1] = b * co + d * s; m[2] = c * co - a * s; m[3] = d * co - b * s;
  }
  save() {
    let s = this.stack[this.stackDepth];
    if (!s) s = this.stack[this.stackDepth] = { props: new Array(STATE.length), transform: new Array(6), bounds: new Array(4), dash: [] };
    this.stackDepth++;
    for (let i = 0; i < STATE.length; i++) s.props[i] = this[STATE[i]];
    for (let i = 0; i < 6; i++) s.transform[i] = this.transform[i];
    for (let i = 0; i < 4; i++) s.bounds[i] = this.bounds[i];
    s.dash.length = this.dash.length; for (let i = 0; i < this.dash.length; i++) s.dash[i] = this.dash[i];
  }
  restore() {
    if (!this.stackDepth) return;
    const s = this.stack[--this.stackDepth];
    for (let i = 0; i < STATE.length; i++) this[STATE[i]] = s.props[i];
    for (let i = 0; i < 6; i++) this.transform[i] = s.transform[i];
    for (let i = 0; i < 4; i++) this.bounds[i] = s.bounds[i];
    this.dash.length = s.dash.length; for (let i = 0; i < s.dash.length; i++) this.dash[i] = s.dash[i];
  }
  beginPath() {
    for (let i = 0; i < this.paths.length; i++) this.recyclePath(this.paths[i]);
    this.paths.length = 0; this.path = null; this.simpleCircle = null;
  }
  moveTo(x, y) {
    this.simpleCircle = null;
    const path = this.pathPool.pop() || [];
    path.length = 0; path.closed = false; path.push(this.pathPoint(x, y));
    this.path = path; this.paths.push(path);
  }
  lineTo(x, y) { this.simpleCircle = null; if (!this.path) this.moveTo(x, y); else this.path.push(this.pathPoint(x, y)); }
  closePath() { if (this.path?.length) this.path.closed = true; }
  rect(x, y, w, h) { this.moveTo(x, y); this.lineTo(x + w, y); this.lineTo(x + w, y + h); this.lineTo(x, y + h); this.closePath(); }
  roundRect(x, y, w, h, radius = 0) {
    const r = Math.max(0, Math.min(Array.isArray(radius) ? radius[0] : radius, Math.abs(w) / 2, Math.abs(h) / 2));
    if (r <= 0) { this.rect(x, y, w, h); return; }
    this.moveTo(x + r, y);
    this.arc(x + w - r, y + r, r, -Math.PI / 2, 0);
    this.arc(x + w - r, y + h - r, r, 0, Math.PI / 2);
    this.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
    this.arc(x + r, y + r, r, Math.PI, Math.PI * 1.5); this.closePath();
  }
  arc(x, y, radius, start, end, ccw = false) {
    const standalone = !this.path && this.paths.length === 0;
    let span = end - start;
    if (Math.abs(span) >= TAU) span = ccw ? -TAU : TAU;
    else if (ccw && span > 0) span -= TAU;
    else if (!ccw && span < 0) span += TAU;
    // The game draws hundreds of complete circles every frame. Do not tessellate them in JS only
    // to throw those points away again when the native bridge can draw the same primitive directly.
    if (standalone && Math.abs(span) >= TAU - 1e-4) {
      const m = this.transform, sx = Math.hypot(m[0], m[1]), sy = Math.hypot(m[2], m[3]);
      if (Math.abs(sx - sy) < 0.001) {
        this.simpleCircle = { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5], r: radius * (sx + sy) * 0.5 };
        return;
      }
    }
    this.ellipse(x, y, radius, radius, 0, start, end, ccw);
  }
  ellipse(x, y, rx, ry, rotation, start, end, ccw = false) {
    let span = end - start;
    if (Math.abs(span) >= TAU) span = ccw ? -TAU : TAU;
    else if (ccw && span > 0) span -= TAU;
    else if (!ccw && span < 0) span += TAU;
    // Vita's 960×544 output does not benefit visually from browser-level tessellation density.
    const steps = Math.max(6, Math.min(28, Math.ceil(Math.abs(span) * Math.sqrt(Math.max(rx, ry, 1)) * 0.62)));
    const co = Math.cos(rotation), si = Math.sin(rotation);
    for (let i = 0; i <= steps; i++) {
      const angle = start + span * i / steps, px = rx * Math.cos(angle), py = ry * Math.sin(angle);
      this.lineTo(x + px * co - py * si, y + px * si + py * co);
    }
  }
  quadraticCurveTo(cx, cy, x, y) {
    if (!this.path?.length) this.moveTo(cx, cy);
    const p = this.path[this.path.length - 1], m = this.transform;
    const c0 = m[0] * cx + m[2] * cy + m[4], c1 = m[1] * cx + m[3] * cy + m[5];
    const e0 = m[0] * x + m[2] * y + m[4], e1 = m[1] * x + m[3] * y + m[5];
    for (let i = 1; i <= 7; i++) {
      const t = i / 7, u = 1 - t, point = this.pointPool.pop() || [0, 0];
      point[0] = u * u * p[0] + 2 * u * t * c0 + t * t * e0;
      point[1] = u * u * p[1] + 2 * u * t * c1 + t * t * e1;
      this.path.push(point);
    }
  }
  bezierCurveTo(c1x, c1y, c2x, c2y, x, y) {
    if (!this.path?.length) this.moveTo(c1x, c1y);
    const p = this.path[this.path.length - 1], m = this.transform;
    const a0 = m[0] * c1x + m[2] * c1y + m[4], a1 = m[1] * c1x + m[3] * c1y + m[5];
    const b0 = m[0] * c2x + m[2] * c2y + m[4], b1 = m[1] * c2x + m[3] * c2y + m[5];
    const e0 = m[0] * x + m[2] * y + m[4], e1 = m[1] * x + m[3] * y + m[5];
    for (let i = 1; i <= 9; i++) {
      const t = i / 9, u = 1 - t, uu = u * u, tt = t * t, point = this.pointPool.pop() || [0, 0];
      point[0] = uu * u * p[0] + 3 * uu * t * a0 + 3 * u * tt * b0 + tt * t * e0;
      point[1] = uu * u * p[1] + 3 * uu * t * a1 + 3 * u * tt * b1 + tt * t * e1;
      this.path.push(point);
    }
  }
  createLinearGradient(x0, y0, x1, y1) {
    const m = this.transform;
    return new Gradient('linear', [m[0] * x0 + m[2] * y0 + m[4], m[1] * x0 + m[3] * y0 + m[5],
      m[0] * x1 + m[2] * y1 + m[4], m[1] * x1 + m[3] * y1 + m[5]]);
  }
  createRadialGradient(x0, y0, _r0, x1, y1, r1) {
    const m = this.transform;
    return new Gradient('radial', [m[0] * x0 + m[2] * y0 + m[4], m[1] * x0 + m[3] * y0 + m[5],
      m[0] * x1 + m[2] * y1 + m[4], m[1] * x1 + m[3] * y1 + m[5], r1 * Math.hypot(m[0], m[1])]);
  }
  prepare() {
    const b = this.bounds, p = this.preparedBounds;
    if (b[0] !== p[0] || b[1] !== p[1] || b[2] !== p[2] || b[3] !== p[3]) {
      this.native.clip(b[0], b[1], b[2], b[3]); p[0] = b[0]; p[1] = b[1]; p[2] = b[2]; p[3] = b[3];
    }
    const blend = this.globalCompositeOperation === 'lighter';
    if (blend !== this.preparedBlend) { this.native.blend(blend); this.preparedBlend = blend; }
  }
  triangles(points, indices, style) {
    const count = indices.length;
    if (!count || this.globalAlpha <= 0) return;
    let vertices = this.triangleVertices, palette = this.triangleColors;
    if (count > MAX_REUSED_VERTICES) { vertices = new Float32Array(count * 3); palette = new Uint32Array(count); }
    const gradient = style instanceof Gradient;
    const solid = gradient ? 0 : packed(rgba(style), this.globalAlpha);
    for (let i = 0; i < count; i++) {
      const p = points[indices[i]], at = i * 3;
      vertices[at] = p[0]; vertices[at + 1] = p[1]; vertices[at + 2] = 0.5;
      palette[i] = gradient ? style.packedAt(p[0], p[1], this.globalAlpha) : solid;
    }
    this.prepare(); this.native.triangles(vertices.buffer, palette.buffer, count);
  }
  fill() {
    if (this.simpleCircle && this.globalAlpha > 0 && this.native.fillCircle) {
      const c = this.simpleCircle; this.prepare();
      if (this.fillStyle instanceof Gradient && this.fillStyle.kind === 'radial') {
        // Six concentric hardware circles preserve the glow silhouette at a fraction of the old
        // hundreds of JS-generated gradient triangles.
        for (let ring = 6; ring >= 1; ring--) {
          const f = ring / 6;
          this.native.fillCircle(c.x, c.y, c.r * f, this.fillStyle.packedAt(c.x + c.r * f, c.y, this.globalAlpha));
        }
      } else if (!(this.fillStyle instanceof Gradient)) this.native.fillCircle(c.x, c.y, c.r, packed(rgba(this.fillStyle), this.globalAlpha));
      else this.triangles(this.paths[0], earcut(this.paths[0].flat()), this.fillStyle);
      return;
    }
    for (const path of this.paths) {
      if (path.length < 3) continue;
      if (this.fillStyle instanceof Gradient && this.fillStyle.kind === 'radial') {
        const center = [this.fillStyle.points[2], this.fillStyle.points[3]], points = [center], indices = [];
        for (let ring = 1; ring <= 4; ring++) for (const p of path) points.push([center[0] + (p[0] - center[0]) * ring / 4, center[1] + (p[1] - center[1]) * ring / 4]);
        const n = path.length;
        for (let i = 0; i < n; i++) indices.push(0, 1 + i, 1 + (i + 1) % n);
        for (let r = 1; r < 4; r++) for (let i = 0; i < n; i++) {
          const a = 1 + (r - 1) * n + i, b = 1 + (r - 1) * n + (i + 1) % n;
          indices.push(a, a + n, b, b, a + n, b + n);
        }
        this.triangles(points, indices, this.fillStyle);
      } else this.triangles(path, earcut(path.flat()), this.fillStyle);
    }
  }
  stroke() {
    if (this.simpleCircle && this.globalAlpha > 0 && !(this.strokeStyle instanceof Gradient) && this.native.strokeCircle) {
      const c = this.simpleCircle; this.prepare();
      this.native.strokeCircle(c.x, c.y, c.r, this.lineWidth * Math.hypot(this.transform[0], this.transform[1]), packed(rgba(this.strokeStyle), this.globalAlpha));
      return;
    }
    const scale = Math.hypot(this.transform[0], this.transform[1]);
    if (!(this.strokeStyle instanceof Gradient) && this.native.strokeLine && this.globalAlpha > 0) {
      const width = this.lineWidth * scale, color = packed(rgba(this.strokeStyle), this.globalAlpha);
      this.prepare();
      for (const path of this.paths) for (let i = 1; i < path.length + Number(Boolean(path.closed)); i++) {
        const a = path[i - 1], b = path[i % path.length];
        this.native.strokeLine(a[0], a[1], b[0], b[1], width, color);
      }
      return;
    }
    const points = [], indices = [], half = this.lineWidth * scale / 2;
    for (const path of this.paths) for (let i = 1; i < path.length + Number(Boolean(path.closed)); i++) {
      const a = path[i - 1], b = path[i % path.length], dx0 = b[0] - a[0], dy0 = b[1] - a[1], length = Math.hypot(dx0, dy0); if (!length) continue;
      const dx = dy0 / length * half, dy = -dx0 / length * half, j = points.length;
      points.push([a[0] + dx, a[1] + dy], [a[0] - dx, a[1] - dy], [b[0] + dx, b[1] + dy], [b[0] - dx, b[1] - dy]);
      indices.push(j, j + 1, j + 2, j + 2, j + 1, j + 3);
    }
    this.triangles(points, indices, this.strokeStyle);
  }
  fillRect(x, y, w, h) {
    if (this.globalAlpha <= 0 || w <= 0 || h <= 0) return;
    const m = this.transform;
    if (!(this.fillStyle instanceof Gradient) && Math.abs(m[1]) < EPS && Math.abs(m[2]) < EPS && this.native.rect) {
      let tx = m[0] * x + m[4], ty = m[3] * y + m[5], tw = m[0] * w, th = m[3] * h;
      if (tw < 0) { tx += tw; tw = -tw; } if (th < 0) { ty += th; th = -th; }
      this.prepare(); this.native.rect(tx, ty, tw, th, packed(rgba(this.fillStyle), this.globalAlpha)); return;
    }
    if (this.fillStyle instanceof Gradient) {
      this.triangles([this.point(x, y), this.point(x + w, y), this.point(x + w, y + h), this.point(x, y + h)], [0, 1, 2, 0, 2, 3], this.fillStyle);
      return;
    }
    const a = m[0], b = m[1], c = m[2], d = m[3], e = m[4], f = m[5], v = this.rectVertices;
    const x0 = a * x + c * y + e, y0 = b * x + d * y + f;
    const x1 = a * (x + w) + c * y + e, y1 = b * (x + w) + d * y + f;
    const x2 = a * (x + w) + c * (y + h) + e, y2 = b * (x + w) + d * (y + h) + f;
    const x3 = a * x + c * (y + h) + e, y3 = b * x + d * (y + h) + f;
    v[0] = x0; v[1] = y0; v[3] = x1; v[4] = y1; v[6] = x2; v[7] = y2;
    v[9] = x0; v[10] = y0; v[12] = x2; v[13] = y2; v[15] = x3; v[16] = y3;
    const col = this.rectColors, color = packed(rgba(this.fillStyle), this.globalAlpha);
    col[0] = col[1] = col[2] = col[3] = col[4] = col[5] = color;
    this.prepare(); this.native.triangles(this.rectVerticesBuffer, this.rectColorsBuffer, 6);
  }
  strokeRect(x, y, w, h) {
    if (!(this.strokeStyle instanceof Gradient) && this.native.strokeLine && this.globalAlpha > 0) {
      const m = this.transform, color = packed(rgba(this.strokeStyle), this.globalAlpha), width = this.lineWidth * Math.hypot(m[0], m[1]);
      const x0 = m[0] * x + m[2] * y + m[4], y0 = m[1] * x + m[3] * y + m[5];
      const x1 = m[0] * (x + w) + m[2] * y + m[4], y1 = m[1] * (x + w) + m[3] * y + m[5];
      const x2 = m[0] * (x + w) + m[2] * (y + h) + m[4], y2 = m[1] * (x + w) + m[3] * (y + h) + m[5];
      const x3 = m[0] * x + m[2] * (y + h) + m[4], y3 = m[1] * x + m[3] * (y + h) + m[5];
      this.prepare();
      this.native.strokeLine(x0, y0, x1, y1, width, color); this.native.strokeLine(x1, y1, x2, y2, width, color);
      this.native.strokeLine(x2, y2, x3, y3, width, color); this.native.strokeLine(x3, y3, x0, y0, width, color);
      return;
    }
    const paths = this.paths, path = this.path, circle = this.simpleCircle;
    this.paths = []; this.path = null; this.simpleCircle = null; this.rect(x, y, w, h); this.stroke();
    for (const temporary of this.paths) this.recyclePath(temporary);
    this.paths = paths; this.path = path; this.simpleCircle = circle;
  }
  clip() {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, found = false;
    for (const path of this.paths) for (const p of path) { found = true; if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0]; if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1]; }
    if (!found) return;
    const b = this.bounds; b[0] = Math.max(b[0], minX); b[1] = Math.max(b[1], minY); b[2] = Math.min(b[2], maxX); b[3] = Math.min(b[3], maxY);
  }
  setLineDash(values) { this.dash.length = values.length; for (let i = 0; i < values.length; i++) this.dash[i] = values[i]; }
  getLineDash() { return this.dash.slice(); }
  fontInfo(value = '') {
    let base = fontCache.get(this.font);
    if (!base) {
      const match = /([\d.]+)px/.exec(this.font);
      const size = Math.max(8, Math.min(48, Math.round(Number(match?.[1] || 16))));
      base = [this.font.includes('DejaVu') ? 'dejavu-400' : this.font.includes('Cinzel') ? 'cinzel-700' : 'inter-400', size];
      if (fontCache.size > 128) fontCache.clear();
      fontCache.set(this.font, base);
    }
    if (base[0] !== 'inter-400') return base;
    for (const ch of String(value)) if (ch.codePointAt(0) > 0x24f) return ['dejavu-400', base[1]];
    return base;
  }
  measureText(value) {
    const str = String(value), info = this.fontInfo(str), font = info[0], size = info[1], key = font + ':' + size + ':' + str;
    let width = measureCache.get(key);
    if (width === undefined) {
      width = this.native.measure(font, size, str);
      if (measureCache.size > 1024) measureCache.clear();
      measureCache.set(key, width);
    }
    return { width };
  }
  fillText(value, x, y, maxWidth) {
    value = String(value).replace(/[᛭ᛉ⛨]/g, c => ({ '᛭': '✱', 'ᛉ': 'Ψ', '⛨': '✠' })[c]);
    const info = this.fontInfo(value), font = info[0], size = info[1];
    let measured = this.measureText(value).width;
    if (maxWidth && measured > maxWidth) {
      while (value.length > 1 && this.measureText(value + '…').width > maxWidth) value = value.slice(0, -1);
      value += '…'; measured = this.measureText(value).width;
    }
    if (this.textAlign === 'center') x -= measured / 2;
    else if (this.textAlign === 'right' || this.textAlign === 'end') x -= measured;
    if (this.textBaseline === 'top') y += size; else if (this.textBaseline === 'middle') y += size * 0.35;
    const m = this.transform, tx = m[0] * x + m[2] * y + m[4], ty = m[1] * x + m[3] * y + m[5];
    this.prepare(); this.native.text(font, size, value, tx, ty, packed(rgba(this.fillStyle), this.globalAlpha));
  }
  strokeText(...args) { this.fillText(...args); }
  drawImage(image, ...args) {
    let sx = 0, sy = 0, sw = image.width, sh = image.height, x, y, w, h;
    if (args.length === 2) { [x, y] = args; w = sw; h = sh; }
    else if (args.length === 4) [x, y, w, h] = args;
    else [sx, sy, sw, sh, x, y, w, h] = args;
    const m = this.transform, a = m[0], b = m[1], c0 = m[2], d = m[3], e = m[4], f = m[5], c = this.imageCorners;
    c[0] = a * x + c0 * y + e; c[1] = b * x + d * y + f;
    c[2] = a * (x + w) + c0 * y + e; c[3] = b * (x + w) + d * y + f;
    c[4] = a * x + c0 * (y + h) + e; c[5] = b * x + d * (y + h) + f;
    c[6] = a * (x + w) + c0 * (y + h) + e; c[7] = b * (x + w) + d * (y + h) + f;
    this.prepare(); this.native.image(image.id, this.imageCornersBuffer, sx, sy, sw, sh, packed([255, 255, 255, 1], this.globalAlpha));
  }
}
