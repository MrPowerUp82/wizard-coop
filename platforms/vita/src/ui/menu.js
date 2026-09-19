// @ts-check
import { SPELLS } from '../../../../server/game.js';
import { SPECIALS } from '../../../../server/weapons.js';
import { CAMPAIGNS, campaignId } from '../../../../server/campaign.js';
import { CURSES, dailyChallenge } from '../../../../server/curses.js';
import { characterEffects, characterNames, dailyRecord } from '../../../../src/menu.js';
import { PLAYER_SPRITES, drawSprite, view as spriteCamera } from '../../../../src/sprites.js';
import { COLORS, menuList, roundPanel, text, wrapText } from './draw.js';

// Canvas menus for PlayStation Vita (960×544).
// Reuses the rules from the shared game logic: character unlocks, campaign modes,
// daily challenge, Grimório upgrades, saved preferences.

const prefs = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* ignore */ } }
};

const savedCharacter = (key, fallback) => {
  const value = Number(prefs.get(key) ?? fallback);
  return Number.isInteger(value) && value >= 0 && value < SPELLS.length ? value : fallback;
};

/**
 * @param {{
 *   controllers: any,
 *   wallet: any,
 *   audio: any,
 *   debugControllers: boolean,
 *   onSolo: (character: number) => void,
 *   onCoop: (first: number, second: number) => void,
 *   onDaily: () => void,
 *   onExit: () => void
 * }} options
 */
export function createVitaMenu({ controllers, wallet, audio, debugControllers, onSolo, onCoop, onDaily, onExit }) {
  let screen = 'main';
  let focus = 0;
  const character = savedCharacter('arcana-character', 0);
  const characters = [character, savedCharacter('arcana-character-p2', (character + 1) % SPELLS.length)];
  let campaign = campaignId(prefs.get('arcana-campaign'));
  const ready = [false, false];
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
      { id: 'daily', label: 'Desafio diário', detail: `${challenge.curses.map(id => CURSES[id].title).join(' + ')} · ${characterNames[challenge.character]}${record ? ` · recorde: ${record.phase}` : ''}` },
      { id: 'campaign', label: 'Ritmo da campanha', detail: `◀ ${CAMPAIGNS[campaign].name} ▶` },
      { id: 'shop', label: 'Grimório', detail: `${wallet.coins} moedas` },
      { id: 'controllers', label: 'Controles', detail: `${controllers.connectedCount} conectado(s)` },
      { id: 'exit', label: 'Sair', detail: '' }
    ];
  }

  function go(next) {
    screen = next;
    focus = 0;
    click();
    controllers.setCoop(false);
  }

  function mainInput(event) {
    const items = mainItems();
    if (event.action === 'up') { focus = (focus + items.length - 1) % items.length; click(); }
    else if (event.action === 'down') { focus = (focus + 1) % items.length; click(); }
    else if (event.action === 'left' || event.action === 'right') {
      if (items[focus].id === 'campaign') {
        const list = campaigns();
        const next = (list.indexOf(campaign) + (event.action === 'right' ? 1 : list.length - 1)) % list.length;
        campaign = list[next];
        prefs.set('arcana-campaign', campaign);
        click();
      }
    } else if (event.action === 'confirm') {
      const item = items[focus];
      if (item.id === 'solo') go('solo');
      else if (item.id === 'daily') onDaily();
      else if (item.id === 'campaign') {
        const list = campaigns();
        campaign = list[(list.indexOf(campaign) + 1) % list.length];
        prefs.set('arcana-campaign', campaign);
        click();
      } else if (item.id === 'shop') { shopFocus = 0; go('shop'); }
      else if (item.id === 'controllers') go('controllers');
      else if (item.id === 'exit') onExit();
    }
  }

  function soloInput(event) {
    if (event.action === 'left') { characters[0] = (characters[0] + SPELLS.length - 1) % SPELLS.length; click(); }
    else if (event.action === 'right') { characters[0] = (characters[0] + 1) % SPELLS.length; click(); }
    else if (event.action === 'confirm') {
      prefs.set('arcana-character', characters[0]);
      onSolo(characters[0]);
    } else if (event.action === 'cancel') go('main');
  }

  function lobbyInput(event) {
    const slot = event.slot;
    if (slot < 0) {
      if (event.action === 'join' || event.action === 'confirm') {
        const free = [0, 1].find(s => controllers.missing(s));
        if (free !== undefined) { controllers.bind(free, event.pad); click(); }
      } else if (event.action === 'cancel' && !controllers.padFor(0)) go('main');
      return;
    }
    if (event.action === 'cancel') {
      if (ready[slot]) { ready[slot] = false; click(); }
      else go('main');
      return;
    }
    if (event.action === 'alt' && !ready[0] && !ready[1]) {
      controllers.swap();
      click();
      return;
    }
    if (event.action === 'left' && !ready[slot]) {
      const other = characters[1 - slot];
      let pick = (characters[slot] + SPELLS.length - 1) % SPELLS.length;
      if (pick === other) pick = (pick + SPELLS.length - 1) % SPELLS.length;
      characters[slot] = pick;
      click();
    } else if (event.action === 'right' && !ready[slot]) {
      const other = characters[1 - slot];
      let pick = (characters[slot] + 1) % SPELLS.length;
      if (pick === other) pick = (pick + 1) % SPELLS.length;
      characters[slot] = pick;
      click();
    } else if (event.action === 'confirm' || event.action === 'join') {
      ready[slot] = true;
      click();
      if (ready[0] && ready[1] && controllers.padFor(0) && controllers.padFor(1)) {
        prefs.set('arcana-character', characters[0]);
        prefs.set('arcana-character-p2', characters[1]);
        onCoop(characters[0], characters[1]);
      }
    }
  }

  function shopInput(event) {
    const offers = wallet.offers();
    if (event.action === 'up') { shopFocus = Math.max(0, shopFocus - 1); click(); }
    else if (event.action === 'down') { shopFocus = Math.min(offers.length - 1, shopFocus + 1); click(); }
    else if (event.action === 'confirm') {
      const offer = offers[shopFocus];
      if (offer && wallet.buy(offer.id)) { say(`${offer.title} adquirido!`); audio.play('power'); }
      else click();
    } else if (event.action === 'alt') {
      wallet.refund();
      say('Moedas redistribuídas');
      click();
    } else if (event.action === 'cancel') go('main');
  }

  function drawCharacter(ctx, color, x, y, width, { active = false, time = 0 } = {}) {
    const spell = SPELLS[color];
    const height = 220;
    roundPanel(ctx, x, y, width, height, {
      fill: active ? 'rgba(30, 72, 60, .92)' : COLORS.panel,
      stroke: active ? COLORS.focus : COLORS.line,
      lineWidth: active ? 2 : 1,
      radius: 10
    });
    Object.assign(spriteCamera, { dpr: 1, camX: 0, camY: 0, shakeX: 0, shakeY: 0 });
    drawSprite(ctx, PLAYER_SPRITES[color], x + width / 2, y + 46 + Math.sin(time * 3 + color) * 3, 76, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    text(ctx, characterNames[color], x + width / 2, y + 104, { font: '700 18px Cinzel', align: 'center', color: spell.tint });
    text(ctx, spell.name, x + width / 2, y + 124, { font: '600 13px Inter', align: 'center', maxWidth: width - 16 });
    wrapText(ctx, `${characterEffects[color]} · Especial: ${SPECIALS[color].name}`, x + 10, y + 144, width - 20, 15, { font: '500 11px Inter', color: COLORS.dim });
  }

  function drawTitle(ctx, W, subtitle) {
    text(ctx, 'ARCANA', W / 2, 56, { font: '700 38px Cinzel', align: 'center', color: COLORS.ink });
    text(ctx, 'SURVIVORS', W / 2, 88, { font: '700 22px Cinzel', align: 'center', color: COLORS.mint });
    if (subtitle) text(ctx, subtitle, W / 2, 114, { font: '600 14px Inter', align: 'center', color: COLORS.dim });
  }

  function drawLobbySlot(ctx, slot, x, width, H, time) {
    const pad = controllers.padFor(slot);
    const labels = controllers.labels(slot);
    const midX = x + width / 2;
    text(ctx, `JOGADOR ${slot + 1}`, midX, 150, { font: '700 18px Cinzel', align: 'center', color: SPELLS[characters[slot]].tint });
    text(ctx, pad ? pad.label : 'Aguardando controle…', midX, 172, { font: '600 14px Inter', align: 'center', color: pad ? COLORS.ink : COLORS.dim });
    text(ctx, pad ? '✓ conectado' : '✗ conecte um controle (DS3/DS4)', midX, 190,
      { font: '600 13px Inter', align: 'center', color: pad ? COLORS.mint : COLORS.danger });
    drawCharacter(ctx, characters[slot], midX - 100, 204, 200, { active: ready[slot], time });
    text(ctx, ready[slot] ? 'PRONTO' : `◀ ▶ personagem · ${labels.confirm} pronto`, midX, 450,
      { font: '700 14px Inter', align: 'center', color: ready[slot] ? COLORS.gold : COLORS.mint });
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
        menuList(ctx, mainItems(), focus, (W - 540) / 2, 136, 540, { rowHeight: 44, font: '700 16px Inter' });
        text(ctx, '↑ ↓ navegar · ✕ confirmar · ◯ voltar', W / 2, H - 18, { font: '600 13px Inter', align: 'center', color: COLORS.dim });
      } else if (screen === 'solo') {
        drawTitle(ctx, W, 'ESCOLHA SEU PERSONAGEM');
        const cardW = 190, gap = 16, total = SPELLS.length * cardW + (SPELLS.length - 1) * gap;
        SPELLS.forEach((_, color) => drawCharacter(ctx, color, (W - total) / 2 + color * (cardW + gap), 146, cardW, { active: color === characters[0], time }));
        text(ctx, `◀ ▶ escolher · ✕ confirmar · ◯ voltar · ${CAMPAIGNS[campaign].name}`, W / 2, H - 24, { font: '600 14px Inter', align: 'center', color: COLORS.mint });
      } else if (screen === 'lobby') {
        drawTitle(ctx, W, 'CO-OP LOCAL · TELA DIVIDIDA');
        drawLobbySlot(ctx, 0, 0, W / 2, H, time);
        drawLobbySlot(ctx, 1, W / 2, W / 2, H, time);
        ctx.fillStyle = COLORS.line;
        ctx.fillRect(W / 2 - 0.5, 140, 1, 310);
        const hint = controllers.connectedCount < 2
          ? 'Conecte um segundo controle (DualShock 3/4 no PS TV ou via ds4vita) · ◯ volta'
          : 'Cada jogador escolhe com o próprio controle · ▢ troca controles · ◯ volta';
        wrapText(ctx, hint, 60, H - 56, W - 120, 18, { font: '600 13px Inter', color: COLORS.dim, align: 'center' });
      } else if (screen === 'shop') {
        drawTitle(ctx, W, `GRIMÓRIO · ${wallet.coins} moedas`);
        const offers = wallet.offers();
        const start = Math.max(0, Math.min(shopFocus - 2, offers.length - 6));
        menuList(ctx, offers.slice(start, start + 6).map(offer => ({
          label: `${offer.title}  ${'●'.repeat(offer.rank)}${'○'.repeat(offer.max - offer.rank)}`,
          detail: offer.cost === null ? 'Completo' : `${offer.cost} moedas`,
          disabled: offer.cost === null || wallet.coins < offer.cost
        })), shopFocus - start, (W - 620) / 2, 138, 620, { rowHeight: 46, font: '700 16px Inter' });
        const offer = offers[shopFocus];
        if (offer) text(ctx, offer.description, W / 2, 456, { font: '500 13px Inter', align: 'center', color: COLORS.dim, maxWidth: W - 100 });
        text(ctx, `✕ comprar · ▢ redistribuir (${wallet.invested} moedas) · ◯ voltar`, W / 2, H - 22, { font: '600 14px Inter', align: 'center', color: COLORS.mint });
      } else if (screen === 'controllers') {
        drawTitle(ctx, W, 'CONTROLES CONECTADOS');
        const list = controllers.pads.filter(p => p.connected);
        list.forEach((pad, row) => text(ctx, `Porta ${pad.port} · ${pad.label}`, 160, 160 + row * 28, { font: '600 16px Inter' }));
        if (!list.length) text(ctx, 'Nenhum controle detectado', W / 2, 200, { font: '600 16px Inter', align: 'center', color: COLORS.dim });
        wrapText(ctx, 'No PlayStation TV ou com o plugin ds4vita, dois controles DualShock 3/4 jogam em co-op local tela dividida.', 160, 360, W - 320, 20, { font: '500 14px Inter', color: COLORS.dim });
        if (debugControllers) text(ctx, 'DEBUG_CONTROLLERS ativo', W / 2, H - 54, { font: '600 13px Inter', align: 'center', color: COLORS.gold });
        text(ctx, '◯ voltar', W / 2, H - 24, { font: '600 14px Inter', align: 'center', color: COLORS.mint });
      }
      if (message) {
        roundPanel(ctx, W / 2 - 200, H - 80, 400, 36, { radius: 18 });
        text(ctx, message.value, W / 2, H - 62, { font: '600 14px Inter', align: 'center', baseline: 'middle' });
      }
    }
  };
}
