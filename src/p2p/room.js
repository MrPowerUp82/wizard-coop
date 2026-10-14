import { joinRoom } from '@trystero-p2p/torrent';

export const APP_ID = 'arcana-survivors';

/** Optional TURN relay for networks where direct WebRTC fails: ?turn=turn:host:3478&turnUser=...&turnCred=... */
function turnConfig() {
  try {
    const params = new URLSearchParams(location.search);
    const url = params.get('turn');
    return url ? [{ urls: url, username: params.get('turnUser') || undefined, credential: params.get('turnCred') || undefined }] : undefined;
  } catch { return undefined; }
}

/** The only place that touches the P2P library. */
export function openRoom(roomId) {
  return joinRoom({ appId: APP_ID, turnConfig: turnConfig() }, roomId);
}
