import './style.css';
import './enhancements.css';
import { activateSpecial, applyPower, createGameState, createPlayer, rerollPowers, updateGame } from '../server/game.js';
import { PHASES } from '../server/phases.js';
import { createAnimator } from './animation.js';
import { createAudio } from './audio.js';
import { createHud, format } from './hud.js';
import { createInput } from './input.js';
import { createMenu, playerName, renderCharacterPicker, serverUrl } from './menu.js';
import { createSession, savedSession } from './net.js';
import { POWER_INFO } from './powerInfo.js';
import { renderWorld } from './render.js';
import { createWallet } from './wallet.js';

const $ = selector => document.querySelector(selector);
const canvas = $('#game');
const ctx = canvas.getContext('2d');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let W = innerWidth, H = innerHeight, dpr = 1;

const audio = createAudio();
const hud = createHud();
const wallet = createWallet();
const animator = createAnimator({ onHit: () => audio.play('hit'), onKill: () => audio.play('kill') });

let mode = 'menu'; // menu | offline | online
let game = null;   // offline simulation
let session = null;
let view = null;   // what is drawn this frame (offline state or interpolated co-op snapshot)
let meId = null;
let paused = false;
let last = performance.now();
let round = null;

const controls = createInput({
  joystick: $('#joystick'),
  isPlaying: () => mode !== 'menu',
  onPause: () => togglePause(),
  onSpecial: () => useSpecial()
});

const menu = createMenu({
  wallet, audio, toast: hud.toast,
  onOffline: startOffline,
  onCreate: visibility => connect('create', '', visibility),
  onJoin: code => connect('join', code),
  isIdle: () => mode === 'menu' && !session && $('#lobby').classList.contains('hidden')
});

function resize() {
  dpr = Math.min(devicePixelRatio, 2);
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  canvas.style.width = `${innerWidth}px`;
  canvas.style.height = `${innerHeight}px`;
  W = innerWidth;
  H = innerHeight;
}
addEventListener('resize', resize);
resize();

function backdrop(time) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#071117';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(101,181,157,.055)';
  for (let x = (W / 2) % 64; x < W; x += 64) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = (H / 2) % 64; y < H; y += 64) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  for (let i = 0; i < 35; i++) {
    const x = (i * 197 + time * 0.004 * (i % 3 + 1)) % (W + 100) - 50;
    const y = (i * 113) % (H + 60) - 30;
    ctx.fillStyle = `rgba(94,208,170,${0.025 + (i % 4) * 0.009})`;
    ctx.beginPath(); ctx.arc(x, y, 2 + i % 3, 0, 7); ctx.fill();
  }
  const cx = W * 0.72, cy = H * 0.52;
  ctx.strokeStyle = 'rgba(95,214,179,.08)';
  for (let radius = 140; radius < 350; radius += 48) {
    ctx.beginPath(); ctx.arc(cx, cy, radius + Math.sin(time / 1800 + radius) * 5, 0, Math.PI * 2); ctx.stroke();
  }
}

function newRound() {
  return { defeatShown: false, gameOverShown: false, deposited: false, lastMe: null, lastEventId: null, hazards: 0, low: false };
}

function feedback(me) {
  const previous = round.lastMe;
  round.lastMe = { hp: me.hp, level: me.level, xp: me.xp, coins: me.coins, charge: me.specialCharge, cast: me.castCount, alive: me.alive };
  const events = view.events || [];
  if (round.lastEventId === null) round.lastEventId = events.reduce((max, event) => Math.max(max, event.id), 0);
  const focus = me.alive === false ? Object.values(view.players).find(p => p.alive !== false) || me : me;
  for (const event of events) {
    if (event.id <= round.lastEventId) continue;
    round.lastEventId = event.id;
    const near = event.x === undefined || Math.hypot(event.x - focus.x, event.y - focus.y) < 800;
    const phase = PHASES[view.phase || 0];
    if (event.kind === 'boss') { audio.play('boss'); hud.announce(`${phase.bossName} despertou!`, 'danger'); }
    else if (event.kind === 'stage') { audio.play('stage'); hud.announce(event.stage === 3 ? 'Fúria final do guardião!' : 'O guardião entrou em fúria!', 'danger'); }
    else if (event.kind === 'bossDown') { audio.play('bossDown'); hud.announce(`${phase.bossName} caiu!`, 'gold'); }
    else if (event.kind === 'elite') { audio.play('elite'); hud.announce('Uma elite surgiu — derrote-a para ganhar um baú', 'gold'); }
    else if (event.kind === 'ring') { audio.play('warning'); hud.announce('Enxame! Abra caminho', 'danger'); }
    else if (event.kind === 'chest' && event.player === me.id) { audio.play('chest'); hud.toast('Baú aberto: escolha uma recompensa'); }
    else if (event.kind === 'magnet' && near) audio.play('magnet');
    else if (event.kind === 'boom' && near) audio.play('boom');
    else if (event.kind === 'chain' && near) audio.play('chain');
    else if (event.kind === 'revive' && near) audio.play('revive');
    else if (event.kind === 'phoenix') { audio.play('phoenix'); hud.announce('Fênix! Um arcanista renasceu', 'gold'); }
    else if (event.kind === 'special' && near) audio.play('special');
  }
  const hazards = view.hazards?.length || 0;
  if (hazards > round.hazards) audio.play('warning');
  round.hazards = hazards;
  const low = me.alive !== false && me.hp / me.maxHp < 0.3;
  if (low !== round.low) { round.low = low; $('#damageVignette').classList.toggle('low', low); }
  if (!previous) return;
  if (me.hp < previous.hp - 0.5 && me.alive) { audio.play('hurt'); hud.flashDamage(); animator.shake(4); }
  if (me.level > previous.level) audio.play('level');
  else if (me.xp > previous.xp) audio.play('gem');
  if (me.hp > previous.hp + 10 && me.level === previous.level) audio.play('heart');
  if (me.coins > previous.coins) audio.play('coin');
  if (me.specialCharge > previous.charge && me.specialCharge - previous.charge >= 20) audio.play('crystal');
  if (me.castCount > previous.cast) audio.play('shoot');
}

function depositCoins() {
  if (!round || round.deposited) return;
  round.deposited = true;
  const coins = view?.players[meId]?.coins || 0;
  wallet.deposit(coins);
  menu.renderShop();
  return coins;
}

function showDefeat(allDead) {
  round.defeatShown = true;
  round.gameOverShown = allDead;
  const me = view.players[meId];
  $('#defeatTitle').textContent = view.victory ? 'Ritual concluído!' : allDead ? 'Ritual encerrado' : 'Você caiu';
  $('#defeatText').textContent = view.victory ? 'Os três guardiões caíram. A aurora pertence aos arcanistas.'
    : allDead ? 'Nenhum arcanista permaneceu de pé.' : 'Um aliado pode ressuscitar você permanecendo dentro do círculo por 4 segundos.';
  $('#finalStats').textContent = `TEMPO ${format(view.time)}  •  NÍVEL ${me.level}  •  FASE ${(view.phase || 0) + 1}/3  •  MOEDAS ${me.coins || 0}`;
  $('#defeatModal').classList.toggle('victory', Boolean(view.victory));
  $('#spectateBtn').classList.toggle('hidden', allDead);
  const table = $('#resultsTable');
  table.classList.toggle('hidden', !allDead);
  $('#coinsEarned').classList.toggle('hidden', !allDead);
  if (allDead) {
    audio.play(view.victory ? 'victory' : 'defeat');
    const earned = depositCoins() || 0;
    $('#coinsEarned').textContent = `+${earned} moedas guardadas no Grimório · total ${wallet.coins}`;
    const header = document.createElement('tr');
    for (const label of ['Arcanista', 'Nível', 'Abates', 'Dano', 'Resgates']) { const th = document.createElement('th'); th.textContent = label; header.append(th); }
    const rows = Object.values(view.players).sort((a, b) => (b.stats?.damage || 0) - (a.stats?.damage || 0)).map(player => {
      const tr = document.createElement('tr');
      if (player.id === me.id) tr.className = 'me';
      for (const value of [player.name, player.level, player.stats?.kills ?? 0, Math.round(player.stats?.damage ?? 0).toLocaleString('pt-BR'), player.stats?.revives ?? 0]) {
        const td = document.createElement('td'); td.textContent = value; tr.append(td);
      }
      return tr;
    });
    table.replaceChildren(header, ...rows);
  }
  $('#defeatModal').classList.remove('hidden');
}

function syncOverlays(me) {
  if (me.alive && round.defeatShown && !view.over) {
    round.defeatShown = false;
    $('#defeatModal').classList.add('hidden');
    controls.reset();
    hud.toast('Você foi ressuscitado!');
  }
  if (me.alive === false && !round.defeatShown) showDefeat(view.over);
  if (view.over && !round.gameOverShown) showDefeat(true);
}

function choosePower(id) {
  const me = view?.players[meId];
  if (!me?.pendingPowers?.includes(id)) return;
  hud.hidePowers(me.pendingPowers.join(','));
  if (mode === 'offline') applyPower(game.players.me, id);
  else session?.send({ type: 'choosePower', power: id });
  audio.play('power');
  hud.toast(`${POWER_INFO[id][1]} adquirido`);
}

function reroll() {
  const me = view?.players[meId];
  if (!me?.pendingPowers || !(me.rerolls > 0)) return;
  if (mode === 'offline') rerollPowers(game.players.me, Math.random, { coop: false });
  else session?.send({ type: 'reroll' });
  audio.play('click');
}

addEventListener('keydown', event => {
  if (mode === 'menu' || $('#powerModal').classList.contains('hidden') || event.repeat) return;
  const choices = view?.players[meId]?.pendingPowers;
  const index = ['1', '2', '3'].indexOf(event.key);
  if (index >= 0 && choices?.[index]) choosePower(choices[index]);
  if (event.key.toLowerCase() === 'r') reroll();
});

function step(now, dt) {
  if (mode === 'menu') { backdrop(now); return; }
  const input = paused ? { x: 0, y: 0 } : controls.read();
  if (mode === 'offline') {
    const me = game.players.me;
    me.input = me.alive && !me.pendingPowers ? input : { x: 0, y: 0 };
    if (!paused && !me.pendingPowers?.length) updateGame(game, dt);
    view = game;
    meId = 'me';
  } else {
    const next = session?.frame(now, dt, input);
    if (!next) return;
    view = next;
    meId = session.playerId;
  }
  const me = view.players[meId];
  if (!me) return;
  const choosing = hud.syncPowers(me, { offline: mode === 'offline', onChoose: choosePower, onReroll: reroll });
  syncOverlays(me);
  animator.update(view, dt, { paused: paused || (mode === 'offline' && choosing), reduced: reducedMotion.matches });
  feedback(me);
  const focus = me.alive === false ? Object.values(view.players).find(p => p.alive !== false) || me : me;
  renderWorld(ctx, view, { me, focus, animator, W, H, dpr, reduced: reducedMotion.matches, offline: mode === 'offline' });
  hud.update(view, me, { paused, offline: mode === 'offline' });
}

function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  step(now, dt);
}
requestAnimationFrame(loop);

function showGame(label, room = '') {
  animator.reset();
  hud.resetCaches();
  controls.reset();
  round = newRound();
  paused = false;
  audio.unlock();
  $('#menu').classList.add('hidden');
  $('#lobby').classList.add('hidden');
  $('#shopModal').classList.add('hidden');
  $('#hud').classList.remove('hidden');
  $('#defeatModal').classList.add('hidden');
  $('#modeLabel').textContent = label;
  $('#roomPill').classList.toggle('hidden', !room);
  $('#roomPill').querySelector('b').textContent = room;
  $('#playerName').textContent = playerName().toUpperCase();
  $('.avatar').style.backgroundPosition = `${(mode === 'offline' ? menu.character : session?.color ?? 0) * 100 / 3}% 0`;
  $('#pauseBtn').classList.toggle('hidden', mode !== 'offline');
  $('#muteBtn').textContent = audio.muted ? '♪̸' : '♪';
}

function startOffline() {
  if (session) return;
  game = createGameState();
  game.offline = true;
  game.players.me = createPlayer('me', playerName(), menu.character, wallet.upgrades);
  mode = 'offline';
  showGame('SOZINHO');
}

function endGame() {
  if (mode !== 'menu' && view) depositCoins();
  mode = 'menu';
  animator.reset();
  controls.reset();
  paused = false;
  game = null;
  view = null;
  round = null;
  const previous = session;
  session = null;
  previous?.close();
  hud.setReconnecting(false);
  hud.hidePowers();
  for (const id of ['hud', 'lobby', 'defeatModal', 'pauseModal']) $(`#${id}`).classList.add('hidden');
  $('#damageVignette').classList.remove('low');
  $('#menu').classList.remove('hidden');
  menu.fetchOpenRooms();
}

function togglePause(force) {
  if (mode !== 'offline' || view?.over) return;
  paused = typeof force === 'boolean' ? force : !paused;
  controls.reset();
  $('#pauseModal').classList.toggle('hidden', !paused);
}
addEventListener('blur', () => { controls.reset(); togglePause(true); });
document.addEventListener('visibilitychange', () => { if (document.hidden) { controls.reset(); togglePause(true); } });

function useSpecial() {
  const me = view?.players[meId];
  if (mode === 'menu' || paused || view?.over || !me?.alive || me.pendingPowers) return;
  if (mode === 'offline') activateSpecial(game, 'me');
  else session?.send({ type: 'special' });
}

function connect(action, code = '', visibility = 'closed', resume = null) {
  if (session || mode !== 'menu') return;
  let lobbyPlayers = [];
  let lobbyRunning = false;
  const entry = { action, code, visibility, name: playerName(), color: menu.character, meta: wallet.upgrades, resume };
  const requestEntry = color => current.send({ type: action, room: code, name: playerName(), visibility, color, meta: wallet.upgrades });
  const renderLobbyCharacters = (disabled = false) => {
    renderCharacterPicker($('#lobbyCharacters'), current.playerId ? current.color : menu.character, lobbyPlayers, current.playerId, color => {
      if (session !== current) return;
      if (current.playerId) current.send({ type: 'selectCharacter', color });
      else { menu.selectCharacter(color); requestEntry(color); }
    }, disabled || lobbyRunning);
  };
  const current = session = createSession(resume?.url || serverUrl(), entry, {
    onJoined(message) {
      if (session !== current) return;
      if (Number.isInteger(message.color)) menu.selectCharacter(message.color);
      $('#roomCode').textContent = message.room;
      $('#lobbyStatus').textContent = `${message.count} jogador(es) no ritual`;
      $('#lobbyVisibility').textContent = message.visibility === 'open' ? 'Sala aberta — aparece na lista pública' : 'Sala fechada — entrada somente pelo código';
    },
    onLobby(message) {
      if (session !== current) return;
      $('#lobbyStatus').textContent = `${message.count} jogador(es) no ritual`;
      lobbyPlayers = message.players || [];
      lobbyRunning = Boolean(message.running);
      const mine = lobbyPlayers.find(p => p.id === current.playerId);
      if (mine) { current.color = mine.color; menu.selectCharacter(mine.color); }
      $('#startBtn').disabled = message.hostId !== current.playerId || lobbyRunning;
      $('#lobbyCharacterHint').textContent = message.hostId === current.playerId
        ? 'Escolha seu personagem e comece quando todos estiverem prontos.' : 'Escolha seu personagem e aguarde o anfitrião começar.';
      renderLobbyCharacters();
    },
    onStart() {
      if (session !== current) return;
      mode = 'online';
      showGame('CO-OP', current.room);
    },
    onReconnecting(active) { if (session === current) hud.setReconnecting(active); },
    onError(message) {
      if (session !== current) return;
      if (message.code === 'RESUME_FAILED') {
        session = null; current.close();
        if (mode === 'online') { endGame(); hud.toast('Não foi possível voltar à partida.'); }
        return;
      }
      hud.toast(message.message);
      $('#lobbyStatus').textContent = message.message;
      if (message.code === 'CHARACTER_TAKEN') {
        lobbyPlayers = message.players || [];
        $('#lobbyCharacterHint').textContent = current.playerId ? 'Escolha um personagem livre.' : 'Selecione um personagem livre abaixo para entrar.';
        renderLobbyCharacters();
      } else if (!current.playerId && !message.transport) {
        session = null; current.close();
        $('#startBtn').disabled = true;
      }
    },
    onClosed({ over, failure, reason }) {
      if (session !== current) return;
      session = null;
      hud.setReconnecting(false);
      if (mode === 'online') {
        if (!over) { endGame(); hud.toast(reason || 'Conexão encerrada. Você pode iniciar outro ritual.'); }
        return;
      }
      $('#lobbyStatus').textContent = failure || reason || 'Conexão encerrada. Cancele para tentar novamente.';
      $('#startBtn').disabled = true;
      renderLobbyCharacters(true);
    }
  });
  if (resume) { hud.toast('Voltando à partida…'); return; }
  $('#roomCode').textContent = '------';
  $('#startBtn').disabled = true;
  $('#lobby').classList.remove('hidden');
  $('#lobbyStatus').textContent = 'Conectando ao servidor…';
  $('#lobbyCharacterHint').textContent = 'Você pode trocar de personagem antes da batalha.';
  renderLobbyCharacters(true);
}

$('#specialBtn').onclick = useSpecial;
$('#startBtn').onclick = () => session?.send({ type: 'start' });
$('#roomCode').onclick = async () => {
  if (!session?.room) return;
  try { await navigator.clipboard.writeText(session.room); hud.toast('Código copiado'); }
  catch { hud.toast(`Compartilhe o código: ${session.room}`); }
};
for (const button of /** @type {NodeListOf<HTMLButtonElement>} */ (document.querySelectorAll('.backBtn'))) button.onclick = endGame;
$('#exitBtn').onclick = endGame;
$('#defeatExit').onclick = endGame;
$('#spectateBtn').onclick = () => $('#defeatModal').classList.add('hidden');
$('#pauseBtn').onclick = () => togglePause();
$('#resumeBtn').onclick = () => togglePause(false);
$('#muteBtn').onclick = () => { $('#muteBtn').textContent = audio.toggleMute() ? '♪̸' : '♪'; };
addEventListener('pointerdown', () => audio.unlock(), { once: true });

const pendingResume = savedSession();
if (pendingResume) connect('join', pendingResume.room, 'closed', pendingResume);

if (import.meta.env?.DEV) {
  // Debug hook: the in-app browser pane does not run requestAnimationFrame, so frames can be pumped by hand.
  /** @type {any} */ (window).__ARCANA__ = {
    step(frames = 1, ms = 16) { for (let n = 0; n < frames; n++) { last = performance.now(); step(last, ms / 1000); } },
    startOffline, endGame,
    get game() { return game; },
    get view() { return view; }
  };
}
