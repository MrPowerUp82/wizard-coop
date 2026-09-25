import { BEHAVIORS, ENEMIES, PHASES } from '../server/phases.js';
import { POWERS } from '../server/powers.js';
import { KIND_LABELS, POWER_INFO, REACTIONS, requirementText } from './powerInfo.js';
import { BESTIARY, bestiaryKnown, renderBestiary } from './bestiary.js';

// The Códex remembers, in this browser, every power, combo, creature, guardian and encounter the player has met.
const KEY = 'arcana-codex';

const BEHAVIOR_TEXT = {
  walker: 'Avança em linha reta e morde quem alcança.',
  charger: `Para, brilha e investe em alta velocidade quando você está a menos de ${BEHAVIORS.charger.range}px.`,
  splitter: 'Ao morrer, divide-se em criaturas menores.',
  shooter: 'Mantém distância e dispara projéteis lentos.',
  bomber: 'Corre até você e explode depois de um pavio curto — afaste-se ao ver o brilho.',
  flier: 'Voa por cima da multidão e ignora empurrões.'
};

const ENCOUNTERS = {
  altar: ['◇', 'Altar opcional', 'Defenda o círculo por 15s enquanto ondas surgem: todos ganham um poder e moedas.'],
  merchant: ['⚖', 'Mercador errante', 'Fique 1,5s perto dele com 20 moedas da partida para trocar por um poder.'],
  shrine: ['☥', 'Santuário amaldiçoado', 'Aceite o pacto: poder e moedas para todos, mas os inimigos ferem 30% mais até o fim do reino.'],
  thief: ['✪', 'Ladrão de relíquias', 'Uma elite foge com um baú. Derrube-a em 20s para ganhar baú, ímã e moedas.']
};

export const CODEX_SECTIONS = {
  powers: {
    title: 'Poderes',
    entries: () => Object.entries(POWERS).map((/** @type {[string, any]} */ [id, power]) => {
      const [icon, name, text] = POWER_INFO[id] || ['?', id, ''];
      const detail = power.kind === 'evolution' ? `Requer ${requirementText(power.requires)}.`
        : power.kind === 'signature' ? `Exclusivo do personagem ${['Azul', 'Vermelho', 'Verde', 'Roxo'][power.color]} a partir do nível ${power.minLevel}.`
          : power.kind === 'coop' ? 'Aparece somente em partidas com aliados.' : `Até o grau ${power.max}.`;
      return { id, icon, name, text, detail, tag: KIND_LABELS[power.kind] || 'Passivo', hint: power.kind === 'evolution' ? `Requer ${requirementText(power.requires)}` : 'Escolha este poder numa partida' };
    })
  },
  reactions: {
    title: 'Combos',
    entries: () => Object.entries(REACTIONS).map(([id, [name, text]]) => ({ id, icon: '✷', name, text, detail: '', tag: 'Reação',
      hint: id === 'team' || id === 'convergence' ? 'Descubra jogando com aliados' : 'Combine elementos para descobrir' }))
  },
  enemies: {
    title: 'Criaturas',
    entries: () => Object.entries(ENEMIES).filter((/** @type {[string, any]} */ [, enemy]) => enemy.name).map((/** @type {[string, any]} */ [id, enemy]) => {
      const realm = PHASES.find(phase => phase.enemies.includes(id) || phase.specials?.some(special => special.type === id));
      return { id, icon: '☗', name: enemy.name, text: BEHAVIOR_TEXT[enemy.behavior || 'walker'],
        detail: `Vida ${enemy.hp} · velocidade ${enemy.speed} · dano ${enemy.damage}${realm ? ` · ${realm.name}` : ''}`,
        tag: realm?.name || 'Criatura', hint: 'Encontre esta criatura para registrá-la' };
    })
  },
  bosses: {
    title: 'Guardiões',
    entries: () => PHASES.map((phase, index) => ({ id: phase.boss, icon: '♜', name: phase.bossName, tag: `Reino ${index + 1}`,
      text: `Guardião de ${phase.name}. Entra em fúria com 66% e 33% da vida, invocando servos e acelerando os ataques.`,
      detail: 'Desvie dos projéteis vermelhos e saia dos círculos antes que se fechem.', hint: 'Derrote este guardião para registrá-lo' }))
  },
  encounters: {
    title: 'Encontros',
    entries: () => Object.entries(ENCOUNTERS).map(([id, [icon, name, text]]) => ({ id, icon, name, text, detail: '', tag: 'Evento', hint: 'Surge no meio de um reino' }))
  }
};

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    return Object.fromEntries(Object.keys(CODEX_SECTIONS).map(section => [section, Array.isArray(saved[section]) ? saved[section] : []]));
  } catch {
    return Object.fromEntries(Object.keys(CODEX_SECTIONS).map(section => [section, []]));
  }
}

/** @param {{ onDiscover?: (section: string, entry: any) => void }} [options] */
export function createCodex({ onDiscover } = {}) {
  let data = load();
  const known = Object.fromEntries(Object.entries(data).map(([section, ids]) => [section, new Set(ids)]));
  let lastEnemyScan = 0;
  let dirty = false;

  function discover(section, id) {
    if (!id || known[section]?.has(id) || !CODEX_SECTIONS[section].entries().some(entry => entry.id === id)) return false;
    known[section].add(id);
    data[section].push(id);
    dirty = true;
    onDiscover?.(section, CODEX_SECTIONS[section].entries().find(entry => entry.id === id));
    return true;
  }

  function flush() {
    if (!dirty) return;
    dirty = false;
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* the Códex is a convenience */ }
  }

  return {
    discover,
    has: (section, id) => known[section]?.has(id) || false,
    /** Called every frame with the drawn state; scans creatures a few times per second only. */
    observe(view, me, now) {
      for (const [id, rank] of Object.entries(me?.powers || {})) if (rank > 0) discover('powers', id);
      if (view.altar) discover('encounters', 'altar');
      if (view.encounter) discover('encounters', view.encounter.kind);
      if (now - lastEnemyScan > 400) {
        lastEnemyScan = now;
        for (const enemy of view.enemies || []) if (!enemy.boss) discover('enemies', enemy.type);
        flush();
      }
    },
    observeEvent(event, phase) {
      if (event.kind === 'combo') {
        discover('reactions', event.reaction);
        if (event.team) discover('reactions', 'team');
      } else if (event.kind === 'convergence') discover('reactions', 'convergence');
      else if (event.kind === 'bossDown') discover('bosses', PHASES[phase]?.boss);
      flush();
    },
    progress() {
      const total = Object.values(CODEX_SECTIONS).reduce((sum, section) => sum + section.entries().length, 0);
      const found = Object.entries(CODEX_SECTIONS).reduce((sum, [id, section]) => sum + section.entries().filter(entry => known[id].has(entry.id)).length, 0);
      return { found, total };
    },
    reset() { data = load(); for (const [section, ids] of Object.entries(data)) known[section] = new Set(ids); }
  };
}

/** Fills the Códex modal: section tabs plus one card per entry; unknown entries only show a hint. */
/** @param {(tab: string) => void} [onTab] */
export function renderCodex(codex, { tabs, list, progress }, active = 'powers', onTab = () => {},
  heroAvailable = /** @type {(color: number) => boolean} */ (color => color < 4)) {
  const bestiaryFound = entry => bestiaryKnown(entry, codex, heroAvailable);
  const { found, total } = codex.progress();
  progress.textContent = `${found}/${total} registros descobertos`;
  tabs.replaceChildren(...Object.entries({ ...CODEX_SECTIONS, bestiary: { title: 'Bestiário', entries: () => BESTIARY } }).map(([id, section]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `codex-tab${id === active ? ' selected' : ''}`;
    button.setAttribute('aria-pressed', String(id === active));
    const entries = section.entries();
    const found = entries.filter(entry => id === 'bestiary' ? bestiaryFound(entry) : codex.has(id, entry.id)).length;
    button.textContent = `${section.title} ${found}/${entries.length}`;
    button.onclick = () => onTab(id);
    return button;
  }));
  if (active === 'bestiary') return renderBestiary(list, progress, bestiaryFound);
  list.classList.remove('bestiary-list');
  list.replaceChildren(...CODEX_SECTIONS[active].entries().map(entry => {
    const unlocked = codex.has(active, entry.id);
    const card = document.createElement('article');
    card.className = `codex-entry${unlocked ? '' : ' locked'}`;
    const icon = document.createElement('i'); icon.textContent = unlocked ? entry.icon : '?';
    const title = document.createElement('b'); title.textContent = unlocked ? entry.name : '???';
    const tag = document.createElement('em'); tag.textContent = entry.tag;
    const text = document.createElement('p'); text.textContent = unlocked ? entry.text : entry.hint;
    card.append(icon, title, tag, text);
    if (unlocked && entry.detail) { const detail = document.createElement('small'); detail.textContent = entry.detail; card.append(detail); }
    return card;
  }));
}
