import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameState, createPlayer, publicState, updateGame } from './game.js';
import { VIEW_RADIUS, decodeState, encodeState } from './protocol.js';
import { startRoom } from './test-support.js';

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
    slowFor: 1, windup: 0, fuse: 0, dashWarn: 0, stage: undefined, dashAngle: undefined, thief: undefined, rootFor: 0, freezeFor: 0, burningFor: 0 });
  assert.equal(decoded.enemies[1].stage, 2);
  assert.equal(decoded.shots[0].special, true);
  assert.equal(decoded.shots[0].hitIds, undefined);
  assert.equal(decoded.gems[0].type, 'chest');
  assert.equal(decoded.hazards[0].radius, 100);
  assert.equal(decoded.phaseStatus, view.phaseStatus);
  assert.ok(JSON.stringify(encodeState(s, 'p')).length < JSON.stringify(view).length / 2);
});

test('conexão caída mantém o personagem e permite voltar com o token; saída voluntária libera na hora', { timeout: 15000 }, async t => {
  const { host: roomHost, connect } = startRoom(t, { reconnectGraceMs: 800 });
  const owner = connect();
  owner.send({ type: 'create', name: 'Anfitrião', color: 0 });
  const created = await owner.receive('joined');
  const guest = connect();
  guest.send({ type: 'join', room: created.room, name: 'Convidado', color: 1 });
  const joined = await guest.receive('joined');
  assert.ok(joined.token);
  owner.send({ type: 'start' });
  await guest.receive('start');

  guest.terminate();
  const waiting = await owner.receive('lobby', m => m.players.some(p => p.id === joined.playerId && !p.connected));
  assert.equal(waiting.count, 2);

  const back = connect();
  back.send({ type: 'resume', room: created.room, token: 'wrong' });
  assert.equal((await back.receive('error')).code, 'RESUME_FAILED');
  back.send({ type: 'resume', room: created.room, token: joined.token });
  const resumed = await back.receive('joined');
  assert.equal(resumed.resumed, true);
  assert.equal(resumed.playerId, joined.playerId);
  assert.equal(decodeState((await back.receive('start')).state).players[joined.playerId].connected, true);

  owner.drain('lobby');
  back.terminate();
  await owner.receive('lobby', m => m.count === 1);
  assert.equal(roomHost.snapshot().count, 1);

  const third = connect();
  third.send({ type: 'join', room: created.room, color: 2 });
  const late = await third.receive('joined');
  owner.drain('lobby');
  third.send({ type: 'leave' });
  await owner.receive('lobby', m => !m.players.some(p => p.id === late.playerId));
});

test('trocar poderes e entrar atrasado funcionam pela sala', { timeout: 15000 }, async t => {
  const { connect } = startRoom(t);
  const host = connect();
  host.send({ type: 'create', color: 0, meta: { reroll: 1, vigor: 99 } });
  const created = await host.receive('joined');
  host.send({ type: 'start' });
  const state = decodeState((await host.receive('start')).state);
  const me = state.players[created.playerId];
  assert.equal(me.rerolls, 2);
  assert.equal(me.maxHp, 130);
  const late = connect();
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

test('sala co-op leva maldições, bloqueia o infinito sem desbloqueio, aplica loadout e repassa sinais', { timeout: 15000 }, async t => {
  const { connect } = startRoom(t);
  const host = connect();
  host.send({ type: 'create', color: 0, campaign: 'endless', curses: ['swarm', 'bogus'], meta: {}, loadout: { weapon: 'aura' } });
  const created = await host.receive('joined');
  const lobby = await host.receive('lobby');
  assert.equal(lobby.campaign, 'quick', 'infinito exige desbloqueio');
  assert.deepEqual(lobby.curses, ['swarm']);
  const guest = connect();
  guest.send({ type: 'join', room: created.room, color: 2, meta: { arsenal: 1, secondSpell: 1 }, loadout: { weapon: 'chain', special: 1 } });
  const joined = await guest.receive('joined');
  host.send({ type: 'start' });
  const state = decodeState((await host.receive('start')).state);
  assert.deepEqual(state.curses, ['swarm']);
  assert.equal(state.players[created.playerId].powers.aura, undefined);
  assert.equal(state.players[joined.playerId].powers.chain, 1);
  assert.equal(state.players[joined.playerId].specialVariant, 1);
  guest.send({ type: 'signal', signal: 'help' });
  const signalled = await host.receive('state', m => decodeState(m.state).events.some(event => event.kind === 'signal'));
  const event = decodeState(signalled.state).events.find(e => e.kind === 'signal');
  assert.equal(event.player, joined.playerId);
  assert.equal(event.signal, 'help');

  const other = startRoom(t);
  const unlocked = other.connect();
  unlocked.send({ type: 'create', color: 1, campaign: 'endless', meta: { endless: 1 } });
  await unlocked.receive('joined');
  assert.equal((await unlocked.receive('lobby')).campaign, 'endless');
});

test('snapshot compacto transmite a posição do familiar', () => {
  const s = createGameState();
  const p = createPlayer('p', 'Mago', 2, { pact: 1 });
  s.players.p = p;
  s.spawn = 999;
  updateGame(s, 0.05, () => 0.9);
  s.enemies.push({ id: 9, type: 'imp', x: 120, y: 0, hp: 26, maxHp: 26, age: 0 });
  updateGame(s, 0.05, () => 0.9);
  const decoded = decodeState(JSON.parse(JSON.stringify(encodeState(s, 'p'))));
  assert.deepEqual(decoded.players.p.familiar, { x: Math.round(p.familiar.x), y: Math.round(p.familiar.y) });
  assert.equal(decodeState(JSON.parse(JSON.stringify(encodeState({ ...s, players: { q: createPlayer('q', 'Sem', 0) } }, 'q')))).players.q.familiar, null);
});
