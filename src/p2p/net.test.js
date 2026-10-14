import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoomHost } from '../../server/room-host.js';
import { createSession } from '../net.js';
import { attachTransport, loopbackPair } from './transport.js';
import { waitFor } from './test-support.js';

const entry = (action, extra = {}) => ({ action, code: 'ABC234', visibility: 'closed', name: 'Ana', color: 0, meta: {}, campaign: 'quick',
  curses: [], loadout: {}, unlocks: {}, ...extra });

test('createSession entra, inicia a partida e entrega quadros interpolados por loopback', async t => {
  const roomHost = createRoomHost({ code: 'ABC234' });
  t.after(() => roomHost.destroy());
  const events = [];
  const session = createSession(() => {
    const [client, server] = loopbackPair();
    attachTransport(roomHost, server);
    return client;
  }, entry('create'), {
    onJoined: message => events.push(['joined', message.room]),
    onLobby: () => events.push(['lobby']),
    onStart: () => events.push(['start']),
    onClosed: event => events.push(['closed', event.code])
  });
  await waitFor(() => events.some(([name]) => name === 'lobby'));
  assert.deepEqual(events[0], ['joined', 'ABC234']);
  assert.equal(session.frame(performance.now(), 0.016, { x: 0, y: 0 }), null, 'sem snapshot ainda não há quadro');
  session.send({ type: 'start' });
  await waitFor(() => session.inGame && session.hasState);
  const view = session.frame(performance.now(), 0.016, { x: 0, y: 0 });
  assert.ok(view.players[session.playerId]);
  session.close();
  await waitFor(() => roomHost.destroyed);
});

test('createSession avisa transporte inválido sem derrubar quem chamou', () => {
  const errors = [];
  createSession(() => { throw new Error('sem WebRTC'); }, entry('join'), { onError: error => errors.push(error) });
  assert.equal(errors.length, 1);
  assert.equal(errors[0].transport, true);
});
