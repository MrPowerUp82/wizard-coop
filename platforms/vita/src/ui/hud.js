// @ts-check
import { POWERS } from '../../../../server/game.js';
import { PHASES } from '../../../../server/phases.js';
import { phaseDuration } from '../../../../server/campaign.js';
import { format } from '../../../../src/hud.js';
import { KIND_LABELS, POWER_INFO, requirementText } from '../../../../src/powerInfo.js';
import { COLORS, bar, roundPanel, text, veil, wrapText } from './draw.js';

// Canvas version of the game HUD for PlayStation Vita (960×544).
// Keeps the same method signatures as the web/Switch HUD so feedback.js and localCoop.js
// can interact with it without platform checks.

const TOAST_SECONDS = 2.2, ANNOUNCE_SECONDS = 2.6;
const TONES = { danger: COLORS.danger, gold: COLORS.gold, '': COLORS.mint };

export function createVitaHud() {
  let toast = null, announce = null, damage = 0, low = false;
  let shown = { view: null, me: null, paused: false };
  let powers = null;
  let shownPowers = '';
  let powerLabels = { confirm: '✕', alt: '▢' };

  return {
    toast(message) { toast = { message, age: 0 }; },
    announce(message, tone = '') { announce = { message, tone, age: 0 }; },
    flashDamage() { damage = 1; },
    setLowHealth(value) { low = value; },
    setReconnecting() {},
    resetCaches() { shownPowers = ''; powers = null; toast = null; announce = null; damage = 0; low = false; },

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
    powerInput(action) {
      if (!powers) return;
      const count = powers.choices.length;
      if (action === 'left' || action === 'up') powers.selected = (powers.selected + count - 1) % count;
      else if (action === 'right' || action === 'down') powers.selected = (powers.selected + 1) % count;
      else if (action === 'confirm') powers.onChoose(powers.choices[powers.selected]);
      else if (action === 'alt' && powers.me.rerolls > 0) powers.onReroll();
    },

    update(view, me, { paused }) { shown = { view, me, paused }; },

    draw(ctx, W, H, dt) {
      const { view } = shown;
      if (!view) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      if (toast && (toast.age += dt) > TOAST_SECONDS) toast = null;
      if (announce && (announce.age += dt) > ANNOUNCE_SECONDS) announce = null;
      damage = Math.max(0, damage - dt * 3);

      if (damage > 0 || low) {
        const alpha = Math.max(damage * 0.35, low ? 0.18 + Math.sin(performance.now() / 260) * 0.06 : 0);
        ctx.fillStyle = `rgba(200, 30, 50, ${alpha})`;
        ctx.fillRect(0, 0, W, H);
      }

      // Realm progress and clock
      const phase = PHASES[view.phase || 0];
      const status = view.phaseStatus || 'horde';
      const duration = phaseDuration(view);
      const remaining = Math.max(0, duration - (view.phaseTime || 0));
      const clock = status === 'boss' ? 'BATALHA DE CHEFE' : status === 'intermission' ? 'PORTAL ABERTO' : format(remaining);

      roundPanel(ctx, W / 2 - 130, 10, 260, 38, { radius: 8, fill: 'rgba(7, 14, 20, .8)' });
      text(ctx, `${phase ? phase.name : 'Reino'} · ${clock}`, W / 2, 34, { font: '700 15px Cinzel', align: 'center', color: COLORS.ink });

      // Active boss bar
      if (view.boss) {
        const boss = view.boss;
        const width = 480;
        const ratio = Math.max(0, boss.hp / Math.max(1, boss.maxHp));
        roundPanel(ctx, W / 2 - width / 2 - 10, 56, width + 20, 30, { radius: 6, fill: 'rgba(7, 14, 20, .88)' });
        bar(ctx, W / 2 - width / 2, 62, width, 16, ratio, COLORS.danger);
        text(ctx, `${boss.name} (${Math.round(ratio * 100)}%)`, W / 2, 75, {
          font: '700 12px Inter', align: 'center', baseline: 'middle', color: COLORS.ink
        });
      }

      // Toasts and Announcements
      if (announce) {
        const color = TONES[announce.tone] || COLORS.mint;
        text(ctx, announce.message, W / 2, 120, { font: '700 20px Cinzel', align: 'center', color });
      }
      if (toast) {
        roundPanel(ctx, W / 2 - 180, H - 60, 360, 34, { radius: 17 });
        text(ctx, toast.message, W / 2, H - 39, { font: '600 13px Inter', align: 'center', baseline: 'middle' });
      }
    },

    /** The power choice modal for 960x544 screen */
    drawPowers(ctx, W, H) {
      if (!powers || !powers.choices?.length) return;
      veil(ctx, W, H, 0.65);
      const { me, choices, title, selected } = powers;
      text(ctx, title || 'NOVO PODER', W / 2, 68, { font: '700 28px Cinzel', align: 'center', color: COLORS.gold });
      text(ctx, 'Escolha como o ritual deve evoluir', W / 2, 98, { font: '500 15px Inter', align: 'center', color: COLORS.dim });

      const cardW = 250, cardH = 280, gap = 20;
      const totalW = choices.length * cardW + (choices.length - 1) * gap;
      const startX = (W - totalW) / 2;
      const startY = 126;

      choices.forEach((id, index) => {
        const x = startX + index * (cardW + gap);
        const active = index === selected;
        const [icon, name, description] = POWER_INFO[id] || ['?', id, ''];
        const power = POWERS[id];
        const badge = KIND_LABELS[power?.kind];

        roundPanel(ctx, x, startY, cardW, cardH, {
          fill: active ? 'rgba(28, 64, 56, .96)' : COLORS.panelSolid,
          stroke: active ? COLORS.focus : COLORS.line,
          lineWidth: active ? 2 : 1,
          radius: 12
        });

        text(ctx, icon, x + cardW / 2, startY + 46, { font: '36px serif', align: 'center', color: COLORS.gold });
        text(ctx, name, x + cardW / 2, startY + 84, { font: '700 17px Inter', align: 'center', maxWidth: cardW - 20 });
        if (badge) text(ctx, badge.toUpperCase(), x + cardW / 2, startY + 106, { font: '700 11px Inter', align: 'center', color: COLORS.mint });

        const rank = (me?.powers?.[id] || 0) + 1;
        const detail = power?.kind === 'evolution' ? `${description} · ${requirementText(power.requires)}` : `${description} · Grau ${rank}/${power?.max ?? 1}`;
        wrapText(ctx, detail, x + 16, startY + 134, cardW - 32, 17, { font: '500 13px Inter', color: COLORS.ink });

        if (active) {
          text(ctx, `${powerLabels.confirm} ESCOLHER`, x + cardW / 2, startY + cardH - 16, {
            font: '700 12px Inter', align: 'center', color: COLORS.focus
          });
        }
      });

      const hint = `◀ ▶ escolher · ${powerLabels.confirm} confirmar${me?.rerolls > 0 ? ` · ${powerLabels.alt} trocar opções (${me.rerolls})` : ''}`;
      text(ctx, hint, W / 2, H - 32, { font: '600 14px Inter', align: 'center', color: COLORS.mint });
    }
  };
}
