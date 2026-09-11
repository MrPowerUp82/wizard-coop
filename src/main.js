import './style.css';
import './enhancements.css';
import { POWERS, applyPower, createGameState, createPlayer, updateGame, xpNeeded } from '../server/game.js';

const $ = selector => document.querySelector(selector);
const canvas = $('#game');
const ctx = canvas.getContext('2d');
const atlas = new Image();
atlas.src = './assets/sprites.webp';

const CELL = 313.5;
const sprites = {
  player: [0, 0], player2: [1, 0], player3: [2, 0], player4: [3, 0],
  slime: [0, 1], bat: [1, 1], brute: [2, 1], eye: [3, 1],
  bolt: [0, 2], fire: [1, 2], blade: [2, 2], thorn: [3, 2],
  gem: [0, 3], greenGem: [1, 3], coin: [2, 3], heart: [3, 3]
};
const playerSprites = ['player', 'player2', 'player3', 'player4'];
const powerInfo = {
  arcane: ['✦', 'Poder arcano', '+25% de dano mágico'],
  haste: ['ϟ', 'Cadência', 'Ataques 12% mais rápidos'],
  vitality: ['♥', 'Vitalidade', '+22 de vida máxima e cura 30'],
  swiftness: ['➤', 'Passos do vento', '+12% de velocidade'],
  multishot: ['✧', 'Disparo múltiplo', '+1 projétil por ataque'],
  magnet: ['◎', 'Magnetismo', '+55 de alcance de coleta'],
  armor: ['◇', 'Armadura rúnica', 'Reduz o dano recebido']
};

let W = innerWidth;
let H = innerHeight;
let dpr = 1;
let last = 0;
let game = null;
let socket = null;
let input = { x: 0, y: 0 };
let lastSentInput = { x: 99, y: 99 };
let lastInputAt = 0;
let touching = false;
let shownPowers = '';
let defeatShown = false;
const keys = new Set();

function resize() {
  dpr = Math.min(devicePixelRatio, 2);
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  canvas.style.width = `${innerWidth}px`;
  canvas.style.height = `${innerHeight}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  W = innerWidth;
  H = innerHeight;
}
addEventListener('resize', resize);
resize();

function drawSprite(name, x, y, size, rotation = 0, alpha = 1) {
  const [sx, sy] = sprites[name];
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.drawImage(atlas, sx * CELL, sy * CELL, CELL, CELL, -size / 2, -size / 2, size, size);
  ctx.restore();
}

function backdrop(time = 0) {
  ctx.fillStyle = '#071117';
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.translate((W / 2) % 64, (H / 2) % 64);
  ctx.strokeStyle = 'rgba(101,181,157,.055)';
  for (let x = -W; x < W; x += 64) { ctx.beginPath(); ctx.moveTo(x, -H); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = -H; y < H; y += 64) { ctx.beginPath(); ctx.moveTo(-W, y); ctx.lineTo(W, y); ctx.stroke(); }
  ctx.restore();
  for (let i = 0; i < 35; i++) {
    const x = (i * 197 + time * 0.004 * (i % 3 + 1)) % (W + 100) - 50;
    const y = (i * 113) % (H + 60) - 30;
    ctx.fillStyle = `rgba(94,208,170,${0.025 + (i % 4) * 0.009})`;
    ctx.beginPath(); ctx.arc(x, y, 2 + i % 3, 0, 7); ctx.fill();
  }
}

function menuLoop(time) {
  if (game) return;
  backdrop(time);
  const x = W * 0.72, y = H * 0.52;
  ctx.strokeStyle = 'rgba(95,214,179,.08)';
  for (let radius = 140; radius < 350; radius += 48) {
    ctx.beginPath(); ctx.arc(x, y, radius + Math.sin(time / 1800 + radius) * 5, 0, Math.PI * 2); ctx.stroke();
  }
  requestAnimationFrame(menuLoop);
}
requestAnimationFrame(menuLoop);

function startOffline() {
  game = createGameState();
  game.offline = true;
  game.players.me = createPlayer('me', 'Arcanista', 0);
  shownPowers = '';
  defeatShown = false;
  showGame('SOZINHO');
  last = performance.now();
  requestAnimationFrame(loop);
}

function loop(now) {
  if (!game) return;
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  readInput();
  const me = game.players.me;
  if (game.offline) {
    if (me?.alive && !me.pendingPowers) me.input = input;
    updateGame(game, dt);
  } else if (socket?.readyState === 1 && me && me.alive !== false) {
    const changed = input.x !== lastSentInput.x || input.y !== lastSentInput.y;
    if (changed || now - lastInputAt >= 100) {
      socket.send(JSON.stringify({ type: 'input', ...input }));
      lastSentInput = { ...input };
      lastInputAt = now;
    }
  }
  syncOverlays();
  render(now);
  requestAnimationFrame(loop);
}

function syncOverlays() {
  const me = game?.players.me;
  if (!me) return;
  if (me.pendingPowers?.length) {
    const key = me.pendingPowers.join(',');
    if (key !== shownPowers) { shownPowers = key; showPowerChoices(me.pendingPowers); }
  } else {
    shownPowers = '';
    $('#powerModal').classList.add('hidden');
  }
  if (me.alive === false && !defeatShown) showDefeat(game.over);
  if (game.over && !defeatShown) showDefeat(true);
}

function showPowerChoices(choices) {
  const box = $('#powerChoices');
  box.innerHTML = '';
  for (const id of choices) {
    const [icon, title, description] = powerInfo[id];
    const rank = (game.players.me.powers[id] || 0) + 1;
    const button = document.createElement('button');
    button.className = 'power-choice';
    button.innerHTML = `<i>${icon}</i><b>${title}</b><small>${description}<br>Grau ${rank}/${POWERS[id].max}</small>`;
    button.onclick = () => choosePower(id);
    box.append(button);
  }
  $('#powerModal').classList.remove('hidden');
}

function choosePower(id) {
  $('#powerModal').classList.add('hidden');
  if (game.offline) applyPower(game.players.me, id);
  else socket?.send(JSON.stringify({ type: 'choosePower', power: id }));
  toast(`${powerInfo[id][1]} adquirido`);
}

function showDefeat(allDead) {
  defeatShown = true;
  const me = game.players.me;
  $('#defeatTitle').textContent = allDead ? 'Ritual encerrado' : 'Você caiu';
  $('#defeatText').textContent = allDead ? 'Nenhum arcanista permaneceu de pé.' : 'Você agora observa os aliados sobreviventes.';
  $('#finalStats').textContent = `TEMPO ${format(game.time)}  •  NÍVEL ${me.level}`;
  $('#defeatModal').classList.remove('hidden');
}

function visible(x, y, camX, camY, margin = 110) {
  return x >= camX - margin && x <= camX + W + margin && y >= camY - margin && y <= camY + H + margin;
}

function render(time) {
  const me = game.players.me || Object.values(game.players)[0];
  if (!me) return;
  backdrop(time);
  const camX = me.x - W / 2, camY = me.y - H / 2;
  ctx.save();
  ctx.translate(-camX, -camY);
  for (const gem of game.gems || []) if (visible(gem.x, gem.y, camX, camY)) drawSprite('gem', gem.x, gem.y, 28, 0, Math.min(0.9, gem.ttl / 4));
  for (const shot of game.shots || []) if (visible(shot.x, shot.y, camX, camY)) drawSprite('bolt', shot.x, shot.y, 38, Math.atan2(shot.vy, shot.vx));
  for (const enemy of game.enemies || []) {
    if (!visible(enemy.x, enemy.y, camX, camY)) continue;
    drawSprite(enemy.type, enemy.x, enemy.y, enemy.type === 'brute' ? 76 : 54);
    ctx.fillStyle = '#10151a'; ctx.fillRect(enemy.x - 20, enemy.y - 34, 40, 3);
    ctx.fillStyle = '#b95465'; ctx.fillRect(enemy.x - 20, enemy.y - 34, 40 * Math.max(0, enemy.hp / enemy.maxHp), 3);
  }
  let index = 0;
  for (const player of Object.values(game.players)) {
    if (visible(player.x, player.y, camX, camY)) {
      const alive = player.alive !== false;
      if (alive && player.pendingPowers?.length) {
        const pulse = 40 + Math.sin(time / 130) * 4;
        ctx.strokeStyle = 'rgba(126, 237, 205, .82)';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(player.x, player.y, pulse, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = 'rgba(87, 215, 180, .08)';
        ctx.beginPath(); ctx.arc(player.x, player.y, pulse, 0, Math.PI * 2); ctx.fill();
      }
      drawSprite(playerSprites[player.color ?? index % 4], player.x, player.y, 68, 0, alive ? 1 : 0.28);
      ctx.font = '600 10px Inter'; ctx.textAlign = 'center';
      ctx.fillStyle = alive ? '#c6eee2' : '#8b5961';
      ctx.fillText(alive ? (player.name || 'Aliado') : 'DERROTADO', player.x, player.y - 41);
    }
    index++;
  }
  ctx.restore();

  $('#hpBar').style.width = `${Math.max(0, me.hp / me.maxHp) * 100}%`;
  $('#xpBar').style.width = `${Math.min(1, me.xp / xpNeeded(me.level)) * 100}%`;
  $('#level').textContent = `NÍVEL ${me.level}`;
  $('#timer').textContent = format(game.time || 0);
  renderPlayers();
}

function format(value) {
  const seconds = Math.floor(value);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function readInput() {
  let x = (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0);
  let y = (keys.has('s') || keys.has('arrowdown') ? 1 : 0) - (keys.has('w') || keys.has('arrowup') ? 1 : 0);
  if (x || y) { const length = Math.hypot(x, y); input = { x: x / length, y: y / length }; }
  else if (!touching) input = { x: 0, y: 0 };
}
addEventListener('keydown', event => keys.add(event.key.toLowerCase()));
addEventListener('keyup', event => keys.delete(event.key.toLowerCase()));

const joystick = $('#joystick');
const knob = joystick.querySelector('i');
function touchMove(event) {
  if (!touching) return;
  const point = event.touches?.[0] || event;
  const rect = joystick.getBoundingClientRect();
  const dx = point.clientX - (rect.left + rect.width / 2), dy = point.clientY - (rect.top + rect.height / 2);
  const length = Math.hypot(dx, dy), movement = Math.min(35, length), x = length ? dx / length : 0, y = length ? dy / length : 0;
  knob.style.transform = `translate(${x * movement}px,${y * movement}px)`;
  input = { x, y };
}
joystick.addEventListener('pointerdown', event => { touching = true; joystick.setPointerCapture(event.pointerId); touchMove(event); });
joystick.addEventListener('pointermove', touchMove);
joystick.addEventListener('pointerup', () => { touching = false; input = { x: 0, y: 0 }; knob.style.transform = ''; });

function showGame(label, room = '') {
  $('#menu').classList.add('hidden');
  $('#lobby').classList.add('hidden');
  $('#hud').classList.remove('hidden');
  $('#modeLabel').textContent = label;
  $('#roomPill').classList.toggle('hidden', !room);
  $('#roomPill').querySelector('b').textContent = room;
}

function endGame() {
  game = null;
  socket?.close();
  socket = null;
  $('#hud').classList.add('hidden');
  $('#lobby').classList.add('hidden');
  $('#powerModal').classList.add('hidden');
  $('#defeatModal').classList.add('hidden');
  $('#menu').classList.remove('hidden');
  requestAnimationFrame(menuLoop);
}

function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('show');
  clearTimeout(element.timer);
  element.timer = setTimeout(() => element.classList.remove('show'), 2200);
}

function serverUrl() {
  return localStorage.getItem('arcana-server') || new URLSearchParams(location.search).get('server') || 'ws://localhost:8080';
}

function localizeState(state) {
  const mine = state.players[socket.playerId];
  if (mine) { state.players.me = mine; delete state.players[socket.playerId]; }
  return state;
}

function connect(action, code = '') {
  try { socket = new WebSocket(serverUrl()); } catch { toast('Endereço do servidor inválido'); return; }
  $('#lobby').classList.remove('hidden');
  $('#lobbyStatus').textContent = 'Conectando ao servidor…';
  socket.onopen = () => socket.send(JSON.stringify({ type: action, room: code, name: 'Arcanista' }));
  socket.onerror = () => { $('#lobbyStatus').textContent = 'Não foi possível alcançar o servidor.'; };
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.type === 'joined') {
      socket.playerId = message.playerId; socket.room = message.room;
      $('#roomCode').textContent = message.room;
      $('#lobbyStatus').textContent = `${message.count} jogador(es) no ritual`;
      if (action === 'join') socket.send(JSON.stringify({ type: 'ready' }));
    }
    if (message.type === 'lobby') $('#lobbyStatus').textContent = `${message.count} jogador(es) no ritual`;
    if (message.type === 'start') {
      game = { offline: false, ...localizeState(message.state) };
      shownPowers = ''; defeatShown = false;
      showGame('CO-OP', socket.room); last = performance.now(); requestAnimationFrame(loop);
    }
    if (message.type === 'state' && game) game = { offline: false, ...localizeState(message.state) };
    if (message.type === 'error') toast(message.message);
  };
  socket.onclose = () => { if (game) { toast('Conexão encerrada'); setTimeout(endGame, 900); } };
}

function renderPlayers() {
  const players = Object.values(game.players || {});
  const signature = players.map(p => `${p.id}:${p.alive !== false}`).join('|');
  const element = $('#players');
  if (element.dataset.signature === signature) return;
  element.dataset.signature = signature;
  element.innerHTML = '';
  players.forEach((player, index) => {
    const dot = document.createElement('div');
    const alive = player.alive !== false;
    dot.className = `player-dot${alive ? '' : ' dead'}`;
    dot.style.backgroundPosition = `${-(player.color ?? index) * 100 / 3}% 0`;
    dot.title = `${player.name}${alive ? '' : ' — derrotado'}`;
    element.append(dot);
  });
}

$('#offlineBtn').onclick = startOffline;
$('#createBtn').onclick = () => connect('create');
$('#joinToggle').onclick = () => $('#joinBox').classList.toggle('hidden');
$('#joinBtn').onclick = () => {
  const code = $('#roomInput').value.trim().toUpperCase();
  code.length < 4 ? toast('Digite o código da sala') : connect('join', code);
};
$('#startBtn').onclick = () => socket?.send(JSON.stringify({ type: 'start' }));
$('#roomCode').onclick = async () => { await navigator.clipboard?.writeText($('#roomCode').textContent); toast('Código copiado'); };
document.querySelectorAll('.backBtn').forEach(button => { button.onclick = endGame; });
$('#exitBtn').onclick = endGame;
$('#defeatExit').onclick = endGame;
$('#settingsBtn').onclick = () => $('#settings').classList.toggle('hidden');
$('#serverUrl').value = serverUrl();
$('#saveServer').onclick = () => { localStorage.setItem('arcana-server', $('#serverUrl').value.trim()); toast('Servidor salvo'); };
