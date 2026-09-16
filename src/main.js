import './style.css';
import './enhancements.css';
import { activateDash, activateSpecial, applyPower, createGameState, createPlayer, rerollPowers, updateGame } from '../server/game.js';
import { CAMPAIGNS } from '../server/campaign.js';
import { PHASES } from '../server/phases.js';
import { CURSES, seededRandom } from '../server/curses.js';
import { sendSignal } from '../server/game.js';
import { createCodex } from './codex.js';
import { moodFor } from './music.js';
import { createAnimator } from './animation.js';
import { createAudio } from './audio.js';
import { createHud, format } from './hud.js';
import { createInput } from './input.js';
import { createMenu, playerName, renderCharacterPicker, saveDailyRecord, serverUrl } from './menu.js';
import { createSession, savedSession } from './net.js';
import { DAMAGE_SOURCES, POWER_INFO } from './powerInfo.js';
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
// Only discoveries worth interrupting play for get a toast; creatures and ordinary powers are logged silently.
const codex = createCodex({
  onDiscover(section, entry) {
    if (mode === 'menu' || !entry) return;
    if (section === 'reactions' || section === 'bosses' || section === 'encounters' || (section === 'powers' && entry.tag === 'Evolução')) {
      hud.toast(`Códex: ${entry.name} registrado`);
    }
  }
});
const FIXED_STEP = 1 / 60;

let mode = 'menu'; // menu | offline | online
let game = null;   // offline simulation
let session = null;
let view = null;   // what is drawn this frame (offline state or interpolated co-op snapshot)
let meId = null;
let paused = false;
let last = performance.now();
let round = null;
let accumulator = 0;
let camera = { x: 0, y: 0 };

const controls = createInput({
  joystick: $('#joystick'),
  isPlaying: () => mode !== 'menu',
  onPause: () => togglePause(),
  onSpecial: () => useSpecial(),
  onDash: () => useDash()
});

const menu = createMenu({
  wallet, codex, audio, toast: hud.toast,
  onOffline: () => startOffline(),
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
    const phase = PHASES[event.kind === 'bossDown' ? event.phase ?? view.phase ?? 0 : view.phase || 0];
    codex.observeEvent(event, event.phase ?? view.phase ?? 0);
    if (event.kind === 'boss') { audio.play('boss'); hud.announce(`${phase.bossName} despertou!`, 'danger'); }
    else if (event.kind === 'stage') { audio.play('stage'); hud.announce(event.stage === 3 ? 'Fúria final do guardião!' : 'O guardião entrou em fúria!', 'danger'); }
    else if (event.kind === 'bossDown') { audio.play('bossDown'); hud.announce(`${phase.bossName} caiu!`, 'gold'); }
    else if (event.kind === 'elite') { audio.play('elite'); hud.announce('Uma elite surgiu — derrote-a para ganhar um baú', 'gold'); }
    else if (event.kind === 'ring') { audio.play('warning'); hud.announce('Enxame! Abra caminho', 'danger'); }
    else if (event.kind === 'chest') { audio.play('chest'); hud.toast('Baú compartilhado: todos recebem um poder'); }
    else if (event.kind === 'altar') { audio.play('elite'); hud.announce('Altar opcional: defenda por 15s para ganhar um poder', 'gold'); }
    else if (event.kind === 'altarComplete') { audio.play('chest'); hud.announce('Altar purificado! Poder e moedas para todos', 'gold'); }
    else if (event.kind === 'altarExpired') hud.toast('O altar se apagou. A campanha continua.');
    else if (event.kind === 'combo' && event.team) { audio.play('teamCombo'); if (near) hud.toast('Combo em equipe! Especiais carregados'); }
    else if (event.kind === 'combo' && near) audio.play('chain');
    else if (event.kind === 'convergence') { audio.play('convergence'); hud.announce('Convergência!', 'gold'); }
    else if (event.kind === 'signal') { audio.play('signal'); if (event.player !== meId) hud.toast(`${event.name}: ${SIGNAL_TEXT[event.signal] || 'sinal'}`); }
    else if (event.kind === 'encounter') { audio.play('encounter'); hud.announce(ENCOUNTER_TEXT[event.encounter] || 'Um encontro surgiu', 'gold'); }
    else if (event.kind === 'merchantSale') { audio.play('chest'); if (event.player === meId) hud.toast('Negócio fechado: escolha um poder'); }
    else if (event.kind === 'shrineAccepted') { audio.play('stage'); hud.announce('Pacto aceito! Poder para todos — inimigos mais fortes neste reino', 'danger'); }
    else if (event.kind === 'thiefDown') { audio.play('chest'); hud.announce('Ladrão derrubado! O tesouro é seu', 'gold'); }
    else if (event.kind === 'thiefEscaped') hud.toast('O ladrão escapou com o tesouro.');
    else if (event.kind === 'loop') { audio.play('loop'); hud.announce(`Volta ${event.loop + 1}: os reinos despertam mais fortes`, 'danger'); }
    else if (event.kind === 'evade' && near) audio.play('shoot');
    else if (event.kind === 'magnet' && near) audio.play('magnet');
    else if (event.kind === 'boom' && near) audio.play('boom');
    else if (event.kind === 'chain' && near) audio.play('chain');
    else if (event.kind === 'familiar' && near) audio.play('familiar');
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

const SIGNAL_TEXT = { here: 'venham aqui!', help: 'preciso de ajuda!', danger: 'cuidado!', look: 'olhem ali!' };
const ENCOUNTER_TEXT = {
  merchant: 'Um mercador errante chegou — troque moedas por um poder',
  shrine: 'Um santuário amaldiçoado oferece um pacto',
  thief: 'Um ladrão fugiu com um baú — alcance-o!'
};

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
  if (mode === 'offline') rerollPowers(game.players.me, game.random, { coop: false });
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
canvas.addEventListener('click', event => signal('look', { x: camera.x + event.clientX, y: camera.y + event.clientY }));
for (const button of /** @type {NodeListOf<HTMLButtonElement>} */ (document.querySelectorAll('[data-signal]'))) {
  button.onclick = () => signal(button.dataset.signal);
}

function step(now, dt) {
  if (mode === 'menu') { backdrop(now); audio.music('menu'); return; }
  const input = paused ? { x: 0, y: 0 } : controls.read();
  if (mode === 'offline') {
    const me = game.players.me;
    me.input = me.alive && !me.pendingPowers ? input : { x: 0, y: 0 };
    if (!paused && !me.pendingPowers?.length) {
      if (game.daily) {
        // The daily ritual runs on a fixed step so its seeded randomness replays the same way on every machine.
        accumulator = Math.min(accumulator + dt, FIXED_STEP * 4);
        while (accumulator >= FIXED_STEP) { updateGame(game, FIXED_STEP, game.random); accumulator -= FIXED_STEP; }
      } else updateGame(game, dt, game.random);
    }
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
  codex.observe(view, me, now);
  audio.music(paused ? 'menu' : moodFor(view, mode), view.phase || 0);
  const focus = me.alive === false ? Object.values(view.players).find(p => p.alive !== false) || me : me;
  camera = { x: focus.x - W / 2, y: focus.y - H / 2 };
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
  $('#hud').classList.toggle('coop', mode === 'online');
  $('#codexModal').classList.add('hidden');
  accumulator = 0;
  $('#muteBtn').textContent = audio.muted ? '♪̸' : '♪';
}

/** Solo run; a daily challenge fixes the seed, curses and character, and ignores permanent upgrades so scores compare. */
function startOffline(challenge = null) {
  if (session) return;
  if (challenge) {
    game = createGameState('quick', { curses: challenge.curses, daily: challenge.key });
    game.random = seededRandom(challenge.seed);
    game.players.me = createPlayer('me', playerName(), challenge.character);
    menu.selectCharacter(challenge.character);
  } else {
    game = createGameState(menu.campaign, { curses: menu.curses });
    game.random = Math.random;
    game.players.me = createPlayer('me', playerName(), menu.character, wallet.upgrades, menu.loadout);
  }
  game.offline = true;
  mode = 'offline';
  const curses = game.curses.map(id => CURSES[id].title).join(' + ');
  showGame(challenge ? `DESAFIO DIÁRIO · ${curses}` : `SOLO · ${CAMPAIGNS[game.campaign].name}${curses ? ` · ${curses}` : ''}`);
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
  if (mode === 'offline') activateSpecial(game, 'me', game.random);
  else session?.send({ type: 'special' });
}

function useDash() {
  const me = view?.players[meId];
  if (mode === 'menu' || paused || view?.over || !me?.alive || me.pendingPowers) return;
  const input = controls.read();
  if (mode === 'offline') activateDash(game, 'me', input);
  else session?.send({ type: 'dash', ...input });
}

function connect(action, code = '', visibility = 'closed', resume = null) {
  if (session || mode !== 'menu') return;
  let lobbyPlayers = [];
  let lobbyRunning = false;
  const entry = { action, code, visibility, name: playerName(), color: menu.character, meta: wallet.upgrades, campaign: menu.campaign,
    curses: menu.curses, loadout: menu.loadout, resume };
  const requestEntry = color => current.send({ type: action, room: code, name: playerName(), visibility, color, meta: wallet.upgrades,
    campaign: menu.campaign, curses: menu.curses, loadout: menu.loadout });
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

$('#specialBtn').onclick = useSpecial;
$('#dashBtn').onclick = useDash;
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
    startOffline, endGame, codex, sendSignal,
    get game() { return game; },
    get view() { return view; }
  };
}
