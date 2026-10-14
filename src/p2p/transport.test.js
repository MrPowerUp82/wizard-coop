import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoomHost } from '../../server/room-host.js';
import { attachTransport, createTransport, loopbackPair } from './transport.js';
import { openInbox, waitFor } from './test-support.js';

test('loopback entrega as mensagens em ordem e só depois de abrir', async () => {
  const [client, server] = loopbackPair();
  client.send('perdida');
  assert.equal(client.readyState, 0);
  const received = [];
  server.onmessage = ({ data }) => received.push(data);
  await waitFor(() => client.readyState === 1 && server.readyState === 1);
  client.send('a'); client.send('b'); server.send('c');
  const echoed = [];
  client.onmessage = ({ data }) => echoed.push(data);
  await waitFor(() => received.length === 2 && echoed.length === 1);
  assert.deepEqual(received, ['a', 'b']);
  assert.deepEqual(echoed, ['c']);
});

test('fechar um lado fecha o outro com o mesmo código e motivo, e depois disso nada é entregue', async () => {
  const [client, server] = loopbackPair();
  await waitFor(() => client.readyState === 1);
  const closes = [];
  client.onclose = event => closes.push(['client', event.code, event.reason]);
  server.onclose = event => closes.push(['server', event.code, event.reason]);
  server.close(4003, 'O anfitrião saiu.');
  await waitFor(() => closes.length === 2);
  assert.deepEqual(closes.sort(), [['client', 4003, 'O anfitrião saiu.'], ['server', 4003, 'O anfitrião saiu.']]);
  assert.equal(client.readyState, 3);
  const after = [];
  client.onmessage = ({ data }) => after.push(data);
  server.send('tarde');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(after, []);
});

test('createTransport entrega mensagens enquanto conecta e nunca depois de fechar', () => {
  const transport = createTransport();
  const got = [];
  transport.onmessage = ({ data }) => got.push(data);
  transport._receive('antes de abrir');
  transport._open();
  transport._receive('aberto');
  transport._finish(1006, 'x');
  transport._receive('depois de fechar');
  assert.deepEqual(got, ['antes de abrir', 'aberto']);
  assert.equal(transport.readyState, 3);
});

test('attachTransport liga o transporte a uma sala: criar, jogar e sair do lado do cliente remove o jogador', async t => {
  const roomHost = createRoomHost({ code: 'ABC234' });
  t.after(() => roomHost.destroy());
  const [clientEnd, serverEnd] = loopbackPair();
  assert.ok(attachTransport(roomHost, serverEnd));
  const client = await openInbox(clientEnd);
  client.send({ type: 'create', name: 'Ana' });
  const joined = await client.receive('joined');
  assert.equal(joined.room, 'ABC234');
  assert.equal(roomHost.snapshot().count, 1);
  clientEnd.close(1000, 'bye');
  await waitFor(() => roomHost.destroyed);
});

test('attachTransport em uma sala já destruída fecha o transporte com 4002', async () => {
  const roomHost = createRoomHost({ code: 'ABC234' });
  roomHost.destroy();
  const [clientEnd, serverEnd] = loopbackPair();
  assert.equal(attachTransport(roomHost, serverEnd), null);
  const client = await openInbox(clientEnd);
  await waitFor(() => client.closed);
  assert.equal(client.closed.code, 4002);
});
