/**
 * A transport is the subset of WebSocket that net.js and the room host rely on:
 * readyState (0 connecting, 1 open, 3 closed), send(string), close(code, reason) and the
 * onopen / onmessage({ data }) / onclose({ code, reason }) / onerror callbacks.
 */
export const CONNECTING = 0;
export const OPEN = 1;
export const CLOSED = 3;

/**
 * Builds a transport. `onSend` ships a string to the other side; `onLocalClose` tells the other side that
 * this side closed. The underscore methods are for whoever implements the other side of the wire.
 * @param {{ onSend?: (raw: string) => void, onLocalClose?: (code: number, reason: string) => void }} [hooks]
 */
export function createTransport({ onSend = () => {}, onLocalClose = () => {} } = {}) {
  const transport = {
    readyState: CONNECTING,
    /** @type {null | (() => void)} */ onopen: null,
    /** @type {null | ((event: { data: string }) => void)} */ onmessage: null,
    /** @type {null | ((event: { code: number, reason: string }) => void)} */ onclose: null,
    /** @type {null | (() => void)} */ onerror: null,
    send(/** @type {string} */ raw) { if (transport.readyState === OPEN) onSend(raw); },
    close(code = 1000, reason = '') {
      if (transport.readyState === CLOSED) return;
      onLocalClose(code, reason);
      transport._finish(code, reason);
    },
    _open() {
      if (transport.readyState !== CONNECTING) return;
      transport.readyState = OPEN;
      transport.onopen?.();
    },
    _receive(/** @type {string} */ data) {
      if (transport.readyState !== CLOSED) transport.onmessage?.({ data });
    },
    _finish(/** @type {number} */ code, /** @type {string} */ reason) {
      if (transport.readyState === CLOSED) return;
      transport.readyState = CLOSED;
      transport.onclose?.({ code, reason });
    }
  };
  return transport;
}

/** Two transports joined in memory: what the host's own player uses to reach its own room. */
export function loopbackPair() {
  /** @type {any[]} */
  const ends = [];
  const make = index => createTransport({
    onSend: raw => queueMicrotask(() => ends[1 - index]._receive(raw)),
    onLocalClose: (code, reason) => queueMicrotask(() => ends[1 - index]._finish(code, reason))
  });
  ends.push(make(0), make(1));
  queueMicrotask(() => { ends[0]._open(); ends[1]._open(); });
  return /** @type {[ReturnType<typeof createTransport>, ReturnType<typeof createTransport>]} */ (ends);
}

/** Connects a transport (the server side of a pair) to a room host. Returns the host's link, or null if the room is gone. */
export function attachTransport(roomHost, transport) {
  const link = roomHost.connect({
    send: raw => transport.send(raw),
    close: (code, reason) => transport.close(code, reason)
  });
  if (!link) return null;
  transport.onmessage = ({ data }) => link.receive(data);
  transport.onclose = () => link.disconnect();
  return link;
}
