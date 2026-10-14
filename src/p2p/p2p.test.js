import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeState } from '../../server/protocol.js';
import { createSession } from '../net.js';
import { channel } from './channel.js';
import { createFakeSwarm } from './fake-room.js';
import { guestTransport } from './guest.js';
import { createCode, hostRoom, roomId } from './host.js';
import { openInbox, waitFor } from './test-support.js';

const CODE = 'ABC234';

function setup(t, hostOptions = {}) {
  const swarm = createFakeSwarm();
  const hosting = hostRoom({ openRoom: swarm.openRoom, code: CODE, ...hostOptions });
  t.after(() => hosting.stop());
  const guestRoom = () => swarm.openRoom(roomId(CODE));
  const guest = (options = {}) => guestTransport(guestRoom(), { helloTimeoutMs: 1000, ...options });
  return { swarm, hosting, guest, guestRoom };
}

test('createCode usa só o alfabeto sem caracteres ambíguos e tem 6 letras', () => {
  for (let n = 0; n < 200; n++) assert.match(createCode(), /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
  assert.equal(createCode(() => 0), 'AAAAAA');
});

test('convidado entra pelo código, aparece no lobby e recebe a partida do anfitrião', { timeout: 10000 }, async t => {
  const { hosting, guest } = setup(t);
  const owner = await openInbox(hosting.connect());
  owner.send({ type: 'create', name: 'Ana', visibility: 'open', color: 0 });
  assert.equal((await owner.receive('joined')).room, CODE);
  const friend = await openInbox(guest());
  friend.send({ type: 'join', room: CODE, name: 'Beto', color: 1 });
  const joined = await friend.receive('joined');
  assert.equal(joined.count, 2);
  await owner.receive('lobby', m => m.count === 2);
  owner.send({ type: 'start' });
  assert.equal(Object.keys(decodeState((await friend.receive('start')).state).players).length, 2);
  friend.send({ type: 'input', x: 1, y: 0, seq: 1 });
  await friend.receive('state', m => decodeState(m.state).players[joined.playerId].inputSeq === 1);
});

test('código inexistente: o convidado recebe "Sala não encontrada." e o transporte fecha com 4004', { timeout: 10000 }, async t => {
  const swarm = createFakeSwarm();
  const ghost = await openInbox(guestTransport(swarm.openRoom(roomId('ZZZZZZ')), { helloTimeoutMs: 150 }));
  t.after(() => ghost.transport.close());
  assert.match((await ghost.receive('error')).message, /não encontrada/);
  await waitFor(() => ghost.closed);
  assert.equal(ghost.closed.code, 4004);
});

test('retomada sem anfitrião fecha com 1006 para o net.js continuar tentando e depois desistir', { timeout: 10000 }, async () => {
  const swarm = createFakeSwarm();
  const ghost = await openInbox(guestTransport(swarm.openRoom(roomId('ZZZZZZ')), { resume: true, helloTimeoutMs: 150 }));
  await waitFor(() => ghost.closed);
  assert.deepEqual(ghost.closed, { code: 1006, reason: 'O anfitrião saiu.' });
  assert.equal(ghost.has('error'), false);
});

test('o anfitrião que sai encerra a sala para todos com 4003, sem retentativa', { timeout: 10000 }, async t => {
  const { hosting, guest } = setup(t);
  const owner = await openInbox(hosting.connect());
  owner.send({ type: 'create', name: 'Ana', visibility: 'closed' });
  await owner.receive('joined');
  const friend = await openInbox(guest());
  friend.send({ type: 'join', room: CODE });
  await friend.receive('joined');
  hosting.stop();
  await waitFor(() => friend.closed && owner.closed);
  assert.deepEqual(friend.closed, { code: 4003, reason: 'O anfitrião saiu.' });
  assert.equal(owner.closed.code, 4003);
  assert.equal(hosting.roomHost.destroyed, true);
});

test('fechar a sessão local do anfitrião derruba a sala e os convidados', { timeout: 10000 }, async t => {
  const { hosting, guest } = setup(t);
  const owner = await openInbox(hosting.connect());
  owner.send({ type: 'create' });
  await owner.receive('joined');
  const friend = await openInbox(guest());
  friend.send({ type: 'join', room: CODE });
  await friend.receive('joined');
  owner.transport.close(1000, 'sair');
  await waitFor(() => friend.closed);
  assert.equal(friend.closed.code, 4003);
});

test('convidado que cai volta com um peer novo, pelo token, e recupera o mesmo personagem', { timeout: 10000 }, async t => {
  const { swarm, hosting, guest, guestRoom } = setup(t, { reconnectGraceMs: 5000 });
  const owner = await openInbox(hosting.connect());
  owner.send({ type: 'create', name: 'Ana' });
  await owner.receive('joined');
  const firstRoom = guestRoom();
  const friend = await openInbox(guestTransport(firstRoom, { helloTimeoutMs: 1000 }));
  friend.send({ type: 'join', room: CODE, name: 'Beto', color: 1 });
  const joined = await friend.receive('joined');
  owner.send({ type: 'start' });
  await friend.receive('start');

  swarm.sever(firstRoom);
  await waitFor(() => friend.closed);
  assert.equal(friend.closed.code, 1006);
  await owner.receive('lobby', m => m.players.some(p => p.id === joined.playerId && !p.connected));

  const back = await openInbox(guest({ resume: true }));
  back.send({ type: 'resume', room: CODE, token: joined.token });
  const resumed = await back.receive('joined');
  assert.equal(resumed.resumed, true);
  assert.equal(resumed.playerId, joined.playerId);
  assert.equal(decodeState((await back.receive('start')).state).players[joined.playerId].connected, true);
});

test('createSession do convidado retoma sozinho depois de uma queda', { timeout: 15000 }, async t => {
  const { swarm, hosting, guestRoom } = setup(t, { reconnectGraceMs: 8000 });
  const owner = await openInbox(hosting.connect());
  owner.send({ type: 'create', name: 'Ana' });
  await owner.receive('joined');
  const rooms = [];
  const events = [];
  const session = createSession(resume => {
    const room = guestRoom();
    rooms.push(room);
    return guestTransport(room, { resume, helloTimeoutMs: 1000 });
  }, { action: 'join', code: CODE, visibility: 'closed', name: 'Beto', color: 1, meta: {}, campaign: 'quick', curses: [], loadout: {}, unlocks: {} }, {
    onJoined: message => events.push(message.resumed ? 'resumed' : 'joined'),
    onReconnecting: active => events.push(active ? 'reconnecting' : 'stable'),
    onStart: () => events.push('start'),
    onClosed: event => events.push(`closed:${event.code}`)
  });
  t.after(() => session.close());
  await waitFor(() => events.includes('joined'));
  owner.send({ type: 'start' });
  await waitFor(() => session.inGame);

  swarm.sever(rooms[0]);
  await waitFor(() => events.includes('resumed'), 6000);
  assert.ok(events.indexOf('reconnecting') > events.indexOf('start'));
  assert.equal(events.some(event => event.startsWith('closed')), false);
  assert.ok(session.frame(performance.now(), 0.016, { x: 0, y: 0 }));
});

test('quadros de quem não fez hello, não-string ou grandes demais são ignorados', { timeout: 10000 }, async t => {
  const { swarm, hosting } = setup(t);
  const owner = await openInbox(hosting.connect());
  owner.send({ type: 'create' });
  await owner.receive('joined');
  const rogue = swarm.openRoom(roomId(CODE));
  const msg = channel(rogue, 'msg');
  const ctl = channel(rogue, 'ctl');
  await new Promise(resolve => setTimeout(resolve, 20));
  await msg.send(JSON.stringify({ type: 'join', name: 'Intruso' }));
  await ctl.send({ t: 'close', code: 4003, reason: 'forjado' });
  await ctl.send('texto solto');
  await ctl.send({ t: 'hello' });
  await msg.send({ type: 'join', name: 'Objeto' });
  await msg.send('x'.repeat(5000));
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(hosting.roomHost.snapshot().count, 1, 'nenhum dos quadros inválidos entrou na sala');
  await msg.send(JSON.stringify({ type: 'join', room: CODE, name: 'Depois do hello' }));
  await waitFor(() => hosting.roomHost.snapshot().count === 2);
  rogue.leave();
});
