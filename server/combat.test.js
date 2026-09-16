import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameState, createPlayer, updateGame, activateSpecial, publicState, REVIVE, SPECIAL, SPELLS, LIMITS, DROP_TTL } from './game.js';

function fixture(color = 0) {
  const s = createGameState();
  const p = createPlayer('p', 'Mago', color);
  p.x = 0; p.attackCooldown = 999;
  s.players.p = p; s.spawn = 999;
  return { s, p };
}
function enemy(id, x = 200, y = 0, hp = 100) {
  return { id, x, y, hp, maxHp: hp, type: 'slime', age: 0 };
}
function tick(s, seconds) {
  for (let n = 0; n < Math.round(seconds * 30); n++) updateGame(s, 1 / 30, () => 0.9);
}

test('ressurreição permite movimento dentro do círculo e reinicia ao sair', () => {
  const { s, p } = fixture();
  const fallen = createPlayer('fallen', 'Aliado', 1);
  fallen.alive = false; fallen.hp = 0; fallen.x = 0;
  fallen.coins = 7; fallen.specialCharge = 50;
  s.players.fallen = fallen;
  tick(s, 2);
  assert.equal(fallen.alive, false);
  assert.ok(fallen.reviveProgress > 1.9);
  assert.equal(p.reviving, fallen.id);
  p.input.x = 1;
  tick(s, 0.1);
  assert.ok(p.x > 0 && p.x < REVIVE.radius);
  assert.ok(fallen.reviveProgress > 2);
  p.input.x = 0; p.x = 200;
  tick(s, 1);
  assert.equal(fallen.reviveProgress, 0);
  p.x = 0;
  tick(s, REVIVE.seconds + 0.1);
  assert.equal(fallen.alive, true);
  assert.equal(fallen.hp, fallen.maxHp * REVIVE.health);
  assert.ok(fallen.invulnerableFor > 2.8);
  assert.equal(fallen.coins, 7);
  assert.equal(fallen.specialCharge, 50);
  assert.equal(fallen.reviveProgress, 0);
});

test('troca de aliado reinicia ressurreição; escolha de poder e morte impedem ajuda', () => {
  const { s, p } = fixture();
  const fallen = createPlayer('fallen', 'Caído');
  fallen.alive = false; fallen.hp = 0;
  s.players.fallen = fallen;
  tick(s, 2);
  const helper = createPlayer('helper', 'Outro');
  s.players.helper = helper;
  p.x = 200;
  tick(s, 0.1);
  assert.ok(fallen.reviveProgress < 0.2);
  assert.equal(fallen.reviveBy, 'helper');
  helper.pendingPowers = ['arcane'];
  tick(s, 0.1);
  assert.equal(fallen.reviveProgress, 0);
  helper.alive = false; p.alive = false;
  tick(s, 5);
  assert.equal(s.over, true);
  assert.equal(fallen.alive, false);
});

test('quatro cores usam seus projéteis; fogo atinge área, espinho e lâmina atravessam sem repetir dano', () => {
  for (let color = 0; color < 4; color++) {
    const { s, p } = fixture(color);
    p.attackCooldown = 0;
    s.enemies = [enemy('a'), enemy('b', 240)];
    updateGame(s, 0.01, () => 0.9);
    assert.equal(s.shots[0].color, color);
    assert.equal(s.shots[0].pierce, SPELLS[color].pierce);
    const shot = s.shots[0];
    shot.x = 200; shot.y = 0; shot.vx = 0; shot.vy = 0;
    updateGame(s, 0.001, () => 0.9);
    assert.equal(s.enemies[0].hp, 100 - p.damage);
    if (color === 0) assert.ok(s.enemies[0].slowFor > 0);
    if (color === 1) assert.equal(s.enemies[1].hp, 100 - p.damage * 0.6);
    if (color === 2) {
      updateGame(s, 0.001, () => 0.9);
      assert.equal(s.enemies[0].hp, 100 - p.damage);
      shot.x = 240;
      updateGame(s, 0.001, () => 0.9);
      assert.equal(s.enemies[1].hp, 100 - p.damage);
    }
    if (color === 3) assert.equal(s.enemies[1].hp, 100 - p.damage);
  }
});

test('drops dão XP, cura limitada, carga limitada e moedas uma única vez', () => {
  const { s, p } = fixture();
  p.hp = 90; p.specialCharge = 90;
  s.gems = [
    { type: 'gem', value: 2 }, { type: 'heart', value: 25 },
    { type: 'greenGem', value: 25 }, { type: 'coin', value: 1 }
  ].map(drop => ({ ...drop, x: 0, y: 0, ttl: DROP_TTL }));
  updateGame(s, 0.01);
  assert.equal(p.hp, 100); assert.equal(p.specialCharge, 100);
  assert.equal(p.coins, 0); assert.equal(p.coinFrac, 0.4); assert.equal(p.xp, 1);
  assert.equal(s.gems.length, 0);
  updateGame(s, 0.01);
  assert.equal(p.coins, 0); assert.equal(p.coinFrac, 0.4); assert.equal(p.xp, 1);
});

test('coração e cristal ficam para quem precisa; derrotados não coletam', () => {
  const { s, p } = fixture();
  p.specialCharge = 100;
  const ally = createPlayer('ally', 'Aliado');
  ally.x = 10; ally.hp = 50; s.players.ally = ally;
  s.gems = ['heart', 'greenGem'].map(type => ({ type, value: 25, x: 0, y: 0, ttl: DROP_TTL }));
  updateGame(s, 0.01);
  assert.equal(ally.hp, 75); assert.equal(ally.specialCharge, 25);
  ally.alive = false; ally.hp = 0;
  s.gems = ['heart', 'greenGem'].map(type => ({ type, value: 25, x: 0, y: 0, ttl: DROP_TTL }));
  updateGame(s, 0.01);
  assert.equal(s.gems.length, 2); assert.equal(ally.hp, 0);
});

test('mortes geram todos os drops e respeitam limite mesmo antes da limpeza', () => {
  for (const [roll, type] of [[0, 'heart'], [0.0499, 'heart'], [0.05, 'greenGem'], [0.2499, 'greenGem'], [0.25, 'coin'], [0.2799, 'coin'], [0.28, null], [0.9, null]]) {
    const { s } = fixture();
    s.enemies = [enemy('a', 200, 0, 1)];
    s.shots = [{ x: 200, y: 0, vx: 0, vy: 0, ttl: 1, damage: 10, color: 0 }];
    updateGame(s, 0.01, () => roll);
    assert.deepEqual(s.gems.map(g => g.type), type ? ['gem', type] : ['gem']);
  }
  const { s } = fixture();
  s.cleanup = 10;
  s.gems = Array.from({ length: LIMITS.drops }, () => ({ x: 400, y: 0, ttl: DROP_TTL, value: 1 }));
  s.enemies = [enemy('a', 200, 0, 1)];
  s.shots = [{ x: 200, y: 0, vx: 0, vy: 0, ttl: 1, damage: 10 }];
  updateGame(s, 0.01, () => 0.05);
  assert.equal(s.gems.length, LIMITS.drops);
});

test('especiais exigem carga e jogador ativo; respeitam capacidade e consomem só uma vez', () => {
  for (let color = 0; color < 4; color++) {
    const { s, p } = fixture(color);
    assert.equal(activateSpecial(s, 'p'), false);
    p.specialCharge = SPECIAL.max;
    p.pendingPowers = ['arcane'];
    assert.equal(activateSpecial(s, 'p'), false);
    p.pendingPowers = null; p.alive = false;
    assert.equal(activateSpecial(s, 'p'), false);
    p.alive = true; s.phaseStatus = 'transition';
    assert.equal(activateSpecial(s, 'p'), false);
    s.phaseStatus = 'horde'; s.over = true;
    assert.equal(activateSpecial(s, 'p'), false);
    s.over = false;
    if (color === 3) {
      s.shots = Array.from({ length: LIMITS.shots }, () => ({}));
      assert.equal(activateSpecial(s, 'p'), false);
      assert.equal(p.specialCharge, SPECIAL.max);
    } else if (color > 0) {
      s.zones = Array.from({ length: LIMITS.zones }, () => ({}));
      assert.equal(activateSpecial(s, 'p'), false);
      assert.equal(p.specialCharge, SPECIAL.max);
      s.zones = [];
    }
    s.shots = [];
    assert.equal(activateSpecial(s, 'p'), true);
    assert.equal(p.specialCharge, 0);
    assert.equal(s.shots.length, color === 3 ? 8 : 0);
    assert.ok(s.shots.every(shot => shot.color === color && shot.special && shot.damage === p.damage * 3));
    assert.equal(activateSpecial(s, 'p'), false);
    assert.equal(activateSpecial(s, 'missing'), false);
    const snapshot = JSON.parse(JSON.stringify(publicState(s)));
    assert.equal(snapshot.players.p.specialCharge, 0);
    if (color === 3) { assert.equal(snapshot.shots[0].color, color); assert.equal(snapshot.shots[0].hitIds, undefined); }
  }
});

test('chefes disparam à distância com limite e projéteis ferem somente jogadores', () => {
  for (const type of ['treant', 'lich', 'demon']) {
    const { s, p } = fixture();
    s.phaseStatus = 'boss';
    s.enemies = [{ ...enemy('boss', 400), type, boss: true, attackCooldown: 999, rangedCooldown: 0 }];
    updateGame(s, 0.01);
    assert.equal(s.enemyShots.length, type === 'demon' ? 5 : 3);
    assert.equal(p.hp, 100);
    assert.ok(s.enemyShots.every(shot => shot.vx < 0));
    s.enemies[0].rangedCooldown = 999;
    s.enemyShots = [{ ...s.enemyShots[0], x: 0, y: 0, vx: 0, vy: 0 }];
    updateGame(s, 0.01);
    assert.ok(p.hp < 100);
    assert.equal(s.enemies[0].hp, 100);
    assert.equal(s.enemyShots.length, 0);
    s.enemies[0].rangedCooldown = 0;
    s.enemyShots = Array.from({ length: LIMITS.enemyShots }, () => ({ x: 800, y: 800, vx: 1, vy: 0, ttl: 2, radius: 14 }));
    updateGame(s, 0.01);
    assert.equal(s.enemyShots.length, LIMITS.enemyShots);
    s.enemies[0].rangedCooldown = 999;
    tick(s, 2.1);
    assert.equal(s.enemyShots.length, 0);
  }
});
