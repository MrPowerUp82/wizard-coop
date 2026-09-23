import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameState, createPlayer, activateSpecial, LIMITS, SPELLS } from './game.js';
import { PLAYER_BASE } from './balance.js';
import { selectPlayerCharacter } from './developer.js';
import { GOD, GOD_COST, GOD_PLANETS, godPlanetPosition } from './god.js';
import { createWallet } from '../src/wallet.js';
import { createGrid } from './spatial.js';
import { updateWeapons, estimateDps } from './weapons.js';

test('The God custa 60000, desbloqueia uma vez e sobrevive à redistribuição', () => {
  const previous = globalThis.localStorage;
  const saved = new Map();
  globalThis.localStorage = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) };
  try {
    const wallet = createWallet();
    assert.equal(wallet.offers().find(offer => offer.id === 'theGod').cost, GOD_COST);
    wallet.deposit(GOD_COST - 1);
    assert.equal(wallet.buy('theGod'), false);
    wallet.deposit(1);
    assert.equal(wallet.buy('theGod'), true);
    assert.equal(wallet.coins, 0);
    assert.equal(wallet.buy('theGod'), false);
    wallet.respec();
    assert.equal(createWallet().godUnlocked, true);
    assert.equal(createWallet().offers().find(offer => offer.id === 'theGod').cost, null);
  } finally {
    globalThis.localStorage = previous;
  }
});

test('The God tem os atributos pedidos e troca sem acumular bônus', () => {
  const base = createPlayer('b', 'Base');
  const god = createPlayer('g', 'The God', GOD);
  assert.equal(god.maxHp, 500);
  assert.equal(god.damage, PLAYER_BASE.damage * 1.5);
  assert.equal(god.speed, PLAYER_BASE.speed * 1.2);
  assert.equal(god.armor, 12);
  assert.equal(god.attackDelay, PLAYER_BASE.attackDelay * 0.85);
  assert.equal(god.projectiles, 1);
  assert.equal(SPELLS[GOD].pierce, 3);
  for (let n = 0; n < 5; n++) {
    selectPlayerCharacter(god, 0);
    for (const field of ['hp', 'maxHp', 'damage', 'speed', 'armor', 'attackDelay', 'projectiles'])
      assert.ok(Math.abs(god[field] - base[field]) < 1e-8, field);
    selectPlayerCharacter(god, GOD);
  }
  assert.equal(god.maxHp, 500);
});

test('The God tem especiais próprios e o alternativo respeita o limite de disparos', () => {
  const game = createGameState();
  const god = createPlayer('g', 'The God', GOD);
  game.players.g = god;
  god.specialCharge = 100;
  assert.equal(activateSpecial(game, 'g'), true);
  assert.equal(god.invulnerableFor, 1.5);
  const alt = createPlayer('a', 'The God', GOD, { secondSpell: 1 }, { special: 1 });
  game.players.a = alt;
  alt.specialCharge = 100;
  game.shots = Array.from({ length: LIMITS.shots - 11 }, () => ({}));
  assert.equal(activateSpecial(game, 'a'), false);
  game.shots = [];
  assert.equal(activateSpecial(game, 'a'), true);
  assert.equal(game.shots.length, 12);
  assert.ok(game.shots.every(shot => shot.color === GOD && shot.pierce === 3));
});

test('dois planetas de The God orbitam, ferem por contato e respeitam intervalo entre acertos', () => {
  const game = createGameState();
  const god = createPlayer('g', 'The God', GOD);
  game.players.g = god;
  const position = godPlanetPosition(god, 0, 0);
  const target = { id: 1, type: 'slime', ...position, hp: 1000, maxHp: 1000, age: 0 };
  const distant = { id: 2, type: 'slime', x: 300, y: 0, hp: 1000, maxHp: 1000, age: 0 };
  game.enemies = [target, distant];
  const grid = createGrid();
  game.enemies.forEach(enemy => grid.insert(enemy));
  const tick = () => updateWeapons({ s: game, dt: 0, random: () => 0.9, grid, alive: [god] });
  tick();
  assert.equal(target.hp, 1000 - god.damage * GOD_PLANETS.damage);
  assert.equal(distant.hp, 1000);
  tick();
  assert.equal(target.hp, 1000 - god.damage * GOD_PLANETS.damage);
  game.time = Math.PI * 2 / GOD_PLANETS.speed;
  tick();
  assert.equal(target.hp, 1000 - god.damage * GOD_PLANETS.damage * 2);
  assert.ok(estimateDps(god) > god.damage / god.attackDelay);
});

test('planetas exclusivos coexistem com Orbes arcanos e pausam durante escolha de poder', () => {
  const game = createGameState();
  const god = createPlayer('g', 'The God', GOD);
  god.powers.orbit = 1;
  game.players.g = god;
  const target = { id: 1, type: 'slime', x: god.x + GOD_PLANETS.radius, y: god.y, hp: 1000, maxHp: 1000, age: 0 };
  game.enemies = [target];
  const grid = createGrid(); grid.insert(target);
  const tick = () => updateWeapons({ s: game, dt: 0, random: () => 0.9, grid, alive: [god] });
  tick();
  assert.ok(Math.abs(target.hp - (1000 - god.damage * (GOD_PLANETS.damage + 0.65))) < 1e-8);
  god.pendingPowers = ['armor'];
  game.time = 1;
  tick();
  assert.ok(Math.abs(target.hp - (1000 - god.damage * (GOD_PLANETS.damage + 0.65))) < 1e-8);
});
