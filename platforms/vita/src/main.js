// @ts-check
import { activateDash, activateSpecial, applyPower, rerollPowers } from '../../../server/game.js';
import { CAMPAIGNS } from '../../../server/campaign.js';
import { PHASES } from '../../../server/phases.js';
import { CURSES, dailyChallenge } from '../../../server/curses.js';
import { createAnimator } from '../../../src/animation.js';
import { createAudio } from '../../../src/audio.js';
import { drawBackdrop } from '../../../src/backdrop.js';
import { createCodex } from '../../../src/codex.js';
import { createFeedback, newRound } from '../../../src/feedback.js';
import { format } from '../../../src/hud.js';
import { advanceOfflineRun, chooserOf, createOfflineRun, localPlayersOf, offlineActor, renderLocalViews } from '../../../src/localCoop.js';
import { saveDailyRecord } from '../../../src/menu.js';
import { moodFor } from '../../../src/music.js';
import { POWER_INFO } from '../../../src/powerInfo.js';
import { drawPlayerPanel } from '../../../src/splitHud.js';
import { createWallet } from '../../../src/wallet.js';
import { installAudioCompat } from './audio-compat.js';
import { installCanvasCompat } from './canvas-compat.js';
import { installFontCompat, loadFonts } from './fonts.js';
import { createControllers } from './input/controllers.js';
import { SceCtrlButton } from './input/mappings.js';
import { COLORS, menuList, roundPanel, text, veil } from './ui/draw.js';
import { createVitaHud } from './ui/hud.js';
import { createVitaMenu } from './ui/menu.js';
import { drawControllerDebug } from './debug/controller-debug.js';
import { createPerf } from './debug/perf.js';
import { createAutoplay } from './debug/autoplay.js';

// PlayStation Vita shell. Drives the shared offline run and split screen from src/localCoop.js,
// the authoritative simulation (server/game.js), renderer and feedback.

const global = /** @type {any} */ (globalThis);
const isDebug = typeof DEBUG_CONTROLLERS !== 'undefined' && Boolean(DEBUG_CONTROLLERS);

installAudioCompat();
const screenObj = typeof screen !== 'undefined' ? screen : { width: 960, height: 544, getContext: () => null };
const ctx = typeof screenObj.getContext === 'function' ? screenObj.getContext('2d') : null;

if (ctx) {
  installFontCompat(ctx);
  installCanvasCompat(ctx);
}

const W = screenObj.width || 960;
const H = screenObj.height || 544;
const dpr = 1;

if (ctx) {
  ctx.fillStyle = '#071117';
  ctx.fillRect(0, 0, W, H);
  ctx.font = '20px system-ui';
  ctx.fillStyle = '#83d9bf';
  ctx.textAlign = 'center';
  ctx.fillText('Arcana Survivors · PlayStation Vita…', W / 2, H / 2);
}

await loadFonts();

const audio = createAudio();
const wallet = createWallet();
const hud = createVitaHud();
const animator = createAnimator({ onHit: () => audio.play('hit'), onKill: () => audio.play('kill') });

let mode = 'menu'; // menu | offline
let run = null, game = null, local = ['me'], view = null, round = null;
let paused = false;
let results = null;
let overlayFocus = 0;
let last = performance.now();
let showDebug = isDebug;
const perf = isDebug ? createPerf() : null;

const codex = createCodex({
  onDiscover(section, entry) {
    if (mode === 'menu' || !entry) return;
    if (section === 'reactions' || section === 'bosses' || section === 'encounters' || (section === 'powers' && entry.tag === 'Evolução')) {
      hud.toast(`Códex: ${entry.name} registrado`);
    }
  }
});
const feedback = createFeedback({ audio, hud, codex, animator });

const controllers = createControllers({
  isPlaying: () => mode === 'offline',
  onPause: () => togglePause(),
  onSpecial: slot => useSpecial(slot),
  onDash: slot => useDash(slot)
});

const menu = createVitaMenu({
  controllers,
  wallet,
  audio,
  debugControllers: isDebug,
  onSolo: character => startRun({ character }),
  onCoop: (character, secondCharacter) => startRun({ split: true, character, secondCharacter }),
  onDaily: () => startRun({ challenge: dailyChallenge() }),
  onExit: () => {
    if (global.Vita?.exit) global.Vita.exit();
    else if (global.App?.exit) global.App.exit();
  }
});

const autoplay = isDebug ? createAutoplay({ startRun, endGame, controllers, perf, getView: () => view }) : null;

function startRun({ challenge = null, split = false, character = 0, secondCharacter = 1 }) {
  run = createOfflineRun({
    challenge,
    split,
    campaign: menu.campaign,
    curses: [],
    name: split ? 'Jogador 1' : 'Arcanista',
    character,
    secondCharacter,
    upgrades: wallet.upgrades,
    loadout: { weapon: null, special: 0 }
  });
  ({ game, local } = run);
  controllers.setCoop(local.length > 1);
  mode = 'offline';
  paused = false;
  overlayFocus = 0;
  results = null;
  round = newRound();
  animator.reset();
  hud.resetCaches();
  controllers.reset();
  audio.unlock();
  menu.enter('playing');
  const curses = game.curses.map(id => CURSES[id]?.title).filter(Boolean).join(' + ');
  hud.announce(challenge ? `Desafio diário · ${curses}` : `${split ? 'Tela dividida' : 'Solo'} · ${CAMPAIGNS[game.campaign]?.name || 'Campanha'}`, 'gold');
}

function depositCoins() {
  if (!round || round.deposited) return 0;
  round.deposited = true;
  const coins = view?.players.me?.coins || 0;
  wallet.deposit(coins);
  return coins;
}

function endGame() {
  if (view) depositCoins();
  mode = 'menu';
  run = game = view = round = results = null;
  paused = false;
  animator.reset();
  hud.resetCaches();
  controllers.setCoop(false);
  controllers.reset();
  menu.enter('main');
}

function togglePause(force) {
  if (mode !== 'offline' || view?.over) return;
  paused = typeof force === 'boolean' ? force : !paused;
  if (!paused && missingSlot() >= 0) paused = true;
  overlayFocus = 0;
  controllers.reset();
}

const missingSlot = () => (mode === 'offline' && controllers.coop ? local.findIndex((_, slot) => controllers.missing(slot))
  : controllers.connectedCount ? -1 : 0);

function useSpecial(slot) {
  const me = offlineActor(view, local, slot, paused);
  if (me) activateSpecial(game, me.id, game.random);
}

function useDash(slot) {
  const me = offlineActor(view, local, slot, paused);
  if (me) activateDash(game, me.id, controllers.read(slot));
}

function choosePower(id) {
  const me = chooserOf(localPlayersOf(view, local), view.players.me);
  if (!me?.pendingPowers?.includes(id)) return;
  hud.hidePowers(me.pendingPowers.join(','));
  applyPower(game.players[me.id], id);
  audio.play('power');
  hud.toast(`${POWER_INFO[id]?.[1] || id} adquirido`);
}

function reroll() {
  const me = chooserOf(localPlayersOf(view, local), view.players.me);
  if (!me?.pendingPowers || !(me.rerolls > 0)) return;
  rerollPowers(game.players[me.id], game.random, { coop: local.length > 1 });
  audio.play('click');
}

function showResults() {
  round.gameOverShown = round.defeatShown = true;
  const me = view.players.me;
  audio.play(view.victory ? 'victory' : 'defeat');
  const earned = depositCoins();
  let daily = '';
  if (game.daily) {
    const { improved, best } = saveDailyRecord(game.daily, {
      phase: (view.phase || 0) + 1,
      loop: view.loop || 0,
      time: Math.round(view.time),
      victory: Boolean(view.victory)
    });
    daily = improved ? `Novo recorde do desafio diário: reino ${best.phase} em ${format(best.time)}` : `Recorde de hoje: reino ${best.phase} em ${format(best.time)}`;
  }
  results = {
    title: view.victory ? 'Ritual concluído!' : 'Ritual encerrado',
    text: view.victory ? 'Todos os guardiões caíram. A aurora pertence aos arcanistas.' : 'Nenhum arcanista permaneceu de pé.',
    stats: `TEMPO ${format(view.time)}  •  NÍVEL ${me.level}  •  FASE ${(view.phase || 0) + 1}/${PHASES.length}${view.loop ? ` · VOLTA ${view.loop + 1}` : ''}  •  MOEDAS ${me.coins || 0}`,
    rows: Object.values(view.players).sort((a, b) => (b.stats?.damage || 0) - (a.stats?.damage || 0))
      .map(p => [p.name, p.level, p.stats?.kills ?? 0, Math.round(p.stats?.damage ?? 0).toLocaleString('pt-BR'), p.stats?.revives ?? 0]),
    coins: `+${earned} moedas guardadas no Grimório · total ${wallet.coins}`,
    daily,
    age: 0
  };
}

function overlayInput(dt) {
  for (const event of controllers.events) {
    if (event.action === 'lost') hud.toast(`Controle do Jogador ${event.slot + 1} desconectado`);
    else if (event.action === 'reconnected') hud.toast(`Controle do Jogador ${event.slot + 1} reconectado`);
  }
  if (results) {
    results.age += dt;
    if (results.age > 1 && controllers.events.some(e => e.action === 'confirm' || e.action === 'cancel')) endGame();
    return;
  }
  const missing = missingSlot();
  if (missing >= 0) {
    if (!paused) { paused = true; overlayFocus = 0; }
    const claim = controllers.events.find(e => (e.action === 'join' || e.action === 'confirm') && controllers.coop && controllers.isFree(e.pad));
    if (claim) { controllers.bind(missing, claim.pad); hud.toast(`${claim.pad.label} agora controla o Jogador ${missing + 1}`); }
    return;
  }
  if (paused) {
    for (const { action } of controllers.events) {
      if (action === 'up') overlayFocus = Math.max(0, overlayFocus - 1);
      else if (action === 'down') overlayFocus = Math.min(2, overlayFocus + 1);
      else if (action === 'cancel') togglePause(false);
      else if (action === 'confirm') {
        if (overlayFocus === 0) togglePause(false);
        else if (overlayFocus === 1) {
          const split = local.length > 1;
          const c0 = view?.players?.me?.character || 0;
          const c1 = view?.players?.p2?.character || 1;
          startRun({ split, character: c0, secondCharacter: c1 });
        } else {
          endGame();
          return;
        }
      }
    }
    return;
  }
  if (hud.choosingPower) {
    const picker = chooserOf(localPlayersOf(view, local), view.players.me);
    const slot = local.indexOf(picker.id);
    for (const event of controllers.events) if (event.slot === slot) hud.powerInput(event.action);
  }
}

function drawPause() {
  if (!ctx) return;
  veil(ctx, W, H, 0.6);
  roundPanel(ctx, W / 2 - 250, H / 2 - 150, 500, 300, { fill: COLORS.panelSolid, radius: 18 });
  text(ctx, 'Ⅱ', W / 2, H / 2 - 95, { font: '700 26px Cinzel', align: 'center', color: COLORS.gold });
  text(ctx, 'Ritual pausado', W / 2, H / 2 - 60, { font: '700 28px Cinzel', align: 'center' });
  const missing = missingSlot();
  if (missing >= 0) {
    const message = controllers.coop ? `Controle do Jogador ${missing + 1} desconectado` : 'Nenhum controle conectado';
    text(ctx, message, W / 2, H / 2 - 16, { font: '700 18px Inter', align: 'center', color: COLORS.danger });
    text(ctx, 'Reconecte o controle ou pressione ✕ em outro controle livre.', W / 2, H / 2 + 14,
      { font: '500 15px Inter', align: 'center', color: COLORS.dim, maxWidth: 460 });
    text(ctx, 'Vida, XP, poderes e personagem continuam guardados.', W / 2, H / 2 + 40, { font: '500 13px Inter', align: 'center', color: COLORS.dim });
    return;
  }
  text(ctx, 'Respire. A floresta pode esperar.', W / 2, H / 2 - 36, { font: '500 15px Inter', align: 'center', color: COLORS.dim });
  menuList(ctx, [{ label: 'Continuar batalha' }, { label: 'Reiniciar ritual' }, { label: 'Voltar ao menu' }], overlayFocus, W / 2 - 190, H / 2 - 8, 380);
}

function drawResults() {
  if (!ctx || !results) return;
  veil(ctx, W, H, 0.72);
  roundPanel(ctx, W / 2 - 380, 40, 760, 464, { fill: COLORS.panelSolid, radius: 16, stroke: view.victory ? COLORS.gold : COLORS.line });
  text(ctx, results.title, W / 2, 85, { font: '700 30px Cinzel', align: 'center', color: view.victory ? COLORS.gold : COLORS.ink });
  text(ctx, results.text, W / 2, 114, { font: '500 15px Inter', align: 'center', color: COLORS.dim });
  text(ctx, results.stats, W / 2, 145, { font: '700 13px Inter', align: 'center', color: COLORS.mint, maxWidth: 720 });
  const columns = [W / 2 - 300, W / 2 - 75, W / 2 + 25, W / 2 + 130, W / 2 + 250];
  ['Arcanista', 'Nível', 'Abates', 'Dano', 'Resgates'].forEach((label, i) => text(ctx, label, columns[i], 186, { font: '700 13px Inter', color: COLORS.dim }));
  results.rows.forEach((row, r) => row.forEach((value, i) => text(ctx, value, columns[i], 214 + r * 26, { font: '600 15px Inter', maxWidth: i ? 100 : 210 })));
  text(ctx, results.coins, W / 2, 400, { font: '700 15px Inter', align: 'center', color: COLORS.gold });
  if (results.daily) text(ctx, results.daily, W / 2, 428, { font: '600 14px Inter', align: 'center', color: COLORS.mint });
  if (results.age > 1) text(ctx, '✕ / ○ · voltar ao menu', W / 2, 474, { font: '600 15px Inter', align: 'center', color: COLORS.mint });
}

function debugToggle() {
  const clicks = SceCtrlButton.SELECT | SceCtrlButton.L1;
  if (controllers.pads.some(p => p.connected && (p.raw & ~p.previous & clicks))) showDebug = !showDebug;
}

function playFrame(now, dt) {
  overlayInput(dt);
  if (mode !== 'offline') return;
  const updateStart = performance.now();
  advanceOfflineRun(run, dt, { paused, read: slot => controllers.read(slot) });
  if (perf) perf.update(performance.now() - updateStart);
  view = game;
  const me = view.players.me;
  const split = local.length > 1;
  const mine = localPlayersOf(view, local);
  const picker = chooserOf(mine, me);
  const pickerSlot = Math.max(0, local.indexOf(picker.id));
  const choosing = hud.syncPowers(picker, { onChoose: choosePower, onReroll: reroll, title: split ? `Novo poder · Jogador ${pickerSlot + 1}` : undefined });
  if (choosing) hud.setPowerLabels(controllers.labels(pickerSlot));
  if (view.over && !round.gameOverShown) showResults();
  animator.update(view, dt, { paused: paused || choosing, reduced: false });
  feedback(view, round, mine);
  codex.observe(view, me, now);
  audio.music(paused ? 'menu' : moodFor(view, mode), view.phase || 0);

  const renderStart = performance.now();
  if (ctx) {
    const blocked = paused || choosing || view.over || view.phaseStatus === 'transition';
    const keys = [controllers.labels(0), controllers.labels(1)];
    renderLocalViews(ctx, view, { me, mine, split, animator, W, H, dpr, reduced: false, offline: true, blocked, keys });
    if (!split) drawPlayerPanel(ctx, me, { slot: 0, ox: 0, W, H, dpr, blocked, keys: keys[0] });
    hud.update(view, me, { paused });
    hud.draw(ctx, W, H, dt);
    if (results) drawResults();
    else if (paused) drawPause();
    else if (choosing) hud.drawPowers(ctx, W, H);
  }
  if (perf) perf.render(performance.now() - renderStart);
  if (perf && showDebug && ctx) perf.draw(ctx, view, controllers, { split });
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  if (perf) perf.frame(dt);
  controllers.poll(dt);
  if (isDebug) { debugToggle(); if (autoplay) autoplay.frame(dt); }
  if (ctx) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    if (mode === 'menu') {
      drawBackdrop(ctx, W, H, dpr, now);
      audio.music('menu');
      menu.update(controllers.events, dt);
      if (mode === 'menu') menu.draw(ctx, W, H, now / 1000);
    }
  }
  if (mode === 'offline') playFrame(now, dt);
  if (isDebug && ctx && (showDebug || menu.screen === 'controllers')) drawControllerDebug(ctx, controllers, W, H);
}

requestAnimationFrame(frame);

if (isDebug) {
  global.__ARCANA_VITA__ = {
    get mode() { return mode; },
    get game() { return game; },
    get paused() { return paused; },
    get results() { return results; },
    get view() { return view; },
    controllers, menu, hud, startRun, endGame, togglePause
  };
}
