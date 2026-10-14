import test from 'node:test';
import assert from 'node:assert/strict';
import { PROTOCOL_VERSION, decodeState } from './protocol.js';
import { startRoom } from './test-support.js';

test('sala tolera mensagens inválidas e preserva a sala após entrada duplicada', { timeout: 10000 }, async t => {
  const { connect } = startRoom(t);
  const client = connect();
  client.send('null');
  client.send('{');
  client.send('[]');
  client.send({ type: 'create', name: { unexpected: true } });
  const joined = await client.receive('joined');
  client.send({ type: 'create' });
  assert.match((await client.receive('error')).message, /já está/);
  client.send({ type: 'start' });
  const started = decodeState((await client.receive('start')).state);
  assert.equal(Object.keys(started.players).length, 1);
  assert.equal(started.players[joined.playerId].name, 'Arcanista');
  client.send({ type: 'special', playerId: joined.playerId, specialCharge: 100 });
  const state = decodeState((await client.receive('state')).state);
  assert.equal(state.players[joined.playerId].specialCharge, 0);
  assert.ok(state.shots.every(shot => !shot.special));
});

test('o snapshot da sala só existe depois de criada e reflete visibilidade, ocupação e andamento', { timeout: 10000 }, async t => {
  const closed = startRoom(t);
  assert.equal(closed.host.snapshot(), null);
  const hidden = closed.connect();
  hidden.send({ type: 'create', name: 'Oculto', visibility: 'closed' });
  await hidden.receive('joined');
  assert.equal(closed.host.snapshot().visibility, 'closed');

  const open = startRoom(t);
  const owner = open.connect();
  owner.send({ type: 'create', name: 'Merlin', visibility: 'open' });
  const created = await owner.receive('joined');
  assert.deepEqual(open.host.snapshot(), { code: 'ABC234', count: 1, running: false, over: false, full: false, host: 'Merlin',
    campaign: 'quick', curses: [], visibility: 'open' });
  owner.send({ type: 'start' });
  await owner.receive('start');
  assert.equal(open.host.snapshot().running, true);
  const ally = open.connect();
  ally.send({ type: 'join', room: created.room, name: 'Aliado' });
  await ally.receive('joined');
  ally.send({ type: 'ready' });
  assert.equal(Object.keys(decodeState((await ally.receive('start')).state).players).length, 2);
  assert.equal(open.host.snapshot().count, 2);
});

test('sala lotada recusa o quinto jogador e libera a vaga quando alguém sai', { timeout: 10000 }, async t => {
  const { host, connect } = startRoom(t);
  const owner = connect();
  owner.send({ type: 'create', visibility: 'open' });
  const { room } = await owner.receive('joined');
  const players = [owner];
  for (let n = 0; n < 3; n++) {
    const guest = connect();
    guest.send({ type: 'join', room });
    await guest.receive('joined');
    players.push(guest);
  }
  assert.equal(host.snapshot().full, true);
  const extra = connect();
  extra.send({ type: 'join', room });
  assert.match((await extra.receive('error')).message, /cheia/);
  players[3].terminate();
  assert.equal(host.snapshot().full, false);
  extra.send({ type: 'join', room });
  assert.equal((await extra.receive('joined')).count, 4);
});

test('recusa cliente de outra versão do protocolo', { timeout: 10000 }, async t => {
  const { connect } = startRoom(t);
  const client = connect();
  client.send({ type: 'create', v: PROTOCOL_VERSION + 1 });
  const error = await client.receive('error');
  assert.equal(error.code, 'PROTOCOL_MISMATCH');
  assert.match(error.message, /Atualize/);
  client.send({ type: 'create', v: PROTOCOL_VERSION, name: 'Ana' });
  assert.ok((await client.receive('joined')).playerId);
});

test('entrar antes da criação ou com código errado devolve sala não encontrada; o código ignora maiúsculas', { timeout: 10000 }, async t => {
  const { connect } = startRoom(t);
  const early = connect();
  early.send({ type: 'join', room: 'ABC234' });
  assert.match((await early.receive('error')).message, /não encontrada/);
  const owner = connect();
  owner.send({ type: 'create' });
  await owner.receive('joined');
  early.send({ type: 'join', room: 'ZZZZZZ' });
  assert.match((await early.receive('error')).message, /não encontrada/);
  early.send({ type: 'join', room: 'abc234' });
  assert.ok((await early.receive('joined')).playerId);
});

test('descarta mensagens grandes demais e o excesso de mensagens por segundo', { timeout: 10000 }, async t => {
  const { connect, host } = startRoom(t);
  const client = connect();
  client.send(JSON.stringify({ type: 'create', name: 'x'.repeat(5000) }));
  client.send({ type: 'ping', t: 1 });
  assert.equal((await client.receive('pong')).t, 1);
  assert.equal(host.snapshot(), null, 'a mensagem grande não criou a sala');
  for (let n = 0; n < 60; n++) client.send({ type: 'ping', t: n });
  assert.equal(client.drain('pong').length, 48, 'passam só 50 mensagens por segundo, contando as duas primeiras');
});

test('uma sala que nunca começa expira e avisa os clientes com o código 4001', { timeout: 10000 }, async t => {
  const { host, connect } = startRoom(t, { lobbyIdleMs: 150 });
  const client = connect();
  client.send({ type: 'create' });
  await client.receive('joined');
  assert.deepEqual(await client.closedWith(), { code: 4001, reason: 'Sala expirou antes da batalha' });
  assert.equal(host.destroyed, true);
});
