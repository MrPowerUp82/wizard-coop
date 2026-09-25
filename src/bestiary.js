import { ENEMIES, PHASES } from '../server/phases.js';
import { drawAnimatedSprite, ENEMY_SPRITES, PLAYER_SPRITES, view, worldTransform } from './sprites.js';

const PLAYER_NAMES = ['Azul', 'Vermelho', 'Verde', 'Roxo', 'O Desenvolvedor', 'Guardião da Aurora', 'The God'];
const HERO_HINTS = ['', '', '', '', 'Um segredo guardado por quem criou o jogo', 'Vença os seis reinos no modo Clássico', 'Compre por 60000 moedas no Grimório'];
const ACTIONS = ['Parado', 'Movimento', 'Ataque', 'Interação', 'Dano'];
// Realm names are feminine when their first word ends in "a" (Cripta, Cidadela): "na Cripta", "no Bosque".
const feminine = realm => /^\S*a\s/.test(realm);

// `section` names the Códex section that records the entry; heroes are checked against unlocks instead.
export const BESTIARY = [
  ...PLAYER_SPRITES.map((sprite, index) => ({ id: sprite, sprite, name: PLAYER_NAMES[index], group: 'Heróis', section: 'heroes',
    hero: index, detail: 'Personagem jogável', hint: HERO_HINTS[index] })),
  ...Object.entries(ENEMIES).filter((/** @type {[string, any]} */ [, enemy]) => enemy.name).map((/** @type {[string, any]} */ [id, enemy]) => {
    const phase = PHASES.find(realm => realm.enemies.includes(id) || realm.specials?.some(special => special.type === id));
    return { id, sprite: ENEMY_SPRITES[id] || enemy.sprite || id, name: enemy.name, group: 'Criaturas', section: 'enemies',
      detail: phase?.name || 'Criatura invocada', hint: phase ? `Encontre ${feminine(phase.name) ? 'na' : 'no'} ${phase.name}` : 'Encontre numa partida' };
  }),
  ...PHASES.map(phase => ({ id: phase.boss, sprite: phase.boss, name: phase.bossName, group: 'Guardiões', section: 'bosses',
    detail: phase.name, hint: `Derrote o guardião ${feminine(phase.name) ? 'da' : 'do'} ${phase.name}` }))
];

/** @param {{ has: (section: string, id: string) => boolean }} codex @param {(color: number) => boolean} heroAvailable */
export const bestiaryKnown = (entry, codex, heroAvailable) =>
  entry.section === 'heroes' ? heroAvailable(entry.hero) : codex.has(entry.section, entry.id);

/**
 * Shows every game character with the same sprite renderer used in a match; entries not met yet
 * animate as dark silhouettes with a hint. Returns a cleanup function.
 * @param {(entry: any) => boolean} isKnown
 */
export function renderBestiary(list, progress, isKnown) {
  const found = BESTIARY.filter(isKnown).length;
  progress.textContent = `${found}/${BESTIARY.length} personagens e criaturas · escolha uma ação para ver as animações`;
  const toolbar = document.createElement('div');
  toolbar.className = 'bestiary-toolbar';
  const label = document.createElement('label');
  label.textContent = 'Animação ';
  const action = document.createElement('select');
  action.setAttribute('aria-label', 'Animação dos personagens');
  ACTIONS.forEach((name, row) => action.add(new Option(name, String(row))));
  label.append(action);
  const mirror = document.createElement('button');
  mirror.type = 'button';
  mirror.textContent = 'Espelhar: não';
  mirror.setAttribute('aria-pressed', 'false');
  mirror.onclick = () => {
    const pressed = mirror.getAttribute('aria-pressed') !== 'true';
    mirror.setAttribute('aria-pressed', String(pressed));
    mirror.textContent = `Espelhar: ${pressed ? 'sim' : 'não'}`;
  };
  toolbar.append(label, mirror);

  const gallery = document.createElement('div');
  gallery.className = 'bestiary-gallery';
  const previews = [];
  for (const group of ['Heróis', 'Criaturas', 'Guardiões']) {
    const entries = BESTIARY.filter(entry => entry.group === group);
    const heading = document.createElement('h3');
    heading.textContent = `${group} · ${entries.filter(isKnown).length}/${entries.length}`;
    gallery.append(heading);
    for (const entry of entries) {
      const known = isKnown(entry);
      const card = document.createElement('article');
      card.className = `bestiary-entry${known ? '' : ' locked'}`;
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 128;
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', known ? `Animação de ${entry.name}` : 'Silhueta de personagem não descoberto');
      const name = document.createElement('b');
      name.textContent = known ? entry.name : '???';
      const detail = document.createElement('small');
      detail.textContent = known ? entry.detail : entry.hint || '???';
      card.append(canvas, name, detail);
      gallery.append(card);
      previews.push({ canvas, sprite: entry.sprite, known });
    }
  }
  list.replaceChildren(toolbar, gallery);
  list.classList.add('bestiary-list');

  let raf = 0;
  let lastFrame = -1;
  const pose = { rotation: 0, sx: 1, sy: 1, animationRow: 0, animationFrame: 0 };
  const draw = now => {
    raf = requestAnimationFrame(draw);
    const frame = Math.floor(now / 170) % 4;
    const row = Number(action.value);
    const flipped = mirror.getAttribute('aria-pressed') === 'true';
    const key = frame + row * 4 + (flipped ? 20 : 0);
    if (key === lastFrame) return;
    lastFrame = key;
    pose.animationRow = row;
    pose.animationFrame = frame;
    pose.sx = flipped ? -1 : 1;
    const original = { ...view };
    Object.assign(view, { dpr: 1, zoom: 1, ox: 0, oy: 0, camX: 0, camY: 0, shakeX: 0, shakeY: 0 });
    for (const { canvas, sprite, known } of previews) {
      const ctx = canvas.getContext('2d');
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, 128, 128);
      worldTransform(ctx);
      drawAnimatedSprite(ctx, sprite, 64, 64, 88, pose);
      if (!known) {
        // Keep only the sprite's shape: paint over its opaque pixels in the card's shadow color.
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalCompositeOperation = 'source-in';
        ctx.fillStyle = '#04090c';
        ctx.fillRect(0, 0, 128, 128);
        ctx.globalCompositeOperation = 'source-over';
      }
    }
    Object.assign(view, original);
  };
  raf = requestAnimationFrame(draw);
  return () => { cancelAnimationFrame(raf); list.classList.remove('bestiary-list'); };
}
