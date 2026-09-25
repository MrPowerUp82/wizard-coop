import { SPELLS } from '../server/game.js';
import { ALT_SPECIALS, SPECIALS } from '../server/weapons.js';
import { CAMPAIGNS, campaignId } from '../server/campaign.js';
import { CURSES, curseReward, dailyChallenge, sanitizeCurses } from '../server/curses.js';
import { STARTING_WEAPONS } from '../server/meta.js';
import { POWER_INFO } from './powerInfo.js';
import { renderCodex } from './codex.js';
import { animateCreditsSeal } from './intro.js';
import { DEVELOPER } from '../server/developer.js';
import { characterPortrait } from './characterPortrait.js';
import { AURORA } from '../server/aurora.js';
import { GOD, GOD_COST } from '../server/god.js';
import { createAchievements } from './achievements.js';

const $ = selector => document.querySelector(selector);
const DEFAULT_SERVER = 'wss://vps65228.publiccloud.com.br/ws';
export const characterNames = ['Azul', 'Vermelho', 'Verde', 'Roxo', 'O Desenvolvedor', 'Guardião da Aurora', 'The God'];
export const characterEffects = ['Desacelera inimigos', 'Explode em área', 'Atravessa 3 inimigos', 'Lâmina larga, até 2 alvos', 'Secreto · 5× vida, 4× dano, disparo triplo', '+50% vida · +35% dano · perfura 2 alvos · raio solar periódico', '500 de vida · +50% dano · +20% velocidade · 12 armadura · ataques 15% mais rápidos · perfura 3 alvos · 2 planetas orbitais'];
const achievements = createAchievements();

const storage = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* preference only */ } }
};
let secretFound = false;
const developerUnlocked = () => secretFound || storage.get('arcana-developer-unlocked') === '1';
const godUnlocked = () => {
  try { return JSON.parse(storage.get('arcana-meta') || '{}').godUnlocked === true; } catch { return false; }
};

export function serverUrl() {
  return new URLSearchParams(location.search).get('server') || storage.get('arcana-server') || DEFAULT_SERVER;
}

export function playerName() {
  return ($('#playerNameInput').value.trim() || 'Arcanista').slice(0, 16);
}

export function renderCharacterPicker(element, selected, players, ownId, onChoose, disabled = false) {
  const active = /** @type {HTMLElement | null} */ (document.activeElement);
  const focused = element.contains(active) ? active?.dataset.color : undefined;
  element.replaceChildren(...SPELLS.flatMap((spell, color) => {
    if (color === DEVELOPER && !developerUnlocked()) return [];
    const occupant = players.find(p => p.color === color && p.id !== ownId);
    const locked = (color === AURORA && !achievements.aurora) || (color === GOD && !godUnlocked());
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'character-option'; button.dataset.color = String(color);
    button.setAttribute('aria-pressed', String(color === selected));
    button.style.setProperty('--character-color', spell.tint);
    button.disabled = disabled || Boolean(occupant) || locked;
    const portrait = document.createElement('span');
    portrait.className = 'character-portrait'; portrait.setAttribute('aria-hidden', 'true');
    characterPortrait(portrait, color);
    const title = document.createElement('b'); title.textContent = characterNames[color];
    const power = document.createElement('span'); power.textContent = spell.name;
    const detail = document.createElement('small');
    detail.textContent = locked ? color === GOD ? `Bloqueado · compre por ${GOD_COST} moedas no Grimório` : 'Bloqueado · vença os seis reinos no modo Clássico'
      : occupant ? `Em uso: ${occupant.name}` : `${characterEffects[color]} · Especial: ${SPECIALS[color].name}`;
    button.title = locked ? color === GOD ? `Compre The God por ${GOD_COST} moedas no Grimório.` : 'Derrote o último guardião no modo Clássico para desbloquear.' : SPECIALS[color].description;
    button.append(portrait, title, power, detail);
    button.onclick = () => onChoose(color);
    return button;
  }));
  if (focused !== undefined) element.querySelector(`[data-color="${focused}"]`)?.focus();
}

const readJson = (key, fallback) => { try { return JSON.parse(storage.get(key) || '') ?? fallback; } catch { return fallback; } };

/** Best daily-challenge result of today, kept in this browser. */
export function dailyRecord(key) {
  const saved = readJson('arcana-daily', null);
  return saved?.key === key ? saved : null;
}

export function saveDailyRecord(key, result) {
  const best = dailyRecord(key);
  const score = r => (r.loop || 0) * 100 + r.phase * 10 + (r.victory ? 5 : 0) + r.time / 10000;
  const improved = !best || score(result) > score(best);
  if (improved) storage.set('arcana-daily', JSON.stringify({ key, ...result }));
  return { improved, best: improved ? { key, ...result } : best };
}

export function createMenu({ wallet, codex, toast, onOffline, onSplit, onDaily, onCreate, onJoin, isIdle, audio }) {
  const characterAvailable = color => Number.isInteger(color) && color >= 0 && color < SPELLS.length
    && (color !== DEVELOPER || developerUnlocked()) && (color !== AURORA || achievements.aurora)
    && (color !== GOD || wallet.godUnlocked);
  const saved = Number(storage.get('arcana-character') ?? 0);
  let selected = characterAvailable(saved) ? saved : 0;
  let visibility = 'open';
  let campaign = campaignId(storage.get('arcana-campaign'));
  let curses = sanitizeCurses(readJson('arcana-curses', []));
  let weapon = storage.get('arcana-weapon') || '';
  let variant = storage.get('arcana-variant') === '1' ? 1 : 0;
  const savedSecond = Number(storage.get('arcana-character-p2') ?? 1);
  let second = characterAvailable(savedSecond) ? savedSecond : 1;
  let codexTab = 'powers';
  let stopBestiary = () => {};
  let cancelRoomRequest = () => {};

  function selectCharacter(color) {
    if (!characterAvailable(color)) return;
    selected = color;
    storage.set('arcana-character', String(color));
    renderCharacterPicker($('#characterPicker'), color, [], null, selectCharacter);
    characterPortrait($('.sprite-preview'), color);
    renderSplit();
    renderOptions();
  }

  /** Split screen: player 2 picks any character player 1 is not using. */
  function selectSecond(color) {
    if (!characterAvailable(color)) return;
    second = color;
    storage.set('arcana-character-p2', String(color));
    renderSplit();
  }

  function renderSplit() {
    if (second === selected) second = SPELLS.findIndex((_, color) => color !== selected && characterAvailable(color));
    renderCharacterPicker($('#splitPicker'), second, [{ id: 'p1', color: selected, name: 'Jogador 1' }], null, selectSecond);
  }

  const unlocked = id => (wallet.upgrades[id] || 0) > 0;

  function renderOptions() {
    const picker = $('#cursePicker');
    if (!picker) return;
    picker.replaceChildren(...Object.entries(CURSES).map(([id, curse]) => {
      const chip = document.createElement('button');
      chip.type = 'button'; chip.className = 'curse-chip';
      chip.setAttribute('aria-pressed', String(curses.includes(id)));
      const title = document.createElement('b'); title.textContent = `${curse.icon} ${curse.title}`;
      const text = document.createElement('small'); text.textContent = `${curse.description} · +${Math.round(curse.reward * 100)}% moedas`;
      chip.append(title, text);
      chip.onclick = () => {
        curses = curses.includes(id) ? curses.filter(other => other !== id) : [...curses, id];
        storage.set('arcana-curses', JSON.stringify(curses));
        renderOptions();
      };
      return chip;
    }));
    const bonus = Math.round((curseReward({ curses }) - 1) * 100);
    $('#curseReward').textContent = curses.length ? `${curses.length} ativa(s) · +${bonus}% moedas` : 'Sem maldições';

    const endlessOption = /** @type {HTMLOptionElement} */ ($('#campaignSelect option[value="endless"]'));
    endlessOption.disabled = !unlocked('endless');
    endlessOption.textContent = unlocked('endless') ? 'Infinito · os reinos se repetem cada vez mais difíceis' : 'Infinito · desbloqueie no Grimório';
    if (campaign === 'endless' && !unlocked('endless')) campaign = 'quick';
    $('#campaignSelect').value = campaign;

    const arsenal = unlocked('arsenal'), second = unlocked('secondSpell');
    $('#loadoutBox').classList.toggle('hidden', !arsenal && !second);
    $('#weaponLabel').classList.toggle('hidden', !arsenal);
    $('#variantLabel').classList.toggle('hidden', !second);
    const weaponSelect = /** @type {HTMLSelectElement} */ ($('#weaponSelect'));
    weaponSelect.replaceChildren(new Option('Nenhuma (sorteio normal)', ''),
      ...STARTING_WEAPONS.map(id => new Option(`${POWER_INFO[id][0]} ${POWER_INFO[id][1]}`, id)));
    weaponSelect.value = STARTING_WEAPONS.includes(weapon) ? weapon : '';
    const variantSelect = /** @type {HTMLSelectElement} */ ($('#variantSelect'));
    variantSelect.replaceChildren(new Option(SPECIALS[selected].name, '0'), new Option(ALT_SPECIALS[selected].name, '1'));
    variantSelect.value = String(variant);
    variantSelect.title = (variant ? ALT_SPECIALS : SPECIALS)[selected].description;

    const challenge = dailyChallenge();
    const record = dailyRecord(challenge.key);
    $('#dailyInfo').textContent = `${challenge.curses.map(id => CURSES[id].title).join(' + ')} · ${characterNames[challenge.character]}`
      + (record ? ` · recorde: reino ${record.phase}${record.loop ? ` (volta ${record.loop + 1})` : ''}` : '');
    const { found, total } = codex.progress();
    $('#codexInfo').textContent = `${found}/${total} registros descobertos`;
  }

  function showCodex() {
    stopBestiary();
    stopBestiary = renderCodex(codex, { tabs: $('#codexTabs'), list: $('#codexList'), progress: $('#codexProgress') }, codexTab, tab => { codexTab = tab; showCodex(); }, characterAvailable) || (() => {});
  }

  function renderOpenRooms(rooms) {
    const list = $('#openRoomsList');
    if (!rooms.length) {
      const empty = document.createElement('small');
      empty.textContent = 'Nenhuma sala aberta agora. Você pode criar a primeira.';
      list.replaceChildren(empty);
      return;
    }
    list.replaceChildren(...rooms.map(room => {
      const button = document.createElement('button');
      button.className = 'open-room';
      const description = document.createElement('span');
      const host = document.createElement('b');
      host.textContent = room.host;
      const code = document.createElement('small');
      code.textContent = `${CAMPAIGNS[room.campaign || 'classic'].name} • ${room.running ? 'Em andamento' : 'Aguardando jogadores'}`;
      description.append(host, code);
      const occupancy = document.createElement('em');
      occupancy.textContent = `${room.count}/4  ›`;
      button.append(description, occupancy);
      button.onclick = () => onJoin(room.code);
      return button;
    }));
  }

  function listMessage(text) {
    const small = document.createElement('small');
    small.textContent = text;
    $('#openRoomsList').replaceChildren(small);
  }

  function fetchOpenRooms() {
    cancelRoomRequest();
    $('#roomCapacity').textContent = '';
    if (!navigator.onLine) { listMessage('Sem internet. Você pode jogar offline ou iniciar o desafio diário.'); return; }
    let listSocket;
    try { listSocket = new WebSocket(serverUrl()); } catch { listMessage('Endereço do servidor inválido.'); return; }
    const timeout = setTimeout(() => { listMessage('O servidor demorou para responder.'); cancelRoomRequest(); }, 5000);
    cancelRoomRequest = () => {
      clearTimeout(timeout);
      listSocket.onopen = listSocket.onmessage = listSocket.onclose = null;
      listSocket.onerror = () => {};
      listSocket.close();
      cancelRoomRequest = () => {};
    };
    listSocket.onopen = () => listSocket.send(JSON.stringify({ type: 'listRooms' }));
    listSocket.onmessage = ({ data }) => {
      let message;
      try { message = JSON.parse(data); } catch { return; }
      if (!message || message.type !== 'rooms' || !Array.isArray(message.rooms)) return;
      renderOpenRooms(message.rooms);
      if (message.capacity) {
        const { used, max } = message.capacity;
        $('#roomCapacity').textContent = `${used}/${max} salas em uso${used >= max ? ' • Limite atingido. Entre em uma sala com vagas.' : ''}`;
      }
      cancelRoomRequest();
    };
    listSocket.onerror = listSocket.onclose = () => { listMessage('Não foi possível consultar as salas.'); cancelRoomRequest(); };
  }

  function renderShop() {
    const offers = wallet.offers();
    $('#shopCoins').textContent = `${wallet.coins} moedas`;
    $('#shopBtnCoins').textContent = wallet.coins ? `${wallet.coins} moedas para gastar` : 'Melhorias permanentes com moedas';
    $('#respecBtn').disabled = wallet.invested <= 0;
    $('#respecBtn').textContent = `Redistribuir melhorias · devolver ${wallet.invested} moedas`;
    $('#shopList').replaceChildren(...offers.map(offer => {
      const card = document.createElement('div');
      card.className = 'shop-item';
      const title = document.createElement('b'); title.textContent = offer.title;
      const pips = document.createElement('span'); pips.className = 'shop-pips';
      pips.textContent = '●'.repeat(offer.rank) + '○'.repeat(offer.max - offer.rank);
      const description = document.createElement('small'); description.textContent = offer.description;
      const buy = document.createElement('button');
      buy.className = 'compact';
      buy.textContent = offer.cost === null ? 'Completo' : `Comprar · ${offer.cost}`;
      buy.disabled = offer.cost === null || wallet.coins < offer.cost;
      buy.onclick = () => {
        if (wallet.buy(offer.id)) {
          audio.play('chest'); toast(offer.unlock ? `${offer.title} desbloqueado` : `${offer.title} aprimorado`);
          renderShop(); renderOptions();
          if (offer.id === 'theGod') { renderCharacterPicker($('#characterPicker'), selected, [], null, selectCharacter); renderSplit(); }
        }
      };
      if (offer.unlock) card.classList.add('unlock');
      card.append(title, pips, description, buy);
      return card;
    }));
  }

  selectCharacter(selected);
  let secretClicks = 0;
  $('#secretTitle').onclick = () => {
    if (!isIdle()) return;
    if (developerUnlocked()) { selectCharacter(DEVELOPER); return; }
    secretClicks++;
    if (secretClicks === 4) toast('Uma presença observa… mais três toques.');
    if (secretClicks < 7) return;
    secretFound = true;
    storage.set('arcana-developer-unlocked', '1');
    selectCharacter(DEVELOPER);
    audio.play('chest');
    toast('Easter egg descoberto: O Desenvolvedor despertou!');
  };
  const campaignSelect = $('#campaignSelect');
  campaignSelect.value = campaign;
  campaignSelect.onchange = () => { campaign = campaignId(campaignSelect.value); storage.set('arcana-campaign', campaign); };
  $('#respecBtn').onclick = () => { const refund = wallet.respec(); toast(`${refund} moedas devolvidas ao Grimório`); renderShop(); renderOptions(); };
  $('#weaponSelect').onchange = event => { weapon = event.target.value; storage.set('arcana-weapon', weapon); };
  $('#variantSelect').onchange = event => { variant = event.target.value === '1' ? 1 : 0; storage.set('arcana-variant', String(variant)); renderOptions(); };
  $('#dailyBtn').onclick = () => onDaily(dailyChallenge());
  $('#codexBtn').onclick = () => { showCodex(); $('#codexModal').classList.remove('hidden'); };
  $('#codexClose').onclick = () => { stopBestiary(); $('#codexModal').classList.add('hidden'); renderOptions(); };
  renderShop();
  $('#offlineBtn').onclick = () => onOffline();
  $('#shopBtn').onclick = () => { renderShop(); $('#shopModal').classList.remove('hidden'); };
  $('#shopClose').onclick = () => $('#shopModal').classList.add('hidden');
  $('#splitBtn').onclick = () => {
    $('#joinBox').classList.add('hidden');
    $('#createBox').classList.add('hidden');
    const box = $('#splitBox');
    box.classList.toggle('hidden');
    if (!box.classList.contains('hidden')) requestAnimationFrame(() => box.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
  };
  $('#confirmSplitBtn').onclick = () => onSplit();
  $('#createBtn').onclick = () => {
    $('#splitBox').classList.add('hidden');
    $('#joinBox').classList.add('hidden');
    const box = $('#createBox');
    box.classList.toggle('hidden');
    if (!box.classList.contains('hidden')) requestAnimationFrame(() => box.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
  };
  $('#joinToggle').onclick = () => {
    $('#splitBox').classList.add('hidden');
    $('#createBox').classList.add('hidden');
    const box = $('#joinBox');
    box.classList.toggle('hidden');
    if (!box.classList.contains('hidden')) {
      fetchOpenRooms();
      requestAnimationFrame(() => box.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
    }
  };
  /** @type {NodeListOf<HTMLButtonElement>} */ (document.querySelectorAll('[data-visibility]')).forEach(button => {
    button.onclick = () => {
      visibility = button.dataset.visibility;
      document.querySelectorAll('[data-visibility]').forEach(option => {
        const active = option === button;
        option.classList.toggle('selected', active);
        option.setAttribute('aria-checked', String(active));
      });
      $('#confirmCreateBtn').textContent = visibility === 'open' ? 'Criar sala aberta' : 'Criar sala fechada';
    };
  });
  $('#confirmCreateBtn').onclick = () => onCreate(visibility);
  $('#refreshRoomsBtn').onclick = fetchOpenRooms;
  $('#joinBtn').onclick = () => {
    const code = $('#roomInput').value.trim().toUpperCase();
    code.length < 4 ? toast('Digite o código da sala') : onJoin(code);
  };
  $('#settingsBtn').onclick = () => $('#settings').classList.toggle('hidden');
  const closeCredits = () => $('#creditsModal').classList.add('hidden');
  $('#creditsBtn').onclick = () => {
    $('#creditsModal').classList.remove('hidden');
    animateCreditsSeal($('#creditsSeal'), () => !$('#creditsModal').classList.contains('hidden'));
    $('#creditsClose').focus();
  };
  $('#creditsClose').onclick = closeCredits;
  addEventListener('keydown', event => { if (event.key === 'Escape') closeCredits(); });
  $('#serverUrl').value = serverUrl();
  $('#saveServer').onclick = () => { storage.set('arcana-server', $('#serverUrl').value.trim()); toast('Servidor salvo'); fetchOpenRooms(); };
  $('#playerNameInput').value = storage.get('arcana-player-name') || '';
  $('#playerNameInput').addEventListener('change', () => storage.set('arcana-player-name', playerName()));

  const refresh = () => { if (!document.hidden && isIdle()) fetchOpenRooms(); };
  refresh();
  addEventListener('online', refresh);
  addEventListener('offline', refresh);
  setInterval(refresh, 10000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });

  return {
    get unlocks() { return { aurora: achievements.aurora, god: wallet.godUnlocked }; },
    recordVictory(result) {
      const earned = achievements.recordVictory(result);
      if (earned) {
        renderCharacterPicker($('#characterPicker'), selected, [], null, selectCharacter);
        renderSplit();
      }
      return earned;
    },
    get character() { return selected; },
    get secondCharacter() { return second; },
    get campaign() { return campaign; },
    get curses() { return [...curses]; },
    get loadout() { return { weapon: weapon || null, special: variant }; },
    selectCharacter,
    fetchOpenRooms,
    renderShop,
    renderOptions
  };
}
