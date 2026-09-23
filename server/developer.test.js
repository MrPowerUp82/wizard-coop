import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameState, createPlayer, activateSpecial, updateGame, publicState } from './game.js';
import { DEVELOPER, selectPlayerCharacter } from './developer.js';
import { LIMITS } from './balance.js';
import { encodeState, decodeState } from './protocol.js';
import { dailyChallenge } from './curses.js';
import { createGrid } from './spatial.js';
import { updatePlayerAttacks, updateShots } from './weapons.js';

const enemy = (id, x, hp = 10000) => ({ id, type: 'slime', x, y: 0, hp, maxHp: hp, age: 0 });
function fixture() {
  const s = createGameState();
  const p = createPlayer('dev', 'O Desenvolvedor', DEVELOPER);
  p.x = 0; s.players.dev = p; s.spawn = 999;
  return { s, p };
}

test('desenvolvedor: atributos e troca no lobby preservam melhorias sem acumular bônus', () => {
  const meta = { vigor: 3, might: 2, ward: 2, stride: 2, celerity: 2 };
  const base = createPlayer('p', 'Mago', 0, meta);
  const p = createPlayer('p', 'Mago', DEVELOPER, meta);
  assert.equal(p.maxHp, base.maxHp * 5);
  assert.equal(p.damage, base.damage * 4);
  assert.equal(p.projectiles, 3);
  for (let i = 0; i < 10; i++) {
    selectPlayerCharacter(p, DEVELOPER);
    assert.equal(p.maxHp, base.maxHp * 5);
    selectPlayerCharacter(p, 3);
    for (const field of ['hp', 'maxHp', 'damage', 'speed', 'armor', 'projectiles', 'attackDelay']) {
      assert.ok(Math.abs(p[field] - base[field]) < 1e-9, field);
    }
    selectPlayerCharacter(p, DEVELOPER);
  }
});

test('código-fonte dispara três raios, atravessa, desacelera e explode sem repetir alvo', () => {
  const { s, p } = fixture();
  s.enemies = [enemy(1, 20), enemy(2, 80)];
  updatePlayerAttacks({ s, alive: [p] });
  assert.equal(s.shots.length, 3);
  assert.ok(s.shots.every(shot => shot.color === DEVELOPER && shot.pierce === 6));
  s.shots = [s.shots[1]];
  const grid = createGrid();
  s.enemies.forEach(e => grid.insert(e));
  const ctx = { s, dt: 0, random: () => 0.9, grid };
  updateShots(ctx);
  assert.equal(s.enemies[0].hp, 10000 - p.damage);
  assert.equal(s.enemies[0].slowFor, 1.2);
  assert.equal(s.enemies[1].hp, 10000 - p.damage * 0.6);
  updateShots(ctx);
  assert.equal(s.enemies[0].hp, 10000 - p.damage);
});

test('reescrever realidade respeita alcance, cura, proteção e bloqueios com arrays cheios', () => {
  const { s, p } = fixture();
  p.hp = 100; p.specialCharge = 100;
  s.enemies = [enemy(1, 300), enemy(2, 800)];
  s.enemyShots = [{ x: 100, y: 0 }, { x: 800, y: 0 }];
  s.shots = Array.from({ length: LIMITS.shots }, () => ({}));
  s.zones = Array.from({ length: LIMITS.zones }, () => ({}));
  assert.equal(activateSpecial(s, 'dev'), true);
  assert.equal(s.enemies[0].hp, 10000 - p.damage * 24);
  assert.equal(s.enemies[1].hp, 10000);
  assert.equal(s.enemyShots.length, 1);
  assert.equal(p.hp, 350); assert.equal(p.invulnerableFor, 3);
  assert.equal(p.specialCharge, 0);
  assert.equal(p.stats.by.special, p.damage * 24);
  p.specialCharge = 100;
  assert.equal(activateSpecial(s, 'dev'), false);
  p.specialCooldown = 0; p.pendingPowers = ['arcane'];
  assert.equal(activateSpecial(s, 'dev'), false);
  p.pendingPowers = null; s.phaseStatus = 'transition';
  assert.equal(activateSpecial(s, 'dev'), false);
});

test('restauração cura e protege aliados vivos próximos, sem ressuscitar caídos', () => {
  const { s, p } = fixture();
  p.specialVariant = 1; p.specialCharge = 100;
  for (const [id, x, alive] of [['near', 100, true], ['far', 800, true], ['down', 50, false]]) {
    const ally = createPlayer(id, id); ally.x = x; ally.hp = alive ? 10 : 0; ally.alive = alive;
    s.players[id] = ally;
  }
  assert.equal(activateSpecial(s, 'dev'), true);
  assert.equal(s.players.near.hp, 100); assert.equal(s.players.near.invulnerableFor, 5);
  assert.equal(s.players.far.hp, 10); assert.equal(s.players.down.hp, 0);
});

test('restauração elimina inimigos em todo o mapa, registra abates e drops sem afetar spawns posteriores', () => {
  const { s, p } = fixture();
  p.specialVariant = 1; p.specialCharge = 100;
  s.enemies = [enemy(1, 100), { ...enemy(2, 9000, 900000), elite: true }, enemy(3, -12000)];
  const targets = [...s.enemies];
  assert.equal(activateSpecial(s, 'dev', () => 0.9), true);
  assert.ok(targets.every(e => e.hp <= 0));
  assert.equal(p.stats.kills, 3);
  assert.equal(p.stats.by.special, 920000);
  assert.ok(s.gems.some(gem => gem.type === 'chest'));
  assert.ok(s.gems.some(gem => gem.type === 'gem'));
  s.enemies.push(enemy(99, 0));
  p.attackCooldown = 999;
  updateGame(s, 0.016, () => 0.9);
  assert.equal(s.enemies.find(e => e.id === 99).hp, 10000);
  assert.equal(p.specialCharge < 100, true);
  assert.equal(activateSpecial(s, 'dev'), false);
});

test('restauração mata chefes distantes e preserva transição de fase e vitória', () => {
  for (const phase of [0, 5]) {
    const { s, p } = fixture();
    s.phase = phase; s.phaseStatus = 'boss';
    p.specialVariant = 1; p.specialCharge = 100;
    s.enemies = [{ ...enemy(1, 20000, 1e8), type: phase === 0 ? 'treant' : 'umbra', boss: true }];
    assert.equal(activateSpecial(s, 'dev'), true);
    assert.equal(s.enemies[0].hp, 0);
    updateGame(s, 0.016, () => 0.9);
    if (phase === 0) assert.equal(s.phaseStatus, 'transition');
    else { assert.equal(s.over, true); assert.equal(s.victory, true); }
  }
});

test('recarga automática pausa nas escolhas, limita a carga e transmite o personagem no protocolo', () => {
  const { s, p } = fixture();
  updateGame(s, 0.1, () => 0.9);
  assert.equal(p.specialCharge, 1);
  p.pendingPowers = ['arcane'];
  updateGame(s, 0.1, () => 0.9); assert.equal(p.specialCharge, 1);
  p.pendingPowers = null; p.specialCharge = 99.9;
  updateGame(s, 0.1, () => 0.9); assert.equal(p.specialCharge, 100);
  const decoded = decodeState(encodeState(s, 'dev'));
  assert.equal(decoded.players.dev.color, DEVELOPER);
  assert.equal(decoded.players.dev.maxHp, 500);
  assert.equal(publicState(s).players.dev.color, DEVELOPER);
  for (let day = 1; day <= 365; day++) {
    assert.ok(dailyChallenge(new Date(Date.UTC(2026, 0, day))).character < DEVELOPER);
  }
});
