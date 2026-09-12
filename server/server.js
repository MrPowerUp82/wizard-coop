import { WebSocketServer } from 'ws';
import crypto from 'node:crypto';
import { applyPower, createGameState, createPlayer, publicState, updateGame } from './game.js';

const PORT = Number(process.env.PORT || 8080);
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

function join(ws, room, name) {
  if (room.state.over) return send(ws, { type: 'error', message: 'Este ritual já terminou. Crie uma nova sala.' });
  if (room.clients.size >= 4) return send(ws, { type: 'error', message: 'A sala está cheia.' });
  ws.room = room;
  ws.id = crypto.randomUUID();
  ws.messages = 0;
  ws.rateWindow = Date.now();
  room.clients.add(ws);
  room.state.players[ws.id] = createPlayer(ws.id, (typeof name === 'string' && name.trim() || 'Arcanista').slice(0, 16), (room.clients.size - 1) % 4);
  send(ws, { type: 'joined', room: room.code, playerId: ws.id, count: room.clients.size });
  broadcast(room, { type: 'lobby', count: room.clients.size });
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
    if (ws.room && (message.type === 'create' || message.type === 'join')) {
      return send(ws, { type: 'error', message: 'Você já está em uma sala.' });
    }

    if (message.type === 'create') {
      const roomCode = createCode();
      const room = { code: roomCode, host: ws, clients: new Set(), state: createGameState(), running: false };
      rooms.set(roomCode, room);
      join(ws, room, message.name);
    } else if (message.type === 'join') {
      const room = rooms.get(String(message.room || '').toUpperCase());
      room ? join(ws, room, message.name) : send(ws, { type: 'error', message: 'Sala não encontrada.' });
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
      broadcast(room, { type: 'lobby', count: room.clients.size });
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
    if (++frames % 3 === 0) broadcast(room, { type: 'state', state: publicState(room.state) });
  }, 1000 / TICK);
}

wss.on('listening', () => console.log(`Arcana Survivors server listening on :${wss.address().port}`));
