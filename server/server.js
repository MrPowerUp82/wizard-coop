import { WebSocketServer } from 'ws';
import crypto from 'node:crypto';
import { activateDash, activateSpecial, addLatePlayer, applyPower, createGameState, createPlayer, rerollPowers, updateGame } from './game.js';
import { campaignId } from './campaign.js';
import { encodeState } from './protocol.js';
import { sanitizeMeta } from './meta.js';

const env = (name, fallback) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} deve ser um número positivo.`);
  return value;
};
const PORT = Number(process.env.PORT || 8081);
const MAX_ROOMS = Number(process.env.MAX_ROOMS ?? 3);
if (!Number.isSafeInteger(MAX_ROOMS) || MAX_ROOMS < 1) {
  throw new Error('MAX_ROOMS deve ser um número inteiro positivo.');
}
const HEARTBEAT_MS = env('HEARTBEAT_MS', 15_000);
const RECONNECT_GRACE_MS = env('RECONNECT_GRACE_MS', 30_000);
const LOBBY_IDLE_MS = env('LOBBY_IDLE_MS', 20 * 60_000);
const ENDED_ROOM_MS = env('ENDED_ROOM_MS', 90_000);
const MAX_PLAYERS = 4;
const TICK = 30;
const SNAPSHOT_EVERY = 2; // 15 snapshots per second; clients interpolate between them.

/**
 * A connected socket plus the bookkeeping this server attaches to it.
 * @typedef {import('ws').WebSocket & { id?: string, token?: string, room?: any, messages: number, rateWindow: number, isAlive: boolean }} Client
 */

const rooms = new Map();
const wss = new WebSocketServer({
  port: PORT, maxPayload: 4096,
  perMessageDeflate: { zlibDeflateOptions: { level: 1 }, threshold: 512, serverMaxWindowBits: 11, concurrencyLimit: 4 }
});
const send = (ws, data) => ws.readyState === 1 && ws.send(JSON.stringify(data));

function createCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let value;
  do value = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  while (rooms.has(value));
  return value;
}

function broadcast(room, message) {
  const raw = JSON.stringify(message);
  for (const client of room.clients) if (client.readyState === 1 && client.bufferedAmount < 256_000) client.send(raw);
}

/** Each client gets its own snapshot, trimmed to what is near its player. */
function broadcastState(room, type) {
  for (const client of room.clients) {
    if (client.readyState === 1 && client.bufferedAmount < 256_000) {
      client.send(JSON.stringify({ type, state: encodeState(room.state, client.id) }));
    }
  }
}

const playerCount = room => Object.keys(room.state.players).length;

function openRoomList() {
  return [...rooms.values()]
    .filter(room => room.visibility === 'open' && !room.state.over && playerCount(room) < MAX_PLAYERS)
    .map(room => ({
      code: room.code,
      count: playerCount(room),
      running: room.running,
      host: room.state.players[room.host?.id]?.name || 'Arcanista'
      , campaign: room.state.campaign
    }));
}

const roomPlayers = room => Object.values(room.state.players).map(({ id, name, color, connected }) => ({ id, name, color, connected: connected !== false }));
function lobbyState(room) {
  return { type: 'lobby', count: playerCount(room), visibility: room.visibility,
    players: roomPlayers(room), hostId: room.host?.id, running: room.running, campaign: room.state.campaign };
}
function characterTaken(ws, room) {
  return send(ws, { type: 'error', code: 'CHARACTER_TAKEN', message: 'Este personagem já está em uso. Escolha outro para entrar.',
    players: roomPlayers(room) });
}

function attach(ws, room, id, token) {
  ws.room = room;
  ws.id = id;
  ws.token = token;
  room.clients.add(ws);
  if (!room.host || !room.clients.has(room.host)) room.host = ws;
}

function join(ws, room, name, requestedColor, meta) {
  if (room.state.over) return send(ws, { type: 'error', message: 'Este ritual já terminou. Crie uma nova sala.' });
  if (playerCount(room) >= MAX_PLAYERS) return send(ws, { type: 'error', message: 'A sala está cheia.' });
  const usedColors = new Set(Object.values(room.state.players).map(p => p.color));
  const color = requestedColor ?? [0, 1, 2, 3].find(value => !usedColors.has(value));
  if (usedColors.has(color)) return characterTaken(ws, room);
  const id = crypto.randomUUID();
  const token = crypto.randomUUID();
  attach(ws, room, id, token);
  room.sessions.set(token, id);
  const player = createPlayer(id, (typeof name === 'string' && name.trim() || 'Arcanista').slice(0, 16), color, sanitizeMeta(meta));
  if (room.running) addLatePlayer(room.state, player);
  else room.state.players[id] = player;
  send(ws, { type: 'joined', room: room.code, playerId: id, token, color, count: playerCount(room), visibility: room.visibility });
  broadcast(room, lobbyState(room));
}

function resume(ws, message) {
  const room = rooms.get(String(message.room || '').toUpperCase());
  const token = String(message.token || '');
  const id = room?.sessions.get(token);
  if (!room || !id || !room.state.players[id] || [...room.clients].some(client => client.id === id)) {
    return send(ws, { type: 'error', code: 'RESUME_FAILED', message: 'Não foi possível voltar à partida.' });
  }
  clearTimeout(room.grace.get(id));
  room.grace.delete(id);
  attach(ws, room, id, token);
  const player = room.state.players[id];
  player.connected = true;
  send(ws, { type: 'joined', room: room.code, playerId: id, token, color: player.color, count: playerCount(room), visibility: room.visibility, resumed: true });
  if (room.running) send(ws, { type: 'start', state: encodeState(room.state, id) });
  broadcast(room, lobbyState(room));
}

function destroyRoom(room, code = 1000, reason = '') {
  clearInterval(room.timer);
  clearTimeout(room.expire);
  for (const timer of room.grace.values()) clearTimeout(timer);
  rooms.delete(room.code);
  for (const client of room.clients) { client.room = null; client.close(code, reason); }
  room.clients.clear();
}

function removePlayer(room, id) {
  delete room.state.players[id];
  for (const [token, owner] of room.sessions) if (owner === id) room.sessions.delete(token);
  if (!room.clients.size && !room.grace.size) return destroyRoom(room);
  if (room.host?.id === id || !room.clients.has(room.host)) room.host = [...room.clients][0] || null;
  broadcast(room, lobbyState(room));
}

function leave(ws, intentional) {
  const room = ws.room;
  if (!room || !room.clients.has(ws)) return;
  room.clients.delete(ws);
  ws.room = null;
  const player = room.state.players[ws.id];
  if (!intentional && player && room.running && !room.state.over) {
    // Keep the character in the match for a while so a dropped connection can resume it.
    player.connected = false;
    player.input = { x: 0, y: 0 };
    room.grace.set(ws.id, setTimeout(() => { room.grace.delete(ws.id); removePlayer(room, ws.id); }, RECONNECT_GRACE_MS));
    if (room.host === ws) room.host = [...room.clients][0] || null;
    broadcast(room, lobbyState(room));
    return;
  }
  removePlayer(room, ws.id);
}

wss.on('connection', (/** @type {Client} */ ws) => {
  ws.messages = 0;
  ws.rateWindow = Date.now();
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('error', () => ws.close());
  ws.on('message', raw => {
    const now = Date.now();
    if (now - (ws.rateWindow || 0) > 1000) { ws.rateWindow = now; ws.messages = 0; }
    if (++ws.messages > 50) return;
    let message;
    try { message = JSON.parse(String(raw)); } catch { return; }
    if (!message || typeof message !== 'object' || Array.isArray(message)) return;
    if (message.type === 'ping') {
      return Number.isFinite(message.t) && send(ws, { type: 'pong', t: message.t });
    }
    if (message.type === 'listRooms') {
      return send(ws, { type: 'rooms', rooms: openRoomList(), capacity: { used: rooms.size, max: MAX_ROOMS } });
    }
    if (ws.room && ['create', 'join', 'resume'].includes(message.type)) {
      return send(ws, { type: 'error', message: 'Você já está em uma sala.' });
    }
    if (['create', 'join', 'selectCharacter'].includes(message.type)
      && (message.color !== undefined || message.type === 'selectCharacter')
      && (!Number.isInteger(message.color) || message.color < 0 || message.color > 3)) {
      return send(ws, { type: 'error', message: 'Personagem inválido.' });
    }
    const room = ws.room;
    const player = room?.state.players[ws.id];

    if (message.type === 'create') {
      if (rooms.size >= MAX_ROOMS) {
        return send(ws, { type: 'error', message: `O servidor atingiu o limite de ${MAX_ROOMS} salas. Entre em uma sala disponível ou tente novamente mais tarde.` });
      }
      const created = { code: createCode(), host: null, clients: new Set(), sessions: new Map(), grace: new Map(),
        state: createGameState(campaignId(message.campaign)), running: false, visibility: message.visibility === 'open' ? 'open' : 'closed' };
      created.expire = setTimeout(() => { if (!created.running) destroyRoom(created, 4001, 'Sala expirou antes da batalha'); }, LOBBY_IDLE_MS);
      rooms.set(created.code, created);
      join(ws, created, message.name, message.color, message.meta);
      if (!ws.room) destroyRoom(created);
    } else if (message.type === 'join') {
      const target = rooms.get(String(message.room || '').toUpperCase());
      target ? join(ws, target, message.name, message.color, message.meta) : send(ws, { type: 'error', message: 'Sala não encontrada.' });
    } else if (message.type === 'resume') {
      resume(ws, message);
    } else if (message.type === 'selectCharacter' && room) {
      if (room.running || room.state.over) return send(ws, { type: 'error', message: 'O personagem só pode ser trocado antes da batalha.' });
      if (Object.values(room.state.players).some(p => p.id !== ws.id && p.color === message.color)) return characterTaken(ws, room);
      player.color = message.color;
      player.x = message.color * 55;
      broadcast(room, lobbyState(room));
    } else if (message.type === 'start' && room?.host === ws) {
      start(room);
    } else if (message.type === 'ready' && room?.running) {
      send(ws, { type: 'start', state: encodeState(room.state, ws.id) });
    } else if (message.type === 'input' && player) {
      let x = Math.max(-1, Math.min(1, Number(message.x) || 0));
      let y = Math.max(-1, Math.min(1, Number(message.y) || 0));
      const length = Math.hypot(x, y);
      if (length > 1) { x /= length; y /= length; }
      player.input = player.alive && !player.pendingPowers ? { x, y } : { x: 0, y: 0 };
      if (Number.isSafeInteger(message.seq) && message.seq > player.inputSeq) player.inputSeq = message.seq;
    } else if (message.type === 'choosePower' && player) {
      applyPower(player, String(message.power || ''));
    } else if (message.type === 'reroll' && player) {
      rerollPowers(player, Math.random, { coop: playerCount(room) > 1 });
    } else if (message.type === 'special' && room?.running) {
      activateSpecial(room.state, ws.id);
    } else if (message.type === 'dash' && room?.running) {
      activateDash(room.state, ws.id, { x: message.x, y: message.y });
    } else if (message.type === 'leave' && room) {
      leave(ws, true);
    }
  });

  ws.on('close', () => leave(ws, false));
});

const heartbeat = setInterval(() => {
  for (const ws of /** @type {Set<Client>} */ (wss.clients)) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, HEARTBEAT_MS);
wss.on('close', () => clearInterval(heartbeat));

function start(room) {
  if (room.running) return;
  room.running = true;
  clearTimeout(room.expire);
  broadcastState(room, 'start');
  let frames = 0;
  let previous = Date.now();
  room.timer = setInterval(() => {
    const now = Date.now();
    const dt = Math.min((now - previous) / 1000, 0.08);
    previous = now;
    if (!room.clients.size) return; // Everyone dropped: freeze the match while they may still reconnect.
    updateGame(room.state, dt);
    if (++frames % SNAPSHOT_EVERY === 0 || room.state.over) broadcastState(room, 'state');
    if (room.state.over) {
      clearInterval(room.timer);
      for (const timer of room.grace.values()) clearTimeout(timer);
      room.grace.clear();
      room.expire = setTimeout(() => destroyRoom(room, 4002, 'Partida encerrada'), ENDED_ROOM_MS);
    }
  }, 1000 / TICK);
}

wss.on('listening', () => console.log(`Arcana Survivors server listening on :${/** @type {import('node:net').AddressInfo} */ (wss.address()).port}`));
