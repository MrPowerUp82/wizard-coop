import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameState, createPlayer, updateGame, xpNeeded } from './game.js';
import { POWERS, applyPower, offerPowers, rerollPowers } from './powers.js';

const random = () => 0.5;
const maxPowers = () => Object.fromEntries(Object.entries(POWERS).map(([id, power]) => [id, power.max]));

for (const [id, power] of Object.entries(POWERS)) {
  test(`${id}: pode atingir o máximo e deixa de aparecer nas próximas escolhas`, () => {
    const player = createPlayer('p', 'Mago', power.color ?? 0);
    player.level = 10;
    player.powers = maxPowers();
    player.powers[id] = power.max - 1;
    assert.deepEqual(offerPowers(player, random, { coop: true }), [id]);
    assert.equal(applyPower(player, id), true);
    assert.equal(player.powers[id], power.max);
    assert.equal(offerPowers(player, random, { coop: true }), null);
  });
}

test('level up considera o limite de cada jogador separadamente', () => {
  const state = createGameState();
  state.spawn = 999;
  for (const id of ['p1', 'p2']) {
    const player = createPlayer(id, id);
    player.powers = maxPowers();
    player.xp = xpNeeded(player.level);
    state.players[id] = player;
  }
  state.players.p2.powers.arcane--;
  updateGame(state, 0.016, random);
  assert.equal(state.players.p1.pendingPowers, null);
  assert.deepEqual(state.players.p2.pendingPowers, ['arcane']);
  assert.equal(state.players.p1.level, 2);
  assert.equal(state.players.p2.level, 2);
});

test('trocar opções não reaproveita habilidades no máximo para completar três escolhas', () => {
  const player = createPlayer('p', 'Mago');
  player.powers = maxPowers();
  player.powers.haste--;
  player.powers.vitality--;
  player.pendingPowers = ['arcane', 'haste'];
  player.rerolls = 1;
  assert.equal(rerollPowers(player, random), true);
  assert.deepEqual(player.pendingPowers, ['vitality', 'haste']);
  assert.equal(player.rerolls, 0);
});

test('trocar opções sem habilidades disponíveis encerra a escolha', () => {
  const player = createPlayer('p', 'Mago');
  player.powers = maxPowers();
  player.pendingPowers = ['arcane', 'haste', 'vitality'];
  player.rerolls = 1;
  assert.equal(rerollPowers(player, random), true);
  assert.equal(player.pendingPowers, null);
  assert.equal(player.powerTimer, 0);
});
