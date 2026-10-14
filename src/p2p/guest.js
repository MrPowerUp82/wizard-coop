import { channel } from './channel.js';
import { createTransport } from './transport.js';

const HELLO_TIMEOUT_MS = 12_000;
const RESUME_HELLO_TIMEOUT_MS = 5_000;
const LEAVE_DELAY_MS = 300; // lets the last message or farewell leave before the connection is torn down

/**
 * A WebSocket-shaped transport to the host of a P2P room. It opens when the host answers our `hello`.
 * @param {any} room an opened P2P room (see room.js / fake-room.js)
 * @param {{ resume?: boolean, helloTimeoutMs?: number }} [options]
 */
export function guestTransport(room, { resume = false, helloTimeoutMs = resume ? RESUME_HELLO_TIMEOUT_MS : HELLO_TIMEOUT_MS } = {}) {
  const msg = channel(room, 'msg');
  const ctl = channel(room, 'ctl');
  let hostId = null;
  let leaveTimer = null;
  const leaveRoom = () => { leaveTimer ??= setTimeout(() => room.leave(), LEAVE_DELAY_MS); };

  const transport = createTransport({
    onSend: raw => msg.send(raw, hostId),
    onLocalClose: leaveRoom
  });
  const finish = (code, reason) => {
    clearTimeout(helloTimer);
    transport._finish(code, reason);
    leaveRoom();
  };

  const helloTimer = setTimeout(() => {
    if (hostId) return;
    if (resume) return finish(1006, 'O anfitrião saiu.');
    // A first join gets the same error the old server sent, so the lobby shows the usual message.
    transport._receive(JSON.stringify({ type: 'error', message: 'Sala não encontrada.' }));
    finish(4004, 'Sala não encontrada.');
  }, helloTimeoutMs);

  ctl.onMessage((message, peerId) => {
    if (message?.t === 'ack' && !hostId) {
      hostId = peerId;
      clearTimeout(helloTimer);
      transport._open();
    } else if (message?.t === 'close' && peerId === hostId) {
      finish(Number.isInteger(message.code) ? message.code : 1006, String(message.reason || ''));
    }
  });
  msg.onMessage((raw, peerId) => { if (peerId === hostId && typeof raw === 'string') transport._receive(raw); });
  room.onPeerJoin = peerId => { if (!hostId) ctl.send({ t: 'hello' }, peerId); };
  room.onPeerLeave = peerId => { if (peerId === hostId) finish(1006, 'Conexão com o anfitrião perdida.'); };
  return transport;
}
