import test from 'node:test';
import assert from 'node:assert/strict';
import { AURORA } from './aurora.js';
import { createAchievements } from '../src/achievements.js';
import { createPlayer, createGameState, activateSpecial, updateGame, publicState } from './game.js';
import { DEVELOPER, selectPlayerCharacter } from './developer.js';
import { LIMITS } from './balance.js';
import { encodeState, decodeState } from './protocol.js';
import { createAnimator } from '../src/animation.js';

function memoryStorage() {
  const data = new Map();
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
}
const win = { over: true, victory: true, campaign: 'classic', phase: 5 };

test('aurora só desbloqueia na vitória final clássica e persiste entre sessões', () => {
  const storage = memoryStorage(); const achievements = createAchievements(storage);
  for (const result of [null, {}, { ...win, over: false }, { ...win, victory: false }, { ...win, phase: 4 },
    { ...win, campaign: 'quick' }, { ...win, campaign: 'endless' }]) {
    assert.equal(achievements.recordVictory(result), false);
    assert.equal(achievements.aurora, false);
  }
  assert.equal(achievements.recordVictory(win), true);
  assert.equal(achievements.recordVictory(win), false);
  assert.equal(createAchievements(storage).aurora, true);
  assert.equal(createAchievements(storage).recordVictory(win), false);
});

test('aurora mantém desbloqueio em memória quando armazenamento está indisponível', () => {
  const achievements = createAchievements({ getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } });
  assert.equal(achievements.aurora, false);
  assert.equal(achievements.recordVictory(win), true);
  assert.equal(achievements.aurora, true);
  assert.equal(achievements.recordVictory(win), false);
});

test('vitória clássica real desbloqueia aurora pelos estados offline e online', () => {
  const s = createGameState('classic');
  s.players.p = createPlayer('p', 'Vencedor');
  s.phase = 5; s.phaseStatus = 'boss'; s.spawn = 999;
  s.enemies = [{ id: 1, type: 'umbra', hp: 0, maxHp: 1000, x: 100, y: 0, boss: true, age: 0 }];
  updateGame(s, 0.016, () => 0.9);
  for (const result of [publicState(s), decodeState(encodeState(s, 'p'))]) {
    assert.equal(createAchievements(memoryStorage()).recordVictory(result), true);
  }
});

test('aurora supera os magos comuns e fica abaixo do desenvolvedor sem acumular bônus nas trocas', () => {
  const meta = { vigor: 2, might: 3, stride: 2, celerity: 2, ward: 1 };
  const base = createPlayer('p', 'Padrão', 0, meta);
  const p = createPlayer('p', 'Aurora', AURORA, meta);
  const dev = createPlayer('d', 'Dev', DEVELOPER, meta);
  for (const field of ['hp', 'maxHp', 'damage', 'speed', 'armor']) {
    assert.ok(p[field] > base[field] && p[field] < dev[field], field);
  }
  assert.ok(p.attackDelay < base.attackDelay && p.attackDelay > dev.attackDelay);
  assert.equal(p.projectiles, 1);
  for (let n = 0; n < 10; n++) for (const color of [DEVELOPER, 3, AURORA, 0]) {
    selectPlayerCharacter(p, color);
    const expected = createPlayer('p', '', color, meta);
    for (const field of ['hp', 'maxHp', 'damage', 'speed', 'armor', 'projectiles', 'attackDelay']) {
      assert.ok(Math.abs(p[field] - expected[field]) < 1e-8, field);
    }
  }
});

test('alvorada tem alcance e dano finitos; coroa respeita limite de projéteis e desbloqueio do especial alternativo', () => {
  const s = createGameState(); const p = createPlayer('p', 'Aurora', AURORA);
  p.x = 0; p.specialCharge = 100; s.players.p = p;
  s.enemies = [100, 400].map((x, id) => ({ id, x, y: 0, hp: 10000, maxHp: 10000, type: 'slime', age: 0 }));
  s.enemyShots = [{ x: 100, y: 0 }, { x: 400, y: 0 }];
  assert.equal(activateSpecial(s, 'p'), true);
  assert.equal(s.enemies[0].hp, 10000 - p.damage * 6);
  assert.equal(s.enemies[1].hp, 10000);
  assert.equal(s.enemyShots.length, 1); assert.equal(p.invulnerableFor, 1.5);
  assert.equal(createPlayer('a', '', AURORA, {}, { special: 1 }).specialVariant, 0);
  const alt = createPlayer('a', '', AURORA, { secondSpell: 1 }, { special: 1 });
  s.players.a = alt; alt.specialCharge = 100;
  s.shots = Array.from({ length: LIMITS.shots - 11 }, () => ({}));
  assert.equal(activateSpecial(s, 'a'), false); assert.equal(alt.specialCharge, 100);
  s.shots = [];
  assert.equal(activateSpecial(s, 'a'), true);
  assert.equal(s.shots.length, 12);
  assert.ok(s.shots.every(shot => shot.color === AURORA && shot.pierce === 2 && shot.damage === alt.damage * 3));
});

test('aurora não tem recarga automática e transmite cor e animação próprias', () => {
  const s = createGameState(); s.spawn = 999;
  s.players.p = createPlayer('p', 'Aurora', AURORA);
  updateGame(s, 0.1, () => 0.9);
  assert.equal(s.players.p.specialCharge, 0);
  const view = decodeState(encodeState(s, 'p'));
  assert.equal(view.players.p.color, AURORA); assert.equal(view.players.p.maxHp, 150);
  for (const variant of [0, 1]) {
    const animator = createAnimator(); animator.update(view, 0.016);
    const next = { ...view, events: [{ id: 1, kind: 'special', t: 0, x: 0, y: 0, color: AURORA, variant }] };
    animator.update(next, 0.016);
    assert.ok(animator.effects.some(fx => fx.kind === 'aurora' && fx.variant === variant));
  }
});
