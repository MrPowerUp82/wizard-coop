// @ts-check
import { SPELLS } from '../../../../server/game.js';
import { SPECIALS } from '../../../../server/weapons.js';
import { CAMPAIGNS, campaignId } from '../../../../server/campaign.js';
import { CURSES, dailyChallenge } from '../../../../server/curses.js';
import { characterEffects, characterNames, dailyRecord } from '../../../../src/menu.js';
import { PLAYER_SPRITES, drawSprite, view as spriteCamera } from '../../../../src/sprites.js';
import { labelsFor } from '../input/mappings.js';
import { COLORS, menuList, roundPanel, text, wrapText } from './draw.js';

// Canvas menus for the Switch. The web menu (src/menu.js) is DOM; the rules it applies are reused:
// the same characters, campaign unlocks, daily challenge, Grimório wallet and saved preferences
// (same localStorage keys). Co-op keeps the web's split-screen rule that player 2 cannot pick
// player 1's character; each player picks with their own controller.

const prefs = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* preference only */ } }
};
const savedCharacter = (key, fallback) => {
  const value = Number(prefs.get(key) ?? fallback);
  return Number.isInteger(value) && value >= 0 && value < SPELLS.length ? value : fallback;
};
const SEPARATE_JOYCONS = 'HOME › Controles › Mudar empunhadura/ordem: segure cada Joy-Con na horizontal e pressione SL + SR.';

/**
 * @param {{ controllers: any, wallet: any, audio: any, debugControllers: boolean,
 *   onSolo: (character: number) => void, onCoop: (first: number, second: number) => void,
 *   onDaily: () => void, onExit: () => void }} options
 */
export function createSwitchMenu({ controllers, wallet, audio, debugControllers, onSolo, onCoop, onDaily, onExit }) {
  let screen = 'main';
  let focus = 0;
  let character = savedCharacter('arcana-character', 0);
  const characters = [character, savedCharacter('arcana-character-p2', (character + 1) % SPELLS.length)];
  let campaign = campaignId(prefs.get('arcana-campaign'));
  let ready = [false, false];
  let message = null;
  let shopFocus = 0;

  const unlocked = id => (wallet.upgrades[id] || 0) > 0;
  const campaigns = () => Object.keys(CAMPAIGNS).filter(id => id !== 'endless' || unlocked('endless'));
  if (!campaigns().includes(campaign)) campaign = 'quick';
  const say = value => { message = { value, age: 0 }; };
  const click = () => audio.play('click');

  function mainItems() {
    const challenge = dailyChallenge();
    const record = dailyRecord(challenge.key);
    return [
      { id: 'solo', label: 'Jogar solo', detail: 'Sobreviva no seu ritmo' },
      { id: 'coop', label: 'Co-op local', detail: 'Tela dividida · Joy-Con L + Joy-Con R' },
      { id: 'daily', label: 'Desafio diário', detail: `${challenge.curses.map(id => CURSES[id].title).join(' + ')} · ${characterNames[challenge.character]}${record ? ` · recorde: reino ${record.phase}` : ''}` },
      { id: 'campaign', label: 'Ritmo da campanha', detail: `◀ ${CAMPAIGNS[campaign].name} ▶` },
      { id: 'shop', label: 'Grimório', detail: `${wallet.coins} moedas` },
      { id: 'controllers', label: 'Controles', detail: `${controllers.connectedCount} conectado(s)` },
      { id: 'exit', label: 'Sair', detail: '' }
    ];
  }

  function go(next) {
    screen = next; focus = 0; click();
    if (next === 'lobby') {
      ready = [false, false];
      controllers.setCoop(true);
      controllers.autoAssign();
      if (characters[1] === characters[0]) characters[1] = (characters[0] + 1) % SPELLS.length;
    } else if (next === 'main') controllers.setCoop(false);
  }

  function cycleCharacter(slot, step) {
    let next = characters[slot];
    do next = (next + step + SPELLS.length) % SPELLS.length; while (screen === 'lobby' && next === characters[1 - slot]);
    characters[slot] = next;
    prefs.set(slot ? 'arcana-character-p2' : 'arcana-character', String(next));
    click();
  }

  function mainInput({ action }) {
    const items = mainItems();
    if (action === 'up') { focus = (focus + items.length - 1) % items.length; click(); }
    else if (action === 'down') { focus = (focus + 1) % items.length; click(); }
    const item = items[focus];
    if (item.id === 'campaign' && (action === 'left' || action === 'right' || action === 'confirm')) {
      const list = campaigns();
      campaign = list[(list.indexOf(campaign) + (action === 'left' ? list.length - 1 : 1)) % list.length];
      prefs.set('arcana-campaign', campaign);
      click();
      return;
    }
    if (action !== 'confirm') return;
    if (item.id === 'solo') go('solo');
    else if (item.id === 'coop') go('lobby');
    else if (item.id === 'daily') onDaily();
    else if (item.id === 'shop') { go('shop'); shopFocus = 0; }
    else if (item.id === 'controllers') go('controllers');
    else if (item.id === 'exit') onExit();
  }

  function soloInput({ action }) {
    if (action === 'left') cycleCharacter(0, -1);
    else if (action === 'right') cycleCharacter(0, 1);
    else if (action === 'cancel') go('main');
    else if (action === 'confirm') { character = characters[0]; onSolo(character); }
  }

  function lobbyInput({ action, slot, pad }) {
    if (slot < 0) {
      // A controller without a slot joins the first free one (SL+SR on a sideways Joy-Con, or confirm).
      if (action === 'join' || action === 'confirm') {
        const free = [0, 1].find(s => controllers.missing(s));
        if (free !== undefined) { controllers.bind(free, pad); click(); }
      } else if (action === 'cancel' && !controllers.padFor(0)) go('main');
      return;
    }
    if (action === 'left' && !ready[slot]) cycleCharacter(slot, -1);
    else if (action === 'right' && !ready[slot]) cycleCharacter(slot, 1);
    else if (action === 'confirm' || action === 'join') { ready[slot] = true; click(); }
    else if (action === 'cancel') { if (ready[slot]) { ready[slot] = false; click(); } else go('main'); }
    else if (action === 'alt' && !ready[0] && !ready[1]) { controllers.swap(); click(); }
    if (ready[0] && ready[1] && controllers.padFor(0) && controllers.padFor(1)) onCoop(characters[0], characters[1]);
  }

  function shopInput({ action }) {
    const offers = wallet.offers();
    if (action === 'up') shopFocus = (shopFocus + offers.length - 1) % offers.length;
    else if (action === 'down') shopFocus = (shopFocus + 1) % offers.length;
    else if (action === 'cancel') go('main');
    else if (action === 'confirm') {
      const offer = offers[shopFocus];
      if (wallet.buy(offer.id)) { audio.play('chest'); say(offer.unlock ? `${offer.title} desbloqueado` : `${offer.title} aprimorado`); }
      else say(offer.cost === null ? 'Melhoria completa' : 'Moedas insuficientes');
    } else if (action === 'alt' && wallet.invested > 0) say(`${wallet.respec()} moedas devolvidas ao Grimório`);
  }

  function drawCharacter(ctx, color, x, y, width, { active, taken = false, time }) {
    const spell = SPELLS[color];
    roundPanel(ctx, x, y, width, 250, { fill: active ? 'rgba(28, 64, 56, .95)' : COLORS.panelSolid,
      stroke: active ? spell.tint : COLORS.line, lineWidth: active ? 3 : 1, radius: 16 });
    Object.assign(spriteCamera, { dpr: 1, camX: 0, camY: 0, shakeX: 0, shakeY: 0 });
    drawSprite(ctx, PLAYER_SPRITES[color], x + width / 2, y + 70 + Math.sin(time * 3 + color) * 3, 96, 0, taken ? 0.35 : 1);
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1;
    text(ctx, characterNames[color], x + width / 2, y + 148, { font: '700 22px Cinzel', align: 'center', color: spell.tint });
    text(ctx, spell.name, x + width / 2, y + 172, { font: '600 15px Inter', align: 'center', maxWidth: width - 20 });
    wrapText(ctx, `${characterEffects[color]} · Especial: ${SPECIALS[color].name}`, x + 14, y + 196, width - 28, 18, { font: '500 13px Inter', color: COLORS.dim });
  }

  function drawTitle(ctx, W, subtitle) {
    text(ctx, 'ARCANA', W / 2, 92, { font: '700 58px Cinzel', align: 'center', color: COLORS.ink });
    text(ctx, 'SURVIVORS', W / 2, 136, { font: '700 30px Cinzel', align: 'center', color: COLORS.mint });
    if (subtitle) text(ctx, subtitle, W / 2, 172, { font: '600 16px Inter', align: 'center', color: COLORS.dim });
  }

  function drawLobbySlot(ctx, slot, x, width, H, time) {
    const pad = controllers.padFor(slot);
    const labels = labelsFor(pad?.kind);
    text(ctx, `JOGADOR ${slot + 1}`, x + width / 2, 214, { font: '700 20px Cinzel', align: 'center', color: SPELLS[characters[slot]].tint });
    text(ctx, pad ? pad.label : 'Aguardando controle…', x + width / 2, 240, { font: '600 16px Inter', align: 'center', color: pad ? COLORS.ink : COLORS.dim });
    text(ctx, pad ? '✓ conectado' : '✗ pressione SL + SR (ou A) no controle', x + width / 2, 262,
      { font: '600 14px Inter', align: 'center', color: pad ? COLORS.mint : COLORS.danger });
    drawCharacter(ctx, characters[slot], x + (width - 240) / 2, 282, 240, { active: ready[slot], time });
    text(ctx, ready[slot] ? 'PRONTO' : `◀ ▶ personagem · ${labels.confirm} pronto`, x + width / 2, 562,
      { font: '700 16px Inter', align: 'center', color: ready[slot] ? COLORS.gold : COLORS.mint });
  }

  return {
    get screen() { return screen; },
    get campaign() { return campaign; },
    enter(next = 'main') { screen = next; focus = 0; if (next === 'main') controllers.setCoop(false); },
    update(events, dt) {
      if (message && (message.age += dt) > 2.4) message = null;
      for (const event of events) {
        if (screen === 'main') mainInput(event);
        else if (screen === 'solo') soloInput(event);
        else if (screen === 'lobby') lobbyInput(event);
        else if (screen === 'shop') shopInput(event);
        else if (screen === 'controllers' && event.action === 'cancel') go('main');
        if (screen === 'playing') break;
      }
    },
    draw(ctx, W, H, time) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      if (screen === 'main') {
        drawTitle(ctx, W, 'A noite não termina. Sua magia também não.');
        menuList(ctx, mainItems(), focus, (W - 640) / 2, 200, 640);
        text(ctx, '↑ ↓ navegar · A / ▶ confirmar', W / 2, H - 28, { font: '600 15px Inter', align: 'center', color: COLORS.dim });
      } else if (screen === 'solo') {
        drawTitle(ctx, W, 'ESCOLHA SEU PERSONAGEM');
        const width = 250, gap = 24, total = SPELLS.length * width + (SPELLS.length - 1) * gap;
        SPELLS.forEach((_, color) => drawCharacter(ctx, color, (W - total) / 2 + color * (width + gap), 220, width, { active: color === characters[0], time }));
        text(ctx, `◀ ▶ escolher · A confirmar · B voltar · ${CAMPAIGNS[campaign].name}`, W / 2, H - 40, { font: '600 17px Inter', align: 'center', color: COLORS.mint });
      } else if (screen === 'lobby') {
        drawTitle(ctx, W, 'CO-OP LOCAL · TELA DIVIDIDA');
        drawLobbySlot(ctx, 0, 0, W / 2, H, time);
        drawLobbySlot(ctx, 1, W / 2, W / 2, H, time);
        ctx.fillStyle = COLORS.line; ctx.fillRect(W / 2 - 0.5, 200, 1, 380);
        const joined = controllers.pads.some(p => p.connected && p.kind === 'joyDual');
        const hint = joined ? `Seus Joy-Cons estão juntos como um único controle. Para separá-los: ${SEPARATE_JOYCONS}`
          : controllers.connectedCount < 2 ? `Conecte um segundo controle ou use os Joy-Cons separados. ${SEPARATE_JOYCONS}`
            : `Cada jogador escolhe com o próprio controle · Y / ▲ troca os controles de lugar · B volta`;
        wrapText(ctx, hint, 120, H - 110, W - 240, 22, { font: '600 15px Inter', color: joined ? COLORS.gold : COLORS.dim, align: 'left' });
      } else if (screen === 'shop') {
        drawTitle(ctx, W, `GRIMÓRIO · ${wallet.coins} moedas`);
        const offers = wallet.offers();
        const start = Math.max(0, Math.min(shopFocus - 3, offers.length - 7));
        menuList(ctx, offers.slice(start, start + 7).map(offer => ({
          label: `${offer.title}  ${'●'.repeat(offer.rank)}${'○'.repeat(offer.max - offer.rank)}`,
          detail: offer.cost === null ? 'Completo' : `${offer.cost} moedas`, disabled: offer.cost === null || wallet.coins < offer.cost
        })), shopFocus - start, (W - 760) / 2, 196, 760, { rowHeight: 56, font: '700 18px Inter' });
        const offer = offers[shopFocus];
        if (offer) text(ctx, offer.description, W / 2, 610, { font: '500 16px Inter', align: 'center', color: COLORS.dim, maxWidth: W - 120 });
        text(ctx, `A comprar · Y redistribuir (${wallet.invested} investidas) · B voltar`, W / 2, H - 40, { font: '600 16px Inter', align: 'center', color: COLORS.mint });
      } else if (screen === 'controllers') {
        drawTitle(ctx, W, 'CONTROLES CONECTADOS');
        const list = controllers.pads.filter(p => p.connected);
        list.forEach((pad, row) => text(ctx, `${pad.index} · ${pad.label}`, 200, 230 + row * 34, { font: '600 18px Inter' }));
        if (!list.length) text(ctx, 'Nenhum controle conectado', W / 2, 240, { font: '600 18px Inter', align: 'center', color: COLORS.dim });
        wrapText(ctx, `Co-op: Joy-Con L é o Jogador 1 e Joy-Con R o Jogador 2, cada um na horizontal. ${SEPARATE_JOYCONS}`, 200, 520, W - 400, 24,
          { font: '500 16px Inter', color: COLORS.dim });
        if (debugControllers) text(ctx, 'DEBUG_CONTROLLERS ativo: valores brutos no painel lateral', W / 2, H - 70, { font: '600 14px Inter', align: 'center', color: COLORS.gold });
        text(ctx, 'B voltar', W / 2, H - 40, { font: '600 16px Inter', align: 'center', color: COLORS.mint });
      }
      if (message) {
        roundPanel(ctx, W / 2 - 260, H - 104, 520, 40, { radius: 20 });
        text(ctx, message.value, W / 2, H - 84, { font: '600 16px Inter', align: 'center', baseline: 'middle' });
      }
    }
  };
}
