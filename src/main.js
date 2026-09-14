import './style.css';
import './enhancements.css';
import { POWERS, REVIVE, SPECIAL, SPELLS, activateSpecial, applyPower, createGameState, createPlayer, updateGame, xpNeeded } from '../server/game.js';
import { ENEMIES, PHASES, PHASE_DURATION } from '../server/phases.js';
import { drawTerrain } from './terrain.js';

const $ = selector => document.querySelector(selector);
const canvas = $('#game');
const ctx = canvas.getContext('2d');
const atlas = new Image();
atlas.src = './assets/sprites.webp';
const phaseAtlas = new Image();
phaseAtlas.src = './assets/phases.png';
// Source bounds follow the generated atlas (1254 × 1254).
const phaseSprites = {
  mushroom: [0, 0, 418, 442], beetle: [418, 0, 408, 442], treant: [826, 0, 428, 440],
  skeleton: [0, 442, 418, 410], wraith: [418, 442, 408, 410], lich: [826, 440, 428, 408],
  imp: [0, 852, 418, 402], scorpion: [418, 852, 408, 402], demon: [826, 848, 428, 406]
};

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
let gameOverShown = false;
let paused = false;
let animationFrame = 0;
let shownPhase = '';
let selectedVisibility = 'open';
const savedCharacter = Number(localStorage.getItem('arcana-character') ?? 0);
let selectedCharacter = Number.isInteger(savedCharacter) && savedCharacter >= 0 && savedCharacter < 4 ? savedCharacter : 0;
const characterNames = ['Azul', 'Vermelho', 'Verde', 'Roxo'];
const characterEffects = ['Desacelera inimigos', 'Explode em área', 'Atravessa 3 inimigos', 'Lâmina larga, até 2 alvos'];
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
  const source = phaseSprites[name] ? phaseAtlas : atlas;
  if (!source.complete || !source.naturalWidth) return;
  const bounds = phaseSprites[name] || [sprites[name][0] * CELL, sprites[name][1] * CELL, CELL, CELL];
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.drawImage(source, ...bounds, -size / 2, -size / 2, size, size);
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
  animationFrame = requestAnimationFrame(menuLoop);
}
animationFrame = requestAnimationFrame(menuLoop);

function startOffline() {
  cancelAnimationFrame(animationFrame);
  resetInput();
  paused = false;
  game = createGameState();
  game.offline = true;
  game.players.me = createPlayer('me', playerName(), selectedCharacter);
  shownPowers = '';
  defeatShown = false;
  gameOverShown = false;
  shownPhase = '';
  showGame('SOZINHO');
  last = performance.now();
  animationFrame = requestAnimationFrame(loop);
}

function loop(now) {
  if (!game) return;
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  readInput();
  const me = game.players.me;
  if (game.offline) {
    if (me?.alive && !me.pendingPowers) me.input = input;
    if (!paused && !me?.pendingPowers?.length) updateGame(game, dt);
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
  animationFrame = requestAnimationFrame(loop);
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
  if (me.alive && defeatShown && !game.over) {
    defeatShown = false;
    $('#defeatModal').classList.add('hidden');
    resetInput();
    toast('Você foi ressuscitado!');
  }
  if (me.alive === false && !defeatShown) showDefeat(game.over);
  if (game.over && !gameOverShown) showDefeat(true);
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
  gameOverShown = allDead;
  const me = game.players.me;
  $('#defeatTitle').textContent = game.victory ? 'Ritual concluído!' : allDead ? 'Ritual encerrado' : 'Você caiu';
  $('#defeatText').textContent = game.victory ? 'Os três guardiões caíram. A aurora pertence aos arcanistas.' : allDead ? 'Nenhum arcanista permaneceu de pé.' : 'Um aliado pode ressuscitar você permanecendo dentro do círculo por 4 segundos.';
  $('#finalStats').textContent = `TEMPO ${format(game.time)}  •  NÍVEL ${me.level}  •  FASE ${(game.phase || 0) + 1}/3  •  MOEDAS ${me.coins || 0}`;
  $('#defeatModal').classList.toggle('victory', Boolean(game.victory));
  $('#defeatModal').classList.remove('hidden');
  $('#spectateBtn').classList.toggle('hidden', allDead);
}

function visible(x, y, camX, camY, margin = 110) {
  return x >= camX - margin && x <= camX + W + margin && y >= camY - margin && y <= camY + H + margin;
}

function render(time) {
  const me = game.players.me || Object.values(game.players)[0];
  if (!me) return;
  const focus = me.alive === false ? Object.values(game.players).find(p => p.alive !== false) || me : me;
  const camX = focus.x - W / 2, camY = focus.y - H / 2;
  drawTerrain(ctx, game.phase || 0, camX, camY, W, H);
  ctx.save();
  ctx.translate(-camX, -camY);
  for (const hazard of game.hazards || []) {
    ctx.beginPath(); ctx.arc(hazard.x, hazard.y, hazard.radius, 0, Math.PI * 2);
    ctx.fillStyle = hazard.fired ? 'rgba(255,150,75,.55)' : 'rgba(245,85,80,.12)'; ctx.fill();
    ctx.strokeStyle = hazard.fired ? '#ffc778' : '#ef7f78'; ctx.lineWidth = 2; ctx.stroke();
    if (!hazard.fired) {
      ctx.beginPath(); ctx.arc(hazard.x, hazard.y, hazard.radius * Math.max(0, 1 - hazard.warning / 1.3), 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  for (const gem of game.gems || []) if (visible(gem.x, gem.y, camX, camY)) drawSprite(gem.type || 'gem', gem.x, gem.y, 28, 0, Math.min(0.9, gem.ttl / 4));
  for (const shot of game.shots || []) if (visible(shot.x, shot.y, camX, camY)) {
    const spell = SPELLS[shot.color ?? 0];
    ctx.save();
    if (shot.color === 3) ctx.filter = 'hue-rotate(55deg)';
    drawSprite(spell.sprite, shot.x, shot.y, shot.special ? 65 : spell.sprite === 'blade' ? 52 : 38, Math.atan2(shot.vy, shot.vx));
    ctx.restore();
  }
  for (const shot of game.enemyShots || []) if (visible(shot.x, shot.y, camX, camY)) {
    ctx.strokeStyle = '#ff6666'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(shot.x, shot.y, 21, 0, Math.PI * 2); ctx.stroke();
    drawSprite(shot.sprite, shot.x, shot.y, 42, Math.atan2(shot.vy, shot.vx));
  }
  for (const enemy of game.enemies || []) {
    if (!visible(enemy.x, enemy.y, camX, camY)) continue;
    drawSprite(enemy.type, enemy.x, enemy.y, ENEMIES[enemy.type]?.size || (enemy.type === 'brute' ? 76 : 64));
    if (enemy.boss) continue;
    ctx.fillStyle = '#10151a'; ctx.fillRect(enemy.x - 20, enemy.y - 34, 40, 3);
    ctx.fillStyle = '#b95465'; ctx.fillRect(enemy.x - 20, enemy.y - 34, 40 * Math.max(0, enemy.hp / enemy.maxHp), 3);
  }
  let index = 0;
  for (const player of Object.values(game.players)) {
    if (visible(player.x, player.y, camX, camY)) {
      const alive = player.alive !== false;
      if (!alive && !game.over) {
        ctx.strokeStyle = '#eaaa91'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(player.x, player.y, REVIVE.radius, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = '#8dffcc'; ctx.lineWidth = 5;
        ctx.beginPath(); ctx.arc(player.x, player.y, REVIVE.radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (player.reviveProgress || 0) / REVIVE.seconds); ctx.stroke();
      }
      if (alive && (player.pendingPowers?.length || player.invulnerableFor > 0)) {
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
      ctx.fillText(alive ? (player.name || 'Aliado') : game.over ? 'DERROTADO' : `REVIVER · ${Math.ceil(REVIVE.seconds - (player.reviveProgress || 0))}s`, player.x, player.y - (alive ? 41 : 65));
    }
    index++;
  }
  ctx.restore();
  renderTeammateArrows(focus, camX, camY);

  $('#hpBar').style.width = `${Math.max(0, me.hp / me.maxHp) * 100}%`;
  $('#xpBar').style.width = `${Math.min(1, me.xp / xpNeeded(me.level)) * 100}%`;
  $('#level').textContent = `NÍVEL ${me.level}`;
  $('#timer').textContent = format(game.time || 0);
  const charge = me.specialCharge || 0;
  const spell = SPELLS[me.color ?? 0];
  $('#spellName').textContent = spell.name;
  $('#specialFill').style.width = `${charge}%`;
  $('#specialBtn').disabled = charge < SPECIAL.max || !me.alive || paused || Boolean(me.pendingPowers) || game.over || game.phaseStatus === 'transition';
  $('#specialBtn').textContent = charge >= SPECIAL.max ? '✦ Especial · ESPAÇO' : `✦ Especial ${charge}%`;
  $('#coinCount').textContent = `Moedas: ${me.coins || 0}`;
  $('#reviveHint').textContent = game.over ? '' : me.alive
    ? me.reviving ? 'Ressuscitando aliado… permaneça no círculo.' : game.offline ? '' : 'Para reviver um aliado, fique no círculo por 4s.'
    : me.reviveBy ? `Aliado ressuscitando você… ${Math.ceil(REVIVE.seconds - me.reviveProgress)}s` : 'Aguarde um aliado chegar até seu corpo.';
  renderPhase();
  renderPlayers();
}

function renderPhase() {
  const phase = PHASES[game.phase || 0];
  const state = game.phaseStatus || 'horde';
  const key = `${game.phase}:${state}`;
  if (shownPhase !== key) {
    shownPhase = key;
    $('#phaseName').textContent = `${(game.phase || 0) + 1} / 3 · ${phase.name}`;
    $('#phasePanel').style.setProperty('--phase-color', phase.color);
    if (state === 'boss') toast(`${phase.bossName} despertou! Desvie das áreas e dos projéteis.`);
    else if (state === 'horde') toast(`Fase ${(game.phase || 0) + 1}: ${phase.name}`);
  }
  $('#phaseTime').textContent = state === 'horde' ? `${format(Math.ceil(PHASE_DURATION - (game.phaseTime || 0)))} ATÉ O CHEFE`
    : state === 'boss' ? 'DERROTE O GUARDIÃO' : state === 'transition' ? 'GUARDIÃO DERROTADO' : 'CAMPANHA CONCLUÍDA';
  $('#phaseProgress').style.width = `${Math.min(100, (game.phaseTime || 0) / PHASE_DURATION * 100)}%`;
  const boss = game.enemies.find(e => e.boss);
  $('#bossPanel').classList.toggle('hidden', !boss);
  if (boss) {
    $('#bossName').textContent = phase.bossName;
    $('#bossHp').style.width = `${Math.max(0, boss.hp / boss.maxHp * 100)}%`;
    $('#bossHealth').textContent = `${Math.ceil(boss.hp)} / ${Math.ceil(boss.maxHp)}`;
  }
  $('#phaseTransition').classList.toggle('hidden', state !== 'transition');
  if (state === 'transition') $('#transitionText').textContent = `${PHASES[(game.phase || 0) + 1]?.name} · ${Math.ceil(game.transitionTime)}s`;
}

function renderTeammateArrows(me, camX, camY) {
  if (game.offline) return;
  for (const player of Object.values(game.players)) {
    if (player === me) continue;
    const screenX = player.x - camX;
    const screenY = player.y - camY;
    if (screenX >= 45 && screenX <= W - 45 && screenY >= 65 && screenY <= H - 55) continue;
    const dx = player.x - me.x;
    const dy = player.y - me.y;
    const angle = Math.atan2(dy, dx);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const reach = Math.min(
      (W / 2 - 55) / Math.max(0.001, Math.abs(cos)),
      (H / 2 - 75) / Math.max(0.001, Math.abs(sin))
    );
    const x = W / 2 + cos * reach;
    const y = H / 2 + sin * reach;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = player.alive === false ? '#ffb58e' : '#83e1c4';
    ctx.shadowColor = '#42b995';
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.moveTo(15, 0); ctx.lineTo(-9, -9); ctx.lineTo(-5, 0); ctx.lineTo(-9, 9);
    ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#b8f3e1';
    ctx.font = '600 9px Inter';
    ctx.textAlign = 'center';
    ctx.fillText(`${player.alive === false ? 'REVIVER ' : ''}${player.name} • ${Math.round(Math.hypot(dx, dy) / 10)}m`, x, y + 22);
  }
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
addEventListener('keydown', event => {
  if (event.target instanceof HTMLInputElement) return;
  const key = event.key.toLowerCase();
  if (game && ['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(key)) event.preventDefault();
  if (key === 'escape' && !event.repeat) togglePause();
  if (key === ' ' && !event.repeat) useSpecial();
  keys.add(key);
});
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
function resetInput() {
  keys.clear();
  touching = false;
  input = { x: 0, y: 0 };
  knob.style.transform = '';
  if (game?.offline && game.players.me) game.players.me.input = input;
  if (socket?.readyState === 1) socket.send(JSON.stringify({ type: 'input', ...input }));
}
for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) joystick.addEventListener(event, resetInput);
function togglePause(force) {
  if (!game?.offline || game.over) return;
  paused = typeof force === 'boolean' ? force : !paused;
  resetInput();
  $('#pauseModal').classList.toggle('hidden', !paused);
}
addEventListener('blur', () => { resetInput(); togglePause(true); });
document.addEventListener('visibilitychange', () => { if (document.hidden) { resetInput(); togglePause(true); } });

function showGame(label, room = '') {
  $('#menu').classList.add('hidden');
  $('#lobby').classList.add('hidden');
  $('#hud').classList.remove('hidden');
  $('#modeLabel').textContent = label;
  $('#roomPill').classList.toggle('hidden', !room);
  $('#roomPill').querySelector('b').textContent = room;
  $('#playerName').textContent = (game?.players.me?.name || playerName()).toUpperCase();
  $('.avatar').style.backgroundPosition = `${(game?.players.me?.color ?? 0) * 100 / 3}% 0`;
  $('#pauseBtn').classList.toggle('hidden', !game?.offline);
}

function endGame() {
  cancelAnimationFrame(animationFrame);
  resetInput();
  paused = false;
  game = null;
  const previousSocket = socket;
  socket = null;
  previousSocket?.close();
  $('#hud').classList.add('hidden');
  $('#lobby').classList.add('hidden');
  $('#powerModal').classList.add('hidden');
  $('#defeatModal').classList.add('hidden');
  $('#pauseModal').classList.add('hidden');
  $('#menu').classList.remove('hidden');
  fetchOpenRooms();
  animationFrame = requestAnimationFrame(menuLoop);
}

function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('show');
  clearTimeout(element.timer);
  element.timer = setTimeout(() => element.classList.remove('show'), 2200);
}

function serverUrl() {
  return new URLSearchParams(location.search).get('server') || localStorage.getItem('arcana-server') || 'wss://vps65228.publiccloud.com.br/ws';
}

function playerName() {
  return ($('#playerNameInput').value.trim() || 'Arcanista').slice(0, 16);
}

function localizeState(state) {
  const mine = state.players[socket.playerId];
  if (mine) { state.players.me = mine; delete state.players[socket.playerId]; }
  return state;
}

function renderOpenRooms(rooms) {
  const list = $('#openRoomsList');
  list.innerHTML = '';
  if (!rooms.length) {
    const empty = document.createElement('small');
    empty.textContent = 'Nenhuma sala aberta agora. Você pode criar a primeira.';
    list.append(empty);
    return;
  }
  for (const room of rooms) {
    const button = document.createElement('button');
    button.className = 'open-room';
    const description = document.createElement('span');
    const host = document.createElement('b');
    host.textContent = room.host;
    const code = document.createElement('small');
    code.textContent = `Sala ${room.code} • ${room.running ? 'Em andamento' : 'Aguardando jogadores'}`;
    description.append(host, code);
    const occupancy = document.createElement('em');
    occupancy.textContent = `${room.count}/4  ›`;
    button.append(description, occupancy);
    button.onclick = () => connect('join', room.code);
    list.append(button);
  }
}

let cancelRoomRequest = () => {};
function fetchOpenRooms() {
  cancelRoomRequest();
  const list = $('#openRoomsList');
  $('#roomCapacity').textContent = '';
  let listSocket;
  try { listSocket = new WebSocket(serverUrl()); }
  catch { list.innerHTML = '<small>Endereço do servidor inválido.</small>'; return; }
  const timeout = setTimeout(() => {
    list.innerHTML = '<small>O servidor demorou para responder.</small>';
    cancelRoomRequest();
  }, 5000);
  cancelRoomRequest = () => {
    clearTimeout(timeout);
    listSocket.onopen = listSocket.onmessage = listSocket.onclose = null;
    listSocket.onerror = () => {};
    listSocket.close();
    cancelRoomRequest = () => {};
  };
  listSocket.onopen = () => listSocket.send(JSON.stringify({ type: 'listRooms' }));
  listSocket.onmessage = ({ data }) => {
    let message;
    try { message = JSON.parse(data); } catch { return; }
    if (!message || message.type !== 'rooms' || !Array.isArray(message.rooms)) return;
    renderOpenRooms(message.rooms);
    if (message.capacity) {
      const { used, max } = message.capacity;
      $('#roomCapacity').textContent = `${used}/${max} salas em uso${used >= max ? ' • Limite atingido. Entre em uma sala com vagas.' : ''}`;
    }
    cancelRoomRequest();
  };
  listSocket.onerror = listSocket.onclose = () => {
    list.innerHTML = '<small>Não foi possível consultar as salas.</small>';
    cancelRoomRequest();
  };
}

function renderCharacterPicker(element, selected, players, ownId, onChoose, disabled = false) {
  const focused = element.contains(document.activeElement) ? document.activeElement?.dataset.color : undefined;
  element.replaceChildren();
  SPELLS.forEach((spell, color) => {
    const occupant = players.find(p => p.color === color && p.id !== ownId);
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'character-option'; button.dataset.color = color;
    button.setAttribute('aria-pressed', String(color === selected));
    button.style.setProperty('--character-color', spell.tint);
    button.disabled = disabled || Boolean(occupant);
    const portrait = document.createElement('span');
    portrait.className = 'character-portrait'; portrait.setAttribute('aria-hidden', 'true');
    portrait.style.backgroundPosition = `${color * 100 / 3}% 0`;
    const title = document.createElement('b'); title.textContent = characterNames[color];
    const power = document.createElement('span'); power.textContent = spell.name;
    const detail = document.createElement('small');
    detail.textContent = occupant ? `Em uso: ${occupant.name}` : characterEffects[color];
    button.append(portrait, title, power, detail);
    button.onclick = () => onChoose(color);
    element.append(button);
  });
  if (focused !== undefined) element.querySelector(`[data-color="${focused}"]`)?.focus();
}

function selectCharacter(color) {
  selectedCharacter = color;
  localStorage.setItem('arcana-character', String(color));
  renderCharacterPicker($('#characterPicker'), color, [], null, selectCharacter);
  $('.sprite-preview').style.backgroundPosition = `${color * 100 / 3}% 0`;
}

function connect(action, code = '', visibility = 'closed') {
  if (socket) return;
  try { socket = new WebSocket(serverUrl()); } catch { toast('Endereço do servidor inválido'); return; }
  const connection = socket;
  let lobbyPlayers = [];
  let lobbyRunning = false;
  function requestEntry(color) {
    if (socket !== connection || connection.readyState !== 1) return;
    connection.send(JSON.stringify({ type: action, room: code, name: playerName(), visibility, color }));
  }
  function renderLobbyCharacters(disabled = false) {
    renderCharacterPicker($('#lobbyCharacters'), connection.playerId ? connection.color : selectedCharacter,
      lobbyPlayers, connection.playerId, color => {
        if (socket !== connection || connection.readyState !== 1) return;
        if (connection.playerId) connection.send(JSON.stringify({ type: 'selectCharacter', color }));
        else { selectCharacter(color); requestEntry(color); }
      }, disabled || lobbyRunning);
  }
  $('#roomCode').textContent = '------';
  $('#startBtn').disabled = true;
  $('#lobby').classList.remove('hidden');
  $('#lobbyStatus').textContent = 'Conectando ao servidor…';
  $('#lobbyCharacterHint').textContent = 'Você pode trocar de personagem antes da batalha.';
  renderLobbyCharacters(true);
  socket.onopen = () => requestEntry(selectedCharacter);
  socket.onerror = () => { if (socket === connection) $('#lobbyStatus').textContent = 'Não foi possível alcançar o servidor.'; };
  socket.onmessage = ({ data }) => {
    if (socket !== connection) return;
    let message;
    try { message = JSON.parse(data); } catch { return; }
    if (!message || typeof message !== 'object') return;
    if (message.type === 'joined') {
      connection.failure = null;
      socket.playerId = message.playerId; socket.room = message.room;
      connection.color = message.color;
      if (Number.isInteger(message.color)) selectCharacter(message.color);
      $('#roomCode').textContent = message.room;
      $('#lobbyStatus').textContent = `${message.count} jogador(es) no ritual`;
      $('#lobbyVisibility').textContent = message.visibility === 'open'
        ? 'Sala aberta — aparece na lista pública'
        : 'Sala fechada — entrada somente pelo código';
      if (action === 'join') socket.send(JSON.stringify({ type: 'ready' }));
    }
    if (message.type === 'lobby') {
      $('#lobbyStatus').textContent = `${message.count} jogador(es) no ritual`;
      lobbyPlayers = message.players || [];
      lobbyRunning = Boolean(message.running);
      const mine = lobbyPlayers.find(p => p.id === connection.playerId);
      if (mine) { connection.color = mine.color; selectCharacter(mine.color); }
      $('#startBtn').disabled = message.hostId !== connection.playerId || lobbyRunning;
      $('#lobbyCharacterHint').textContent = message.hostId === connection.playerId
        ? 'Escolha seu personagem e comece quando todos estiverem prontos.' : 'Escolha seu personagem e aguarde o anfitrião começar.';
      renderLobbyCharacters();
    }
    if (message.type === 'start') {
      cancelAnimationFrame(animationFrame);
      resetInput();
      game = { offline: false, ...localizeState(message.state) };
      shownPowers = ''; defeatShown = false; gameOverShown = false; shownPhase = '';
      showGame('CO-OP', socket.room); last = performance.now(); animationFrame = requestAnimationFrame(loop);
    }
    if (message.type === 'state' && game) game = { offline: false, ...localizeState(message.state) };
    if (message.type === 'error') {
      connection.failure = message.message;
      toast(message.message);
      $('#lobbyStatus').textContent = message.message;
      if (message.code === 'CHARACTER_TAKEN') {
        lobbyPlayers = message.players || [];
        $('#lobbyCharacterHint').textContent = connection.playerId ? 'Escolha um personagem livre.' : 'Selecione um personagem livre abaixo para entrar.';
        renderLobbyCharacters();
        return;
      }
      if (!connection.playerId) connection.close();
    }
  };
  socket.onclose = () => {
    if (socket !== connection) return;
    socket = null;
    renderLobbyCharacters(true);
    if (game) { endGame(); toast('Conexão encerrada. Você pode iniciar outro ritual.'); }
    else { $('#lobbyStatus').textContent = connection.failure || 'Conexão encerrada. Cancele para tentar novamente.'; $('#startBtn').disabled = true; }
  };
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
selectCharacter(selectedCharacter);
function useSpecial() {
  if (!game || paused || game.over || !game.players.me?.alive || game.players.me.pendingPowers) return;
  if (game.offline) activateSpecial(game, 'me');
  else if (socket?.readyState === 1) socket.send(JSON.stringify({ type: 'special' }));
}
$('#specialBtn').onclick = useSpecial;
$('#createBtn').onclick = () => {
  $('#joinBox').classList.add('hidden');
  const createBox = $('#createBox');
  createBox.classList.toggle('hidden');
  if (!createBox.classList.contains('hidden')) {
    requestAnimationFrame(() => createBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
  }
};
$('#joinToggle').onclick = () => {
  $('#createBox').classList.add('hidden');
  const joinBox = $('#joinBox');
  joinBox.classList.toggle('hidden');
  if (!joinBox.classList.contains('hidden')) {
    fetchOpenRooms();
    requestAnimationFrame(() => joinBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
  }
};
document.querySelectorAll('[data-visibility]').forEach(button => {
  button.onclick = () => {
    selectedVisibility = button.dataset.visibility;
    document.querySelectorAll('[data-visibility]').forEach(option => {
      const selected = option === button;
      option.classList.toggle('selected', selected);
      option.setAttribute('aria-checked', String(selected));
    });
    $('#confirmCreateBtn').textContent = selectedVisibility === 'open' ? 'Criar sala aberta' : 'Criar sala fechada';
  };
});
$('#confirmCreateBtn').onclick = () => connect('create', '', selectedVisibility);
$('#refreshRoomsBtn').onclick = fetchOpenRooms;
$('#joinBtn').onclick = () => {
  const code = $('#roomInput').value.trim().toUpperCase();
  code.length < 4 ? toast('Digite o código da sala') : connect('join', code);
};
$('#startBtn').onclick = () => { if (socket?.readyState === 1) socket.send(JSON.stringify({ type: 'start' })); };
$('#roomCode').onclick = async () => {
  if (!socket?.room) return;
  try { await navigator.clipboard.writeText(socket.room); toast('Código copiado'); }
  catch { toast(`Compartilhe o código: ${socket.room}`); }
};
document.querySelectorAll('.backBtn').forEach(button => { button.onclick = endGame; });
$('#exitBtn').onclick = endGame;
$('#defeatExit').onclick = endGame;
$('#spectateBtn').onclick = () => $('#defeatModal').classList.add('hidden');
$('#pauseBtn').onclick = () => togglePause();
$('#resumeBtn').onclick = () => togglePause(false);
$('#settingsBtn').onclick = () => $('#settings').classList.toggle('hidden');
$('#serverUrl').value = serverUrl();
$('#saveServer').onclick = () => { localStorage.setItem('arcana-server', $('#serverUrl').value.trim()); toast('Servidor salvo'); fetchOpenRooms(); };

function refreshMenuRooms() {
  if (!document.hidden && !game && !socket && $('#lobby').classList.contains('hidden')) fetchOpenRooms();
}
refreshMenuRooms();
setInterval(refreshMenuRooms, 10000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshMenuRooms(); });
$('#playerNameInput').value = localStorage.getItem('arcana-player-name') || '';
$('#playerNameInput').addEventListener('change', () => localStorage.setItem('arcana-player-name', playerName()));
