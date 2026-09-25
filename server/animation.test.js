import test from 'node:test';
import assert from 'node:assert/strict';
import { createAnimator, MAX_EFFECTS } from '../src/animation.js';
import { createGameState, createPlayer, updateGame, publicState } from './game.js';

function fixture() {
  const game = createGameState();
  game.players.p = createPlayer('p', 'Mago');
  game.spawn = 999;
  return game;
}

test('player vira com o movimento horizontal e mantém o lado parado ou andando na vertical', () => {
  for (const reduced of [false, true]) {
    const game = fixture();
    const animator = createAnimator();
    const sample = () => animator.update(JSON.parse(JSON.stringify(publicState(game))), 0.033, { reduced });
    sample();
    assert.ok(animator.pose('p:p').sx > 0);
    game.players.p.x -= 8;
    sample();
    assert.ok(animator.pose('p:p').sx < 0);
    sample(); // Unchanged snapshot between network updates.
    game.players.p.y += 8;
    sample();
    assert.ok(animator.pose('p:p').sx < 0);
    game.players.p.castCount++;
    game.players.p.castAngle = 0; // Auto-aim must not override movement facing.
    sample();
    assert.ok(animator.pose('p:p').sx < 0);
    game.players.p.x += 16;
    sample();
    assert.ok(animator.pose('p:p').sx > 0);
    game.players.p.alive = false;
    game.players.p.x -= 8;
    sample();
    assert.ok(animator.pose('p:p').sx > 0);
    animator.reset();
    game.players.p.alive = true;
    sample();
    assert.ok(animator.pose('p:p').sx > 0);
  }
});

test('inimigos espelham conforme aproximação e miram o jogador ao atacar', () => {
  const game = fixture(); const animator = createAnimator();
  const enemy = { id: 11, type: 'mushroom', x: 60, y: 0, hp: 20, maxHp: 20, windup: 0 };
  game.enemies.push(enemy);
  animator.update(game, 0.05);
  assert.ok(animator.pose('e:11').sx < 0); // Nasce à direita do jogador.
  enemy.x = 50;
  animator.update(game, 0.05);
  assert.ok(animator.pose('e:11').sx < 0);
  enemy.y += 8;
  animator.update(game, 0.05);
  assert.ok(animator.pose('e:11').sx < 0); // Movimento vertical conserva a direção.
  enemy.x = -10;
  animator.update(game, 0.05);
  assert.ok(animator.pose('e:11').sx < 0);
  enemy.x = -20; enemy.windup = 0.5;
  animator.update(game, 0.05);
  assert.ok(animator.pose('e:11').sx > 0); // O ataque se volta para o alvo à direita.
});

test('animação observa snapshots sem alterar simulação, colisões ou protocolo', () => {
  const game = fixture();
  const animator = createAnimator();
  animator.update(game, 0.016);
  game.players.p.x = 4; game.players.p.hp = 80;
  game.players.p.castCount++;
  const snapshot = JSON.stringify(game);
  animator.update(game, 0.016);
  assert.equal(JSON.stringify(game), snapshot);
  assert.ok(animator.pose('p:p').flash > 0);
  assert.ok(animator.effects.length > 0);
  assert.notEqual(animator.pose('p:p').rotation, 0);
  assert.equal(game.players.p.x, 4);
});

test('spritesheet acompanha movimento, ataque, interação e dano', () => {
  const game = fixture(); const animator = createAnimator();
  animator.update(game, 0.05);
  assert.equal(animator.pose('p:p').animationRow, 0);
  game.players.p.x += 8;
  animator.update(game, 0.05);
  assert.equal(animator.pose('p:p').animationRow, 1);
  game.players.p.castCount++;
  animator.update(game, 0.05);
  assert.equal(animator.pose('p:p').animationRow, 2);
  for (let i = 0; i < 8; i++) animator.update(game, 0.05);
  game.players.p.shopProgress = 1;
  animator.update(game, 0.05);
  assert.equal(animator.pose('p:p').animationRow, 3);
  game.players.p.hp -= 5;
  animator.update(game, 0.05);
  assert.equal(animator.pose('p:p').animationRow, 4);
});

test('pausa congela efeitos; movimento reduzido mantém legibilidade sem partículas', () => {
  const game = fixture(); const animator = createAnimator();
  animator.update(game, 0.016);
  game.players.p.hp = 75;
  animator.update(game, 0.016);
  const effects = JSON.stringify(animator.effects);
  const pose = animator.pose('p:p'); const time = animator.time;
  animator.update(game, 1, { paused: true });
  assert.equal(animator.time, time);
  assert.equal(JSON.stringify(animator.effects), effects);
  assert.deepEqual(animator.pose('p:p'), pose);
  game.players.p.alive = false;
  animator.update(game, 0.016, { reduced: true });
  assert.equal(animator.effects.length, 0);
  assert.deepEqual(animator.pose('p:p'), { x: 0, y: 0, rotation: 0, sx: 1, sy: 1, alpha: 0.28, flash: 0,
    animationRow: 4, animationFrame: 0 });
});

test('morte, ressurreição e especial produzem efeitos e removem estados antigos', () => {
  const game = fixture(); const animator = createAnimator();
  animator.update(game, 0.016);
  game.players.p.alive = false; game.players.p.hp = 0;
  animator.update(game, 0.016);
  assert.ok(animator.pose('p:p').alpha < 1);
  for (let n = 0; n < 40; n++) animator.update(game, 0.05);
  assert.equal(animator.effects.length, 0);
  game.players.p.alive = true; game.players.p.hp = 40;
  animator.update(game, 0.016);
  assert.ok(animator.effects.some(fx => fx.radius === 65));
  game.players.p.specialCharge = 100;
  animator.update(game, 0.016);
  game.players.p.specialCharge = 0;
  animator.update(game, 0.016);
  assert.ok(animator.effects.some(fx => fx.radius === 95));
  game.players = {};
  animator.update(game, 0.016);
  assert.equal(animator.actorCount, 0);
  animator.reset();
  assert.equal(animator.effects.length, 0);
  assert.equal(animator.time, 0);
});

test('hordas e impactos simultâneos respeitam orçamento visual e limpeza', () => {
  const game = fixture(); const animator = createAnimator();
  game.enemies = Array.from({ length: 180 }, (_, i) => ({ id: String(i), type: 'mushroom', x: i, y: 0, hp: 20 }));
  animator.update(game, 0.016);
  for (const enemy of game.enemies) enemy.hp = 1;
  animator.update(game, 0.016);
  assert.equal(animator.effects.length, MAX_EFFECTS);
  game.enemies = [];
  animator.update(game, 0.016);
  assert.ok(animator.effects.length <= MAX_EFFECTS);
  assert.equal(animator.actorCount, 1);
  for (let n = 0; n < 30; n++) animator.update(game, 0.05);
  assert.equal(animator.effects.length, 0);
});

test('conjuração chega ao cliente uma vez por ataque, sem eventos repetidos entre snapshots', () => {
  const game = fixture(); const animator = createAnimator();
  const player = game.players.p;
  game.enemies = [{ id: 'e', type: 'mushroom', x: 250, y: 100, hp: 1000, maxHp: 1000, age: 0 }];
  animator.update(publicState(game), 0.016);
  updateGame(game, 0.016);
  const snapshot = JSON.parse(JSON.stringify(publicState(game)));
  assert.equal(snapshot.players.p.castCount, 1);
  assert.ok(snapshot.players.p.castAngle > 0);
  animator.update(snapshot, 0.016);
  const count = animator.effects.length;
  animator.update(snapshot, 0.016);
  assert.equal(animator.effects.length, count);
  assert.equal(player.castCount, 1);
});

test('especiais de cada personagem geram efeitos próprios que somem sozinhos', () => {
  for (let color = 0; color < 4; color++) {
    const game = fixture();
    const animator = createAnimator();
    animator.update(game, 0.016);
    game.events = [{ id: 1, kind: 'special', t: 0, x: 0, y: 0, color, tx: 100, ty: 50, delay: 0.6, fx: -170, fy: 0 }];
    animator.update(game, 0.016);
    const kinds = new Set(animator.effects.map(fx => fx.kind));
    assert.ok(kinds.has(['nova', 'meteor', 'thorns', 'lunar'][color]), `cor ${color}`);
    assert.ok(animator.effects.some(fx => fx.kind === 'mote'));
    const meteor = animator.effects.find(fx => fx.kind === 'meteor');
    if (meteor) assert.deepEqual([meteor.x, meteor.y], [100, 50], 'meteoro cai sobre o alvo, não sobre o mago');
    for (let n = 0; n < 40; n++) animator.update(game, 0.05);
    assert.equal(animator.effects.length, 0);
    assert.equal(animator.flash, null);
  }
});

test('especiais do desenvolvedor têm visuais distintos, não se repetem e respeitam movimento reduzido', () => {
  for (const variant of [0, 1]) for (const reduced of [false, true]) {
    const game = fixture(); const animator = createAnimator();
    animator.update(game, 0.016, { reduced });
    game.events = [{ id: 1, kind: 'special', t: 0, x: 0, y: 0, color: 4, variant }];
    animator.update(game, 0.016, { reduced });
    if (reduced) {
      assert.equal(animator.effects.length, 0);
      assert.equal(animator.flash, null);
    } else {
      assert.ok(animator.effects.some(fx => fx.kind === (variant ? 'systemReset' : 'ring')));
      assert.ok(!animator.effects.some(fx => fx.kind === (variant ? 'ring' : 'systemReset')));
      const count = animator.effects.length;
      animator.update(game, 0.016);
      assert.equal(animator.effects.length, count);
      for (let n = 0; n < 40; n++) animator.update(game, 0.05);
      assert.equal(animator.effects.length, 0);
      assert.equal(animator.flash, null);
    }
  }
});

test('movimento reduzido não gera efeitos de especial nem clarão', () => {
  const game = fixture(); const animator = createAnimator();
  animator.update(game, 0.016, { reduced: true });
  game.events = [{ id: 1, kind: 'special', t: 0, x: 0, y: 0, color: 0 }, { id: 2, kind: 'familiar', t: 0, x: 0, y: 0, points: [10, 10], color: 0 }];
  animator.update(game, 0.016, { reduced: true });
  assert.equal(animator.effects.length, 0);
  assert.equal(animator.flash, null);
});

test('rastro de esquiva respeita pausa, snapshots repetidos, teleporte e limpeza', () => {
  const game = fixture(); const animator = createAnimator(); const player = game.players.p;
  animator.update(game, 0.033);
  player.dashFor = 0.15; player.x += 48;
  const snapshot = JSON.stringify(game);
  animator.update(game, 0.033);
  assert.equal(JSON.stringify(game), snapshot);
  const stamps = animator.effects.filter(fx => fx.kind === 'afterimage');
  assert.ok(stamps.length > 0 && stamps.length <= 4);
  const effects = JSON.stringify(animator.effects);
  animator.update(game, 1, { paused: true });
  assert.equal(JSON.stringify(animator.effects), effects);
  animator.update(game, 0.033);
  assert.equal(animator.effects.filter(fx => fx.kind === 'afterimage').length, stamps.length);
  player.x += 900;
  animator.update(game, 0.033);
  assert.equal(animator.effects.filter(fx => fx.kind === 'afterimage').length, stamps.length);
  player.dashFor = 0;
  for (let i = 0; i < 10; i++) animator.update(game, 0.05);
  assert.equal(animator.effects.length, 0);
});

test('subida de nível e conjuração não repetem efeitos em snapshots e respeitam orçamento', () => {
  const game = fixture(); const animator = createAnimator();
  animator.update(game, 0.033);
  game.players.p.level++; game.players.p.castCount++;
  animator.update(game, 0.033);
  assert.ok(animator.effects.some(fx => fx.kind === 'ascend'));
  assert.ok(animator.effects.some(fx => fx.kind === 'sigil'));
  const count = animator.effects.length;
  animator.update(game, 0.033);
  assert.equal(animator.effects.length, count);
  for (let i = 0; i < 80; i++) {
    game.players.p.level++; game.players.p.castCount++;
    animator.update(game, 0.001);
    assert.ok(animator.effects.length <= MAX_EFFECTS);
  }
  for (let i = 0; i < 30; i++) animator.update(game, 0.05);
  assert.equal(animator.effects.length, 0);
});

test('movimento reduzido remove rastros e impede tremor e pausa visual de eventos fortes', () => {
  const game = fixture(); const animator = createAnimator(); const player = game.players.p;
  animator.update(game, 0.033);
  player.dashFor = 0.2; player.x += 30;
  animator.update(game, 0.033);
  assert.ok(animator.effects.some(fx => fx.kind === 'afterimage'));
  player.x += 30; player.level++; player.castCount++;
  game.events = [{ id: 1, kind: 'boom', x: 0, y: 0 }, { id: 2, kind: 'bossDown' }];
  animator.update(game, 0.033, { reduced: true });
  assert.equal(animator.effects.length, 0);
  assert.deepEqual(animator.shakeOffset, { x: 0, y: 0 });
  const time = animator.time;
  animator.update(game, 0.033, { reduced: true });
  assert.ok(animator.time > time);
  assert.equal(animator.flash, null);
});
