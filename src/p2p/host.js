import { createRoomHost } from '../../server/room-host.js';
import { channel } from './channel.js';
import { announceRooms } from './lobby.js';
import { attachTransport, loopbackPair } from './transport.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_PENDING_SENDS = 8; // a peer this far behind stops receiving snapshots until it catches up
const LEAVE_DELAY_MS = 300;

export const roomId = code => `arcana:${code}`;

export function createCode(random = Math.random) {
  return Array.from({ length: 6 }, () => CODE_CHARS[Math.floor(random() * CODE_CHARS.length)]).join('');
}

/**
 * Lets guests that enter the P2P room talk to the room host. A guest becomes a connection only after it says
 * `hello` on the control channel; game frames from anyone else, or that are not strings, are dropped.
 */
export function serveRoom(room, roomHost) {
  const msg = channel(room, 'msg');
  const ctl = channel(room, 'ctl');
  const links = new Map();
  const pending = new Map();

  const forget = peerId => {
    links.get(peerId)?.disconnect();
    links.delete(peerId);
    pending.delete(peerId);
  };

  ctl.onMessage((message, peerId) => {
    if (message?.t !== 'hello') return;
    forget(peerId);
    const link = roomHost.connect({
      send: raw => {
        pending.set(peerId, (pending.get(peerId) || 0) + 1);
        msg.send(raw, peerId).finally(() => { if (pending.has(peerId)) pending.set(peerId, Math.max(0, pending.get(peerId) - 1)); });
      },
      close: (code, reason) => { ctl.send({ t: 'close', code, reason }, peerId); },
      congested: () => (pending.get(peerId) || 0) > MAX_PENDING_SENDS
    });
    if (!link) return;
    links.set(peerId, link);
    ctl.send({ t: 'ack', code: roomHost.code }, peerId);
  });
  msg.onMessage((raw, peerId) => { if (typeof raw === 'string') links.get(peerId)?.receive(raw); });
  room.onPeerLeave = forget;
  return { stop() { for (const peerId of [...links.keys()]) forget(peerId); room.onPeerLeave = null; } };
}

/**
 * Starts hosting a room in this browser. `connect()` gives the host's own player a loopback transport;
 * closing it, calling `stop()` or closing the page ends the room for everyone with code 4003.
 * @param {{ openRoom: (id: string, options?: { passive?: boolean }) => any, code?: string } & Record<string, any>} options
 *   anything else is passed to createRoomHost (timings for tests)
 */
export function hostRoom({ openRoom, code = createCode(), ...hostOptions }) {
  const room = openRoom(roomId(code));
  let stopped = false;
  const roomHost = createRoomHost({ code, ...hostOptions, onDestroy: () => stop() });
  const serving = serveRoom(room, roomHost);
  const announcer = announceRooms({ openRoom, snapshot: () => roomHost.snapshot() });

  function stop() {
    if (stopped) return;
    stopped = true;
    if (typeof removeEventListener === 'function') removeEventListener('pagehide', stop);
    roomHost.destroy(4003, 'O anfitrião saiu.');
    announcer.stop();
    serving.stop();
    setTimeout(() => room.leave(), LEAVE_DELAY_MS);
  }
  if (typeof addEventListener === 'function') addEventListener('pagehide', stop);

  function connect() {
    const [client, server] = loopbackPair();
    if (attachTransport(roomHost, server)) {
      const detach = server.onclose;
      server.onclose = event => { detach?.(event); stop(); };
    }
    return client;
  }

  return { code, roomHost, connect, stop };
}
