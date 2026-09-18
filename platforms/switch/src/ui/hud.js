// @ts-check
import { POWERS } from '../../../../server/game.js';
import { PHASES } from '../../../../server/phases.js';
import { phaseDuration } from '../../../../server/campaign.js';
import { CURSES } from '../../../../server/curses.js';
import { format } from '../../../../src/hud.js';
import { KIND_LABELS, POWER_INFO, requirementText } from '../../../../src/powerInfo.js';
import { COLORS, bar, roundPanel, text, veil, wrapText } from './draw.js';

// Canvas version of the web HUD (src/hud.js builds the same information with DOM elements). It keeps
// the web HUD's method names, so the shared feedback module and the loop call it the same way.
// Per-player status in split screen and solo is the shared splitHud.js panel, drawn by localCoop.js.

const TOAST_SECONDS = 2.2, ANNOUNCE_SECONDS = 2.6;
const TONES = { danger: COLORS.danger, gold: COLORS.gold, '': COLORS.mint };

export function createSwitchHud() {
  let toast = null, announce = null, damage = 0, low = false;
  let shown = { view: null, me: null, paused: false };
  let powers = null;
  let shownPowers = '';
  let powerLabels = { confirm: 'A', alt: 'Y' };

  return {
    toast(message) { toast = { message, age: 0 }; },
    announce(message, tone = '') { announce = { message, tone, age: 0 }; },
    flashDamage() { damage = 1; },
    setLowHealth(value) { low = value; },
    setReconnecting() {},
    resetCaches() { shownPowers = ''; powers = null; toast = null; announce = null; damage = 0; low = false; },

    /** Same contract as the web HUD: returns true while `me` owes a power choice. */
    syncPowers(me, { onChoose, onReroll, title = 'Novo poder' }) {
      if (me?.alive !== false && me?.pendingPowers?.length) {
        const key = me.pendingPowers.join(',');
        if (key !== shownPowers || !powers) { shownPowers = key; powers = { selected: 0 }; }
        Object.assign(powers, { me, choices: me.pendingPowers, onChoose, onReroll, title });
        return true;
      }
      shownPowers = '';
      powers = null;
      return false;
    },
    hidePowers(key = '') { shownPowers = key; powers = null; },
    setPowerLabels(labels) { powerLabels = labels; },
    get choosingPower() { return Boolean(powers); },
    /** Menu events from the chooser's controller while the power choice is open. */
    powerInput(action) {
      if (!powers) return;
      const count = powers.choices.length;
      if (action === 'left' || action === 'up') powers.selected = (powers.selected + count - 1) % count;
      else if (action === 'right' || action === 'down') powers.selected = (powers.selected + 1) % count;
      else if (action === 'confirm') powers.onChoose(powers.choices[powers.selected]);
      else if (action === 'alt' && powers.me.rerolls > 0) powers.onReroll();
    },

    update(view, me, { paused }) { shown = { view, me, paused }; },

    /** Shared (not per-player) match information on top of the world. */
    draw(ctx, W, H, dt) {
      const { view } = shown;
      if (!view) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      if (toast && (toast.age += dt) > TOAST_SECONDS) toast = null;
      if (announce && (announce.age += dt) > ANNOUNCE_SECONDS) announce = null;
      damage = Math.max(0, damage - dt * 3);

      // Damage flash and low-health rim.
      if (damage > 0 || low) {
        const alpha = Math.max(damage * 0.35, low ? 0.18 + Math.sin(performance.now() / 260) * 0.06 : 0);
        const gradient = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.7);
        gradient.addColorStop(0, 'rgba(180, 20, 40, 0)'); gradient.addColorStop(1, `rgba(200, 30, 50, ${alpha})`);
        ctx.fillStyle = gradient; ctx.fillRect(0, 0, W, H);
      }

      // Timer and realm progress, centered on top.
      const phase = PHASES[view.phase || 0];
      const status = view.phaseStatus || 'horde';
      const panelWidth = 360, x = (W - panelWidth) / 2;
      roundPanel(ctx, x, 10, panelWidth, 74, { radius: 12 });
      text(ctx, format(view.time || 0), W / 2, 40, { font: '800 26px Inter', align: 'center' });
      text(ctx, `${view.loop ? `∞${view.loop + 1} · ` : ''}${(view.phase || 0) + 1} / ${PHASES.length} · ${phase.name}`, W / 2, 60,
        { font: '600 14px Inter', align: 'center', color: phase.color || COLORS.mint, maxWidth: panelWidth - 24 });
      const clock = status === 'horde' ? `${format(Math.ceil(phaseDuration(view) - (view.phaseTime || 0)))} ATÉ O CHEFE`
        : status === 'boss' ? 'DERROTE O GUARDIÃO' : status === 'transition' ? 'GUARDIÃO DERROTADO' : 'CAMPANHA CONCLUÍDA';
      bar(ctx, x + 16, 70, panelWidth - 32, 4, (view.phaseTime || 0) / phaseDuration(view), phase.color || COLORS.mint);
      text(ctx, clock, W / 2, 97, { font: '700 12px Inter', align: 'center', color: COLORS.dim });

      const curses = (view.curses || []).map(id => CURSES[id]?.title).filter(Boolean);
      if (view.bloodPact) curses.push('+30% dano inimigo');
      if (curses.length) text(ctx, curses.join(' · '), W / 2, 114, { font: '600 12px Inter', align: 'center', color: COLORS.danger });

      const boss = view.enemies?.find(e => e.boss);
      if (boss) {
        const width = Math.min(520, W - 80), bx = (W - width) / 2, by = 124;
        roundPanel(ctx, bx, by, width, 50, { stroke: 'rgba(255, 107, 94, .5)' });
        text(ctx, `${phase.bossName}${boss.stage > 1 ? ` · Fúria ${boss.stage === 3 ? 'II' : 'I'}` : ''}`, bx + 14, by + 20, { font: '700 15px Inter', color: '#ffb3a8' });
        text(ctx, `${Math.ceil(boss.hp)} / ${Math.ceil(boss.maxHp)}`, bx + width - 14, by + 20, { font: '600 13px Inter', align: 'right', color: COLORS.dim });
        bar(ctx, bx + 14, by + 30, width - 28, 8, boss.hp / boss.maxHp, '#e0485a');
      }

      const objective = objectiveText(view, shown.me);
      if (objective) {
        roundPanel(ctx, 16, 110, 330, 58, { stroke: 'rgba(255, 211, 107, .45)' });
        text(ctx, objective.title, 30, 132, { font: '700 14px Inter', color: COLORS.gold, maxWidth: 300 });
        text(ctx, objective.text, 30, 154, { font: '500 13px Inter', maxWidth: 300 });
      }

      if (status === 'transition') {
        const next = PHASES[((view.phase || 0) + 1) % PHASES.length];
        roundPanel(ctx, W / 2 - 260, H / 2 - 60, 520, 100, { stroke: COLORS.gold });
        text(ctx, 'PASSAGEM ABERTA', W / 2, H / 2 - 28, { font: '700 13px Inter', align: 'center', color: COLORS.gold });
        text(ctx, `${next.name} · ${Math.ceil(view.transitionTime)}s`, W / 2, H / 2 + 2, { font: '700 26px Cinzel', align: 'center' });
        text(ctx, 'Os sobreviventes recuperam 35% da vida e ganham um poder', W / 2, H / 2 + 26, { font: '500 14px Inter', align: 'center', color: COLORS.dim });
      }

      if (announce) {
        const fade = Math.min(1, (ANNOUNCE_SECONDS - announce.age) * 3);
        ctx.globalAlpha = fade;
        text(ctx, announce.message, W / 2, 214, { font: '800 24px Inter', align: 'center', color: TONES[announce.tone] || COLORS.mint, maxWidth: W - 80 });
        ctx.globalAlpha = 1;
      }
      if (toast) {
        ctx.font = '600 16px Inter';
        const width = Math.min(W - 60, ctx.measureText(toast.message).width + 40);
        ctx.globalAlpha = Math.min(1, (TOAST_SECONDS - toast.age) * 4);
        roundPanel(ctx, (W - width) / 2, H - 150, width, 38, { radius: 19 });
        text(ctx, toast.message, W / 2, H - 131, { font: '600 16px Inter', align: 'center', baseline: 'middle', maxWidth: width - 20 });
        ctx.globalAlpha = 1;
      }
    },

    /** The power choice modal, same content as the web one. */
    drawPowers(ctx, W, H) {
      if (!powers) return;
      veil(ctx, W, H, 0.55);
      const { me, choices, title, selected } = powers;
      text(ctx, title, W / 2, 128, { font: '700 34px Cinzel', align: 'center', color: COLORS.gold });
      text(ctx, 'Escolha como o ritual deve evoluir', W / 2, 160, { font: '500 17px Inter', align: 'center', color: COLORS.dim });
      const cardWidth = 300, gap = 28, total = choices.length * cardWidth + (choices.length - 1) * gap;
      choices.forEach((id, index) => {
        const [icon, name, description] = POWER_INFO[id] || ['?', id, ''];
        const power = POWERS[id];
        const x = (W - total) / 2 + index * (cardWidth + gap), y = 200, active = index === selected;
        roundPanel(ctx, x, y, cardWidth, 300, { fill: active ? 'rgba(28, 64, 56, .96)' : COLORS.panelSolid,
          stroke: active ? COLORS.focus : COLORS.line, lineWidth: active ? 3 : 1, radius: 16 });
        text(ctx, icon, x + cardWidth / 2, y + 70, { font: '44px serif', align: 'center', color: COLORS.gold });
        text(ctx, name, x + cardWidth / 2, y + 120, { font: '700 21px Inter', align: 'center', maxWidth: cardWidth - 24 });
        const badge = KIND_LABELS[power?.kind];
        if (badge) text(ctx, badge.toUpperCase(), x + cardWidth / 2, y + 144, { font: '700 12px Inter', align: 'center', color: COLORS.mint });
        const rank = (me.powers?.[id] || 0) + 1;
        const detail = power?.kind === 'evolution' ? `${description} · ${requirementText(power.requires)}` : `${description} · Grau ${rank}/${power?.max ?? 1}`;
        wrapText(ctx, detail, x + 20, y + 178, cardWidth - 40, 22, { font: '500 16px Inter', color: COLORS.ink });
      });
      const hint = `◀ ▶ escolher · ${powerLabels.confirm} confirmar${me.rerolls > 0 ? ` · ${powerLabels.alt} trocar opções (${me.rerolls})` : ''}`;
      text(ctx, hint, W / 2, 548, { font: '600 17px Inter', align: 'center', color: COLORS.mint });
    }
  };
}

function objectiveText(view, me) {
  if (view.over || view.phaseStatus !== 'horde') return null;
  const altar = view.altar;
  if (altar && !['complete', 'expired'].includes(altar.status)) {
    return { title: '◇ ALTAR OPCIONAL', text: `${Math.floor(altar.progress)}/15s defendidos · expira em ${Math.ceil(altar.ttl)}s` };
  }
  const encounter = view.encounter;
  if (!encounter || ['complete', 'expired'].includes(encounter.status)) return null;
  const ttl = Math.ceil(encounter.ttl);
  if (encounter.kind === 'merchant') return { title: '⚖ MERCADOR ERRANTE', text: `Fique perto dele e troque moedas por um poder · ${ttl}s${me?.shopProgress > 0 ? ' · negociando…' : ''}` };
  if (encounter.kind === 'shrine') return { title: '☥ SANTUÁRIO AMALDIÇOADO', text: `${Math.floor(encounter.progress)}s no círculo aceitam o pacto · some em ${ttl}s` };
  return { title: '✪ LADRÃO DE RELÍQUIAS', text: `Derrube-o antes que fuja: ${ttl}s` };
}
