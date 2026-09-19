import { createGameState, createPlayer, updateGame } from '../server/game.js';
import { seededRandom } from '../server/curses.js';
import { renderWorld } from './render.js';
import { drawDivider, drawPlayerPanel } from './splitHud.js';

// The offline run shared by every shell (browser and Nintendo Switch): solo, daily challenge or split
// screen with two players on one machine. Shells only decide where each slot's input comes from.

export const FIXED_STEP = 1 / 60;
const STILL = { x: 0, y: 0 };

/**
 * Solo run; a daily challenge fixes the seed, curses and character, and ignores permanent upgrades so scores compare.
 * Split screen adds a second local player sharing the same Grimório upgrades.
 * `local` lists the player ids driven from this machine, in slot order (split screen has two).
 */
export function createOfflineRun({ challenge = null, split = false, campaign, curses, name, character, secondCharacter, upgrades, loadout }) {
  const local = split && !challenge ? ['me', 'p2'] : ['me'];
  let game;
  if (challenge) {
    game = createGameState('quick', { curses: challenge.curses, daily: challenge.key });
    game.random = seededRandom(challenge.seed);
    game.players.me = createPlayer('me', name, challenge.character);
  } else {
    game = createGameState(campaign, { curses });
    game.random = Math.random;
    game.players.me = createPlayer('me', name, character, upgrades, loadout);
    if (local.length > 1) game.players.p2 = createPlayer('p2', 'Jogador 2', secondCharacter, upgrades);
  }
  game.offline = true;
  return { game, local, accumulator: 0 };
}

/** The local players in slot order. */
export const localPlayersOf = (view, local) => local.map(id => view?.players[id]).filter(Boolean);

/** Whoever owes a power choice right now; split screen resolves one player at a time. */
export const chooserOf = (mine, fallback) => mine.find(p => p.alive !== false && p.pendingPowers?.length) || fallback;

/**
 * One frame of the offline run: every slot's input goes to its own player, then the shared world
 * advances once for everyone. Offline time stops while anyone at this machine picks a power.
 * `read(slot)` returns that slot's normalized movement vector.
 */
export function advanceOfflineRun(run, dt, { paused, read }) {
  const { game } = run;
  const mine = run.local.map(id => game.players[id]);
  mine.forEach((p, slot) => { p.input = !paused && p.alive && !p.pendingPowers ? read(slot) : STILL; });
  if (paused || mine.some(p => p.pendingPowers?.length)) return;
  if (game.daily) {
    // The daily ritual runs on a fixed step so its seeded randomness replays the same way on every machine.
    run.accumulator = Math.min(run.accumulator + dt, FIXED_STEP * 4);
    while (run.accumulator >= FIXED_STEP) { updateGame(game, FIXED_STEP, game.random); run.accumulator -= FIXED_STEP; }
  } else updateGame(game, dt, game.random);
}

/** The offline player a slot acts for, or null when it cannot act right now. */
export function offlineActor(view, local, slot, paused) {
  const id = local[slot];
  const me = id ? view?.players[id] : null;
  if (paused || view?.over || !me?.alive || me.pendingPowers) return null;
  // Offline time is frozen while a split-screen partner picks a power.
  if (localPlayersOf(view, local).some(p => p.pendingPowers?.length)) return null;
  return me;
}

/**
 * Draws the shared world for the local players: the whole screen for one player, or one half with its
 * own camera and status panel per player in split screen (a fallen player keeps watching their revive
 * circle). Returns the solo camera's top-left corner, or null in split screen.
 */
export function renderLocalViews(ctx, view, { me, mine, split, animator, W, H, dpr, reduced, offline, blocked, keys = undefined, drawPanels = true }) {
  if (split) {
    const half = Math.floor(W / 2);
    mine.forEach((p, slot) => {
      const ox = slot ? half : 0, width = slot ? W - half : half;
      renderWorld(ctx, view, { me: p, focus: p, animator, W: width, H, dpr, reduced, offline: false, ox });
      if (drawPanels) drawPlayerPanel(ctx, p, { slot, ox, W: width, H, dpr, blocked, keys: keys?.[slot] });
    });
    if (drawPanels) drawDivider(ctx, half, H, dpr);
    return null;
  }
  const focus = me.alive === false ? Object.values(view.players).find(p => p.alive !== false) || me : me;
  renderWorld(ctx, view, { me, focus, animator, W, H, dpr, reduced, offline });
  return { x: focus.x - W / 2, y: focus.y - H / 2 };
}
