import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeSwarm } from './fake-room.js';
import { LOBBY_ROOM, announceRooms, sanitizeAnnouncement, watchRooms } from './lobby.js';
import { waitFor } from './test-support.js';

const open = { code: 'ABC234', count: 1, running: false, over: false, full: false, host: 'Merlin', campaign: 'quick', curses: [], visibility: 'open' };

test('sanitizeAnnouncement aceita um anúncio válido e normaliza os campos', () => {
  assert.deepEqual(sanitizeAnnouncement({ code: 'abc234', count: 2, running: true, host: 'Merlin', campaign: 'quick', curses: ['swarm'] }),
    { code: 'ABC234', count: 2, running: true, host: 'Merlin', campaign: 'quick', curses: ['swarm'] });
});

test('sanitizeAnnouncement rejeita lixo vindo da rede e limita o que a interface vai desenhar', () => {
  for (const bad of [null, 'x', 42, [], {}, { code: '<img src=x>' }, { code: 'AB' }, { code: 'ABCDEFGHIJ' }, { code: { toString: () => 'ABC234' } }]) {
    assert.equal(sanitizeAnnouncement(bad), null, JSON.stringify(bad));
  }
  const clean = sanitizeAnnouncement({ code: 'ABC234', count: 99, running: 'yes', host: '<b>'.repeat(40), campaign: 'nope', curses: ['bogus', 'swarm'] });
  assert.equal(clean.count, 4);
  assert.equal(clean.running, false);
  assert.ok(clean.host.length <= 16);
  assert.equal(clean.campaign, 'quick');
  assert.deepEqual(clean.curses, ['swarm']);
  assert.equal(sanitizeAnnouncement({ code: 'ABC234', count: -3, host: 7 }).count, 0);
});

test('o menu vê a sala aberta anunciada pelo anfitrião e deixa de vê-la quando ela expira', { timeout: 10000 }, async t => {
  const swarm = createFakeSwarm();
  let snapshot = open;
  const announcer = announceRooms({ openRoom: swarm.openRoom, snapshot: () => snapshot, intervalMs: 40 });
  const lists = [];
  const watcher = watchRooms({ openRoom: swarm.openRoom, onUpdate: list => lists.push(list), ttlMs: 250 });
  t.after(() => { announcer.stop(); watcher.stop(); });
  await waitFor(() => lists.some(list => list.length === 1));
  assert.deepEqual(lists.find(list => list.length === 1), [{ code: 'ABC234', count: 1, running: false, host: 'Merlin', campaign: 'quick', curses: [] }]);
  snapshot = { ...open, full: true };
  await waitFor(() => lists.at(-1).length === 0, 3000);
});

test('salas fechadas, em andamento encerrado ou sem snapshot nunca são anunciadas', { timeout: 10000 }, async t => {
  const swarm = createFakeSwarm();
  const seen = [];
  const watcher = watchRooms({ openRoom: swarm.openRoom, onUpdate: list => seen.push(list) });
  const announcers = [null, { ...open, visibility: 'closed' }, { ...open, over: true }].map(snapshot =>
    announceRooms({ openRoom: swarm.openRoom, snapshot: () => snapshot, intervalMs: 30 }));
  t.after(() => { watcher.stop(); for (const announcer of announcers) announcer.stop(); });
  await new Promise(resolve => setTimeout(resolve, 250));
  assert.deepEqual(seen, []);
});

test('o observador entra no lobby como passivo e anúncios malformados são ignorados', { timeout: 10000 }, async t => {
  const swarm = createFakeSwarm();
  const joined = [];
  const spy = (roomId, options) => { joined.push([roomId, options]); return swarm.openRoom(roomId, options); };
  const lists = [];
  const watcher = watchRooms({ openRoom: spy, onUpdate: list => lists.push(list) });
  t.after(() => watcher.stop());
  assert.deepEqual(joined, [[LOBBY_ROOM, { passive: true }]]);
  const rogue = swarm.openRoom(LOBBY_ROOM);
  const rooms = rogue.makeAction('rooms');
  await new Promise(resolve => setTimeout(resolve, 20));
  await rooms.send({ code: '<script>', count: 1 });
  await rooms.send('texto solto');
  await rooms.send({ code: 'ZZZ999', count: 2, host: 'Real' });
  await waitFor(() => lists.length > 0);
  assert.deepEqual(lists.at(-1).map(room => room.code), ['ZZZ999']);
  rogue.leave();
});
