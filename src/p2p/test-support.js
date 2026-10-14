import { createInbox } from '../../server/test-support.js';

export async function waitFor(condition, timeoutMs = 2000) {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error('timed out waiting for condition');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

/** Wraps a transport so a test can `await inbox.receive('joined')` and `inbox.send({...})`. Resolves once open or closed. */
export async function openInbox(transport) {
  const inbox = createInbox();
  const wrapper = Object.assign(inbox, { transport, closed: null, send: message => transport.send(JSON.stringify(message)) });
  transport.onmessage = ({ data }) => inbox.push(JSON.parse(data));
  transport.onclose = event => { wrapper.closed = event; inbox.notify(); };
  await waitFor(() => transport.readyState !== 0, 3000);
  return wrapper;
}
