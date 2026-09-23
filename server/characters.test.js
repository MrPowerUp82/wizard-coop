import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import WebSocket from 'ws';
import { decodeState } from './protocol.js';

test('personagens escolhidos são únicos por sala, trocáveis no lobby e liberados ao sair', { timeout: 10000 }, async t => {
  const child = spawn(process.execPath, ['server/server.js'], {
    env: { ...process.env, PORT: '0', MAX_ROOMS: '3' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true
  });
  t.after(() => child.kill());
  const [output] = await once(child.stdout, 'data');
  const port = String(output).match(/:(\d+)/)?.[1];
  assert.ok(port);
  async function connect() {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    t.after(() => ws.terminate());
    const messages = [];
    ws.on('message', raw => messages.push(JSON.parse(raw)));
    await once(ws, 'open');
    return {
      ws,
      send: message => ws.send(JSON.stringify(message)),
      async receive(type, predicate = () => true) {
        let index;
        while ((index = messages.findIndex(m => m.type === type && predicate(m))) < 0) await once(ws, 'message');
        return messages.splice(index, 1)[0];
      }
    };
  }
  const host = await connect();
  for (const color of [-1, 7, 1.5, '2', null, {}, []]) {
    host.send({ type: 'create', color });
    assert.match((await host.receive('error')).message, /inválido/);
  }
  host.send({ type: 'listRooms' });
  assert.equal((await host.receive('rooms')).capacity.used, 0);
  for (const unlocks of [undefined, { aurora: false }, { aurora: 'true' }]) {
    host.send({ type: 'create', color: 5, unlocks });
    assert.equal((await host.receive('error')).code, 'CHARACTER_LOCKED');
  }
  for (const unlocks of [undefined, { god: false }, { god: 'true' }]) {
    host.send({ type: 'create', color: 6, unlocks });
    assert.equal((await host.receive('error')).code, 'CHARACTER_LOCKED');
  }
  host.send({ type: 'listRooms' });
  assert.equal((await host.receive('rooms')).capacity.used, 0);
  host.send({ type: 'create', color: 2 });
  const created = await host.receive('joined');
  assert.equal(created.color, 2);
  const firstLobby = await host.receive('lobby');
  assert.equal(firstLobby.players[0].color, 2);
  assert.equal(firstLobby.hostId, created.playerId);
  host.send({ type: 'selectCharacter', color: 5, unlocks: { aurora: true } });
  assert.equal((await host.receive('error')).code, 'CHARACTER_LOCKED');
  host.send({ type: 'selectCharacter', color: 6, unlocks: { god: true } });
  assert.equal((await host.receive('error')).code, 'CHARACTER_LOCKED');

  const guest = await connect();
  guest.send({ type: 'join', room: created.room, color: 2 });
  const taken = await guest.receive('error');
  assert.equal(taken.code, 'CHARACTER_TAKEN');
  assert.deepEqual(taken.players.map(p => p.color), [2]);
  // Retry uses the same connection; a rejected entry did not reserve a slot.
  guest.send({ type: 'join', room: created.room, color: 1 });
  const joined = await guest.receive('joined');
  assert.equal(joined.color, 1); assert.equal(joined.count, 2);
  guest.send({ type: 'selectCharacter', color: 2 });
  assert.equal((await guest.receive('error')).code, 'CHARACTER_TAKEN');
  guest.send({ type: 'selectCharacter', color: 3 });
  const changed = await host.receive('lobby', m => m.players.some(p => p.id === joined.playerId && p.color === 3));
  assert.equal(new Set(changed.players.map(p => p.color)).size, 2);

  // Two requests for one free character cannot both succeed.
  const a = await connect(); const b = await connect();
  a.send({ type: 'join', room: created.room, color: 0 });
  const aJoined = await a.receive('joined');
  b.send({ type: 'join', room: created.room, color: 0 });
  assert.equal((await b.receive('error')).code, 'CHARACTER_TAKEN');
  a.ws.close(); await once(a.ws, 'close');
  await host.receive('lobby', m => m.count === 2 && !m.players.some(p => p.id === aJoined.playerId));
  b.send({ type: 'join', room: created.room, color: 0 });
  assert.equal((await b.receive('joined')).color, 0);

  // Uniqueness is scoped to the room, not the whole server.
  const otherHost = await connect();
  otherHost.send({ type: 'create', color: 5, unlocks: { aurora: true } });
  const secretHost = await otherHost.receive('joined');
  assert.equal(secretHost.color, 5);
  otherHost.send({ type: 'selectCharacter', color: 2 });
  await otherHost.receive('lobby', m => m.players[0].color === 2);
  otherHost.send({ type: 'selectCharacter', color: 4 });
  await otherHost.receive('lobby', m => m.players[0].color === 4);
  otherHost.send({ type: 'start' });
  const secretState = decodeState((await otherHost.receive('start')).state);
  assert.equal(secretState.players[secretHost.playerId].maxHp, 500);
  host.send({ type: 'start' });
  const started = decodeState((await host.receive('start')).state);
  assert.equal(started.players[created.playerId].color, 2);
  assert.equal(started.players[joined.playerId].color, 3);
  guest.send({ type: 'selectCharacter', color: 1 });
  assert.match((await guest.receive('error')).message, /antes da batalha/);
  const state = decodeState((await guest.receive('state')).state);
  assert.equal(state.players[joined.playerId].color, 3);
  const late = await connect();
  late.send({ type: 'join', room: created.room, color: 3 });
  assert.equal((await late.receive('error')).code, 'CHARACTER_TAKEN');
  late.send({ type: 'join', room: created.room, color: 1 });
  const lateJoined = await late.receive('joined');
  late.send({ type: 'ready' });
  assert.equal(decodeState((await late.receive('start')).state).players[lateJoined.playerId].color, 1);
});
