import { WebSocketServer } from 'ws';
import crypto from 'node:crypto';
import { activateSpecial, applyPower, createGameState, createPlayer, publicState, updateGame } from './game.js';

const PORT = Number(process.env.PORT || 8081);
const MAX_ROOMS = Number(process.env.MAX_ROOMS ?? 3);
if (!Number.isSafeInteger(MAX_ROOMS) || MAX_ROOMS < 1) {
  throw new Error('MAX_ROOMS deve ser um número inteiro positivo.');
}
const TICK = 30;
const rooms = new Map();
const wss = new WebSocketServer({ port: PORT, maxPayload: 4096 });
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

function openRoomList() {
  return [...rooms.values()]
    .filter(room => room.visibility === 'open' && !room.state.over && room.clients.size < 4)
    .map(room => ({
      code: room.code,
      count: room.clients.size,
      running: room.running,
      host: room.state.players[room.host?.id]?.name || 'Arcanista'
    }));
}

const roomPlayers = room => Object.values(room.state.players).map(({ id, name, color }) => ({ id, name, color }));
function lobbyState(room) {
  return { type: 'lobby', count: room.clients.size, visibility: room.visibility,
    players: roomPlayers(room), hostId: room.host.id, running: room.running };
}
function characterTaken(ws, room) {
  return send(ws, { type: 'error', code: 'CHARACTER_TAKEN', message: 'Este personagem já está em uso. Escolha outro para entrar.',
    players: roomPlayers(room) });
}

function join(ws, room, name, requestedColor) {
  if (room.state.over) return send(ws, { type: 'error', message: 'Este ritual já terminou. Crie uma nova sala.' });
  if (room.clients.size >= 4) return send(ws, { type: 'error', message: 'A sala está cheia.' });
  const usedColors = new Set(Object.values(room.state.players).map(p => p.color));
  const color = requestedColor ?? [0, 1, 2, 3].find(value => !usedColors.has(value));
  if (usedColors.has(color)) return characterTaken(ws, room);
  ws.room = room;
  ws.id = crypto.randomUUID();
  ws.messages = 0;
  ws.rateWindow = Date.now();
  room.clients.add(ws);
  room.state.players[ws.id] = createPlayer(ws.id, (typeof name === 'string' && name.trim() || 'Arcanista').slice(0, 16), color);
  send(ws, { type: 'joined', room: room.code, playerId: ws.id, color, count: room.clients.size, visibility: room.visibility });
  broadcast(room, lobbyState(room));
}

wss.on('connection', ws => {
  ws.messages = 0;
  ws.rateWindow = Date.now();
  ws.on('error', () => ws.close());
  ws.on('message', raw => {
    const now = Date.now();
    if (now - (ws.rateWindow || 0) > 1000) { ws.rateWindow = now; ws.messages = 0; }
    if (++ws.messages > 50) return;
    let message;
    try { message = JSON.parse(raw); } catch { return; }
    if (!message || typeof message !== 'object' || Array.isArray(message)) return;
    if (message.type === 'listRooms') {
      return send(ws, { type: 'rooms', rooms: openRoomList(), capacity: { used: rooms.size, max: MAX_ROOMS } });
    }
    if (ws.room && (message.type === 'create' || message.type === 'join')) {
      return send(ws, { type: 'error', message: 'Você já está em uma sala.' });
    }
    if (['create', 'join', 'selectCharacter'].includes(message.type)
      && (message.color !== undefined || message.type === 'selectCharacter')
      && (!Number.isInteger(message.color) || message.color < 0 || message.color > 3)) {
      return send(ws, { type: 'error', message: 'Personagem inválido.' });
    }

    if (message.type === 'create') {
      if (rooms.size >= MAX_ROOMS) {
        return send(ws, { type: 'error', message: `O servidor atingiu o limite de ${MAX_ROOMS} salas. Entre em uma sala disponível ou tente novamente mais tarde.` });
      }
      const roomCode = createCode();
      const visibility = message.visibility === 'open' ? 'open' : 'closed';
      const room = { code: roomCode, host: ws, clients: new Set(), state: createGameState(), running: false, visibility };
      rooms.set(roomCode, room);
      join(ws, room, message.name, message.color);
    } else if (message.type === 'join') {
      const room = rooms.get(String(message.room || '').toUpperCase());
      room ? join(ws, room, message.name, message.color) : send(ws, { type: 'error', message: 'Sala não encontrada.' });
    } else if (message.type === 'selectCharacter' && ws.room) {
      const room = ws.room;
      if (room.running || room.state.over) return send(ws, { type: 'error', message: 'O personagem só pode ser trocado antes da batalha.' });
      if (Object.values(room.state.players).some(p => p.id !== ws.id && p.color === message.color)) return characterTaken(ws, room);
      room.state.players[ws.id].color = message.color;
      broadcast(room, lobbyState(room));
    } else if (message.type === 'start' && ws.room?.host === ws) {
      start(ws.room);
    } else if (message.type === 'ready' && ws.room?.running) {
      send(ws, { type: 'start', state: publicState(ws.room.state) });
    } else if (message.type === 'input' && ws.room?.state.players[ws.id]) {
      const player = ws.room.state.players[ws.id];
      let x = Math.max(-1, Math.min(1, Number(message.x) || 0));
      let y = Math.max(-1, Math.min(1, Number(message.y) || 0));
      const length = Math.hypot(x, y);
      if (length > 1) { x /= length; y /= length; }
      player.input = player.alive && !player.pendingPowers ? { x, y } : { x: 0, y: 0 };
    } else if (message.type === 'choosePower' && ws.room?.state.players[ws.id]) {
      applyPower(ws.room.state.players[ws.id], String(message.power || ''));
    } else if (message.type === 'special' && ws.room?.running) {
      activateSpecial(ws.room.state, ws.id);
    }
  });

  ws.on('close', () => {
    const room = ws.room;
    if (!room) return;
    room.clients.delete(ws);
    delete room.state.players[ws.id];
    if (!room.clients.size) {
      clearInterval(room.timer);
      rooms.delete(room.code);
    } else {
      if (room.host === ws) room.host = [...room.clients][0];
      broadcast(room, lobbyState(room));
    }
  });
});

function start(room) {
  if (room.running) return;
  room.running = true;
  broadcast(room, { type: 'start', state: publicState(room.state) });
  let frames = 0;
  let previous = Date.now();
  room.timer = setInterval(() => {
    const now = Date.now();
    const dt = Math.min((now - previous) / 1000, 0.08);
    previous = now;
    updateGame(room.state, dt);
    if (++frames % 3 === 0 || room.state.over) broadcast(room, { type: 'state', state: publicState(room.state) });
    if (room.state.over) clearInterval(room.timer);
  }, 1000 / TICK);
}

wss.on('listening', () => console.log(`Arcana Survivors server listening on :${wss.address().port}`));
