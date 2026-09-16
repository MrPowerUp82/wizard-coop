import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import WebSocket from 'ws';
import { createGameState, createPlayer, publicState, updateGame } from './game.js';
import { VIEW_RADIUS, decodeState, encodeState } from './protocol.js';

async function startServer(t, env = {}) {
  const child = spawn(process.execPath, ['server/server.js'], {
    env: { ...process.env, PORT: '0', ...env }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true
  });
  t.after(() => child.kill());
  const [output] = await once(child.stdout, 'data');
  const port = String(output).match(/:(\d+)/)?.[1];
  assert.ok(port);
  return async function connect(options) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, options);
    t.after(() => ws.terminate());
    const queue = [];
    ws.on('message', raw => queue.push(JSON.parse(raw)));
    await once(ws, 'open');
    return {
      ws,
      send: message => ws.send(JSON.stringify(message)),
      async receive(type, predicate = () => true) {
        let index;
        while ((index = queue.findIndex(m => m.type === type && predicate(m))) < 0) await once(ws, 'message');
        return queue.splice(index, 1)[0];
      }
    };
  };
}

test('snapshot compacto preserva o que o cliente desenha e omite o que está longe', () => {
  const s = createGameState();
  const p = createPlayer('p', 'Mago', 1);
  s.players.p = p;
  s.spawn = 999; s.nextId = 100;
  s.enemies.push({ id: 1, type: 'scorpion', x: 100.4, y: -50.6, hp: 10.2, maxHp: 55, age: 0, elite: true, slowFor: 1 });
  s.enemies.push({ id: 2, type: 'imp', x: VIEW_RADIUS + 100, y: 0, hp: 26, maxHp: 26, age: 0 });
  s.enemies.push({ id: 3, type: 'demon', boss: true, x: 5000, y: 0, hp: 900, maxHp: 1000, age: 0, stage: 2 });
  s.shots.push({ x: 10, y: 0, vx: 400.2, vy: 0, ttl: 1, color: 1, special: true, hitIds: [1] });
  s.gems.push({ id: 7, x: 30, y: 30, type: 'chest', value: 1, ttl: 20 });
  s.hazards.push({ x: 1, y: 2, radius: 100, warning: 0.5, warn0: 1.3, ttl: 1, fired: false, damage: 30 });
  updateGame(s, 0.001, () => 0.9);
  const decoded = decodeState(JSON.parse(JSON.stringify(encodeState(s, 'p'))));
  const view = publicState(s);
  assert.equal(decoded.players.p.name, 'Mago');
  assert.equal(decoded.players.p.color, 1);
  assert.deepEqual(decoded.enemies.map(e => e.id), [1, 3], 'inimigo distante some, chefe permanece');
  assert.deepEqual({ ...decoded.enemies[0], x: 0, y: 0, hp: 0 }, { id: 1, type: 'scorpion', x: 0, y: 0, hp: 0, maxHp: 55, boss: undefined, elite: true,
    slowFor: 1, windup: 0, fuse: 0, dashWarn: 0, stage: undefined, dashAngle: undefined, rootFor: 0, freezeFor: 0, burningFor: 0 });
  assert.equal(decoded.enemies[1].stage, 2);
  assert.equal(decoded.shots[0].special, true);
  assert.equal(decoded.shots[0].hitIds, undefined);
  assert.equal(decoded.gems[0].type, 'chest');
  assert.equal(decoded.hazards[0].radius, 100);
  assert.equal(decoded.phaseStatus, view.phaseStatus);
  assert.ok(JSON.stringify(encodeState(s, 'p')).length < JSON.stringify(view).length / 2);
});

test('conexão caída mantém o personagem e permite voltar com o token; saída voluntária libera na hora', { timeout: 15000 }, async t => {
  const connect = await startServer(t, { RECONNECT_GRACE_MS: '800' });
  const host = await connect();
  host.send({ type: 'create', name: 'Anfitrião', color: 0 });
  const created = await host.receive('joined');
  const guest = await connect();
  guest.send({ type: 'join', room: created.room, name: 'Convidado', color: 1 });
  const joined = await guest.receive('joined');
  assert.ok(joined.token);
  host.send({ type: 'start' });
  await guest.receive('start');

  guest.ws.terminate();
  const waiting = await host.receive('lobby', m => m.players.some(p => p.id === joined.playerId && !p.connected));
  assert.equal(waiting.count, 2);

  const back = await connect();
  back.send({ type: 'resume', room: created.room, token: 'wrong' });
  assert.equal((await back.receive('error')).code, 'RESUME_FAILED');
  back.send({ type: 'resume', room: created.room, token: joined.token });
  const resumed = await back.receive('joined');
  assert.equal(resumed.resumed, true);
  assert.equal(resumed.playerId, joined.playerId);
  assert.equal(decodeState((await back.receive('start')).state).players[joined.playerId].connected, true);

  back.ws.terminate();
  await host.receive('lobby', m => m.count === 1);
  host.send({ type: 'listRooms' });
  assert.equal((await host.receive('rooms')).capacity.used, 1);

  const third = await connect();
  third.send({ type: 'join', room: created.room, color: 2 });
  const late = await third.receive('joined');
  third.send({ type: 'leave' });
  await host.receive('lobby', m => !m.players.some(p => p.id === late.playerId));
});

test('heartbeat derruba conexões mudas e salas ociosas no lobby expiram', { timeout: 15000 }, async t => {
  const connect = await startServer(t, { HEARTBEAT_MS: '150', LOBBY_IDLE_MS: '400' });
  const silent = await connect({ autoPong: false });
  silent.send({ type: 'create' });
  await silent.receive('joined');
  await once(silent.ws, 'close');

  const idle = await connect();
  idle.send({ type: 'create' });
  await idle.receive('joined');
  const [code] = await once(idle.ws, 'close');
  assert.equal(code, 4001);
  const observer = await connect();
  observer.send({ type: 'listRooms' });
  assert.equal((await observer.receive('rooms')).capacity.used, 0);
});

test('trocar poderes e entrar atrasado funcionam pelo servidor', { timeout: 15000 }, async t => {
  const connect = await startServer(t);
  const host = await connect();
  host.send({ type: 'create', color: 0, meta: { reroll: 1, vigor: 99 } });
  const created = await host.receive('joined');
  host.send({ type: 'start' });
  const state = decodeState((await host.receive('start')).state);
  const me = state.players[created.playerId];
  assert.equal(me.rerolls, 2);
  assert.equal(me.maxHp, 130);
  const late = await connect();
  late.send({ type: 'join', room: created.room, color: 3 });
  const joined = await late.receive('joined');
  late.send({ type: 'ready' });
  const lateState = decodeState((await late.receive('start')).state);
  const newcomer = lateState.players[joined.playerId];
  const anchor = lateState.players[created.playerId];
  assert.ok(Math.hypot(newcomer.x - anchor.x, newcomer.y - anchor.y) < 120);
  host.send({ type: 'reroll' });
  const after = decodeState((await host.receive('state')).state);
  assert.equal(after.players[created.playerId].rerolls, 2, 'sem escolha pendente a troca não é gasta');
});
