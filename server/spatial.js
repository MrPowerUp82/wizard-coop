// Uniform hash grid rebuilt every tick. Queries only visit nearby cells instead of every entity.
const OFFSET = 32768;
const keyOf = (cx, cy) => (cx + OFFSET) * 65536 + (cy + OFFSET);

export function createGrid(cellSize = 96) {
  const buckets = new Map();
  // Recycle the small bucket arrays instead of creating hundreds of short-lived arrays every tick.
  // This matters on QuickJS/V8 console runtimes where GC pauses become visible late in a run.
  const pool = [];
  return {
    clear() {
      for (const bucket of buckets.values()) { bucket.length = 0; pool.push(bucket); }
      buckets.clear();
    },
    insert(entity) {
      const key = keyOf(Math.floor(entity.x / cellSize), Math.floor(entity.y / cellSize));
      const bucket = buckets.get(key);
      if (bucket) bucket.push(entity);
      else {
        const next = pool.pop() || [];
        next.push(entity);
        buckets.set(key, next);
      }
    },
    /** Calls visit(entity, distanceSq) for entities within radius; stop early by returning true. */
    query(x, y, radius, visit) {
      const r2 = radius * radius;
      const x0 = Math.floor((x - radius) / cellSize), x1 = Math.floor((x + radius) / cellSize);
      const y0 = Math.floor((y - radius) / cellSize), y1 = Math.floor((y + radius) / cellSize);
      for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) {
        const bucket = buckets.get(keyOf(cx, cy));
        if (!bucket) continue;
        for (const entity of bucket) {
          const dx = entity.x - x, dy = entity.y - y;
          const d2 = dx * dx + dy * dy;
          if (d2 <= r2 && visit(entity, d2)) return;
        }
      }
    }
  };
}
