import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFixtures } from '../scripts/export-protocol-fixtures.mjs';
import { PROTOCOL_VERSION, decodeState } from './protocol.js';

test('fixtures do cliente C++ cobrem chefe, co-op de 4, sinais e fim de partida', { timeout: 120000 }, () => {
  const { version, tables, cases } = buildFixtures();
  assert.equal(version, PROTOCOL_VERSION);
  assert.equal(tables.enemyTypes.length, 23);
  for (const c of cases) assert.deepEqual(JSON.parse(JSON.stringify(decodeState(c.encoded))), c.decoded, c.name);
  assert.ok(cases.some(c => c.encoded.e.some(row => row[6] & 1)), 'algum caso com chefe');
  assert.ok(cases.some(c => c.encoded.p.length === 4), 'co-op de 4');
  assert.ok(cases.some(c => c.encoded.o === 1), 'fim de partida');
  assert.ok(cases.some(c => c.encoded.ev.some(e => e.kind === 'signal')), 'sinal');
  assert.ok(cases.some(c => c.encoded.a || c.encoded.en), 'altar ou encontro');
});
