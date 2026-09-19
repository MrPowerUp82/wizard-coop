// Canvas subset used by Arcana, backed by the bundled QuickJS/vita2d bridge.
// Geometry is transformed on the CPU; textures, triangles and clipping use GXM.
import earcut from 'earcut';

const TAU = Math.PI * 2;
const clamp = v => Math.max(0, Math.min(1, v));
const colors = new Map();

function rgba(value) {
  let c = colors.get(value);
  if (c) return c;
  if (value === 'transparent') c = [0, 0, 0, 0];
  else if (typeof value === 'string' && value.charCodeAt(0) === 35 /* # */) {
    let hex = value.slice(1);
    if (hex.length === 3 || hex.length === 4) hex = [...hex].map(s => s + s).join('');
    c = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16));
    c.push(hex.length === 8 ? parseInt(hex.slice(6), 16) / 255 : 1);
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
  return ((Math.round(clamp(c[3] * alpha) * 255) << 24) | (c[2] << 16) | (c[1] << 8) | c[0]) >>> 0;
}

class Gradient {
  constructor(kind, points) { this.kind = kind; this.points = points; this.stops = []; }
  addColorStop(at, color) { this.stops.push([at, rgba(color)]); this.stops.sort((a, b) => a[0] - b[0]); }
  color(x, y) {
    const [x0, y0, x1, y1, radius = 1] = this.points;
    const dx = x1 - x0, dy = y1 - y0;
    const t = clamp(this.kind === 'radial' ? Math.hypot(x - x1, y - y1) / radius : ((x - x0) * dx + (y - y0) * dy) / (dx * dx + dy * dy || 1));
    if (!this.stops.length) return [0, 0, 0, 0];
    let left = this.stops[0];
    for (const right of this.stops) {
      if (t <= right[0]) {
        const f = clamp((t - left[0]) / (right[0] - left[0] || 1));
        return left[1].map((v, i) => v + (right[1][i] - v) * f);
      }
      left = right;
    }
    return left[1];
  }
}

const STATE = ['fillStyle', 'strokeStyle', 'globalAlpha', 'globalCompositeOperation', 'lineWidth', 'lineCap', 'lineJoin', 'font', 'textAlign', 'textBaseline', 'shadowBlur', 'shadowColor', 'lineDashOffset'];
const measureCache = new Map();

export class NativeCanvas {
  constructor(native, width = 960, height = 544) {
    this.native = native; this.canvas = { width, height };
    this.fillStyle = this.strokeStyle = '#000'; this.globalAlpha = 1;
    this.globalCompositeOperation = 'source-over'; this.lineWidth = 1;
    this.font = '16px Inter'; this.textAlign = 'left'; this.textBaseline = 'alphabetic';
    this.transform = [1, 0, 0, 1, 0, 0]; this.stack = [];
    this.bounds = [0, 0, width, height]; this.dash = []; this.beginPath();

    // Reusable buffers to eliminate GC churn
    this.imageCorners = new Float32Array(8);
    this.imageCornersBuffer = this.imageCorners.buffer;

    this.rectVertices = new Float32Array(18); // 6 vertices * 3 coords
    this.rectVerticesBuffer = this.rectVertices.buffer;
    this.rectColors = new Uint32Array(6);
    this.rectColorsBuffer = this.rectColors.buffer;
    // Pre-fill z=0.5 for all rect vertices
    for (let i = 2; i < 18; i += 3) this.rectVertices[i] = 0.5;
  }
  point(x, y) { const [a, b, c, d, e, f] = this.transform; return [a * x + c * y + e, b * x + d * y + f]; }
  setTransform(a, b, c, d, e, f) { this.transform = [a, b, c, d, e, f]; }
  resetTransform() { this.setTransform(1, 0, 0, 1, 0, 0); }
  translate(x, y) { const p = this.point(x, y); this.transform[4] = p[0]; this.transform[5] = p[1]; }
  scale(x, y) { const m = this.transform; m[0] *= x; m[1] *= x; m[2] *= y; m[3] *= y; }
  rotate(r) { const [a, b, c, d, e, f] = this.transform, s = Math.sin(r), co = Math.cos(r); this.setTransform(a * co + c * s, b * co + d * s, c * co - a * s, d * co - b * s, e, f); }
  save() { this.stack.push({ props: STATE.map(k => this[k]), transform: [...this.transform], bounds: [...this.bounds], dash: [...this.dash] }); }
  restore() {
    const s = this.stack.pop(); if (!s) return;
    STATE.forEach((k, i) => { this[k] = s.props[i]; });
    this.transform = s.transform; this.bounds = s.bounds; this.dash = s.dash;
  }
  beginPath() { this.paths = []; this.path = null; }
  moveTo(x, y) { this.path = [this.point(x, y)]; this.paths.push(this.path); }
  lineTo(x, y) { if (!this.path) this.moveTo(x, y); else this.path.push(this.point(x, y)); }
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
  arc(x, y, radius, start, end, ccw = false) { this.ellipse(x, y, radius, radius, 0, start, end, ccw); }
  ellipse(x, y, rx, ry, rotation, start, end, ccw = false) {
    let span = end - start;
    if (Math.abs(span) >= TAU) span = ccw ? -TAU : TAU;
    else if (ccw && span > 0) span -= TAU;
    else if (!ccw && span < 0) span += TAU;
    const steps = Math.max(2, Math.min(40, Math.ceil(Math.abs(span) * Math.sqrt(Math.max(rx, ry, 1)))));
    const co = Math.cos(rotation), si = Math.sin(rotation);
    for (let i = 0; i <= steps; i++) {
      const angle = start + span * i / steps, px = rx * Math.cos(angle), py = ry * Math.sin(angle);
      this.lineTo(x + px * co - py * si, y + px * si + py * co);
    }
  }
  quadraticCurveTo(cx, cy, x, y) {
    if (!this.path?.length) this.moveTo(cx, cy);
    const p = this.path[this.path.length - 1], c = this.point(cx, cy), end = this.point(x, y);
    for (let i = 1; i <= 10; i++) { const t = i / 10, u = 1 - t; this.path.push([u * u * p[0] + 2 * u * t * c[0] + t * t * end[0], u * u * p[1] + 2 * u * t * c[1] + t * t * end[1]]); }
  }
  bezierCurveTo(c1x, c1y, c2x, c2y, x, y) {
    if (!this.path?.length) this.moveTo(c1x, c1y);
    const p = this.path[this.path.length - 1], a = this.point(c1x, c1y), b = this.point(c2x, c2y), end = this.point(x, y);
    for (let i = 1; i <= 14; i++) { const t = i / 14, u = 1 - t; this.path.push([0, 1].map(k => u ** 3 * p[k] + 3 * u * u * t * a[k] + 3 * u * t * t * b[k] + t ** 3 * end[k])); }
  }
  createLinearGradient(x0, y0, x1, y1) { return new Gradient('linear', [...this.point(x0, y0), ...this.point(x1, y1)]); }
  createRadialGradient(x0, y0, _r0, x1, y1, r1) { return new Gradient('radial', [...this.point(x0, y0), ...this.point(x1, y1), r1 * Math.hypot(this.transform[0], this.transform[1])]); }
  prepare() { this.native.clip(...this.bounds); this.native.blend(this.globalCompositeOperation === 'lighter'); }
  triangles(points, indices, style) {
    if (!indices.length || this.globalAlpha <= 0) return;
    const vertices = new Float32Array(indices.length * 3), color = new Uint32Array(indices.length);
    indices.forEach((index, i) => {
      const p = points[index]; vertices[i * 3] = p[0]; vertices[i * 3 + 1] = p[1]; vertices[i * 3 + 2] = 0.5;
      color[i] = packed(style instanceof Gradient ? style.color(...p) : rgba(style), this.globalAlpha);
    });
    this.prepare(); this.native.triangles(vertices.buffer, color.buffer);
  }
  fill() {
    for (const path of this.paths) {
      if (path.length < 3) continue;
      // Concentric geometry gives radial gradients interior samples (boundary-only
      // triangulation would make a transparent outer edge erase the entire glow).
      if (this.fillStyle instanceof Gradient && this.fillStyle.kind === 'radial') {
        const center = this.fillStyle.points.slice(2, 4), points = [center], indices = [];
        for (let ring = 1; ring <= 6; ring++) for (const p of path) points.push([center[0] + (p[0] - center[0]) * ring / 6, center[1] + (p[1] - center[1]) * ring / 6]);
        const n = path.length;
        for (let i = 0; i < n; i++) indices.push(0, 1 + i, 1 + (i + 1) % n);
        for (let r = 1; r < 6; r++) for (let i = 0; i < n; i++) {
          const a = 1 + (r - 1) * n + i, b = 1 + (r - 1) * n + (i + 1) % n;
          indices.push(a, a + n, b, b, a + n, b + n);
        }
        this.triangles(points, indices, this.fillStyle);
      } else this.triangles(path, earcut(path.flat()), this.fillStyle);
    }
  }
  stroke() {
    const points = [], indices = [], half = this.lineWidth * Math.hypot(this.transform[0], this.transform[1]) / 2;
    for (const path of this.paths) for (let i = 1; i < path.length + Number(Boolean(path.closed)); i++) {
      const a = path[i - 1], b = path[i % path.length], length = Math.hypot(b[0] - a[0], b[1] - a[1]); if (!length) continue;
      const dx = (b[1] - a[1]) / length * half, dy = (a[0] - b[0]) / length * half, j = points.length;
      points.push([a[0] + dx, a[1] + dy], [a[0] - dx, a[1] - dy], [b[0] + dx, b[1] + dy], [b[0] - dx, b[1] - dy]);
      indices.push(j, j + 1, j + 2, j + 2, j + 1, j + 3);
    }
    this.triangles(points, indices, this.strokeStyle);
  }
  fillRect(x, y, w, h) {
    if (this.globalAlpha <= 0 || w <= 0 || h <= 0) return;
    if (this.fillStyle instanceof Gradient) {
      this.triangles([this.point(x, y), this.point(x + w, y), this.point(x + w, y + h), this.point(x, y + h)], [0, 1, 2, 0, 2, 3], this.fillStyle);
      return;
    }
    const p0 = this.point(x, y), p1 = this.point(x + w, y), p2 = this.point(x + w, y + h), p3 = this.point(x, y + h);
    const v = this.rectVertices;
    // Triangle 1: p0, p1, p2
    v[0] = p0[0]; v[1] = p0[1];
    v[3] = p1[0]; v[4] = p1[1];
    v[6] = p2[0]; v[7] = p2[1];
    // Triangle 2: p0, p2, p3
    v[9] = p0[0]; v[10] = p0[1];
    v[12] = p2[0]; v[13] = p2[1];
    v[15] = p3[0]; v[16] = p3[1];
    const c = packed(rgba(this.fillStyle), this.globalAlpha);
    const col = this.rectColors;
    col[0] = col[1] = col[2] = col[3] = col[4] = col[5] = c;
    this.prepare();
    this.native.triangles(this.rectVerticesBuffer, this.rectColorsBuffer);
  }
  strokeRect(x, y, w, h) { const paths = this.paths, path = this.path; this.beginPath(); this.rect(x, y, w, h); this.stroke(); this.paths = paths; this.path = path; }
  clip() {
    const points = this.paths.flat(); if (!points.length) return;
    const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
    this.bounds = [Math.max(this.bounds[0], Math.min(...xs)), Math.max(this.bounds[1], Math.min(...ys)), Math.min(this.bounds[2], Math.max(...xs)), Math.min(this.bounds[3], Math.max(...ys))];
  }
  setLineDash(values) { this.dash = [...values]; }
  getLineDash() { return [...this.dash]; }
  fontInfo(value = '') {
    const size = Math.max(8, Math.min(48, Math.round(Number(/([\d.]+)px/.exec(this.font)?.[1] || 16))));
    const symbols = [...value].some(c => c.codePointAt(0) > 0x24f);
    return [symbols || this.font.includes('DejaVu') ? 'dejavu-400' : this.font.includes('Cinzel') ? 'cinzel-700' : 'inter-400', size];
  }
  measureText(value) {
    const str = String(value);
    const [font, size] = this.fontInfo(str);
    const key = font + ':' + size + ':' + str;
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
    const [font, size] = this.fontInfo(value);
    let measured = this.measureText(value).width;
    if (maxWidth && measured > maxWidth) {
      while (value.length > 1 && this.measureText(value + '…').width > maxWidth) value = value.slice(0, -1);
      value += '…';
      measured = this.measureText(value).width;
    }
    if (this.textAlign === 'center') x -= measured / 2;
    else if (this.textAlign === 'right' || this.textAlign === 'end') x -= measured;
    if (this.textBaseline === 'top') y += size;
    else if (this.textBaseline === 'middle') y += size * 0.35;
    this.prepare(); this.native.text(font, size, value, ...this.point(x, y), packed(rgba(this.fillStyle), this.globalAlpha));
  }
  strokeText(...args) { this.fillText(...args); }
  drawImage(image, ...args) {
    let sx = 0, sy = 0, sw = image.width, sh = image.height, x, y, w, h;
    if (args.length === 2) { [x, y] = args; w = sw; h = sh; }
    else if (args.length === 4) [x, y, w, h] = args;
    else [sx, sy, sw, sh, x, y, w, h] = args;
    const p0 = this.point(x, y), p1 = this.point(x + w, y), p2 = this.point(x, y + h), p3 = this.point(x + w, y + h);
    const c = this.imageCorners;
    c[0] = p0[0]; c[1] = p0[1];
    c[2] = p1[0]; c[3] = p1[1];
    c[4] = p2[0]; c[5] = p2[1];
    c[6] = p3[0]; c[7] = p3[1];
    this.prepare();
    this.native.image(image.id, this.imageCornersBuffer, sx, sy, sw, sh, packed([255, 255, 255, 1], this.globalAlpha));
  }
}
