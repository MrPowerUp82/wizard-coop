import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DROP_TTL, LIMITS, applyPower, createGameState, createPlayer,
  difficultyAt, updateGame, xpNeeded
} from './game.js';

const fixedRandom = () => 0.25;

test('jogador morre, para de se mover e encerra quando todos caem', () => {
  const state = createGameState();
  const player = createPlayer('p1', 'Teste');
  player.hp = 1;
  player.input = { x: 1, y: 0 };
  state.players.p1 = player;
  state.spawn = 999;
  state.enemies.push({ id: 'e1', x: 0, y: 0, hp: 100, maxHp: 100, type: 'brute', age: 0 });
  updateGame(state, 0.016, fixedRandom);
  assert.equal(player.hp, 0);
  assert.equal(player.alive, false);
  assert.deepEqual(player.input, { x: 0, y: 0 });
  assert.equal(state.over, true);
  const x = player.x;
  updateGame(state, 1, fixedRandom);
  assert.equal(player.x, x);
});

test('coleta preserva XP excedente e cria três escolhas únicas', () => {
  const state = createGameState();
  const player = createPlayer('p1', 'Teste');
  state.players.p1 = player;
  state.spawn = 999;
  state.gems.push({ x: 0, y: 0, value: xpNeeded(1) + 2, ttl: DROP_TTL });
  updateGame(state, 0.016, fixedRandom);
  assert.equal(player.level, 2);
  assert.equal(player.xp, 2);
  assert.equal(player.pendingPowers.length, 3);
  assert.equal(new Set(player.pendingPowers).size, 3);
});

test('poder válido altera atributos e escolha inválida é rejeitada', () => {
  const player = createPlayer('p1', 'Teste');
  player.pendingPowers = ['arcane', 'vitality', 'haste'];
  const damage = player.damage;
  assert.equal(applyPower(player, 'arcane'), true);
  assert.ok(player.damage > damage);
  assert.equal(applyPower(player, 'invalid'), false);
});

test('jogador fica invulnerável enquanto escolhe um poder', () => {
  const state = createGameState();
  const player = createPlayer('p1', 'Teste');
  player.hp = 1;
  player.pendingPowers = ['arcane', 'vitality', 'haste'];
  state.players.p1 = player;
  state.spawn = 999;
  state.enemies.push({ id: 'e1', x: 0, y: 0, hp: 100, maxHp: 100, type: 'brute', age: 0 });

  updateGame(state, 0.016, fixedRandom);
  assert.equal(player.hp, 1);
  assert.equal(player.alive, true);

  applyPower(player, 'arcane');
  assert.equal(player.invulnerableFor, 3);
  updateGame(state, 2.9, fixedRandom);
  assert.equal(player.hp, 1);
  assert.equal(player.alive, true);
  state.enemies[0].x = player.x;
  state.enemies[0].y = player.y;
  state.enemies[0].hp = 1000;
  updateGame(state, 0.2, fixedRandom);
  assert.equal(player.hp, 0);
  assert.equal(player.alive, false);
});

test('dificuldade cresce com o tempo respeitando pisos e tetos', () => {
  const start = difficultyAt(0, 1);
  const late = difficultyAt(600, 1);
  assert.ok(late.hpScale > start.hpScale);
  assert.ok(late.damageScale > start.damageScale);
  assert.ok(late.spawnCount > start.spawnCount);
  assert.ok(late.spawnInterval >= 0.16);
  assert.ok(late.speedScale <= 1.38);
});

test('drops expiram e entidades respeitam limites', () => {
  const state = createGameState();
  state.players.p1 = createPlayer('p1', 'Teste');
  state.spawn = 999;
  state.cleanup = 0;
  state.gems = Array.from({ length: LIMITS.drops + 20 }, (_, index) => ({ x: 500 + index, y: 0, value: 1, ttl: index === 0 ? 0.001 : DROP_TTL }));
  updateGame(state, 0.1, fixedRandom);
  assert.ok(state.gems.length <= LIMITS.drops);
  assert.ok(state.gems.every(gem => gem.ttl > 0));
});

test('spawn nunca ultrapassa o limite de inimigos', () => {
  const state = createGameState();
  state.players.p1 = createPlayer('p1', 'Teste');
  state.time = 600;
  state.spawn = 0;
  state.enemies = Array.from({ length: LIMITS.enemies - 1 }, (_, index) => ({ id: String(index), x: 400, y: index, hp: 10, maxHp: 10, type: 'slime', age: 0 }));
  updateGame(state, 0.016, fixedRandom);
  assert.ok(state.enemies.length <= LIMITS.enemies);
});
