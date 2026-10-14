/**
 * Wraps a Trystero action so callers and the in-memory fake share one shape:
 * send(data, peerId?) targets one peer (or everyone), onMessage(handler) receives (data, peerId).
 * Sends never throw: a peer that vanished mid-send is simply gone.
 */
export function channel(room, namespace) {
  const action = room.makeAction(namespace);
  return {
    send(data, peerId) {
      return Promise.resolve(action.send(data, peerId ? { target: peerId } : undefined)).catch(() => {});
    },
    onMessage(handler) {
      action.onMessage = (data, context) => handler(data, context.peerId);
    }
  };
}
