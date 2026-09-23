import './style.css';
import { characterPortrait } from './characterPortrait.js';
import './enhancements.css';
import './mobile.css';
import './desktop.css';
import '@fontsource/cinzel/latin-600.css';
import '@fontsource/cinzel/latin-700.css';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/inter/latin-800.css';
import { setupPwa } from './pwa.js';
import { activateDash, activateSpecial, applyPower, rerollPowers } from '../server/game.js';
import { CAMPAIGNS } from '../server/campaign.js';
import { PHASES } from '../server/phases.js';
import { CURSES } from '../server/curses.js';
import { sendSignal } from '../server/game.js';
import { PROTOCOL_VERSION } from '../server/protocol.js';
import { createCodex } from './codex.js';
import { moodFor } from './music.js';
import { createAnimator } from './animation.js';
import { createAudio } from './audio.js';
import { drawBackdrop } from './backdrop.js';
import { createFeedback, newRound } from './feedback.js';
import { createHud, format } from './hud.js';
import { bindActionButton, createInput } from './input.js';
import { advanceOfflineRun, chooserOf, createOfflineRun, localPlayersOf, offlineActor, renderLocalViews } from './localCoop.js';
import { createMenu, playerName, renderCharacterPicker, saveDailyRecord, serverUrl } from './menu.js';
import { createSession, savedSession } from './net.js';
import { DAMAGE_SOURCES, POWER_INFO } from './powerInfo.js';
import { createWallet } from './wallet.js';

const $ = selector => document.querySelector(selector);
const canvas = $('#game');
const ctx = canvas.getContext('2d');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const mobileQuery = matchMedia('(max-width: 800px), (pointer: coarse) and (max-width: 1400px), (max-height: 500px) and (orientation: landscape)');
const isMobile = () => mobileQuery.matches;
const MOBILE_ZOOM = 0.8;
let W = innerWidth, H = innerHeight, dpr = 1;

const audio = createAudio();
const hud = createHud();
const wallet = createWallet();
const animator = createAnimator({ onHit: () => audio.play('hit'), onKill: () => audio.play('kill') });
// Only discoveries worth interrupting play for get a toast; creatures and ordinary powers are logged silently.
const codex = createCodex({
  onDiscover(section, entry) {
    if (mode === 'menu' || !entry) return;
    if (section === 'reactions' || section === 'bosses' || section === 'encounters' || (section === 'powers' && entry.tag === 'Evolução')) {
      hud.toast(`Códex: ${entry.name} registrado`);
    }
  }
});
const feedback = createFeedback({ audio, hud, codex, animator });

let mode = 'menu'; // menu | offline | online
let run = null;    // offline run (see localCoop.js)
let game = null;   // offline simulation, run.game
let session = null;
let view = null;   // what is drawn this frame (offline state or interpolated co-op snapshot)
let meId = null;
let paused = false;
let last = performance.now();
let round = null;
let camera = { x: 0, y: 0, zoom: 1 };
let local = ['me']; // offline player ids driven from this keyboard, in slot order (split screen has two)
const isSplit = () => mode === 'offline' && local.length > 1;
/** The players this machine controls: both halves in split screen, otherwise just this player. */
const localPlayers = () => (mode === 'offline' ? localPlayersOf(view, local) : [view?.players[meId]].filter(Boolean));
/** Whoever owes a power choice right now; split screen resolves one player at a time. */
const chooser = () => chooserOf(localPlayers(), view?.players[meId]);

const controls = createInput({
  joystick: $('#joystick'),
  isPlaying: () => mode !== 'menu',
  isSplit,
  onPause: () => togglePause(),
  onSpecial: slot => useSpecial(slot),
  onDash: slot => useDash(slot)
});

const menu = createMenu({
  wallet, codex, audio, toast: hud.toast,
  onOffline: () => startOffline(),
  onSplit: () => startOffline(null, true),
  onDaily: challenge => startOffline(challenge),
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

/** Bars for how much each weapon, spell and combo contributed, so the build that worked is visible. */
function renderDamageBreakdown(player) {
  const box = $('#damageBreakdown');
  const sources = Object.entries(player?.stats?.by || {}).filter(([, value]) => value >= 1).sort((a, b) => b[1] - a[1]);
  box.classList.toggle('hidden', !sources.length);
  if (!sources.length) return;
  const total = sources.reduce((sum, [, value]) => sum + value, 0);
  const title = document.createElement('h3');
  title.textContent = 'SEU DANO POR FONTE';
  box.replaceChildren(title, ...sources.map(([kind, value]) => {
    const row = document.createElement('div');
    row.className = 'damage-row';
    const [icon, label] = DAMAGE_SOURCES[kind] || ['•', kind];
    const iconEl = document.createElement('i'); iconEl.textContent = icon;
    const name = document.createElement('span'); name.textContent = label;
    const bar = document.createElement('div'); bar.className = 'bar';
    const fill = document.createElement('i'); fill.style.width = `${(value / sources[0][1]) * 100}%`; bar.append(fill);
    const amount = document.createElement('span'); amount.textContent = `${Math.round(value / total * 100)}%`;
    amount.title = Math.round(value).toLocaleString('pt-BR');
    row.append(iconEl, name, bar, amount);
    return row;
  }));
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
  $('#defeatText').textContent = view.victory ? 'Todos os guardiões caíram. A aurora pertence aos arcanistas.'
    : allDead ? 'Nenhum arcanista permaneceu de pé.' : 'Um aliado pode ressuscitar você permanecendo dentro do círculo por 4 segundos.';
  const unlockedAurora = allDead && menu.recordVictory(view);
  $('#characterReward').classList.toggle('hidden', !unlockedAurora);
  $('#characterReward').textContent = unlockedAurora ? '☀ Guardião da Aurora desbloqueado! Seu novo personagem está disponível no menu.' : '';
  $('#finalStats').textContent = `TEMPO ${format(view.time)}  •  NÍVEL ${me.level}  •  FASE ${(view.phase || 0) + 1}/${PHASES.length}${view.loop ? ` · VOLTA ${view.loop + 1}` : ''}  •  MOEDAS ${me.coins || 0}`;
  renderDamageBreakdown(allDead ? me : null);
  $('#dailyResult').classList.add('hidden');
  if (allDead && game?.daily && !round.dailySaved) {
    round.dailySaved = true;
    const { improved, best } = saveDailyRecord(game.daily, { phase: (view.phase || 0) + 1, loop: view.loop || 0, time: Math.round(view.time), victory: Boolean(view.victory) });
    $('#dailyResult').textContent = improved ? `Novo recorde do desafio diário: reino ${best.phase} em ${format(best.time)}`
      : `Recorde de hoje: reino ${best.phase} em ${format(best.time)}`;
    $('#dailyResult').classList.remove('hidden');
    menu.renderOptions();
  }
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
  // In split screen the partner can still revive a fallen player, so only the end of the run shows results.
  if (me.alive === false && !round.defeatShown && !isSplit()) showDefeat(view.over);
  if (view.over && !round.gameOverShown) showDefeat(true);
}

function choosePower(id) {
  const me = chooser();
  if (!me?.pendingPowers?.includes(id)) return;
  hud.hidePowers(me.pendingPowers.join(','));
  if (mode === 'offline') applyPower(game.players[me.id], id);
  else session?.send({ type: 'choosePower', power: id });
  audio.play('power');
  hud.toast(`${POWER_INFO[id][1]} adquirido`);
}

function reroll() {
  const me = chooser();
  if (!me?.pendingPowers || !(me.rerolls > 0)) return;
  if (mode === 'offline') rerollPowers(game.players[me.id], game.random, { coop: isSplit() });
  else session?.send({ type: 'reroll' });
  audio.play('click');
}

addEventListener('keydown', event => {
  if (mode === 'menu' || $('#powerModal').classList.contains('hidden') || event.repeat) return;
  const choices = chooser()?.pendingPowers;
  const index = ['1', '2', '3'].indexOf(event.key);
  if (index >= 0 && choices?.[index]) choosePower(choices[index]);
  if (event.key.toLowerCase() === 'r') reroll();
});

function signal(kind, at = null) {
  if (mode !== 'online' || !view || view.over || !view.players[meId]?.alive) return;
  session?.send({ type: 'signal', signal: kind, ...(at ? { x: Math.round(at.x), y: Math.round(at.y) } : {}) });
}
const SIGNAL_KEYS = { q: 'here', e: 'help', x: 'danger' };
addEventListener('keydown', event => {
  if (event.repeat || event.target instanceof HTMLInputElement || !$('#powerModal').classList.contains('hidden')) return;
  const kind = SIGNAL_KEYS[event.key.toLowerCase()];
  if (kind) signal(kind);
});
canvas.addEventListener('click', event => {
  const z = camera.zoom || 1;
  signal('look', { x: camera.x + event.clientX / z, y: camera.y + event.clientY / z });
});
for (const button of /** @type {NodeListOf<HTMLButtonElement>} */ (document.querySelectorAll('[data-signal]'))) {
  button.onclick = () => signal(button.dataset.signal);
}

function step(now, dt) {
  if (mode === 'menu') { drawBackdrop(ctx, W, H, dpr, now); audio.music('menu'); return; }
  const still = { x: 0, y: 0 };
  if (mode === 'offline') {
    advanceOfflineRun(run, dt, { paused, read: slot => controls.read(slot) });
    view = game;
    meId = 'me';
  } else {
    const next = session?.frame(now, dt, paused ? still : controls.read());
    if (!next) return;
    view = next;
    meId = session.playerId;
  }
  const me = view.players[meId];
  if (!me) return;
  const split = isSplit();
  const mine = localPlayers();
  const picker = chooser();
  const choosing = hud.syncPowers(picker, { offline: mode === 'offline', onChoose: choosePower, onReroll: reroll,
    title: split ? `Novo poder · Jogador ${local.indexOf(picker.id) + 1}` : undefined });
  syncOverlays(me);
  animator.update(view, dt, { paused: paused || (mode === 'offline' && choosing), reduced: reducedMotion.matches });
  feedback(view, round, mine);
  codex.observe(view, me, now);
  audio.music(paused ? 'menu' : moodFor(view, mode), view.phase || 0);
  const reduced = reducedMotion.matches;
  const blocked = paused || choosing || view.over || view.phaseStatus === 'transition';
  const zoom = isMobile() ? MOBILE_ZOOM : 1;
  camera = renderLocalViews(ctx, view, { me, mine, split, animator, W, H, dpr, reduced, offline: mode === 'offline', blocked, zoom }) || camera;
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
  characterPortrait($('.avatar'), mode === 'offline' ? menu.character : session?.color ?? 0);
  $('#pauseBtn').classList.toggle('hidden', mode !== 'offline');
  $('#hud').classList.toggle('coop', mode === 'online');
  $('#hud').classList.toggle('split', isSplit());
  $('#codexModal').classList.add('hidden');
  $('#muteBtn').textContent = audio.muted ? '♪̸' : '♪';
}

/**
 * Solo run; a daily challenge fixes the seed, curses and character, and ignores permanent upgrades so scores compare.
 * Split screen adds a second player on the same keyboard, sharing this browser's Grimório upgrades.
 */
function startOffline(challenge = null, split = false) {
  if (session) return;
  run = createOfflineRun({ challenge, split, campaign: menu.campaign, curses: menu.curses, name: playerName(),
    character: menu.character, secondCharacter: menu.secondCharacter, upgrades: wallet.upgrades, loadout: menu.loadout });
  ({ game, local } = run);
  if (challenge) menu.selectCharacter(challenge.character);
  mode = 'offline';
  const curses = game.curses.map(id => CURSES[id].title).join(' + ');
  showGame(challenge ? `DESAFIO DIÁRIO · ${curses}`
    : `${isSplit() ? 'TELA DIVIDIDA' : 'SOLO'} · ${CAMPAIGNS[game.campaign].name}${curses ? ` · ${curses}` : ''}`);
}

function endGame() {
  if (mode !== 'menu' && view) depositCoins();
  mode = 'menu';
  animator.reset();
  controls.reset();
  paused = false;
  run = null;
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

/** The player a keyboard slot acts for, or null when that player cannot act right now. */
function actor(slot) {
  if (mode === 'offline') return offlineActor(view, local, slot, paused);
  const me = slot ? null : view?.players[meId];
  if (mode === 'menu' || paused || view?.over || !me?.alive || me.pendingPowers) return null;
  return me;
}

function useSpecial(slot = 0) {
  const me = actor(slot);
  if (!me) return;
  if (mode === 'offline') activateSpecial(game, me.id, game.random);
  else session?.send({ type: 'special' });
}

function useDash(slot = 0) {
  const me = actor(slot);
  if (!me) return;
  const input = controls.read(slot);
  if (mode === 'offline') activateDash(game, me.id, input);
  else session?.send({ type: 'dash', ...input });
}

function connect(action, code = '', visibility = 'closed', resume = null) {
  if (!navigator.onLine) { hud.toast('O co-op precisa de internet. Use Jogar offline.'); return; }
  if (session || mode !== 'menu') return;
  let lobbyPlayers = [];
  let lobbyRunning = false;
  const entry = { action, code, visibility, name: playerName(), color: menu.character, meta: wallet.upgrades, campaign: menu.campaign,
    curses: menu.curses, loadout: menu.loadout, unlocks: menu.unlocks, resume };
  const requestEntry = color => current.send({ type: action, v: PROTOCOL_VERSION, room: code, name: playerName(), visibility, color, meta: wallet.upgrades,
    campaign: menu.campaign, curses: menu.curses, loadout: menu.loadout, unlocks: menu.unlocks });
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
      const curses = (message.curses || []).map(id => CURSES[id]?.title).filter(Boolean);
      $('#lobbyCampaign').textContent = `${CAMPAIGNS[message.campaign || 'classic'].name} · todas as 6 fases${curses.length ? ` · Maldições: ${curses.join(', ')}` : ''}`;
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

bindActionButton($('#specialBtn'), () => useSpecial());
bindActionButton($('#dashBtn'), () => useDash());
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
if (pendingResume && navigator.onLine) connect('join', pendingResume.room, 'closed', pendingResume);
setupPwa({ isIdle: () => mode === 'menu' && !session });

if (import.meta.env?.DEV) {
  // Debug hook: the in-app browser pane does not run requestAnimationFrame, so frames can be pumped by hand.
  /** @type {any} */ (window).__ARCANA__ = {
    step(frames = 1, ms = 16) { for (let n = 0; n < frames; n++) { last = performance.now(); step(last, ms / 1000); } },
    startOffline, endGame, codex, sendSignal,
    get game() { return game; },
    get view() { return view; }
  };
}
