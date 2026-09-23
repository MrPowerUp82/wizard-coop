import { POWERS, REVIVE, SPECIAL, SPELLS, xpNeeded } from '../server/game.js';
import { ENCOUNTERS, POWER_CHOICE_TIMEOUT } from '../server/balance.js';
import { CURSES } from '../server/curses.js';
import { PHASES } from '../server/phases.js';
import { phaseDuration } from '../server/campaign.js';
import { specialOf } from '../server/weapons.js';
import { KIND_LABELS, POWER_INFO, requirementText } from './powerInfo.js';
import { characterPortrait } from './characterPortrait.js';

const $ = selector => document.querySelector(selector);

export function format(value) {
  const seconds = Math.max(0, Math.floor(value));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

/** Writes to the DOM only when a value actually changes, instead of dozens of writes every frame. */
function cached() {
  const last = new Map();
  return (element, property, value) => {
    const key = `${property}`;
    let slot = last.get(element);
    if (!slot) last.set(element, slot = {});
    if (slot[key] === value) return;
    slot[key] = value;
    if (property === 'text') element.textContent = value;
    else if (property === 'width') element.style.width = value;
    else if (property === 'hidden') element.classList.toggle('hidden', value);
    else if (property === 'disabled') element.disabled = value;
    else if (property.startsWith('--')) element.style.setProperty(property, value);
    else element[property] = value;
  };
}

export function createHud() {
  const set = cached();
  const touchControls = matchMedia('(pointer: coarse)');
  const el = Object.fromEntries(['hpBar', 'xpBar', 'level', 'timer', 'spellName', 'specialFill', 'specialBtn', 'coinCount', 'reviveHint',
    'phaseName', 'phasePanel', 'phaseTime', 'phaseProgress', 'bossPanel', 'bossName', 'bossHp', 'bossHealth', 'bossHint', 'phaseTransition',
    'transitionText', 'players', 'powerRow', 'announce', 'reconnectBanner', 'powerModal', 'powerChoices', 'powerTimer', 'rerollBtn',
    'damageVignette', 'toast', 'dashBtn', 'specialHint', 'objectivePanel', 'objectiveText', 'cursesRow', 'encounterPanel',
    'encounterTitle', 'encounterText', 'encounterHint', 'signalBar', 'powerTitle'].map(id => [id, $(`#${id}`)]));
  const powerTimerFill = el.powerTimer.querySelector('i');
  let announceTimer = null;
  let shownPowers = '';
  let playersSignature = '';
  let rowSignature = '';
  let curseSignature = '';

  function toast(message) {
    el.toast.textContent = message;
    el.toast.classList.add('show');
    clearTimeout(el.toast.timer);
    el.toast.timer = setTimeout(() => el.toast.classList.remove('show'), 2200);
  }

  function announce(message, tone = '') {
    el.announce.textContent = message;
    el.announce.className = `announce show ${tone}`;
    clearTimeout(announceTimer);
    announceTimer = setTimeout(() => { el.announce.className = 'announce'; }, 2600);
  }

  function flashDamage() {
    el.damageVignette.classList.remove('hit');
    void el.damageVignette.offsetWidth;
    el.damageVignette.classList.add('hit');
  }

  function renderPlayers(view) {
    const players = Object.values(view.players);
    const signature = players.map(p => `${p.id}:${p.alive !== false}:${p.connected !== false}`).join('|');
    if (signature === playersSignature) return;
    playersSignature = signature;
    el.players.replaceChildren(...players.map((player, index) => {
      const dot = document.createElement('div');
      const alive = player.alive !== false;
      dot.className = `player-dot${alive ? '' : ' dead'}${player.connected === false ? ' offline' : ''}`;
      characterPortrait(dot, player.color ?? index);
      dot.title = `${player.name}${alive ? '' : ' — derrotado'}${player.connected === false ? ' — reconectando' : ''}`;
      return dot;
    }));
  }

  function renderCurses(view) {
    const loop = view.loop || 0;
    const signature = `${(view.curses || []).join()}|${view.bloodPact}|${loop}`;
    if (signature === curseSignature) return;
    curseSignature = signature;
    const chips = (view.curses || []).map(id => {
      const chip = document.createElement('span');
      chip.textContent = CURSES[id]?.icon || '?';
      chip.title = `${CURSES[id]?.title}: ${CURSES[id]?.description}`;
      return chip;
    });
    if (view.bloodPact) {
      const pact = document.createElement('span');
      pact.className = 'pact'; pact.textContent = '☥ +30% dano inimigo'; pact.title = 'Pacto do santuário até o fim do reino';
      chips.push(pact);
    }
    if (loop) {
      const lap = document.createElement('span');
      lap.className = 'loop'; lap.textContent = `∞ Volta ${loop + 1}`;
      chips.push(lap);
    }
    el.cursesRow.replaceChildren(...chips);
    el.cursesRow.classList.toggle('hidden', !chips.length);
  }

  function renderEncounter(view, me) {
    const encounter = view.encounter;
    const visible = Boolean(encounter) && view.phaseStatus === 'horde' && !view.over && !['complete', 'expired'].includes(encounter.status);
    set(el.encounterPanel, 'hidden', !visible);
    if (!visible) return;
    const ttl = Math.ceil(encounter.ttl);
    if (encounter.kind === 'merchant') {
      const cfg = ENCOUNTERS.merchant;
      const bought = encounter.buyers?.includes(me.id);
      set(el.encounterTitle, 'text', '⚖ MERCADOR ERRANTE');
      set(el.encounterText, 'text', bought ? 'Você já comprou. Seus aliados ainda podem.'
        : (me.coins || 0) < cfg.cost ? `Precisa de ${cfg.cost} moedas da partida (você tem ${me.coins || 0}) · ${ttl}s`
          : me.shopProgress > 0 ? `Negociando… ${Math.ceil(cfg.seconds - me.shopProgress)}s` : `Fique perto dele: ${cfg.cost} moedas por um poder · ${ttl}s`);
      set(el.encounterHint, 'text', 'Cada arcanista pode comprar uma vez');
    } else if (encounter.kind === 'shrine') {
      set(el.encounterTitle, 'text', '☥ SANTUÁRIO AMALDIÇOADO');
      set(el.encounterText, 'text', `${Math.floor(encounter.progress)}/${ENCOUNTERS.shrine.seconds}s para aceitar o pacto · some em ${ttl}s`);
      set(el.encounterHint, 'text', `Poder + ${ENCOUNTERS.shrine.coins} moedas para todos, mas inimigos ferem 30% mais neste reino`);
    } else {
      set(el.encounterTitle, 'text', '✪ LADRÃO DE RELÍQUIAS');
      set(el.encounterText, 'text', `Derrube-o antes que fuja: ${ttl}s`);
      set(el.encounterHint, 'text', 'Ele carrega um baú, um ímã e uma bolsa de moedas');
    }
  }

  function renderPowerRow(me) {
    const owned = Object.entries(me.powers || {}).filter(([, rank]) => rank > 0);
    const signature = owned.map(([id, rank]) => `${id}${rank}`).join();
    if (signature === rowSignature) return;
    rowSignature = signature;
    el.powerRow.replaceChildren(...owned.map(([id, rank]) => {
      const chip = document.createElement('span');
      const kind = POWERS[id]?.kind;
      chip.className = `power-chip ${kind}`;
      chip.title = `${POWER_INFO[id]?.[1]} ${rank}/${POWERS[id]?.max}`;
      chip.textContent = POWER_INFO[id]?.[0] || '?';
      if (POWERS[id]?.max > 1) { const sup = document.createElement('sup'); sup.textContent = rank; chip.append(sup); }
      return chip;
    }));
  }

  function showPowerChoices(me, choices, onChoose) {
    el.powerChoices.replaceChildren(...choices.map((id, index) => {
      const [icon, title, description] = POWER_INFO[id];
      const power = POWERS[id];
      const button = document.createElement('button');
      button.className = `power-choice ${power.kind}`;
      const badge = KIND_LABELS[power.kind];
      const rank = (me.powers?.[id] || 0) + 1;
      button.innerHTML = `<i></i><b></b><small></small>${badge ? '<em></em>' : ''}<kbd>${index + 1}</kbd>`;
      button.querySelector('i').textContent = icon;
      button.querySelector('b').textContent = title;
      button.querySelector('small').textContent = power.kind === 'evolution'
        ? `${description} · ${requirementText(power.requires)}` : `${description} · Grau ${rank}/${power.max}`;
      if (badge) button.querySelector('em').textContent = badge;
      button.onclick = () => onChoose(id);
      return button;
    }));
    el.powerModal.classList.remove('hidden');
  }

  return {
    toast, announce, flashDamage,
    resetCaches() { shownPowers = ''; playersSignature = ''; rowSignature = ''; curseSignature = ''; },
    syncPowers(me, { offline, onChoose, onReroll, title = 'Novo poder' }) {
      if (me?.alive !== false && me?.pendingPowers?.length) {
        set(el.powerTitle, 'text', title);
        const key = me.pendingPowers.join(',');
        if (key !== shownPowers) { shownPowers = key; showPowerChoices(me, me.pendingPowers, onChoose); }
        set(el.rerollBtn, 'hidden', !(me.rerolls > 0));
        set(el.rerollBtn, 'text', `↻ Trocar opções (${me.rerolls || 0})`);
        el.rerollBtn.onclick = onReroll;
        set(el.powerTimer, 'hidden', offline);
        if (!offline) set(powerTimerFill, 'width', `${Math.max(0, 1 - (me.powerTimer || 0) / POWER_CHOICE_TIMEOUT) * 100}%`);
        return true;
      }
      shownPowers = '';
      set(el.powerModal, 'hidden', true);
      return false;
    },
    /** Hides the modal; passing the current choices keeps it closed until the server confirms the pick. */
    hidePowers(key = '') { shownPowers = key; el.powerModal.classList.add('hidden'); },
    setReconnecting(active) { set(el.reconnectBanner, 'hidden', !active); },
    setLowHealth(low) { el.damageVignette.classList.toggle('low', low); },
    update(view, me, { paused, offline }) {
      set(el.hpBar, 'width', `${Math.max(0, me.hp / me.maxHp) * 100}%`);
      set(el.xpBar, 'width', `${Math.min(1, me.xp / xpNeeded(me.level)) * 100}%`);
      set(el.level, 'text', `NÍVEL ${me.level}`);
      set(el.timer, 'text', format(view.time || 0));
      const charge = Math.round(me.specialCharge || 0);
      const blocked = !me.alive || paused || Boolean(me.pendingPowers) || view.over || view.phaseStatus === 'transition';
      const special = specialOf(me);
      set(el.spellName, 'text', SPELLS[me.color ?? 0].name);
      set(el.specialFill, 'width', `${charge}%`);
      set(el.specialBtn, 'disabled', charge < SPECIAL.max || blocked || me.specialCooldown > 0);
      set(el.specialBtn, 'text', me.specialCooldown > 0 ? `${special.name} · ${Math.ceil(me.specialCooldown)}s`
        : charge >= SPECIAL.max ? `${special.name}${touchControls.matches ? ' · Pronto' : ' · ESPAÇO'}` : `${special.name} ${charge}%`);
      set(el.specialHint, 'text', special.description);
      set(el.dashBtn, 'disabled', blocked || me.dashCooldown > 0);
      set(el.dashBtn, 'text', me.dashCooldown > 0 ? `Esquiva · ${Math.ceil(me.dashCooldown)}s` : `➤ Esquiva${touchControls.matches ? '' : ' · SHIFT'}`);
      const altar = view.altar;
      set(el.objectivePanel, 'hidden', !altar || view.phaseStatus !== 'horde' || view.over);
      if (altar) set(el.objectiveText, 'text', altar.status === 'complete' ? 'Purificado! Recompensa compartilhada.'
        : altar.status === 'expired' ? 'O altar se apagou. Continue a campanha.'
          : `${Math.floor(altar.progress)}/15s defendidos · expira em ${Math.ceil(altar.ttl)}s`);
      set(el.coinCount, 'text', `Moedas: ${me.coins || 0}`);
      set(el.reviveHint, 'text', view.over ? '' : me.alive
        ? me.reviving ? 'Ressuscitando aliado… permaneça no círculo.' : offline ? '' : 'Para reviver um aliado, fique no círculo por 4s.'
        : me.reviveBy ? `Aliado ressuscitando você… ${Math.ceil(REVIVE.seconds - me.reviveProgress)}s` : 'Aguarde um aliado chegar até seu corpo.');
      const phase = PHASES[view.phase || 0];
      const status = view.phaseStatus || 'horde';
      set(el.phaseName, 'text', `${view.loop ? `∞${view.loop + 1} · ` : ''}${(view.phase || 0) + 1} / ${PHASES.length} · ${phase.name}`);
      set(el.phasePanel, '--phase-color', phase.color);
      set(el.phaseTime, 'text', status === 'horde' ? `${format(Math.ceil(phaseDuration(view) - (view.phaseTime || 0)))} ATÉ O CHEFE`
        : status === 'boss' ? 'DERROTE O GUARDIÃO' : status === 'transition' ? 'GUARDIÃO DERROTADO' : 'CAMPANHA CONCLUÍDA');
      set(el.phaseProgress, 'width', `${Math.min(100, (view.phaseTime || 0) / phaseDuration(view) * 100)}%`);
      const boss = view.enemies.find(e => e.boss);
      set(el.bossPanel, 'hidden', !boss);
      if (boss) {
        set(el.bossName, 'text', `${phase.bossName}${boss.stage > 1 ? ` · Fúria ${boss.stage === 3 ? 'II' : 'I'}` : ''}`);
        set(el.bossHp, 'width', `${Math.max(0, boss.hp / boss.maxHp * 100)}%`);
        set(el.bossHealth, 'text', `${Math.ceil(boss.hp)} / ${Math.ceil(boss.maxHp)}`);
        set(el.bossHint, 'text', boss.stage === 3 ? 'Fúria final: padrões mais rápidos e densos' : 'Desvie dos projéteis vermelhos e saia dos círculos');
      }
      set(el.phaseTransition, 'hidden', status !== 'transition');
      if (status === 'transition') set(el.transitionText, 'text', `${PHASES[((view.phase || 0) + 1) % PHASES.length].name} · ${Math.ceil(view.transitionTime)}s`);
      set(el.signalBar, 'hidden', offline || view.over || !me.alive);
      renderCurses(view);
      renderEncounter(view, me);
      renderPlayers(view);
      renderPowerRow(me);
    }
  };
}
