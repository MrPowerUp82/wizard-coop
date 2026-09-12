import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import WebSocket from 'ws';

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
  const started = await receive('start');
  assert.equal(Object.keys(started.state.players).length, 1);
  assert.equal(started.state.players[joined.playerId].name, 'Arcanista');
  assert.equal(child.exitCode, null);
});
