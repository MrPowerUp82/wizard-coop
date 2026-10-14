/**
 * An in-memory stand-in for the Trystero rooms, used only by tests. Same surface the app touches:
 * selfId, makeAction(ns) -> { send(data, { target }?), onMessage }, onPeerJoin, onPeerLeave, leave().
 */
export function createFakeSwarm() {
  /** @type {Map<string, Set<any>>} */
  const groups = new Map();
  let counter = 0;

  function openRoom(roomId, _options) {
    const group = groups.get(roomId) ?? new Set();
    groups.set(roomId, group);
    const actions = new Map();
    const room = {
      selfId: `peer-${++counter}`, roomId, left: false, peers: new Set(), actions,
      onPeerJoin: null, onPeerLeave: null,
      makeAction(namespace) {
        const action = {
          onMessage: null,
          send(data, options) {
            const payload = structuredClone(data);
            const targets = options?.target == null ? [...room.peers] : [options.target].flat();
            queueMicrotask(() => {
              for (const other of group) {
                if (other.left || !targets.includes(other.selfId) || !room.peers.has(other.selfId) || !other.peers.has(room.selfId)) continue;
                other.actions.get(namespace)?.onMessage?.(payload, { peerId: room.selfId });
              }
            });
            return Promise.resolve();
          }
        };
        actions.set(namespace, action);
        return action;
      },
      leave() {
        if (room.left) return Promise.resolve();
        room.left = true;
        group.delete(room);
        for (const other of group) {
          if (!room.peers.has(other.selfId)) continue;
          other.peers.delete(room.selfId);
          other.onPeerLeave?.(room.selfId);
        }
        room.peers.clear();
        return Promise.resolve();
      }
    };
    group.add(room);
    // Peers find each other asynchronously, like real signaling, after the caller has set its handlers.
    setTimeout(() => {
      if (room.left) return;
      for (const other of group) {
        if (other === room || other.left) continue;
        room.peers.add(other.selfId);
        other.peers.add(room.selfId);
        room.onPeerJoin?.(other.selfId);
        other.onPeerJoin?.(room.selfId);
      }
    }, 0);
    return room;
  }

  /** Cut `room` off from every peer without it leaving: both sides see the connection die. */
  function sever(room) {
    for (const other of groups.get(room.roomId)) {
      if (!room.peers.has(other.selfId)) continue;
      other.peers.delete(room.selfId);
      other.onPeerLeave?.(room.selfId);
      room.onPeerLeave?.(other.selfId);
    }
    room.peers.clear();
  }

  return { openRoom, sever };
}
