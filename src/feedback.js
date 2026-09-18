import { PHASES } from '../server/phases.js';

// Turns simulation events and local player changes into sounds, announcements and the Códex.
// Shared by the browser and Switch shells; each shell passes its own HUD with
// announce/toast/flashDamage/setLowHealth.

const SIGNAL_TEXT = { here: 'venham aqui!', help: 'preciso de ajuda!', danger: 'cuidado!', look: 'olhem ali!' };
const ENCOUNTER_TEXT = {
  merchant: 'Um mercador errante chegou — troque moedas por um poder',
  shrine: 'Um santuário amaldiçoado oferece um pacto',
  thief: 'Um ladrão fugiu com um baú — alcance-o!'
};

/** Per-match bookkeeping for feedback and results screens. */
export function newRound() {
  return { defeatShown: false, gameOverShown: false, deposited: false, last: {}, lastEventId: null, hazards: 0, low: false };
}

export function createFeedback({ audio, hud, codex, animator }) {
  /** Called once per frame with the drawn state, this frame's round and the players this machine controls. */
  return function feedback(view, round, mine) {
    const events = view.events || [];
    if (round.lastEventId === null) round.lastEventId = events.reduce((max, event) => Math.max(max, event.id), 0);
    const focus = mine.find(p => p.alive !== false) || Object.values(view.players).find(p => p.alive !== false) || mine[0];
    const isMine = id => mine.some(p => p.id === id);
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
      else if (event.kind === 'signal') { audio.play('signal'); if (!isMine(event.player)) hud.toast(`${event.name}: ${SIGNAL_TEXT[event.signal] || 'sinal'}`); }
      else if (event.kind === 'encounter') { audio.play('encounter'); hud.announce(ENCOUNTER_TEXT[event.encounter] || 'Um encontro surgiu', 'gold'); }
      else if (event.kind === 'merchantSale') { audio.play('chest'); if (isMine(event.player)) hud.toast('Negócio fechado: escolha um poder'); }
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
    const low = mine.some(p => p.alive !== false && p.hp / p.maxHp < 0.3);
    if (low !== round.low) { round.low = low; hud.setLowHealth(low); }
    // Split-screen players share XP and coins, so each sound plays once per frame instead of doubling.
    const sounds = new Set();
    for (const p of mine) {
      const previous = round.last[p.id];
      round.last[p.id] = { hp: p.hp, level: p.level, xp: p.xp, coins: p.coins, charge: p.specialCharge, cast: p.castCount };
      if (!previous) continue;
      if (p.hp < previous.hp - 0.5 && p.alive) { sounds.add('hurt'); hud.flashDamage(); animator.shake(4); }
      if (p.level > previous.level) sounds.add('level');
      else if (p.xp > previous.xp) sounds.add('gem');
      if (p.hp > previous.hp + 10 && p.level === previous.level) sounds.add('heart');
      if (p.coins > previous.coins) sounds.add('coin');
      if (p.specialCharge > previous.charge && p.specialCharge - previous.charge >= 20) sounds.add('crystal');
      if (p.castCount > previous.cast) sounds.add('shoot');
    }
    for (const sound of sounds) audio.play(sound);
  };
}
