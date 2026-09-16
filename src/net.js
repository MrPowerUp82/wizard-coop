import { decodeState } from '../server/protocol.js';
import { movementDelta } from '../server/movement.js';

const INTERPOLATION_DELAY = 0.1;
const RETRY_DELAYS = [400, 800, 1500, 2500, 4000, 6000, 8000, 8000];
const SESSION_KEY = 'arcana-session';
const SESSION_MAX_AGE = 30_000;

const lerp = (a, b, t) => a + (b - a) * t;
function lerpAngle(a, b, t) {
  let delta = (b - a) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return a + delta * t;
}
const byId = list => new Map(list.map(item => [item.id, item]));

export function savedSession() {
  try {
    const session = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
    return session && Date.now() - session.at < SESSION_MAX_AGE ? session : null;
  } catch { return null; }
}
function rememberSession(session) {
  try { session ? sessionStorage.setItem(SESSION_KEY, JSON.stringify({ ...session, at: Date.now() })) : sessionStorage.removeItem(SESSION_KEY); }
  catch { /* optional */ }
}

/**
 * One co-op connection: lobby messages, a snapshot buffer rendered ~100ms in the past,
 * client-side prediction for the local player and automatic resume after a dropped connection.
 */
export function createSession(url, entry, handlers) {
  let socket = null;
  let closedByUser = false;
  let retries = 0;
  let inGame = false;
  let over = false;
  const snapshots = [];
  let clockOffset = null;
  let rtt = 120;
  let pingTimer = null;
  let lastInput = { x: 99, y: 99 }, lastInputAt = 0, inputSeq = 0;
  let predicted = null, visualOffset = { x: 0, y: 0 };
  let motionId = 0;
  const history = [];

  const session = { playerId: null, room: null, token: null, color: entry.color, failure: null, reconnecting: false };

  const send = message => {
    if (socket?.readyState !== 1) return false;
    socket.send(JSON.stringify(message));
    return true;
  };

  function open(resume) {
    let ws;
    try { ws = new WebSocket(url); } catch { handlers.onError?.({ message: 'Endereço do servidor inválido' }); return; }
    socket = ws;
    ws.onopen = () => {
      if (resume) ws.send(JSON.stringify({ type: 'resume', room: session.room, token: session.token }));
      else ws.send(JSON.stringify({ type: entry.action, room: entry.code, name: entry.name, visibility: entry.visibility, color: entry.color, meta: entry.meta, campaign: entry.campaign }));
      clearInterval(pingTimer);
      const ping = () => send({ type: 'ping', t: performance.now() });
      ping();
      pingTimer = setInterval(ping, 2000);
    };
    ws.onerror = () => { if (socket === ws && !inGame) handlers.onError?.({ message: 'Não foi possível alcançar o servidor.', transport: true }); };
    ws.onmessage = ({ data }) => { if (socket === ws) receive(data); };
    ws.onclose = event => { if (socket === ws) closed(event); };
  }

  function receive(data) {
    let message;
    try { message = JSON.parse(data); } catch { return; }
    if (!message || typeof message !== 'object') return;
    if (message.type === 'pong') { rtt = rtt * 0.7 + (performance.now() - message.t) * 0.3; return; }
    if (message.type === 'joined') {
      retries = 0;
      session.failure = null;
      Object.assign(session, { playerId: message.playerId, room: message.room, token: message.token, color: message.color, reconnecting: false });
      handlers.onReconnecting?.(false);
      handlers.onJoined?.(message);
      if (entry.action === 'join' && !message.resumed) send({ type: 'ready' });
      return;
    }
    if (message.type === 'lobby') return handlers.onLobby?.(message);
    if (message.type === 'error') {
      session.failure = message.message;
      if (message.code === 'RESUME_FAILED') { session.token = null; rememberSession(null); }
      return handlers.onError?.(message);
    }
    if (message.type === 'start' || message.type === 'state') {
      const state = decodeState(message.state);
      const at = performance.now();
      if (message.type === 'start') { snapshots.length = 0; predicted = null; history.length = 0; clockOffset = null; }
      const sample = at - state.time * 1000;
      // Track the fastest-arriving snapshot, drifting slowly so a lag spike does not stall rendering.
      clockOffset = clockOffset === null ? sample : Math.min(sample, clockOffset + 4);
      snapshots.push({ t: state.time, at, state });
      if (snapshots.length > 30) snapshots.shift();
      reconcile(state, at);
      over = state.over;
      if (message.type === 'start' && !inGame) { inGame = true; handlers.onStart?.(); }
      if (session.token) rememberSession(over ? null : { url, room: session.room, token: session.token });
    }
  }

  function closed(event) {
    clearInterval(pingTimer);
    socket = null;
    if (closedByUser) return;
    if (inGame && !over && session.token && retries < RETRY_DELAYS.length && event.code < 4000) {
      session.reconnecting = true;
      handlers.onReconnecting?.(true);
      setTimeout(() => { if (!closedByUser) open(true); }, RETRY_DELAYS[retries++]);
      return;
    }
    if (over) rememberSession(null);
    handlers.onClosed?.({ inGame, over, failure: session.failure, code: event.code, reason: event.reason });
  }

  function reconcile(state, at) {
    const me = state.players[session.playerId];
    if (!predicted || !me) return;
    if (motionId !== (me.motionId || 0)) {
      motionId = me.motionId || 0;
      predicted = { x: me.x, y: me.y };
      visualOffset = { x: 0, y: 0 }; history.length = 0;
      return;
    }
    // Compare the server position with where we predicted ourselves roughly one round trip ago.
    const target = at - rtt;
    let past = history[0];
    for (const entryPoint of history) { if (entryPoint.at > target) break; past = entryPoint; }
    if (!past) return;
    const ex = me.x - past.x, ey = me.y - past.y;
    if (Math.hypot(ex, ey) > 220) {
      visualOffset = { x: 0, y: 0 };
      predicted = { x: me.x, y: me.y };
      history.length = 0;
      return;
    }
    const k = 0.35;
    predicted.x += ex * k; predicted.y += ey * k;
    for (const h of history) { h.x += ex * k; h.y += ey * k; }
    visualOffset.x -= ex * k; visualOffset.y -= ey * k;
  }

  function interpolate(renderT) {
    const last = snapshots[snapshots.length - 1];
    let a = last, b = last;
    for (let i = snapshots.length - 1; i > 0; i--) {
      if (snapshots[i - 1].t <= renderT) { a = snapshots[i - 1]; b = snapshots[i]; break; }
      a = b = snapshots[i - 1];
    }
    const alpha = b.t > a.t ? Math.max(0, Math.min(1, (renderT - a.t) / (b.t - a.t))) : 0;
    const latest = last.state, from = a.state, to = b.state;
    const ahead = renderT - b.t;
    const previousPlayers = from.players, previousEnemies = byId(from.enemies), previousGems = byId(from.gems);
    const players = {};
    for (const [id, p] of Object.entries(latest.players)) {
      const pa = previousPlayers[id], pb = to.players[id] || p;
      players[id] = pa ? { ...p, x: lerp(pa.x, pb.x, alpha), y: lerp(pa.y, pb.y, alpha), orbitAngle: lerpAngle(pa.orbitAngle, pb.orbitAngle, alpha),
        familiar: pa.familiar && pb.familiar ? { x: lerp(pa.familiar.x, pb.familiar.x, alpha), y: lerp(pa.familiar.y, pb.familiar.y, alpha) } : p.familiar } : { ...p };
    }
    const move = list => list.map(item => ({ ...item, x: item.x + item.vx * ahead, y: item.y + item.vy * ahead }));
    return {
      ...latest,
      players,
      enemies: to.enemies.map(e => { const p = previousEnemies.get(e.id); return p ? { ...e, x: lerp(p.x, e.x, alpha), y: lerp(p.y, e.y, alpha) } : e; }),
      gems: to.gems.map(g => { const p = previousGems.get(g.id); return p ? { ...g, x: lerp(p.x, g.x, alpha), y: lerp(p.y, g.y, alpha) } : g; }),
      shots: move(to.shots),
      enemyShots: move(to.enemyShots),
      hazards: to.hazards.map(h => ({ ...h, warning: h.warning - Math.max(0, ahead) })),
      runes: to.runes, zones: to.zones
    };
  }

  if (entry.resume) Object.assign(session, { room: entry.resume.room, token: entry.resume.token });
  open(Boolean(entry.resume));

  return Object.assign(session, {
    send,
    get inGame() { return inGame; },
    get rtt() { return rtt; },
    get hasState() { return snapshots.length > 0; },
    close() {
      closedByUser = true;
      rememberSession(null);
      clearInterval(pingTimer);
      if (socket?.readyState === 1) socket.send(JSON.stringify({ type: 'leave' }));
      socket?.close();
      socket = null;
    },
    /** Sends input when it changes (and as a keep-alive) and returns the view to render this frame. */
    frame(now, dt, input) {
      if (!snapshots.length) return null;
      if (input.x !== lastInput.x || input.y !== lastInput.y || now - lastInputAt >= 100) {
        if (input.x !== lastInput.x || input.y !== lastInput.y) inputSeq++;
        if (send({ type: 'input', x: input.x, y: input.y, seq: inputSeq })) { lastInput = { ...input }; lastInputAt = now; }
      }
      const renderT = (now - clockOffset) / 1000 - INTERPOLATION_DELAY;
      const view = interpolate(renderT);
      const serverMe = snapshots[snapshots.length - 1].state.players[session.playerId];
      const me = view.players[session.playerId];
      if (!serverMe || !me) return view;
      const canMove = serverMe.alive && !serverMe.pendingPowers && !view.over && view.phaseStatus !== 'transition' && !session.reconnecting;
      if (!canMove || !predicted) {
        predicted = { x: serverMe.x, y: serverMe.y };
        visualOffset = { x: 0, y: 0 };
        history.length = 0;
      }
      if (canMove) {
        const latest = snapshots[snapshots.length - 1];
        const age = Math.max(0, (now - clockOffset) / 1000 - latest.t);
        const movement = movementDelta({ ...serverMe, dashFor: Math.max(0, (serverMe.dashFor || 0) - age) }, input, dt);
        predicted.x += movement.x; predicted.y += movement.y;
        history.push({ at: now, x: predicted.x, y: predicted.y });
        while (history.length && history[0].at < now - 1500) history.shift();
      }
      const decay = Math.min(1, dt * 10);
      visualOffset.x -= visualOffset.x * decay; visualOffset.y -= visualOffset.y * decay;
      me.x = predicted.x + visualOffset.x;
      me.y = predicted.y + visualOffset.y;
      return view;
    }
  });
}
