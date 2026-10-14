import { createRoomHost } from './room-host.js';

/** Collects parsed messages and lets a test wait for the one it cares about. */
export function createInbox() {
  const queue = [];
  let wake = () => {};
  const waitForChange = (timeoutMs, what) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { wake = () => {}; reject(new Error(`timed out waiting for ${what}`)); }, timeoutMs);
    wake = () => { clearTimeout(timer); wake = () => {}; resolve(); };
  });
  return {
    push(message) { queue.push(message); wake(); },
    notify() { wake(); },
    has: type => queue.some(message => message.type === type),
    drain(type) {
      const taken = queue.filter(message => message.type === type);
      for (const message of taken) queue.splice(queue.indexOf(message), 1);
      return taken;
    },
    async receive(type, predicate = () => true, timeoutMs = 2000) {
      let index;
      while ((index = queue.findIndex(message => message.type === type && predicate(message))) < 0) await waitForChange(timeoutMs, type);
      return queue.splice(index, 1)[0];
    },
    async until(condition, timeoutMs = 2000, what = 'condition') {
      while (!condition()) await waitForChange(timeoutMs, what);
    }
  };
}

/** A room host with in-memory clients: no sockets, no timers beyond the host's own. */
export function startRoom(t, options = {}) {
  const host = createRoomHost({ code: 'ABC234', ...options });
  t.after(() => host.destroy());
  function connect() {
    const inbox = createInbox();
    const state = { closed: null };
    const link = host.connect({
      send(raw) { inbox.push(JSON.parse(raw)); },
      close(code, reason) { state.closed = { code, reason }; inbox.notify(); }
    });
    return {
      send: message => link.receive(typeof message === 'string' ? message : JSON.stringify(message)),
      terminate: () => link.disconnect(),
      get closed() { return state.closed; },
      receive: inbox.receive,
      drain: inbox.drain,
      has: inbox.has,
      async closedWith(timeoutMs = 2000) { await inbox.until(() => state.closed, timeoutMs, 'close'); return state.closed; }
    };
  }
  return { host, connect, destroy: () => host.destroy() };
}
