import assert from 'node:assert/strict';
import { createPerf } from '../src/debug/perf.js';

const perf = createPerf();
for (let n = 0; n < 4; n++) perf.frame(0.25);
assert.equal(perf.stats.fps, 4, 'slow frames must not be reported as 20 FPS');
assert.equal(perf.stats.frame, 250);
for (let n = 0; n < 20; n++) perf.frame(0.05);
assert.ok(Math.abs(perf.stats.fps - 20) < 1e-9);
perf.frame(0);
assert.ok(Number.isFinite(perf.stats.fps));
console.log('perf ok');
