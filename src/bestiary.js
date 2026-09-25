import { ENEMIES, PHASES } from '../server/phases.js';
import { drawAnimatedSprite, ENEMY_SPRITES, PLAYER_SPRITES, view, worldTransform } from './sprites.js';

const PLAYER_NAMES = ['Azul', 'Vermelho', 'Verde', 'Roxo', 'O Desenvolvedor', 'Guardião da Aurora', 'The God'];
const ACTIONS = ['Parado', 'Movimento', 'Ataque', 'Interação', 'Dano'];

export const BESTIARY = [
  ...PLAYER_SPRITES.map((sprite, index) => ({ id: sprite, sprite, name: PLAYER_NAMES[index], group: 'Heróis', detail: 'Personagem jogável' })),
  ...Object.entries(ENEMIES).filter((/** @type {[string, any]} */ [, enemy]) => enemy.name).map((/** @type {[string, any]} */ [id, enemy]) => {
    const phase = PHASES.find(realm => realm.enemies.includes(id) || realm.specials?.some(special => special.type === id));
    return { id, sprite: ENEMY_SPRITES[id] || enemy.sprite || id, name: enemy.name, group: 'Criaturas', detail: phase?.name || 'Criatura invocada' };
  }),
  ...PHASES.map(phase => ({ id: phase.boss, sprite: phase.boss, name: phase.bossName, group: 'Guardiões', detail: phase.name }))
];

/** Show every game character with the same sprite renderer used in a match. Returns a cleanup function. */
export function renderBestiary(list, progress) {
  progress.textContent = `${BESTIARY.length} personagens e criaturas · escolha uma ação para ver as animações`;
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
    const heading = document.createElement('h3');
    heading.textContent = `${group} · ${BESTIARY.filter(entry => entry.group === group).length}`;
    gallery.append(heading);
    for (const entry of BESTIARY.filter(item => item.group === group)) {
      const card = document.createElement('article');
      card.className = 'bestiary-entry';
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 128;
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', `Animação de ${entry.name}`);
      const name = document.createElement('b');
      name.textContent = entry.name;
      const detail = document.createElement('small');
      detail.textContent = entry.detail;
      card.append(canvas, name, detail);
      gallery.append(card);
      previews.push({ canvas, sprite: entry.sprite });
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
    for (const { canvas, sprite } of previews) {
      const ctx = canvas.getContext('2d');
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, 128, 128);
      worldTransform(ctx);
      drawAnimatedSprite(ctx, sprite, 64, 64, 88, pose);
    }
    Object.assign(view, original);
  };
  raf = requestAnimationFrame(draw);
  return () => { cancelAnimationFrame(raf); list.classList.remove('bestiary-list'); };
}
