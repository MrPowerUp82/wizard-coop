# Multiplayer P2P (WebRTC) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the WebSocket co-op server with host-authoritative WebRTC peer-to-peer, so the game needs no server of ours.

**Architecture:** The browser that creates a room runs the authoritative simulation (`server/game.js`) through a transport-agnostic `server/room-host.js` (the old `server.js` minus I/O). The host plays through an in-memory loopback transport; guests connect over Trystero/WebRTC. `src/net.js` keeps its prediction/interpolation/resume logic and only swaps `new WebSocket(url)` for a transport factory. Open rooms are discovered by announcing on a shared Trystero "lobby" room.

**Tech Stack:** JavaScript (ES modules), Vite, `node --test`, `@trystero-p2p/torrent@0.26.0` (WebRTC signaling over public BitTorrent trackers).

**Spec:** `docs/superpowers/specs/2026-10-14-p2p-multiplayer-design.md`

## Global Constraints

- The wire protocol does not change: `server/protocol.js` and `PROTOCOL_VERSION = 1` are untouched; JSON message shapes (`create/join/resume/input/state/…`) stay identical.
- One new runtime dependency only: `@trystero-p2p/torrent` pinned to exactly `0.26.0`. `ws` and `@types/ws` are removed at the end.
- Only `src/p2p/room.js` imports the Trystero package. Everything else takes `openRoom` by injection so Node tests never load it.
- User-facing strings are Portuguese (pt-BR), matching the existing UI.
- Room code alphabet stays `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, length 6; max 4 players.
- Timings kept from the server: reconnect grace 30 s, lobby idle 20 min, ended-room 90 s, tick 30 Hz, snapshot every 2 ticks, 50 messages/s per client, 4096 characters per message.
- Close codes: 4001 room expired, 4002 match ended, 4003 host left, 4004 room not found. Codes ≥ 4000 make `net.js` stop retrying; 1006 makes it retry.
- ESLint rules: `prefer-const`, `eqeqeq` (smart), `no-var`, unused vars must start with `_`. `npm run check` (lint + typecheck + test) must pass at the end of every task.
- Every commit message ends with the repository's co-author trailer from the session instructions.

## Review Focus

Failure modes the spec implies but a happy-path test would miss, most likely first. Each has a test in the task named.

1. A guest joins with a wrong/lower-case code, or before the host has sent `create`: expect "Sala não encontrada." and no crash (Task 1, Task 5).
2. The host closes the tab or leaves: every guest must end at once with code 4003 and "O anfitrião saiu.", not retry for a minute (Task 5).
3. A guest's connection drops and comes back with a **new peer id**: the host must match it by token and restore the same character, including through `createSession`'s automatic retry (Task 5).
4. A malicious guest sends non-string frames, oversized strings, floods, or frames before `hello`: all ignored, room untouched (Task 1, Task 5).
5. Lobby announcements come from untrusted peers: oversized names, markup, bad codes, wrong counts must be sanitized before the menu renders them (Task 4).

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `server/room-host.js` | create | One room's rules: lobby, create/join/resume/leave, validation, rate limit, tick, snapshots. `createRoomHost(options)` |
| `server/test-support.js` | create | `createInbox()` and `startRoom(t, options)`: in-memory clients for tests |
| `server/room-host.test.js` | create (git mv of `server.test.js`) | Room-host behaviour tests |
| `server/network.test.js`, `server/characters.test.js` | modify | Run against `startRoom` instead of a spawned server |
| `src/p2p/transport.js` | create | Transport contract, `createTransport`, `loopbackPair`, `attachTransport` |
| `src/p2p/channel.js` | create | `channel(room, namespace)` wrapper over a Trystero action |
| `src/p2p/room.js` | create | `openRoom(roomId, { passive })`: the only Trystero import |
| `src/p2p/lobby.js` | create | `sanitizeAnnouncement`, `announceRooms`, `watchRooms` |
| `src/p2p/host.js` | create | `createCode`, `roomId`, `serveRoom`, `hostRoom` |
| `src/p2p/guest.js` | create | `guestTransport(room, options)` |
| `src/p2p/fake-room.js`, `src/p2p/test-support.js` | create | In-memory Trystero stand-in and async test helpers (tests only) |
| `src/p2p/*.test.js` | create | transport, net, lobby, p2p tests |
| `src/net.js` | modify | `createSession(connect, entry, handlers)` |
| `src/main.js`, `src/menu.js`, `index.html` | modify | Host/guest wiring, room list, remove server settings |
| `server/server.js`, `ws` | delete | Gone |
| `package.json`, `eslint.config.js`, `jsconfig.json`, `.claude/launch.json` | modify | Scripts, lint/type scopes |
| `README.md`, `RELEASE_NOTES.md`, `platforms/switch/README.md`, `src/terrain.js`, spec | modify | Documentation |

---

### Task 1: Extract `server/room-host.js` and migrate the server tests

**Files:**
- Create: `server/room-host.js`, `server/test-support.js`
- Rename + rewrite: `server/server.test.js` → `server/room-host.test.js`
- Modify: `server/network.test.js`, `server/characters.test.js`, `jsconfig.json`

**Interfaces:**
- Produces:
  - `createRoomHost({ code, reconnectGraceMs?, lobbyIdleMs?, endedRoomMs?, onDestroy?(code, closeCode, reason) })` returning `{ code, destroyed, connect(endpoint), snapshot(), destroy(closeCode?, reason?) }`.
  - `endpoint`: `{ send(raw: string), close(code?, reason?), congested?(): boolean }`. `connect` returns `{ receive(raw), disconnect() }`, or `null` (after closing the endpoint with 4002) if the host was destroyed.
  - `snapshot()`: `null` before `create`, else `{ code, count, running, over, full, host, campaign, curses, visibility }`.
  - `MAX_PLAYERS = 4`.
  - `server/test-support.js`: `createInbox()` → `{ push(msg), notify(), has(type), drain(type), receive(type, predicate?, timeoutMs?), until(condition, timeoutMs?, what?) }`; `startRoom(t, options?)` → `{ host, connect(), destroy() }` where `connect()` returns a client `{ send(objOrString), terminate(), closed, receive, drain, has, closedWith(timeoutMs?) }`.

- [ ] **Step 1: Write the test helper**

Create `server/test-support.js`:

```js
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
```

- [ ] **Step 2: Write the failing room-host tests**

Run: `git mv server/server.test.js server/room-host.test.js`, then replace its whole content with:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { PROTOCOL_VERSION, decodeState } from './protocol.js';
import { startRoom } from './test-support.js';

test('sala tolera mensagens inválidas e preserva a sala após entrada duplicada', { timeout: 10000 }, async t => {
  const { connect } = startRoom(t);
  const client = connect();
  client.send('null');
  client.send('{');
  client.send('[]');
  client.send({ type: 'create', name: { unexpected: true } });
  const joined = await client.receive('joined');
  client.send({ type: 'create' });
  assert.match((await client.receive('error')).message, /já está/);
  client.send({ type: 'start' });
  const started = decodeState((await client.receive('start')).state);
  assert.equal(Object.keys(started.players).length, 1);
  assert.equal(started.players[joined.playerId].name, 'Arcanista');
  client.send({ type: 'special', playerId: joined.playerId, specialCharge: 100 });
  const state = decodeState((await client.receive('state')).state);
  assert.equal(state.players[joined.playerId].specialCharge, 0);
  assert.ok(state.shots.every(shot => !shot.special));
});

test('o snapshot da sala só existe depois de criada e reflete visibilidade, ocupação e andamento', { timeout: 10000 }, async t => {
  const closed = startRoom(t);
  assert.equal(closed.host.snapshot(), null);
  const hidden = closed.connect();
  hidden.send({ type: 'create', name: 'Oculto', visibility: 'closed' });
  await hidden.receive('joined');
  assert.equal(closed.host.snapshot().visibility, 'closed');

  const open = startRoom(t);
  const owner = open.connect();
  owner.send({ type: 'create', name: 'Merlin', visibility: 'open' });
  const created = await owner.receive('joined');
  assert.deepEqual(open.host.snapshot(), { code: 'ABC234', count: 1, running: false, over: false, full: false, host: 'Merlin',
    campaign: 'quick', curses: [], visibility: 'open' });
  owner.send({ type: 'start' });
  await owner.receive('start');
  assert.equal(open.host.snapshot().running, true);
  const ally = open.connect();
  ally.send({ type: 'join', room: created.room, name: 'Aliado' });
  await ally.receive('joined');
  ally.send({ type: 'ready' });
  assert.equal(Object.keys(decodeState((await ally.receive('start')).state).players).length, 2);
  assert.equal(open.host.snapshot().count, 2);
});

test('sala lotada recusa o quinto jogador e libera a vaga quando alguém sai', { timeout: 10000 }, async t => {
  const { host, connect } = startRoom(t);
  const owner = connect();
  owner.send({ type: 'create', visibility: 'open' });
  const { room } = await owner.receive('joined');
  const players = [owner];
  for (let n = 0; n < 3; n++) {
    const guest = connect();
    guest.send({ type: 'join', room });
    await guest.receive('joined');
    players.push(guest);
  }
  assert.equal(host.snapshot().full, true);
  const extra = connect();
  extra.send({ type: 'join', room });
  assert.match((await extra.receive('error')).message, /cheia/);
  players[3].terminate();
  assert.equal(host.snapshot().full, false);
  extra.send({ type: 'join', room });
  assert.equal((await extra.receive('joined')).count, 4);
});

test('recusa cliente de outra versão do protocolo', { timeout: 10000 }, async t => {
  const { connect } = startRoom(t);
  const client = connect();
  client.send({ type: 'create', v: PROTOCOL_VERSION + 1 });
  const error = await client.receive('error');
  assert.equal(error.code, 'PROTOCOL_MISMATCH');
  assert.match(error.message, /Atualize/);
  client.send({ type: 'create', v: PROTOCOL_VERSION, name: 'Ana' });
  assert.ok((await client.receive('joined')).playerId);
});

test('entrar antes da criação ou com código errado devolve sala não encontrada; o código ignora maiúsculas', { timeout: 10000 }, async t => {
  const { connect } = startRoom(t);
  const early = connect();
  early.send({ type: 'join', room: 'ABC234' });
  assert.match((await early.receive('error')).message, /não encontrada/);
  const owner = connect();
  owner.send({ type: 'create' });
  await owner.receive('joined');
  early.send({ type: 'join', room: 'ZZZZZZ' });
  assert.match((await early.receive('error')).message, /não encontrada/);
  early.send({ type: 'join', room: 'abc234' });
  assert.ok((await early.receive('joined')).playerId);
});

test('descarta mensagens grandes demais e o excesso de mensagens por segundo', { timeout: 10000 }, async t => {
  const { connect, host } = startRoom(t);
  const client = connect();
  client.send(JSON.stringify({ type: 'create', name: 'x'.repeat(5000) }));
  client.send({ type: 'ping', t: 1 });
  assert.equal((await client.receive('pong')).t, 1);
  assert.equal(host.snapshot(), null, 'a mensagem grande não criou a sala');
  for (let n = 0; n < 60; n++) client.send({ type: 'ping', t: n });
  assert.equal(client.drain('pong').length, 48, 'passam só 50 mensagens por segundo, contando as duas primeiras');
});

test('uma sala que nunca começa expira e avisa os clientes com o código 4001', { timeout: 10000 }, async t => {
  const { host, connect } = startRoom(t, { lobbyIdleMs: 150 });
  const client = connect();
  client.send({ type: 'create' });
  await client.receive('joined');
  assert.deepEqual(await client.closedWith(), { code: 4001, reason: 'Sala expirou antes da batalha' });
  assert.equal(host.destroyed, true);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test server/room-host.test.js`
Expected: FAIL — `Cannot find module './room-host.js'`.

- [ ] **Step 4: Write `server/room-host.js`**

```js
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
```

- [ ] **Step 5: Run the room-host tests**

Run: `node --test server/room-host.test.js`
Expected: PASS (7 tests).

- [ ] **Step 6: Port `server/network.test.js` to the helper**

Edit `server/network.test.js`:

1. Replace the imports (lines 1–6) and the whole `startServer` function (lines 8–35) with:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameState, createPlayer, publicState, updateGame } from './game.js';
import { VIEW_RADIUS, decodeState, encodeState } from './protocol.js';
import { startRoom } from './test-support.js';
```

2. Leave the tests `snapshot compacto preserva o que o cliente desenha…` and `snapshot compacto transmite a posição do familiar` exactly as they are.

3. Replace the four server-backed tests (`conexão caída mantém…`, `heartbeat derruba…`, `trocar poderes e entrar atrasado…`, `sala co-op leva maldições…`) with:

```js
test('conexão caída mantém o personagem e permite voltar com o token; saída voluntária libera na hora', { timeout: 15000 }, async t => {
  const { host: roomHost, connect } = startRoom(t, { reconnectGraceMs: 800 });
  const owner = connect();
  owner.send({ type: 'create', name: 'Anfitrião', color: 0 });
  const created = await owner.receive('joined');
  const guest = connect();
  guest.send({ type: 'join', room: created.room, name: 'Convidado', color: 1 });
  const joined = await guest.receive('joined');
  assert.ok(joined.token);
  owner.send({ type: 'start' });
  await guest.receive('start');

  guest.terminate();
  const waiting = await owner.receive('lobby', m => m.players.some(p => p.id === joined.playerId && !p.connected));
  assert.equal(waiting.count, 2);

  const back = connect();
  back.send({ type: 'resume', room: created.room, token: 'wrong' });
  assert.equal((await back.receive('error')).code, 'RESUME_FAILED');
  back.send({ type: 'resume', room: created.room, token: joined.token });
  const resumed = await back.receive('joined');
  assert.equal(resumed.resumed, true);
  assert.equal(resumed.playerId, joined.playerId);
  assert.equal(decodeState((await back.receive('start')).state).players[joined.playerId].connected, true);

  owner.drain('lobby');
  back.terminate();
  await owner.receive('lobby', m => m.count === 1);
  assert.equal(roomHost.snapshot().count, 1);

  const third = connect();
  third.send({ type: 'join', room: created.room, color: 2 });
  const late = await third.receive('joined');
  owner.drain('lobby');
  third.send({ type: 'leave' });
  await owner.receive('lobby', m => !m.players.some(p => p.id === late.playerId));
});

test('trocar poderes e entrar atrasado funcionam pela sala', { timeout: 15000 }, async t => {
  const { connect } = startRoom(t);
  const host = connect();
  host.send({ type: 'create', color: 0, meta: { reroll: 1, vigor: 99 } });
  const created = await host.receive('joined');
  host.send({ type: 'start' });
  const state = decodeState((await host.receive('start')).state);
  const me = state.players[created.playerId];
  assert.equal(me.rerolls, 2);
  assert.equal(me.maxHp, 130);
  const late = connect();
  late.send({ type: 'join', room: created.room, color: 3 });
  const joined = await late.receive('joined');
  late.send({ type: 'ready' });
  const lateState = decodeState((await late.receive('start')).state);
  const newcomer = lateState.players[joined.playerId];
  const anchor = lateState.players[created.playerId];
  assert.ok(Math.hypot(newcomer.x - anchor.x, newcomer.y - anchor.y) < 120);
  host.send({ type: 'reroll' });
  const after = decodeState((await host.receive('state')).state);
  assert.equal(after.players[created.playerId].rerolls, 2, 'sem escolha pendente a troca não é gasta');
});

test('sala co-op leva maldições, bloqueia o infinito sem desbloqueio, aplica loadout e repassa sinais', { timeout: 15000 }, async t => {
  const { connect } = startRoom(t);
  const host = connect();
  host.send({ type: 'create', color: 0, campaign: 'endless', curses: ['swarm', 'bogus'], meta: {}, loadout: { weapon: 'aura' } });
  const created = await host.receive('joined');
  const lobby = await host.receive('lobby');
  assert.equal(lobby.campaign, 'quick', 'infinito exige desbloqueio');
  assert.deepEqual(lobby.curses, ['swarm']);
  const guest = connect();
  guest.send({ type: 'join', room: created.room, color: 2, meta: { arsenal: 1, secondSpell: 1 }, loadout: { weapon: 'chain', special: 1 } });
  const joined = await guest.receive('joined');
  host.send({ type: 'start' });
  const state = decodeState((await host.receive('start')).state);
  assert.deepEqual(state.curses, ['swarm']);
  assert.equal(state.players[created.playerId].powers.aura, undefined);
  assert.equal(state.players[joined.playerId].powers.chain, 1);
  assert.equal(state.players[joined.playerId].specialVariant, 1);
  guest.send({ type: 'signal', signal: 'help' });
  const signalled = await host.receive('state', m => decodeState(m.state).events.some(event => event.kind === 'signal'));
  const event = decodeState(signalled.state).events.find(e => e.kind === 'signal');
  assert.equal(event.player, joined.playerId);
  assert.equal(event.signal, 'help');

  const other = startRoom(t);
  const unlocked = other.connect();
  unlocked.send({ type: 'create', color: 1, campaign: 'endless', meta: { endless: 1 } });
  await unlocked.receive('joined');
  assert.equal((await unlocked.receive('lobby')).campaign, 'endless');
});
```

- [ ] **Step 7: Port `server/characters.test.js`**

Replace the whole file with:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeState } from './protocol.js';
import { startRoom } from './test-support.js';

test('personagens escolhidos são únicos por sala, trocáveis no lobby e liberados ao sair', { timeout: 10000 }, async t => {
  const { host: roomHost, connect } = startRoom(t);
  const host = connect();
  for (const color of [-1, 7, 1.5, '2', null, {}, []]) {
    host.send({ type: 'create', color });
    assert.match((await host.receive('error')).message, /inválido/);
  }
  assert.equal(roomHost.snapshot(), null, 'entradas inválidas não criam a sala');
  for (const unlocks of [undefined, { aurora: false }, { aurora: 'true' }]) {
    host.send({ type: 'create', color: 5, unlocks });
    assert.equal((await host.receive('error')).code, 'CHARACTER_LOCKED');
  }
  for (const unlocks of [undefined, { god: false }, { god: 'true' }]) {
    host.send({ type: 'create', color: 6, unlocks });
    assert.equal((await host.receive('error')).code, 'CHARACTER_LOCKED');
  }
  assert.equal(roomHost.snapshot(), null, 'personagens bloqueados não criam a sala');
  host.send({ type: 'create', color: 2 });
  const created = await host.receive('joined');
  assert.equal(created.color, 2);
  const firstLobby = await host.receive('lobby');
  assert.equal(firstLobby.players[0].color, 2);
  assert.equal(firstLobby.hostId, created.playerId);
  host.send({ type: 'selectCharacter', color: 5, unlocks: { aurora: true } });
  assert.equal((await host.receive('error')).code, 'CHARACTER_LOCKED');
  host.send({ type: 'selectCharacter', color: 6, unlocks: { god: true } });
  assert.equal((await host.receive('error')).code, 'CHARACTER_LOCKED');

  const guest = connect();
  guest.send({ type: 'join', room: created.room, color: 2 });
  const taken = await guest.receive('error');
  assert.equal(taken.code, 'CHARACTER_TAKEN');
  assert.deepEqual(taken.players.map(p => p.color), [2]);
  // Retry uses the same connection; a rejected entry did not reserve a slot.
  guest.send({ type: 'join', room: created.room, color: 1 });
  const joined = await guest.receive('joined');
  assert.equal(joined.color, 1); assert.equal(joined.count, 2);
  guest.send({ type: 'selectCharacter', color: 2 });
  assert.equal((await guest.receive('error')).code, 'CHARACTER_TAKEN');
  guest.send({ type: 'selectCharacter', color: 3 });
  const changed = await host.receive('lobby', m => m.players.some(p => p.id === joined.playerId && p.color === 3));
  assert.equal(new Set(changed.players.map(p => p.color)).size, 2);

  // Two requests for one free character cannot both succeed.
  const a = connect(); const b = connect();
  a.send({ type: 'join', room: created.room, color: 0 });
  const aJoined = await a.receive('joined');
  b.send({ type: 'join', room: created.room, color: 0 });
  assert.equal((await b.receive('error')).code, 'CHARACTER_TAKEN');
  a.terminate();
  await host.receive('lobby', m => m.count === 2 && !m.players.some(p => p.id === aJoined.playerId));
  b.send({ type: 'join', room: created.room, color: 0 });
  assert.equal((await b.receive('joined')).color, 0);

  // Uniqueness is scoped to the room, not to the whole process.
  const other = startRoom(t);
  const otherHost = other.connect();
  otherHost.send({ type: 'create', color: 5, unlocks: { aurora: true } });
  const secretHost = await otherHost.receive('joined');
  assert.equal(secretHost.color, 5);
  otherHost.send({ type: 'selectCharacter', color: 2 });
  await otherHost.receive('lobby', m => m.players[0].color === 2);
  otherHost.send({ type: 'selectCharacter', color: 4 });
  await otherHost.receive('lobby', m => m.players[0].color === 4);
  otherHost.send({ type: 'start' });
  const secretState = decodeState((await otherHost.receive('start')).state);
  assert.equal(secretState.players[secretHost.playerId].maxHp, 500);
  host.send({ type: 'start' });
  const started = decodeState((await host.receive('start')).state);
  assert.equal(started.players[created.playerId].color, 2);
  assert.equal(started.players[joined.playerId].color, 3);
  guest.send({ type: 'selectCharacter', color: 1 });
  assert.match((await guest.receive('error')).message, /antes da batalha/);
  const state = decodeState((await guest.receive('state')).state);
  assert.equal(state.players[joined.playerId].color, 3);
  const late = connect();
  late.send({ type: 'join', room: created.room, color: 3 });
  assert.equal((await late.receive('error')).code, 'CHARACTER_TAKEN');
  late.send({ type: 'join', room: created.room, color: 1 });
  const lateJoined = await late.receive('joined');
  late.send({ type: 'ready' });
  assert.equal(decodeState((await late.receive('start')).state).players[lateJoined.playerId].color, 1);
});
```

- [ ] **Step 8: Exclude the helper from type-checking**

In `jsconfig.json`, replace the `exclude` array with:

```json
  "exclude": [
    "server/**/*.test.js",
    "server/test-support.js",
    "src/**/*.test.js",
    "src/p2p/test-support.js",
    "src/p2p/fake-room.js",
    "dist",
    "node_modules"
  ]
```

- [ ] **Step 9: Run the whole suite**

Run: `npm run check`
Expected: lint, typecheck and `node --test server/*.test.js` all pass. (`server/server.js` still exists and is untouched; no test spawns it any more.)

- [ ] **Step 10: Commit**

```bash
git add server/room-host.js server/test-support.js server/room-host.test.js server/network.test.js server/characters.test.js jsconfig.json
git commit -m "refactor: extract transport-agnostic room host and migrate server tests"
```

---

### Task 2: Transport contract and loopback

**Files:**
- Create: `src/p2p/transport.js`, `src/p2p/test-support.js`, `src/p2p/transport.test.js`
- Modify: `package.json` (test script)

**Interfaces:**
- Consumes: `createRoomHost` from Task 1 (`roomHost.connect(endpoint)` → `{ receive, disconnect } | null`), `createInbox` from `server/test-support.js`.
- Produces:
  - `createTransport({ onSend?(raw), onLocalClose?(code, reason) })` → transport `{ readyState (0|1|3), onopen, onmessage({data}), onclose({code,reason}), onerror, send(raw), close(code?, reason?), _open(), _receive(data), _finish(code, reason) }`. `send` is a no-op unless open. `close` runs `onLocalClose` then finishes. `_receive` delivers in any non-closed state.
  - `loopbackPair()` → `[client, server]` transports wired in memory (open on a microtask, messages delivered on microtasks, `close` propagates to the other end).
  - `attachTransport(roomHost, transport)` → link or `null`; wires `transport.onmessage → link.receive` and `transport.onclose → link.disconnect`.
  - `CONNECTING = 0`, `OPEN = 1`, `CLOSED = 3`.
  - `src/p2p/test-support.js`: `waitFor(condition, timeoutMs?)`, `openInbox(transport)` → inbox `{ ...createInbox(), transport, closed, send(obj) }` resolved once the transport is open or closed.

- [ ] **Step 1: Write the failing test**

Create `src/p2p/test-support.js`:

```js
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
```

Create `src/p2p/transport.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoomHost } from '../../server/room-host.js';
import { attachTransport, createTransport, loopbackPair } from './transport.js';
import { openInbox, waitFor } from './test-support.js';

test('loopback entrega as mensagens em ordem e só depois de abrir', async () => {
  const [client, server] = loopbackPair();
  client.send('perdida');
  assert.equal(client.readyState, 0);
  const received = [];
  server.onmessage = ({ data }) => received.push(data);
  await waitFor(() => client.readyState === 1 && server.readyState === 1);
  client.send('a'); client.send('b'); server.send('c');
  const echoed = [];
  client.onmessage = ({ data }) => echoed.push(data);
  await waitFor(() => received.length === 2 && echoed.length === 1);
  assert.deepEqual(received, ['a', 'b']);
  assert.deepEqual(echoed, ['c']);
});

test('fechar um lado fecha o outro com o mesmo código e motivo, e depois disso nada é entregue', async () => {
  const [client, server] = loopbackPair();
  await waitFor(() => client.readyState === 1);
  const closes = [];
  client.onclose = event => closes.push(['client', event.code, event.reason]);
  server.onclose = event => closes.push(['server', event.code, event.reason]);
  server.close(4003, 'O anfitrião saiu.');
  await waitFor(() => closes.length === 2);
  assert.deepEqual(closes.sort(), [['client', 4003, 'O anfitrião saiu.'], ['server', 4003, 'O anfitrião saiu.']]);
  assert.equal(client.readyState, 3);
  const after = [];
  client.onmessage = ({ data }) => after.push(data);
  server.send('tarde');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(after, []);
});

test('createTransport entrega mensagens enquanto conecta e nunca depois de fechar', () => {
  const transport = createTransport();
  const got = [];
  transport.onmessage = ({ data }) => got.push(data);
  transport._receive('antes de abrir');
  transport._open();
  transport._receive('aberto');
  transport._finish(1006, 'x');
  transport._receive('depois de fechar');
  assert.deepEqual(got, ['antes de abrir', 'aberto']);
  assert.equal(transport.readyState, 3);
});

test('attachTransport liga o transporte a uma sala: criar, jogar e sair do lado do cliente remove o jogador', async t => {
  const roomHost = createRoomHost({ code: 'ABC234' });
  t.after(() => roomHost.destroy());
  const [clientEnd, serverEnd] = loopbackPair();
  assert.ok(attachTransport(roomHost, serverEnd));
  const client = await openInbox(clientEnd);
  client.send({ type: 'create', name: 'Ana' });
  const joined = await client.receive('joined');
  assert.equal(joined.room, 'ABC234');
  assert.equal(roomHost.snapshot().count, 1);
  clientEnd.close(1000, 'bye');
  await waitFor(() => roomHost.destroyed);
});

test('attachTransport em uma sala já destruída fecha o transporte com 4002', async () => {
  const roomHost = createRoomHost({ code: 'ABC234' });
  roomHost.destroy();
  const [clientEnd, serverEnd] = loopbackPair();
  assert.equal(attachTransport(roomHost, serverEnd), null);
  const client = await openInbox(clientEnd);
  await waitFor(() => client.closed);
  assert.equal(client.closed.code, 4002);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test src/p2p/transport.test.js`
Expected: FAIL — cannot find `./transport.js`.

- [ ] **Step 3: Implement `src/p2p/transport.js`**

```js
/**
 * A transport is the subset of WebSocket that net.js and the room host rely on:
 * readyState (0 connecting, 1 open, 3 closed), send(string), close(code, reason) and the
 * onopen / onmessage({ data }) / onclose({ code, reason }) / onerror callbacks.
 */
export const CONNECTING = 0;
export const OPEN = 1;
export const CLOSED = 3;

/**
 * Builds a transport. `onSend` ships a string to the other side; `onLocalClose` tells the other side that
 * this side closed. The underscore methods are for whoever implements the other side of the wire.
 * @param {{ onSend?: (raw: string) => void, onLocalClose?: (code: number, reason: string) => void }} [hooks]
 */
export function createTransport({ onSend = () => {}, onLocalClose = () => {} } = {}) {
  const transport = {
    readyState: CONNECTING,
    /** @type {null | (() => void)} */ onopen: null,
    /** @type {null | ((event: { data: string }) => void)} */ onmessage: null,
    /** @type {null | ((event: { code: number, reason: string }) => void)} */ onclose: null,
    /** @type {null | (() => void)} */ onerror: null,
    send(/** @type {string} */ raw) { if (transport.readyState === OPEN) onSend(raw); },
    close(code = 1000, reason = '') {
      if (transport.readyState === CLOSED) return;
      onLocalClose(code, reason);
      transport._finish(code, reason);
    },
    _open() {
      if (transport.readyState !== CONNECTING) return;
      transport.readyState = OPEN;
      transport.onopen?.();
    },
    _receive(/** @type {string} */ data) {
      if (transport.readyState !== CLOSED) transport.onmessage?.({ data });
    },
    _finish(/** @type {number} */ code, /** @type {string} */ reason) {
      if (transport.readyState === CLOSED) return;
      transport.readyState = CLOSED;
      transport.onclose?.({ code, reason });
    }
  };
  return transport;
}

/** Two transports joined in memory: what the host's own player uses to reach its own room. */
export function loopbackPair() {
  /** @type {any[]} */
  const ends = [];
  const make = index => createTransport({
    onSend: raw => queueMicrotask(() => ends[1 - index]._receive(raw)),
    onLocalClose: (code, reason) => queueMicrotask(() => ends[1 - index]._finish(code, reason))
  });
  ends.push(make(0), make(1));
  queueMicrotask(() => { ends[0]._open(); ends[1]._open(); });
  return /** @type {[ReturnType<typeof createTransport>, ReturnType<typeof createTransport>]} */ (ends);
}

/** Connects a transport (the server side of a pair) to a room host. Returns the host's link, or null if the room is gone. */
export function attachTransport(roomHost, transport) {
  const link = roomHost.connect({
    send: raw => transport.send(raw),
    close: (code, reason) => transport.close(code, reason)
  });
  if (!link) return null;
  transport.onmessage = ({ data }) => link.receive(data);
  transport.onclose = () => link.disconnect();
  return link;
}
```

- [ ] **Step 4: Include `src/p2p` tests in `npm test`**

In `package.json` change the `test` script to:

```json
    "test": "node --test server/*.test.js src/p2p/*.test.js",
```

- [ ] **Step 5: Run the tests**

Run: `node --test src/p2p/transport.test.js`
Expected: PASS (5 tests).

Run: `npm run check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/p2p/transport.js src/p2p/test-support.js src/p2p/transport.test.js package.json
git commit -m "feat(p2p): add transport contract with in-memory loopback"
```

---

### Task 3: `net.js` takes a transport factory

**Files:**
- Modify: `src/net.js`
- Create: `src/p2p/net.test.js`

**Interfaces:**
- Consumes: `loopbackPair`, `attachTransport` (Task 2); `createRoomHost` (Task 1); `waitFor` (Task 2).
- Produces: `createSession(connect, entry, handlers)` where `connect(resume: boolean)` returns a transport (called again with `true` on every automatic resume attempt). `savedSession()` now returns `{ room, token, at }` (no `url`). Sessions are remembered only when `entry.action === 'join'`. Transport failure message: "Não foi possível conectar à sala."

- [ ] **Step 1: Write the failing test**

Create `src/p2p/net.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoomHost } from '../../server/room-host.js';
import { createSession } from '../net.js';
import { attachTransport, loopbackPair } from './transport.js';
import { waitFor } from './test-support.js';

const entry = (action, extra = {}) => ({ action, code: 'ABC234', visibility: 'closed', name: 'Ana', color: 0, meta: {}, campaign: 'quick',
  curses: [], loadout: {}, unlocks: {}, ...extra });

test('createSession entra, inicia a partida e entrega quadros interpolados por loopback', async t => {
  const roomHost = createRoomHost({ code: 'ABC234' });
  t.after(() => roomHost.destroy());
  const events = [];
  const session = createSession(() => {
    const [client, server] = loopbackPair();
    attachTransport(roomHost, server);
    return client;
  }, entry('create'), {
    onJoined: message => events.push(['joined', message.room]),
    onLobby: () => events.push(['lobby']),
    onStart: () => events.push(['start']),
    onClosed: event => events.push(['closed', event.code])
  });
  await waitFor(() => events.some(([name]) => name === 'lobby'));
  assert.deepEqual(events[0], ['joined', 'ABC234']);
  assert.equal(session.frame(performance.now(), 0.016, { x: 0, y: 0 }), null, 'sem snapshot ainda não há quadro');
  session.send({ type: 'start' });
  await waitFor(() => session.inGame && session.hasState);
  const view = session.frame(performance.now(), 0.016, { x: 0, y: 0 });
  assert.ok(view.players[session.playerId]);
  session.close();
  await waitFor(() => roomHost.destroyed);
});

test('createSession avisa transporte inválido sem derrubar quem chamou', () => {
  const errors = [];
  createSession(() => { throw new Error('sem WebRTC'); }, entry('join'), { onError: error => errors.push(error) });
  assert.equal(errors.length, 1);
  assert.equal(errors[0].transport, true);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test src/p2p/net.test.js`
Expected: FAIL — `createSession` treats the function as a URL (`new WebSocket` is not defined in Node, or the error handler is not called).

- [ ] **Step 3: Edit `src/net.js`**

Make these exact edits.

1. Replace the doc block and signature (lines 29–33):

```js
/**
 * One co-op connection: lobby messages, a snapshot buffer rendered ~100ms in the past,
 * client-side prediction for the local player and automatic resume after a dropped connection.
 * `connect(resume)` returns a transport (see src/p2p/transport.js) and is called again on every resume attempt.
 */
export function createSession(connect, entry, handlers) {
```

2. Replace the first lines of `open`:

```js
  function open(resume) {
    let ws;
    try { ws = connect(resume); } catch { handlers.onError?.({ message: 'Não foi possível iniciar a conexão.', transport: true }); return; }
```

3. Replace the `ws.onerror` line:

```js
    ws.onerror = () => { if (socket === ws && !inGame) handlers.onError?.({ message: 'Não foi possível conectar à sala.', transport: true }); };
```

4. In `receive`, replace the `rememberSession` line (the one inside the `start`/`state` branch) with:

```js
      if (session.token && entry.action === 'join') rememberSession(over ? null : { room: session.room, token: session.token });
```

(The host's own room cannot be resumed after a reload, so only guests remember a session.)

- [ ] **Step 4: Run the tests**

Run: `node --test src/p2p/net.test.js`
Expected: PASS (2 tests).

Run: `npm run check`
Expected: PASS. If `tsc` complains that `connect` is used before assignment, annotate with `/** @param {(resume: boolean) => any} connect */` above `createSession`.

- [ ] **Step 5: Commit**

```bash
git add src/net.js src/p2p/net.test.js
git commit -m "refactor(net): create sessions from a transport factory instead of a WebSocket URL"
```

---

### Task 4: Channel wrapper, fake swarm and the public room list

**Files:**
- Create: `src/p2p/channel.js`, `src/p2p/fake-room.js`, `src/p2p/lobby.js`, `src/p2p/lobby.test.js`

**Interfaces:**
- Consumes: `waitFor` (Task 2), `campaignId` (`server/campaign.js`), `sanitizeCurses` (`server/curses.js`).
- Produces:
  - `channel(room, namespace)` → `{ send(data, peerId?) : Promise<void>, onMessage(handler(data, peerId)) }`.
  - `createFakeSwarm()` → `{ openRoom(roomId, options?), sever(room) }`. A fake room has `selfId`, `peers`, `makeAction(ns)` → `{ send(data, { target }?), onMessage }`, `onPeerJoin`, `onPeerLeave`, `leave()`. Peers discover each other on a `setTimeout(0)`; `send` delivers on a microtask to connected peers; `leave()` fires `onPeerLeave` on the others; `sever(room)` disconnects `room` from every peer and fires `onPeerLeave` on both sides.
  - `LOBBY_ROOM = 'arcana-lobby'`, `ANNOUNCE_EVERY_MS = 3000`, `ROOM_TTL_MS = 8000`.
  - `sanitizeAnnouncement(info)` → `{ code, count, running, host, campaign, curses } | null`.
  - `announceRooms({ openRoom, snapshot, intervalMs? })` → `{ stop() }` (announces only while `snapshot()` is open, not over, not full).
  - `watchRooms({ openRoom, onUpdate(list), ttlMs?, now? })` → `{ stop() }` (joins with `{ passive: true }`; `onUpdate` only when the list changes; entries expire after `ttlMs` without a new announcement).

- [ ] **Step 1: Write the failing test**

Create `src/p2p/lobby.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeSwarm } from './fake-room.js';
import { LOBBY_ROOM, announceRooms, sanitizeAnnouncement, watchRooms } from './lobby.js';
import { waitFor } from './test-support.js';

const open = { code: 'ABC234', count: 1, running: false, over: false, full: false, host: 'Merlin', campaign: 'quick', curses: [], visibility: 'open' };

test('sanitizeAnnouncement aceita um anúncio válido e normaliza os campos', () => {
  assert.deepEqual(sanitizeAnnouncement({ code: 'abc234', count: 2, running: true, host: 'Merlin', campaign: 'quick', curses: ['swarm'] }),
    { code: 'ABC234', count: 2, running: true, host: 'Merlin', campaign: 'quick', curses: ['swarm'] });
});

test('sanitizeAnnouncement rejeita lixo vindo da rede e limita o que a interface vai desenhar', () => {
  for (const bad of [null, 'x', 42, [], {}, { code: '<img src=x>' }, { code: 'AB' }, { code: 'ABCDEFGHIJ' }, { code: { toString: () => 'ABC234' } }]) {
    assert.equal(sanitizeAnnouncement(bad), null, JSON.stringify(bad));
  }
  const clean = sanitizeAnnouncement({ code: 'ABC234', count: 99, running: 'yes', host: '<b>'.repeat(40), campaign: 'nope', curses: ['bogus', 'swarm'] });
  assert.equal(clean.count, 4);
  assert.equal(clean.running, false);
  assert.ok(clean.host.length <= 16);
  assert.equal(clean.campaign, 'quick');
  assert.deepEqual(clean.curses, ['swarm']);
  assert.equal(sanitizeAnnouncement({ code: 'ABC234', count: -3, host: 7 }).count, 0);
});

test('o menu vê a sala aberta anunciada pelo anfitrião e deixa de vê-la quando ela expira', { timeout: 10000 }, async t => {
  const swarm = createFakeSwarm();
  let snapshot = open;
  const announcer = announceRooms({ openRoom: swarm.openRoom, snapshot: () => snapshot, intervalMs: 40 });
  const lists = [];
  const watcher = watchRooms({ openRoom: swarm.openRoom, onUpdate: list => lists.push(list), ttlMs: 250 });
  t.after(() => { announcer.stop(); watcher.stop(); });
  await waitFor(() => lists.some(list => list.length === 1));
  assert.deepEqual(lists.find(list => list.length === 1), [{ code: 'ABC234', count: 1, running: false, host: 'Merlin', campaign: 'quick', curses: [] }]);
  snapshot = { ...open, full: true };
  await waitFor(() => lists.at(-1).length === 0, 3000);
});

test('salas fechadas, em andamento encerrado ou sem snapshot nunca são anunciadas', { timeout: 10000 }, async t => {
  const swarm = createFakeSwarm();
  const seen = [];
  const watcher = watchRooms({ openRoom: swarm.openRoom, onUpdate: list => seen.push(list) });
  const announcers = [null, { ...open, visibility: 'closed' }, { ...open, over: true }].map(snapshot =>
    announceRooms({ openRoom: swarm.openRoom, snapshot: () => snapshot, intervalMs: 30 }));
  t.after(() => { watcher.stop(); for (const announcer of announcers) announcer.stop(); });
  await new Promise(resolve => setTimeout(resolve, 250));
  assert.deepEqual(seen, []);
});

test('o observador entra no lobby como passivo e anúncios malformados são ignorados', { timeout: 10000 }, async t => {
  const swarm = createFakeSwarm();
  const joined = [];
  const spy = (roomId, options) => { joined.push([roomId, options]); return swarm.openRoom(roomId, options); };
  const lists = [];
  const watcher = watchRooms({ openRoom: spy, onUpdate: list => lists.push(list) });
  t.after(() => watcher.stop());
  assert.deepEqual(joined, [[LOBBY_ROOM, { passive: true }]]);
  const rogue = swarm.openRoom(LOBBY_ROOM);
  const rooms = rogue.makeAction('rooms');
  await new Promise(resolve => setTimeout(resolve, 20));
  await rooms.send({ code: '<script>', count: 1 });
  await rooms.send('texto solto');
  await rooms.send({ code: 'ZZZ999', count: 2, host: 'Real' });
  await waitFor(() => lists.length > 0);
  assert.deepEqual(lists.at(-1).map(room => room.code), ['ZZZ999']);
  rogue.leave();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test src/p2p/lobby.test.js`
Expected: FAIL — cannot find `./fake-room.js`.

- [ ] **Step 3: Implement `src/p2p/channel.js`**

```js
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
```

- [ ] **Step 4: Implement `src/p2p/fake-room.js`**

```js
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
```

- [ ] **Step 5: Implement `src/p2p/lobby.js`**

```js
import { campaignId } from '../../server/campaign.js';
import { sanitizeCurses } from '../../server/curses.js';
import { channel } from './channel.js';

export const LOBBY_ROOM = 'arcana-lobby';
export const ANNOUNCE_EVERY_MS = 3000;
export const ROOM_TTL_MS = 8000;

/** Announcements come from strangers and end up in the menu: keep only known shapes, short strings and bounded numbers. */
export function sanitizeAnnouncement(info) {
  if (!info || typeof info !== 'object' || Array.isArray(info) || typeof info.code !== 'string') return null;
  const code = info.code.slice(0, 8).toUpperCase();
  if (!/^[A-Z0-9]{4,8}$/.test(code) || info.code.length > 8) return null;
  const count = Number.isInteger(info.count) ? Math.max(0, Math.min(4, info.count)) : 0;
  return { code, count, running: info.running === true,
    host: (typeof info.host === 'string' ? info.host : '').slice(0, 16) || 'Arcanista',
    campaign: campaignId(info.campaign), curses: sanitizeCurses(info.curses) };
}

/**
 * Hosts of open rooms call this: while `snapshot()` says the room is listed (open, not over, not full)
 * it announces itself to everyone in the shared lobby room. Closed rooms never announce.
 */
export function announceRooms({ openRoom, snapshot, intervalMs = ANNOUNCE_EVERY_MS }) {
  let room = null;
  let rooms = null;
  const tick = () => {
    const info = snapshot();
    if (!info || info.visibility !== 'open' || info.over || info.full) return;
    if (!room) { room = openRoom(LOBBY_ROOM); rooms = channel(room, 'rooms'); }
    rooms.send({ code: info.code, count: info.count, running: info.running, host: info.host, campaign: info.campaign, curses: info.curses });
  };
  const timer = setInterval(tick, intervalMs);
  tick();
  return { stop() { clearInterval(timer); room?.leave(); room = null; } };
}

/**
 * The menu calls this while the join panel is open. Joins the lobby as a passive peer (it only connects to
 * announcers, not to other watchers) and reports the current list whenever it changes.
 */
export function watchRooms({ openRoom, onUpdate, ttlMs = ROOM_TTL_MS, now = Date.now }) {
  const room = openRoom(LOBBY_ROOM, { passive: true });
  const known = new Map();
  let last = '';
  const publish = () => {
    for (const [code, entry] of known) if (now() - entry.seen > ttlMs) known.delete(code);
    const list = [...known.values()].map(entry => ({ code: entry.code, count: entry.count, running: entry.running, host: entry.host,
      campaign: entry.campaign, curses: entry.curses }));
    const signature = JSON.stringify(list);
    if (signature === last) return;
    last = signature;
    onUpdate(list);
  };
  channel(room, 'rooms').onMessage(info => {
    const clean = sanitizeAnnouncement(info);
    if (!clean) return;
    known.set(clean.code, { ...clean, seen: now() });
    publish();
  });
  const timer = setInterval(publish, 1000);
  return { stop() { clearInterval(timer); room.leave(); } };
}
```

- [ ] **Step 6: Run the tests**

Run: `node --test src/p2p/lobby.test.js`
Expected: PASS (5 tests). If `lists.at(-1).length === 0` times out, the expiry timer period (1 s) plus `ttlMs: 250` needs up to ~1.3 s; the 3 s limit already covers it.

Run: `npm run check`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/p2p/channel.js src/p2p/fake-room.js src/p2p/lobby.js src/p2p/lobby.test.js
git commit -m "feat(p2p): add channel wrapper, fake swarm and the P2P open-room list"
```

---

### Task 5: Host and guest over the P2P room

**Files:**
- Create: `src/p2p/host.js`, `src/p2p/guest.js`, `src/p2p/p2p.test.js`

**Interfaces:**
- Consumes: `createRoomHost` (Task 1); `createTransport`, `loopbackPair`, `attachTransport` (Task 2); `createSession` (Task 3); `channel`, `createFakeSwarm`, `announceRooms` (Task 4); `openInbox`, `waitFor` (Task 2).
- Produces:
  - `host.js`: `createCode(random?)` (6 chars from the room alphabet), `roomId(code)` → `` `arcana:${code}` ``, `serveRoom(room, roomHost)` → `{ stop() }`, `hostRoom({ openRoom, code?, ...roomHostOptions })` → `{ code, roomHost, connect(), stop() }`. `connect()` returns the host player's loopback transport; closing it (or `stop()`, or `pagehide`) destroys the room with `4003 'O anfitrião saiu.'`.
  - `guest.js`: `guestTransport(room, { resume?, helloTimeoutMs? })` → transport. Opens when the host acks. No ack in time: for a first join it delivers `{"type":"error","message":"Sala não encontrada."}` then closes `4004`; for a resume it closes `1006 'O anfitrião saiu.'`. Host peer leaving closes `1006 'Conexão com o anfitrião perdida.'`. Host `close` control frames close with the host's code/reason.
  - Wire (private to these two files): action `ctl` carries `{ t: 'hello' }` (guest→host), `{ t: 'ack', code }` and `{ t: 'close', code, reason }` (host→guest); action `msg` carries the game JSON strings, host↔guest only.

- [ ] **Step 1: Write the failing tests**

Create `src/p2p/p2p.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeState } from '../../server/protocol.js';
import { createSession } from '../net.js';
import { channel } from './channel.js';
import { createFakeSwarm } from './fake-room.js';
import { guestTransport } from './guest.js';
import { createCode, hostRoom, roomId } from './host.js';
import { openInbox, waitFor } from './test-support.js';

const CODE = 'ABC234';

function setup(t, hostOptions = {}) {
  const swarm = createFakeSwarm();
  const hosting = hostRoom({ openRoom: swarm.openRoom, code: CODE, ...hostOptions });
  t.after(() => hosting.stop());
  const guestRoom = () => swarm.openRoom(roomId(CODE));
  const guest = (options = {}) => guestTransport(guestRoom(), { helloTimeoutMs: 1000, ...options });
  return { swarm, hosting, guest, guestRoom };
}

test('createCode usa só o alfabeto sem caracteres ambíguos e tem 6 letras', () => {
  for (let n = 0; n < 200; n++) assert.match(createCode(), /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
  assert.equal(createCode(() => 0), 'AAAAAA');
});

test('convidado entra pelo código, aparece no lobby e recebe a partida do anfitrião', { timeout: 10000 }, async t => {
  const { hosting, guest } = setup(t);
  const owner = await openInbox(hosting.connect());
  owner.send({ type: 'create', name: 'Ana', visibility: 'open', color: 0 });
  assert.equal((await owner.receive('joined')).room, CODE);
  const friend = await openInbox(guest());
  friend.send({ type: 'join', room: CODE, name: 'Beto', color: 1 });
  const joined = await friend.receive('joined');
  assert.equal(joined.count, 2);
  await owner.receive('lobby', m => m.count === 2);
  owner.send({ type: 'start' });
  assert.equal(Object.keys(decodeState((await friend.receive('start')).state).players).length, 2);
  friend.send({ type: 'input', x: 1, y: 0, seq: 1 });
  await friend.receive('state', m => decodeState(m.state).players[joined.playerId].inputSeq === 1);
});

test('código inexistente: o convidado recebe "Sala não encontrada." e o transporte fecha com 4004', { timeout: 10000 }, async t => {
  const swarm = createFakeSwarm();
  const ghost = await openInbox(guestTransport(swarm.openRoom(roomId('ZZZZZZ')), { helloTimeoutMs: 150 }));
  t.after(() => ghost.transport.close());
  assert.match((await ghost.receive('error')).message, /não encontrada/);
  await waitFor(() => ghost.closed);
  assert.equal(ghost.closed.code, 4004);
});

test('retomada sem anfitrião fecha com 1006 para o net.js continuar tentando e depois desistir', { timeout: 10000 }, async () => {
  const swarm = createFakeSwarm();
  const ghost = await openInbox(guestTransport(swarm.openRoom(roomId('ZZZZZZ')), { resume: true, helloTimeoutMs: 150 }));
  await waitFor(() => ghost.closed);
  assert.deepEqual(ghost.closed, { code: 1006, reason: 'O anfitrião saiu.' });
  assert.equal(ghost.has('error'), false);
});

test('o anfitrião que sai encerra a sala para todos com 4003, sem retentativa', { timeout: 10000 }, async t => {
  const { hosting, guest } = setup(t);
  const owner = await openInbox(hosting.connect());
  owner.send({ type: 'create', name: 'Ana', visibility: 'closed' });
  await owner.receive('joined');
  const friend = await openInbox(guest());
  friend.send({ type: 'join', room: CODE });
  await friend.receive('joined');
  hosting.stop();
  await waitFor(() => friend.closed && owner.closed);
  assert.deepEqual(friend.closed, { code: 4003, reason: 'O anfitrião saiu.' });
  assert.equal(owner.closed.code, 4003);
  assert.equal(hosting.roomHost.destroyed, true);
});

test('fechar a sessão local do anfitrião derruba a sala e os convidados', { timeout: 10000 }, async t => {
  const { hosting, guest } = setup(t);
  const owner = await openInbox(hosting.connect());
  owner.send({ type: 'create' });
  await owner.receive('joined');
  const friend = await openInbox(guest());
  friend.send({ type: 'join', room: CODE });
  await friend.receive('joined');
  owner.transport.close(1000, 'sair');
  await waitFor(() => friend.closed);
  assert.equal(friend.closed.code, 4003);
});

test('convidado que cai volta com um peer novo, pelo token, e recupera o mesmo personagem', { timeout: 10000 }, async t => {
  const { swarm, hosting, guest, guestRoom } = setup(t, { reconnectGraceMs: 5000 });
  const owner = await openInbox(hosting.connect());
  owner.send({ type: 'create', name: 'Ana' });
  await owner.receive('joined');
  const firstRoom = guestRoom();
  const friend = await openInbox(guestTransport(firstRoom, { helloTimeoutMs: 1000 }));
  friend.send({ type: 'join', room: CODE, name: 'Beto', color: 1 });
  const joined = await friend.receive('joined');
  owner.send({ type: 'start' });
  await friend.receive('start');

  swarm.sever(firstRoom);
  await waitFor(() => friend.closed);
  assert.equal(friend.closed.code, 1006);
  await owner.receive('lobby', m => m.players.some(p => p.id === joined.playerId && !p.connected));

  const back = await openInbox(guest({ resume: true }));
  back.send({ type: 'resume', room: CODE, token: joined.token });
  const resumed = await back.receive('joined');
  assert.equal(resumed.resumed, true);
  assert.equal(resumed.playerId, joined.playerId);
  assert.equal(decodeState((await back.receive('start')).state).players[joined.playerId].connected, true);
});

test('createSession do convidado retoma sozinho depois de uma queda', { timeout: 15000 }, async t => {
  const { swarm, hosting, guestRoom } = setup(t, { reconnectGraceMs: 8000 });
  const owner = await openInbox(hosting.connect());
  owner.send({ type: 'create', name: 'Ana' });
  await owner.receive('joined');
  const rooms = [];
  const events = [];
  const session = createSession(resume => {
    const room = guestRoom();
    rooms.push(room);
    return guestTransport(room, { resume, helloTimeoutMs: 1000 });
  }, { action: 'join', code: CODE, visibility: 'closed', name: 'Beto', color: 1, meta: {}, campaign: 'quick', curses: [], loadout: {}, unlocks: {} }, {
    onJoined: message => events.push(message.resumed ? 'resumed' : 'joined'),
    onReconnecting: active => events.push(active ? 'reconnecting' : 'stable'),
    onStart: () => events.push('start'),
    onClosed: event => events.push(`closed:${event.code}`)
  });
  t.after(() => session.close());
  await waitFor(() => events.includes('joined'));
  owner.send({ type: 'start' });
  await waitFor(() => session.inGame);

  swarm.sever(rooms[0]);
  await waitFor(() => events.includes('resumed'), 6000);
  assert.ok(events.indexOf('reconnecting') > events.indexOf('start'));
  assert.equal(events.some(event => event.startsWith('closed')), false);
  assert.ok(session.frame(performance.now(), 0.016, { x: 0, y: 0 }));
});

test('quadros de quem não fez hello, não-string ou com a sala inexistente são ignorados', { timeout: 10000 }, async t => {
  const { swarm, hosting } = setup(t);
  const owner = await openInbox(hosting.connect());
  owner.send({ type: 'create' });
  await owner.receive('joined');
  const rogue = swarm.openRoom(roomId(CODE));
  const msg = channel(rogue, 'msg');
  const ctl = channel(rogue, 'ctl');
  await new Promise(resolve => setTimeout(resolve, 20));
  await msg.send(JSON.stringify({ type: 'join', name: 'Intruso' }));
  await ctl.send({ t: 'close', code: 4003, reason: 'forjado' });
  await ctl.send('texto solto');
  await ctl.send({ t: 'hello' });
  await msg.send({ type: 'join', name: 'Objeto' });
  await msg.send('x'.repeat(5000));
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(hosting.roomHost.snapshot().count, 1, 'nenhum dos quadros inválidos entrou na sala');
  await msg.send(JSON.stringify({ type: 'join', room: CODE, name: 'Depois do hello' }));
  await waitFor(() => hosting.roomHost.snapshot().count === 2);
  rogue.leave();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test src/p2p/p2p.test.js`
Expected: FAIL — cannot find `./guest.js` / `./host.js`.

- [ ] **Step 3: Implement `src/p2p/guest.js`**

```js
import { channel } from './channel.js';
import { createTransport } from './transport.js';

const HELLO_TIMEOUT_MS = 12_000;
const RESUME_HELLO_TIMEOUT_MS = 5_000;
const LEAVE_DELAY_MS = 300; // lets the last message or farewell leave before the connection is torn down

/**
 * A WebSocket-shaped transport to the host of a P2P room. It opens when the host answers our `hello`.
 * @param {any} room an opened P2P room (see room.js / fake-room.js)
 * @param {{ resume?: boolean, helloTimeoutMs?: number }} [options]
 */
export function guestTransport(room, { resume = false, helloTimeoutMs = resume ? RESUME_HELLO_TIMEOUT_MS : HELLO_TIMEOUT_MS } = {}) {
  const msg = channel(room, 'msg');
  const ctl = channel(room, 'ctl');
  let hostId = null;
  let leaveTimer = null;
  const leaveRoom = () => { leaveTimer ??= setTimeout(() => room.leave(), LEAVE_DELAY_MS); };

  const transport = createTransport({
    onSend: raw => msg.send(raw, hostId),
    onLocalClose: leaveRoom
  });
  const finish = (code, reason) => {
    clearTimeout(helloTimer);
    transport._finish(code, reason);
    leaveRoom();
  };

  const helloTimer = setTimeout(() => {
    if (hostId) return;
    if (resume) return finish(1006, 'O anfitrião saiu.');
    // A first join gets the same error the old server sent, so the lobby shows the usual message.
    transport._receive(JSON.stringify({ type: 'error', message: 'Sala não encontrada.' }));
    finish(4004, 'Sala não encontrada.');
  }, helloTimeoutMs);

  ctl.onMessage((message, peerId) => {
    if (message?.t === 'ack' && !hostId) {
      hostId = peerId;
      clearTimeout(helloTimer);
      transport._open();
    } else if (message?.t === 'close' && peerId === hostId) {
      finish(Number.isInteger(message.code) ? message.code : 1006, String(message.reason || ''));
    }
  });
  msg.onMessage((raw, peerId) => { if (peerId === hostId && typeof raw === 'string') transport._receive(raw); });
  room.onPeerJoin = peerId => { if (!hostId) ctl.send({ t: 'hello' }, peerId); };
  room.onPeerLeave = peerId => { if (peerId === hostId) finish(1006, 'Conexão com o anfitrião perdida.'); };
  return transport;
}
```

- [ ] **Step 4: Implement `src/p2p/host.js`**

```js
import { createRoomHost } from '../../server/room-host.js';
import { channel } from './channel.js';
import { announceRooms } from './lobby.js';
import { attachTransport, loopbackPair } from './transport.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_PENDING_SENDS = 8; // a peer this far behind stops receiving snapshots until it catches up
const LEAVE_DELAY_MS = 300;

export const roomId = code => `arcana:${code}`;

export function createCode(random = Math.random) {
  return Array.from({ length: 6 }, () => CODE_CHARS[Math.floor(random() * CODE_CHARS.length)]).join('');
}

/**
 * Lets guests that enter the P2P room talk to the room host. A guest becomes a connection only after it says
 * `hello` on the control channel; game frames from anyone else, or that are not strings, are dropped.
 */
export function serveRoom(room, roomHost) {
  const msg = channel(room, 'msg');
  const ctl = channel(room, 'ctl');
  const links = new Map();
  const pending = new Map();

  const forget = peerId => {
    links.get(peerId)?.disconnect();
    links.delete(peerId);
    pending.delete(peerId);
  };

  ctl.onMessage((message, peerId) => {
    if (message?.t !== 'hello') return;
    forget(peerId);
    const link = roomHost.connect({
      send: raw => {
        pending.set(peerId, (pending.get(peerId) || 0) + 1);
        msg.send(raw, peerId).finally(() => { if (pending.has(peerId)) pending.set(peerId, Math.max(0, pending.get(peerId) - 1)); });
      },
      close: (code, reason) => { ctl.send({ t: 'close', code, reason }, peerId); },
      congested: () => (pending.get(peerId) || 0) > MAX_PENDING_SENDS
    });
    if (!link) return;
    links.set(peerId, link);
    ctl.send({ t: 'ack', code: roomHost.code }, peerId);
  });
  msg.onMessage((raw, peerId) => { if (typeof raw === 'string') links.get(peerId)?.receive(raw); });
  room.onPeerLeave = forget;
  return { stop() { for (const peerId of [...links.keys()]) forget(peerId); room.onPeerLeave = null; } };
}

/**
 * Starts hosting a room in this browser. `connect()` gives the host's own player a loopback transport;
 * closing it, calling `stop()` or closing the page ends the room for everyone with code 4003.
 * @param {{ openRoom: (id: string, options?: { passive?: boolean }) => any, code?: string } & Record<string, any>} options
 *   anything else is passed to createRoomHost (timings for tests)
 */
export function hostRoom({ openRoom, code = createCode(), ...hostOptions }) {
  const room = openRoom(roomId(code));
  let stopped = false;
  const roomHost = createRoomHost({ code, ...hostOptions, onDestroy: () => stop() });
  const serving = serveRoom(room, roomHost);
  const announcer = announceRooms({ openRoom, snapshot: () => roomHost.snapshot() });

  function stop() {
    if (stopped) return;
    stopped = true;
    if (typeof removeEventListener === 'function') removeEventListener('pagehide', stop);
    roomHost.destroy(4003, 'O anfitrião saiu.');
    announcer.stop();
    serving.stop();
    setTimeout(() => room.leave(), LEAVE_DELAY_MS);
  }
  if (typeof addEventListener === 'function') addEventListener('pagehide', stop);

  function connect() {
    const [client, server] = loopbackPair();
    if (attachTransport(roomHost, server)) {
      const detach = server.onclose;
      server.onclose = event => { detach?.(event); stop(); };
    }
    return client;
  }

  return { code, roomHost, connect, stop };
}
```

- [ ] **Step 5: Run the tests**

Run: `node --test src/p2p/p2p.test.js`
Expected: PASS (9 tests). Typical failure to check first: the resume e2e test needs `RETRY_DELAYS[0]` (400 ms) to elapse; its 6 s wait covers it.

Run: `npm run check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/p2p/host.js src/p2p/guest.js src/p2p/p2p.test.js
git commit -m "feat(p2p): host a room in the browser and join it as a guest over WebRTC"
```

---

### Task 6: Wire the UI, add Trystero and verify in a browser

**Files:**
- Create: `src/p2p/room.js`
- Modify: `package.json`, `package-lock.json`, `src/main.js`, `src/menu.js`, `index.html`, `src/terrain.js`

**Interfaces:**
- Consumes: `hostRoom`, `roomId` (host.js), `guestTransport` (guest.js), `watchRooms` (lobby.js), `createSession` (net.js).
- Produces: `openRoom(roomId, { passive? })` → Trystero room (`appId: 'arcana-survivors'`, optional TURN from `?turn=&turnUser=&turnCred=`).

- [ ] **Step 1: Install the dependency**

Run: `npm install @trystero-p2p/torrent@0.26.0 --save-exact`
Expected: `package.json` gains `"@trystero-p2p/torrent": "0.26.0"` under `dependencies`.

- [ ] **Step 2: Create `src/p2p/room.js`**

```js
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

/** The only place that touches the P2P library. Passive rooms only connect to peers that announce themselves. */
export function openRoom(roomId, { passive = false } = {}) {
  return joinRoom({ appId: APP_ID, turnConfig: turnConfig(), ...(passive ? { passive: true } : {}) }, roomId);
}
```

- [ ] **Step 3: Edit `index.html`**

Replace the `menu-links` block and the `#settings` block (the lines containing `settingsBtn`, `settings`, `serverUrl`, `saveServer`) with:

```html
          <div class="menu-links"><button id="creditsBtn" class="text-btn">✧ Créditos</button></div>
```

(The `</div>` that closes the surrounding container stays where it is.)

- [ ] **Step 4: Edit `src/menu.js`**

1. Imports: add after the `createAchievements` import:

```js
import { openRoom } from './p2p/room.js';
import { watchRooms } from './p2p/lobby.js';
```

2. Delete the line `const DEFAULT_SERVER = '…';` and the whole `export function serverUrl() { … }`.

3. Replace the whole `fetchOpenRooms` function with:

```js
  /** Watches the P2P lobby while the join panel is open; closing the panel (or starting a game) stops it. */
  function fetchOpenRooms() {
    cancelRoomRequest();
    $('#roomCapacity').textContent = '';
    if ($('#joinBox').classList.contains('hidden') || !isIdle()) return;
    if (!navigator.onLine) { listMessage('Sem internet. Você pode jogar offline ou iniciar o desafio diário.'); return; }
    listMessage('Procurando salas abertas…');
    let settled = false;
    let latest = [];
    let watcher;
    try {
      watcher = watchRooms({ openRoom, onUpdate: rooms => { latest = rooms; if (settled || rooms.length) renderOpenRooms(rooms); } });
    } catch { listMessage('Não foi possível buscar salas neste navegador.'); return; }
    const settle = setTimeout(() => { settled = true; renderOpenRooms(latest); }, 5000);
    cancelRoomRequest = () => { clearTimeout(settle); watcher.stop(); cancelRoomRequest = () => {}; };
  }
```

4. In `renderOpenRooms`, change `button.onclick = () => onJoin(room.code);` to:

```js
      button.onclick = () => { cancelRoomRequest(); onJoin(room.code); };
```

5. Make the other panel toggles stop the watcher. In `#splitBtn`'s `onclick` add `cancelRoomRequest();` as the first statement; same for `#createBtn`'s `onclick`. In `#joinToggle`'s `onclick`, replace the `if (!box.classList.contains('hidden')) { fetchOpenRooms(); … }` block with:

```js
    if (box.classList.contains('hidden')) cancelRoomRequest();
    else {
      fetchOpenRooms();
      requestAnimationFrame(() => box.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
    }
```

6. Replace the two button handlers:

```js
  $('#confirmCreateBtn').onclick = () => { cancelRoomRequest(); onCreate(visibility); };
```

and in `#joinBtn`'s handler use `code.length < 4 ? toast('Digite o código da sala') : (cancelRoomRequest(), onJoin(code));`.

7. Delete the three server-settings lines: `$('#settingsBtn').onclick = …;`, `$('#serverUrl').value = serverUrl();` and `$('#saveServer').onclick = …;`.

8. Replace the block from `const refresh = () => …` through the `visibilitychange` listener (the `refresh` function, the initial `refresh();`, the `online`/`offline` listeners, the `setInterval(refresh, 10000)` and the `visibilitychange` line) with:

```js
  addEventListener('online', () => fetchOpenRooms());
  addEventListener('offline', () => fetchOpenRooms());
  document.addEventListener('visibilitychange', () => { if (document.hidden) cancelRoomRequest(); else fetchOpenRooms(); });
```

- [ ] **Step 5: Edit `src/main.js`**

1. Imports: change the menu import to drop `serverUrl` and add the P2P imports:

```js
import { createMenu, playerName, renderCharacterPicker, saveDailyRecord } from './menu.js';
import { createSession, savedSession } from './net.js';
import { guestTransport } from './p2p/guest.js';
import { hostRoom, roomId } from './p2p/host.js';
import { openRoom } from './p2p/room.js';
```

2. Below `let session = null;` add: `let hosting = null; // the room this browser hosts, if any`.

3. In `endGame`, after `session = null;` add `hosting = null;`.

4. In `connect(...)`, right after `let lobbyRunning = false;` add:

```js
  hosting = action === 'create' ? hostRoom({ openRoom }) : null;
  const room = hosting?.code ?? code.toUpperCase();
```

5. Replace `const current = session = createSession(resume?.url || serverUrl(), entry, {` with:

```js
  const current = session = createSession(
    hosting ? hosting.connect : useResume => guestTransport(openRoom(roomId(room)), { resume: useResume }),
    entry, {
```

   and make sure the closing of that call keeps its `});` (the handlers object ends unchanged).

6. In `onStart()` after `showGame('CO-OP', current.room);` add:

```js
      if (hosting) hud.toast('Você é o anfitrião: mantenha esta aba aberta e visível, ou a partida trava para todos.');
```

7. In `onClosed`, after `session = null;` add `hosting = null;`.

8. Replace the status line `$('#lobbyStatus').textContent = 'Conectando ao servidor…';` with:

```js
  $('#lobbyStatus').textContent = action === 'create' ? 'Criando a sala…' : 'Procurando a sala…';
```

9. After the existing `visibilitychange` listener (line ~350) add:

```js
let hostWasHidden = false;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hostWasHidden = Boolean(hosting && mode === 'online'); return; }
  if (hostWasHidden) { hostWasHidden = false; hud.toast('A aba ficou oculta: os outros jogadores podem ter travado. Mantenha-a visível.'); }
});
```

- [ ] **Step 6: Edit `src/terrain.js`**

Change the comment text `never sent over WebSocket` to `never sent over the network`.

- [ ] **Step 7: Check and build**

Run: `npm run check`
Expected: PASS.

Run: `npm run build`
Expected: succeeds; `dist/assets/*.js` contains Trystero code (`grep -l "arcana-survivors" dist/assets/*.js` prints a file).

- [ ] **Step 8: Verify in the browser (two tabs)**

Start the `vite` server from `.claude/launch.json` (`preview_start` with `name: "vite"`). The sandbox needs internet for the public trackers; if the tracker WebSockets are blocked, report that instead of claiming success.

1. Tab A: **Criar sala aberta**. Expect the lobby with a 6-letter code and toast-free status "1 jogador(es) no ritual". Console has no errors.
2. Tab B (`tabs_create`, same URL): open **Entrar em sala**. Expect "Procurando salas abertas…" then Tab A's room listed within ~10 s. Click it. Expect Tab A's lobby to show 2 players.
3. Tab A: **Começar**. Both tabs enter the game; Tab B's character moves with the keyboard and Tab A sees it move.
4. Tab B: reload. Expect "Voltando à partida…" and the same character back (within 30 s).
5. Tab A: click the back/exit button. Expect Tab B to show "O anfitrião saiu." and return to the menu.
6. Confirm Network tab shows no request to the old VPS URL and no `ws://localhost:8081`.

Record in the commit message which of these steps could not be run.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json src/p2p/room.js src/main.js src/menu.js index.html src/terrain.js
git commit -m "feat: play co-op over WebRTC with Trystero instead of the WebSocket server"
```

---

### Task 7: Remove the WebSocket server and update the documentation

**Files:**
- Delete: `server/server.js`
- Modify: `package.json`, `package-lock.json`, `.claude/launch.json`, `README.md`, `RELEASE_NOTES.md`, `platforms/switch/README.md`, `docs/superpowers/specs/2026-10-14-p2p-multiplayer-design.md`

- [ ] **Step 1: Delete the server and its dependency**

Run:

```bash
git rm server/server.js
npm uninstall ws @types/ws
```

In `package.json` delete the line `"server": "node server/server.js",`. In `.claude/launch.json` delete the whole `"server"` configuration object (and the comma after the `vite` object).

- [ ] **Step 2: Confirm nothing references the old server**

Run: `grep -rn "server/server\|npm run server\|serverUrl\|WebSocketServer\|from 'ws'" --include=*.js --include=*.json --include=*.html --include=*.md . | grep -v "node_modules\|docs/superpowers\|package-lock\|^./dist"`
Expected: only README lines, which Step 3 rewrites. Anything else: fix it.

- [ ] **Step 3: Rewrite the README parts**

Apply these edits to `README.md`:

1. Intro paragraph (line 5) becomes:
   `Survival roguelite cooperativo para a web, de 1 a 4 jogadores. O jogo é um site estático (GitHub Pages) e o co-op online é peer-to-peer: quem cria a sala roda a simulação (`server/game.js`) no próprio navegador e os outros jogadores se conectam a ele por WebRTC, sem servidor próprio. A mesma simulação roda no modo offline.`
2. In **Desenvolvimento**, delete the block `Em outro terminal:` + the ```` ```bash npm run server``` ```` block + the paragraph beginning `Para conectar ao backend local…`, and put in their place:
   `O co-op funciona direto no `npm run dev`: abra duas abas (ou dois navegadores), crie uma sala em uma e entre pela lista ou pelo código na outra. Os pares se encontram por relays públicos do Trystero (trackers BitTorrent), então é preciso internet. Em redes onde a conexão direta falha, informe um servidor TURN: `?turn=turn:host:3478&turnUser=usuario&turnCred=senha`.`
3. Line 66: replace `salas cooperativas precisam do servidor e de internet` with `salas cooperativas precisam de internet`.
4. Line 162: replace `O servidor valida graus, desbloqueios e escolhas antes de aplicá-los.` with `O anfitrião valida graus, desbloqueios e escolhas antes de aplicá-los.`
5. Replace the **Co-op e rede** bullets (the five after "Salas por código…" and "Quem entra numa partida…") with:
   - `O anfitrião simula a 30 Hz e envia 15 snapshots por segundo a cada convidado. Cada um recebe apenas o que está a até 1.250 unidades do seu personagem, em arrays compactos (`server/protocol.js`).`
   - `O cliente desenha os outros jogadores e inimigos interpolados 100 ms no passado e prevê o próprio movimento, corrigindo a posição com base no tempo de ida e volta medido por ping.`
   - `**Reconexão**: se a conexão de um convidado cair, o personagem continua na partida por 30 segundos e o cliente tenta voltar automaticamente, inclusive após recarregar a página. Sem ninguém conectado, a partida congela até alguém voltar.`
   - `**Limites do P2P**: se o anfitrião fechar ou recarregar a aba, a partida termina para todos. Mantenha a aba do anfitrião visível: abas em segundo plano são desaceleradas pelo navegador. Cerca de 10 a 15% das redes (NAT simétrico, algumas operadoras móveis) só conectam com um servidor TURN. Sem servidor neutro, o anfitrião tem a última palavra sobre a partida.`
   - `Os ports nativos continuam falando o mesmo protocolo de mensagens, mas por WebSocket; eles não encontram salas P2P da web até ganharem suporte a WebRTC.`
   - `Salas que nunca começaram expiram em 20 minutos e partidas encerradas fecham 90 segundos após o fim.`
6. In **Publicar o frontend no GitHub Pages** delete step 4 (`Defina a URL WebSocket no menu…`).
7. Delete everything from the heading `## Backend na VPS com aaPanel` up to (not including) `## Arquitetura`.
8. In the **Arquitetura** table replace the row `| `server/protocol.js` · `server.js` | Snapshots compactos, salas, heartbeat e reconexão |` with:

```
| `server/protocol.js` · `room-host.js` | Snapshots compactos e as regras de uma sala (lobby, entrada, reconexão, tick) |
| `src/p2p/` | Transporte WebRTC (Trystero), anfitrião e convidado, lista de salas abertas |
```

- [ ] **Step 4: Update the other docs**

- `RELEASE_NOTES.md`: add as the first bullet after the title: `- Co-op online agora é peer-to-peer (WebRTC): não há mais servidor WebSocket; quem cria a sala é o anfitrião. Os ports nativos ainda usam WebSocket e não encontram salas P2P.` Also change the existing bullet `Multiplayer web com salas, reconexão e compatibilidade com o port nativo para PC.` to `Multiplayer web com salas e reconexão.`
- `platforms/switch/README.md` line 144: change `(servidor, protocolo, mensagens, WebSocket)` to `(protocolo, mensagens, WebRTC)`.
- Spec `docs/superpowers/specs/2026-10-14-p2p-multiplayer-design.md`: record the two deviations made while planning. In **Criar sala** delete step 2 (the `probe`/`taken` collision check: with 31⁶ ≈ 887 million codes a collision is negligible, and probing would delay every room by seconds) and renumber; in **Entrar por código** change `~8 s` to `12 s (5 s ao retomar)`. In **Contrapressão** change the sentence about the channel buffer to `o anfitrião para de enviar snapshots a um convidado com mais de 8 envios pendentes (a API do Trystero não expõe o buffer do canal)`.

- [ ] **Step 5: Final verification**

Run: `npm run check`
Expected: PASS (lint, typecheck, all tests).

Run: `npm run build`
Expected: succeeds.

Run: `grep -c "\"ws\"" package.json`
Expected: `0`.

If the `graphify` CLI is installed, run `graphify update .` to refresh the knowledge graph (AST-only); skip silently if it is not.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: remove the WebSocket server and document the P2P co-op"
```

---

## Self-review notes

- **Spec coverage:** room-host extraction (Task 1), transport contract + loopback (2), net.js factory (3), lobby/discovery (4), host/guest/reconnect/exit (5), UI + hidden-tab warning + TURN + dependency (6), removals + docs + deviations recorded (7). Tests section of the spec is covered per task.
- **Deviations from the spec, all recorded in Task 7:** no `probe`/collision check; hello timeout 12 s/5 s instead of 8 s; congestion measured by pending sends rather than the channel buffer. `PROTOCOL_MISMATCH` is enforced by the room host on `create/join/resume` rather than in the `hello` handshake.
- **Known limit worth the user's attention:** the native PC/console ports speak WebSocket to the old server and will not find P2P rooms. If they must keep working, a ~60-line `server/server.js` adapter over `createRoomHost` can be added later; that is deliberately out of scope here.
