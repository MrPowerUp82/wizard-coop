import { activateDash, activateSpecial, addLatePlayer, applyPower, createGameState, createPlayer, rerollPowers, sendSignal, updateGame } from './game.js';
import { campaignId } from './campaign.js';
import { PROTOCOL_VERSION, encodeState } from './protocol.js';
import { sanitizeMeta } from './meta.js';
import { sanitizeCurses } from './curses.js';
import { selectPlayerCharacter } from './developer.js';
import { SPELLS } from './weapons.js';
import { AURORA } from './aurora.js';
import { GOD } from './god.js';

export const MAX_PLAYERS = 4;
const TICK = 30;
const SNAPSHOT_EVERY = 2; // 15 snapshots per second; clients interpolate between them.
const MAX_MESSAGE_CHARS = 4096;
const MAX_MESSAGES_PER_SECOND = 50;

/**
 * What a transport gives the host for one connected peer.
 * @typedef {object} Endpoint
 * @property {(raw: string) => void} send
 * @property {(code?: number, reason?: string) => void} close
 * @property {() => boolean} [congested] true when the peer cannot take more snapshots right now
 */

/**
 * The rules of ONE co-op room, independent of how peers are connected: lobby, join/resume/leave, validation,
 * the 30 Hz simulation and per-client snapshots. The browser of whoever created the room runs this.
 * @param {{ code: string, reconnectGraceMs?: number, lobbyIdleMs?: number, endedRoomMs?: number,
 *   onDestroy?: (code: string, closeCode: number, reason: string) => void }} options
 */
export function createRoomHost({ code, reconnectGraceMs = 30_000, lobbyIdleMs = 20 * 60_000, endedRoomMs = 90_000, onDestroy = () => {} }) {
  const roomCode = String(code).toUpperCase();
  /** Every connected peer, whether or not it has entered the room yet. */
  const connections = new Set();
  let room = null;
  let destroyed = false;

  const send = (client, data) => { if (client.open) client.endpoint.send(JSON.stringify(data)); };
  const writable = client => client.open && !client.endpoint.congested?.();
  const broadcast = message => {
    const raw = JSON.stringify(message);
    for (const client of room.clients) if (writable(client)) client.endpoint.send(raw);
  };
  /** Each client gets its own snapshot, trimmed to what is near its player. */
  const broadcastState = type => {
    for (const client of room.clients) {
      if (writable(client)) client.endpoint.send(JSON.stringify({ type, state: encodeState(room.state, client.id) }));
    }
  };
  const playerCount = () => Object.keys(room.state.players).length;
  const roomPlayers = () => Object.values(room.state.players).map(({ id, name, color, connected }) => ({ id, name, color, connected: connected !== false }));
  const lobbyState = () => ({ type: 'lobby', count: playerCount(), visibility: room.visibility, players: roomPlayers(),
    hostId: room.host?.id, running: room.running, campaign: room.state.campaign, curses: room.state.curses });
  const characterTaken = client => send(client, { type: 'error', code: 'CHARACTER_TAKEN',
    message: 'Este personagem já está em uso. Escolha outro para entrar.', players: roomPlayers() });

  function attach(client, id, token) {
    client.id = id;
    client.token = token;
    client.joined = true;
    room.clients.add(client);
    if (!room.host || !room.clients.has(room.host)) room.host = client;
  }

  function join(client, name, requestedColor, meta, loadout, unlocks) {
    if (room.state.over) return send(client, { type: 'error', message: 'Este ritual já terminou. Crie uma nova sala.' });
    if (playerCount() >= MAX_PLAYERS) return send(client, { type: 'error', message: 'A sala está cheia.' });
    const usedColors = new Set(Object.values(room.state.players).map(p => p.color));
    const color = requestedColor ?? [0, 1, 2, 3].find(value => !usedColors.has(value));
    if (usedColors.has(color)) return characterTaken(client);
    const id = crypto.randomUUID();
    const token = crypto.randomUUID();
    attach(client, id, token);
    room.sessions.set(token, id);
    const player = createPlayer(id, (typeof name === 'string' && name.trim() || 'Arcanista').slice(0, 16), color, sanitizeMeta(meta), loadout);
    player.auroraUnlocked = unlocks?.aurora === true;
    player.godUnlocked = unlocks?.god === true;
    if (room.running) addLatePlayer(room.state, player);
    else room.state.players[id] = player;
    send(client, { type: 'joined', room: roomCode, playerId: id, token, color, count: playerCount(), visibility: room.visibility });
    broadcast(lobbyState());
  }

  const inThisRoom = message => !message.room || String(message.room).toUpperCase() === roomCode;

  function resume(client, message) {
    const token = String(message.token || '');
    const id = room && inThisRoom(message) ? room.sessions.get(token) : undefined;
    if (!id || !room.state.players[id] || [...room.clients].some(other => other.id === id)) {
      return send(client, { type: 'error', code: 'RESUME_FAILED', message: 'Não foi possível voltar à partida.' });
    }
    clearTimeout(room.grace.get(id));
    room.grace.delete(id);
    attach(client, id, token);
    const player = room.state.players[id];
    player.connected = true;
    send(client, { type: 'joined', room: roomCode, playerId: id, token, color: player.color, count: playerCount(), visibility: room.visibility, resumed: true });
    if (room.running) send(client, { type: 'start', state: encodeState(room.state, id) });
    broadcast(lobbyState());
  }

  function destroy(closeCode = 1000, reason = '') {
    if (destroyed) return;
    destroyed = true;
    if (room) {
      clearInterval(room.timer);
      clearTimeout(room.expire);
      for (const timer of room.grace.values()) clearTimeout(timer);
      room.clients.clear();
    }
    for (const client of [...connections]) { client.open = false; client.endpoint.close(closeCode, reason); }
    connections.clear();
    onDestroy(roomCode, closeCode, reason);
  }

  function removePlayer(id) {
    delete room.state.players[id];
    for (const [token, owner] of room.sessions) if (owner === id) room.sessions.delete(token);
    if (!room.clients.size && !room.grace.size) return destroy();
    if (room.host?.id === id || !room.clients.has(room.host)) room.host = [...room.clients][0] || null;
    broadcast(lobbyState());
  }

  function leave(client, intentional) {
    if (destroyed || !room?.clients.has(client)) return;
    room.clients.delete(client);
    client.joined = false;
    const player = room.state.players[client.id];
    if (!intentional && player && room.running && !room.state.over) {
      // Keep the character in the match for a while so a dropped connection can resume it.
      player.connected = false;
      player.input = { x: 0, y: 0 };
      room.grace.set(client.id, setTimeout(() => { room.grace.delete(client.id); removePlayer(client.id); }, reconnectGraceMs));
      if (room.host === client) room.host = [...room.clients][0] || null;
      broadcast(lobbyState());
      return;
    }
    removePlayer(client.id);
  }

  function startMatch() {
    if (room.running) return;
    room.running = true;
    clearTimeout(room.expire);
    broadcastState('start');
    let frames = 0;
    let previous = Date.now();
    room.timer = setInterval(() => {
      const now = Date.now();
      const dt = Math.min((now - previous) / 1000, 0.08);
      previous = now;
      if (!room.clients.size) return; // Everyone dropped: freeze the match while they may still reconnect.
      updateGame(room.state, dt);
      if (++frames % SNAPSHOT_EVERY === 0 || room.state.over) broadcastState('state');
      if (room.state.over) {
        clearInterval(room.timer);
        for (const timer of room.grace.values()) clearTimeout(timer);
        room.grace.clear();
        room.expire = setTimeout(() => destroy(4002, 'Partida encerrada'), endedRoomMs);
      }
    }, 1000 / TICK);
  }

  function handle(client, raw) {
    if (destroyed || !client.open) return;
    const now = Date.now();
    if (now - client.rateWindow > 1000) { client.rateWindow = now; client.messages = 0; }
    if (++client.messages > MAX_MESSAGES_PER_SECOND) return;
    if (typeof raw !== 'string' || raw.length > MAX_MESSAGE_CHARS) return;
    let message;
    try { message = JSON.parse(raw); } catch { return; }
    if (!message || typeof message !== 'object' || Array.isArray(message)) return;
    if (message.type === 'ping') {
      return Number.isFinite(message.t) && send(client, { type: 'pong', t: message.t });
    }
    const entering = ['create', 'join', 'resume'].includes(message.type);
    // Native clients ship on their own schedule: refuse a different wire format instead of misreading it.
    // Web clients from before versioning send no `v` and speak version 1.
    if (entering && (message.v ?? 1) !== PROTOCOL_VERSION) {
      return send(client, { type: 'error', code: 'PROTOCOL_MISMATCH', message: 'Atualize o jogo para jogar online.' });
    }
    if (entering && client.joined) return send(client, { type: 'error', message: 'Você já está em uma sala.' });
    if (['create', 'join', 'selectCharacter'].includes(message.type)
      && (message.color !== undefined || message.type === 'selectCharacter')
      && (!Number.isInteger(message.color) || message.color < 0 || message.color >= SPELLS.length)) {
      return send(client, { type: 'error', message: 'Personagem inválido.' });
    }
    const active = client.joined ? room : null;
    const player = active?.state.players[client.id];
    if (['create', 'join', 'selectCharacter'].includes(message.type) && message.color === AURORA
      && !(message.type === 'selectCharacter' ? player?.auroraUnlocked : message.unlocks?.aurora === true)) {
      return send(client, { type: 'error', code: 'CHARACTER_LOCKED', message: 'Vença o modo Clássico para desbloquear o Guardião da Aurora.' });
    }
    if (['create', 'join', 'selectCharacter'].includes(message.type) && message.color === GOD
      && !(message.type === 'selectCharacter' ? player?.godUnlocked : message.unlocks?.god === true)) {
      return send(client, { type: 'error', code: 'CHARACTER_LOCKED', message: 'Compre The God no Grimório para desbloqueá-lo.' });
    }

    if (message.type === 'create') {
      if (room) return send(client, { type: 'error', message: 'Esta sala já foi criada.' });
      // The endless ritual is an unlock: only a host who bought it can open one.
      const requested = campaignId(message.campaign);
      const campaign = requested === 'endless' && !sanitizeMeta(message.meta).endless ? 'quick' : requested;
      room = { code: roomCode, host: null, clients: new Set(), sessions: new Map(), grace: new Map(),
        state: createGameState(campaign, { curses: sanitizeCurses(message.curses) }), running: false,
        visibility: message.visibility === 'open' ? 'open' : 'closed', timer: null, expire: null };
      room.expire = setTimeout(() => { if (!room.running) destroy(4001, 'Sala expirou antes da batalha'); }, lobbyIdleMs);
      join(client, message.name, message.color, message.meta, message.loadout, message.unlocks);
      if (!client.joined) destroy();
    } else if (message.type === 'join') {
      if (room && inThisRoom(message)) join(client, message.name, message.color, message.meta, message.loadout, message.unlocks);
      else send(client, { type: 'error', message: 'Sala não encontrada.' });
    } else if (message.type === 'resume') {
      resume(client, message);
    } else if (message.type === 'selectCharacter' && active) {
      if (active.running || active.state.over) return send(client, { type: 'error', message: 'O personagem só pode ser trocado antes da batalha.' });
      if (Object.values(active.state.players).some(p => p.id !== client.id && p.color === message.color)) return characterTaken(client);
      selectPlayerCharacter(player, message.color);
      broadcast(lobbyState());
    } else if (message.type === 'start' && active?.host === client) {
      startMatch();
    } else if (message.type === 'ready' && active?.running) {
      send(client, { type: 'start', state: encodeState(active.state, client.id) });
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
      rerollPowers(player, Math.random, { coop: playerCount() > 1 });
    } else if (message.type === 'special' && active?.running) {
      activateSpecial(active.state, client.id);
    } else if (message.type === 'signal' && active?.running && player) {
      const at = Number.isFinite(message.x) && Number.isFinite(message.y) ? { x: message.x, y: message.y } : null;
      sendSignal(active.state, client.id, String(message.signal || ''), at);
    } else if (message.type === 'dash' && active?.running) {
      activateDash(active.state, client.id, { x: message.x, y: message.y });
    } else if (message.type === 'leave' && active) {
      leave(client, true);
    }
  }

  return {
    code: roomCode,
    get destroyed() { return destroyed; },
    /** Attach one peer. Returns the handles the transport drives, or null when the room is already gone. */
    connect(/** @type {Endpoint} */ endpoint) {
      if (destroyed) { endpoint.close(4002, 'Partida encerrada'); return null; }
      const client = { endpoint, open: true, joined: false, id: null, token: null, messages: 0, rateWindow: Date.now() };
      connections.add(client);
      return {
        receive: raw => handle(client, raw),
        disconnect() {
          if (!client.open) return;
          client.open = false;
          connections.delete(client);
          leave(client, false);
        }
      };
    },
    /** What the public room list shows, or null until the room has been created. */
    snapshot() {
      if (destroyed || !room) return null;
      return { code: roomCode, count: playerCount(), running: room.running, over: room.state.over, full: playerCount() >= MAX_PLAYERS,
        host: room.state.players[room.host?.id]?.name || 'Arcanista', campaign: room.state.campaign, curses: room.state.curses, visibility: room.visibility };
    },
    destroy
  };
}
