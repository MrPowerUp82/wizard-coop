import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import WebSocket from 'ws';
import { decodeState } from './protocol.js';

test('servidor tolera mensagens inválidas e preserva a sala após entrada duplicada', { timeout: 10000 }, async t => {
  const child = spawn(process.execPath, ['server/server.js'], {
    env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true
  });
  t.after(() => child.kill());
  const [output] = await once(child.stdout, 'data');
  const port = String(output).match(/:(\d+)/)?.[1];
  assert.ok(port);
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  t.after(() => ws.terminate());
  await once(ws, 'open');
  const messages = [];
  ws.on('message', raw => messages.push(JSON.parse(raw)));
  async function receive(type) {
    while (!messages.some(message => message.type === type)) await once(ws, 'message');
    return messages.splice(messages.findIndex(message => message.type === type), 1)[0];
  }
  ws.send('null');
  ws.send('{');
  ws.send('[]');
  ws.send(JSON.stringify({ type: 'create', name: { unexpected: true } }));
  const joined = await receive('joined');
  ws.send(JSON.stringify({ type: 'create' }));
  assert.match((await receive('error')).message, /já está/);
  ws.send(JSON.stringify({ type: 'start' }));
  const started = decodeState((await receive('start')).state);
  assert.equal(Object.keys(started.players).length, 1);
  assert.equal(started.players[joined.playerId].name, 'Arcanista');
  ws.send(JSON.stringify({ type: 'special', playerId: joined.playerId, specialCharge: 100 }));
  const state = decodeState((await receive('state')).state);
  assert.equal(state.players[joined.playerId].specialCharge, 0);
  assert.ok(state.shots.every(shot => !shot.special));
  assert.equal(child.exitCode, null);
});

test('lista apenas salas abertas e disponíveis', { timeout: 10000 }, async t => {
  const child = spawn(process.execPath, ['server/server.js'], {
    env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true
  });
  t.after(() => child.kill());
  const [output] = await once(child.stdout, 'data');
  const port = String(output).match(/:(\d+)/)?.[1];
  assert.ok(port);

  async function connect() {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    t.after(() => ws.terminate());
    await once(ws, 'open');
    return ws;
  }

  async function next(ws, type) {
    while (true) {
      const [raw] = await once(ws, 'message');
      const message = JSON.parse(raw);
      if (message.type === type) return message;
    }
  }

  const closedHost = await connect();
  closedHost.send(JSON.stringify({ type: 'create', name: 'Oculto', visibility: 'closed' }));
  await next(closedHost, 'joined');

  const openHost = await connect();
  openHost.send(JSON.stringify({ type: 'create', name: 'Merlin', visibility: 'open' }));
  const openRoom = await next(openHost, 'joined');

  const browser = await connect();
  browser.send(JSON.stringify({ type: 'listRooms' }));
  const listing = await next(browser, 'rooms');
  assert.deepEqual(listing.rooms, [{ code: openRoom.room, count: 1, running: false, host: 'Merlin', campaign: 'quick', curses: [] }]);

  openHost.send(JSON.stringify({ type: 'start' }));
  await next(openHost, 'start');
  browser.send(JSON.stringify({ type: 'listRooms' }));
  assert.deepEqual((await next(browser, 'rooms')).rooms, [{ code: openRoom.room, count: 1, running: true, host: 'Merlin', campaign: 'quick', curses: [] }]);
  browser.send(JSON.stringify({ type: 'join', room: openRoom.room, name: 'Aliado' }));
  await next(browser, 'joined');
  browser.send(JSON.stringify({ type: 'ready' }));
  assert.equal(Object.keys(decodeState((await next(browser, 'start')).state).players).length, 2);
});

test('limita salas abertas e fechadas, permite entrar no limite e libera vagas ao sair', { timeout: 10000 }, async t => {
  const child = spawn(process.execPath, ['server/server.js'], {
    env: { ...process.env, PORT: '0', MAX_ROOMS: '2' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true
  });
  t.after(() => child.kill());
  const [output] = await once(child.stdout, 'data');
  const port = String(output).match(/:(\d+)/)?.[1];
  assert.ok(port);
  async function connect() {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    t.after(() => ws.terminate());
    const queue = [];
    ws.on('message', raw => queue.push(JSON.parse(raw)));
    await once(ws, 'open');
    return {
      ws,
      send: message => ws.send(JSON.stringify(message)),
      async receive(type) {
        while (!queue.some(message => message.type === type)) await once(ws, 'message');
        return queue.splice(queue.findIndex(message => message.type === type), 1)[0];
      }
    };
  }
  const host = await connect();
  host.send({ type: 'create', visibility: 'open' });
  const room = (await host.receive('joined')).room;
  const privateHost = await connect();
  privateHost.send({ type: 'create', visibility: 'closed' });
  await privateHost.receive('joined');
  const guest = await connect();
  guest.send({ type: 'create', visibility: 'open' });
  assert.match((await guest.receive('error')).message, /limite de 2 salas/);
  guest.send({ type: 'listRooms' });
  const listing = await guest.receive('rooms');
  assert.deepEqual(listing.capacity, { used: 2, max: 2 });
  assert.equal(listing.rooms.length, 1);
  guest.send({ type: 'join', room });
  assert.equal((await guest.receive('joined')).count, 2);
  const third = await connect();
  third.send({ type: 'join', room });
  await third.receive('joined');
  const fourth = await connect();
  fourth.send({ type: 'join', room });
  await fourth.receive('joined');
  const observer = await connect();
  observer.send({ type: 'listRooms' });
  assert.deepEqual((await observer.receive('rooms')).rooms, []);
  observer.send({ type: 'join', room });
  assert.match((await observer.receive('error')).message, /cheia/);
  fourth.ws.close();
  await once(fourth.ws, 'close');
  privateHost.ws.close();
  await once(privateHost.ws, 'close');
  observer.send({ type: 'listRooms' });
  const available = await observer.receive('rooms');
  assert.deepEqual(available.capacity, { used: 1, max: 2 });
  assert.equal(available.rooms[0].count, 3);
  observer.send({ type: 'create', visibility: 'closed' });
  await observer.receive('joined');
  observer.send({ type: 'listRooms' });
  assert.deepEqual((await observer.receive('rooms')).capacity, { used: 2, max: 2 });
});
