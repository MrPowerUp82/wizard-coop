import { SPELLS } from '../server/game.js';

const $ = selector => document.querySelector(selector);
const DEFAULT_SERVER = 'wss://vps65228.publiccloud.com.br/ws';
const characterNames = ['Azul', 'Vermelho', 'Verde', 'Roxo'];
const characterEffects = ['Desacelera inimigos', 'Explode em área', 'Atravessa 3 inimigos', 'Lâmina larga, até 2 alvos'];

const storage = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* preference only */ } }
};

export function serverUrl() {
  return new URLSearchParams(location.search).get('server') || storage.get('arcana-server') || DEFAULT_SERVER;
}

export function playerName() {
  return ($('#playerNameInput').value.trim() || 'Arcanista').slice(0, 16);
}

export function renderCharacterPicker(element, selected, players, ownId, onChoose, disabled = false) {
  const focused = element.contains(document.activeElement) ? document.activeElement?.dataset.color : undefined;
  element.replaceChildren(...SPELLS.map((spell, color) => {
    const occupant = players.find(p => p.color === color && p.id !== ownId);
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'character-option'; button.dataset.color = color;
    button.setAttribute('aria-pressed', String(color === selected));
    button.style.setProperty('--character-color', spell.tint);
    button.disabled = disabled || Boolean(occupant);
    const portrait = document.createElement('span');
    portrait.className = 'character-portrait'; portrait.setAttribute('aria-hidden', 'true');
    portrait.style.backgroundPosition = `${color * 100 / 3}% 0`;
    const title = document.createElement('b'); title.textContent = characterNames[color];
    const power = document.createElement('span'); power.textContent = spell.name;
    const detail = document.createElement('small');
    detail.textContent = occupant ? `Em uso: ${occupant.name}` : characterEffects[color];
    button.append(portrait, title, power, detail);
    button.onclick = () => onChoose(color);
    return button;
  }));
  if (focused !== undefined) element.querySelector(`[data-color="${focused}"]`)?.focus();
}

export function createMenu({ wallet, toast, onOffline, onCreate, onJoin, isIdle, audio }) {
  const saved = Number(storage.get('arcana-character') ?? 0);
  let selected = Number.isInteger(saved) && saved >= 0 && saved < 4 ? saved : 0;
  let visibility = 'open';
  let cancelRoomRequest = () => {};

  function selectCharacter(color) {
    selected = color;
    storage.set('arcana-character', String(color));
    renderCharacterPicker($('#characterPicker'), color, [], null, selectCharacter);
    $('.sprite-preview').style.backgroundPosition = `${color * 100 / 3}% 0`;
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
      code.textContent = `Sala ${room.code} • ${room.running ? 'Em andamento' : 'Aguardando jogadores'}`;
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
        if (wallet.buy(offer.id)) { audio.play('chest'); toast(`${offer.title} aprimorado`); renderShop(); }
      };
      card.append(title, pips, description, buy);
      return card;
    }));
  }

  selectCharacter(selected);
  renderShop();
  $('#offlineBtn').onclick = () => onOffline();
  $('#shopBtn').onclick = () => { renderShop(); $('#shopModal').classList.remove('hidden'); };
  $('#shopClose').onclick = () => $('#shopModal').classList.add('hidden');
  $('#createBtn').onclick = () => {
    $('#joinBox').classList.add('hidden');
    const box = $('#createBox');
    box.classList.toggle('hidden');
    if (!box.classList.contains('hidden')) requestAnimationFrame(() => box.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
  };
  $('#joinToggle').onclick = () => {
    $('#createBox').classList.add('hidden');
    const box = $('#joinBox');
    box.classList.toggle('hidden');
    if (!box.classList.contains('hidden')) {
      fetchOpenRooms();
      requestAnimationFrame(() => box.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
    }
  };
  document.querySelectorAll('[data-visibility]').forEach(button => {
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
  $('#serverUrl').value = serverUrl();
  $('#saveServer').onclick = () => { storage.set('arcana-server', $('#serverUrl').value.trim()); toast('Servidor salvo'); fetchOpenRooms(); };
  $('#playerNameInput').value = storage.get('arcana-player-name') || '';
  $('#playerNameInput').addEventListener('change', () => storage.set('arcana-player-name', playerName()));

  const refresh = () => { if (!document.hidden && isIdle()) fetchOpenRooms(); };
  refresh();
  setInterval(refresh, 10000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });

  return {
    get character() { return selected; },
    selectCharacter,
    fetchOpenRooms,
    renderShop
  };
}
