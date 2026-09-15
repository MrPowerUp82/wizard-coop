import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameState, createPlayer, updateGame, publicState, POWERS, LIMITS } from './game.js';
import { PHASES, PHASE_DURATION, TRANSITION_DURATION } from './phases.js';
import { encodeState, decodeState } from './protocol.js';

function fixture(phase = 0, count = 1) {
  const state = createGameState();
  state.phase = phase;
  for (let i = 0; i < count; i++) {
    const p = createPlayer(`p${i}`, 'Teste', i);
    p.invulnerableFor = 10000;
    state.players[p.id] = p;
  }
  return state;
}
function bossFixture(phase = 0, count = 1) {
  const state = fixture(phase, count);
  state.phaseTime = PHASE_DURATION - 0.01;
  updateGame(state, 0.01, () => 0.25);
  return state;
}

test('cada fase dura 300 segundos e gera apenas seus próprios inimigos', () => {
  for (let phase = 0; phase < PHASES.length; phase++) {
    const s = fixture(phase);
    updateGame(s, 0.1, () => 0.25);
    s.spawn = 0;
    updateGame(s, 0.1, () => 0.9);
    assert.deepEqual(new Set(s.enemies.map(e => e.type)), new Set(PHASES[phase].enemies));
    s.phaseTime = 299.9;
    updateGame(s, 0.05);
    assert.equal(s.phaseStatus, 'horde');
    updateGame(s, 0.06);
    assert.equal(s.phaseTime, 300);
    assert.equal(s.phaseStatus, 'boss');
    assert.equal(s.enemies.length, 1);
    assert.equal(s.enemies[0].type, PHASES[phase].boss);
  }
});

test('chefe não expira nem desaparece quando o jogador se afasta', () => {
  const s = bossFixture();
  const boss = s.enemies[0];
  boss.age = 100;
  boss.x = 10000;
  s.cleanup = 0;
  updateGame(s, 1);
  assert.equal(s.enemies[0], boss);
  assert.equal(s.phaseStatus, 'boss');
  assert.equal(s.phaseTime, 300);
});

test('morte do chefe abre transição, limpa ataques e inicia novos cinco minutos', () => {
  const s = bossFixture();
  s.enemies[0].hp = 0;
  s.hazards.push({ x: 0, y: 0, radius: 100, warning: 3, ttl: 4 });
  s.enemyShots.push({ x: 800, y: 800, vx: 100, vy: 0, ttl: 4, radius: 14 });
  updateGame(s, 0.01);
  assert.equal(s.phaseStatus, 'transition');
  assert.equal(s.hazards.length, 0);
  assert.equal(s.shots.length, 0);
  assert.equal(s.enemyShots.length, 0);
  s.players.p0.hp = 10;
  updateGame(s, TRANSITION_DURATION - 0.01);
  assert.equal(s.phase, 0);
  updateGame(s, 0.02);
  assert.equal(s.phase, 1);
  assert.equal(s.phaseStatus, 'horde');
  assert.equal(s.phaseTime, 0);
  assert.equal(s.players.p0.hp, 45);
});

test('último chefe concede vitória e congela a simulação', () => {
  const s = bossFixture(PHASES.length - 1);
  s.enemies[0].hp = 0;
  updateGame(s, 0.01);
  assert.equal(s.victory, true);
  assert.equal(s.over, true);
  assert.equal(s.phaseStatus, 'complete');
  const snapshot = JSON.stringify(s);
  updateGame(s, 10);
  assert.equal(JSON.stringify(s), snapshot);
});

test('morte do grupo prevalece sobre vitória no mesmo frame', () => {
  const s = bossFixture(PHASES.length - 1);
  const p = s.players.p0;
  p.invulnerableFor = 0; p.hp = 1;
  s.enemies[0].hp = 0;
  s.hazards.push({ x: p.x, y: p.y, radius: 100, warning: 0.01, ttl: 1, damage: 50, fired: false });
  updateGame(s, 0.02);
  assert.equal(s.over, true);
  assert.equal(s.victory, false);
});

test('ataque do chefe avisa antes de causar dano e permite esquiva', () => {
  const s = bossFixture(1, 2);
  const boss = s.enemies[0];
  boss.attackCooldown = 0;
  for (const p of Object.values(s.players)) p.invulnerableFor = 0;
  updateGame(s, 0.01);
  assert.equal(s.hazards.length, 1);
  assert.equal(s.players.p0.hp, 100);
  const h = s.hazards[0];
  s.players.p0.x = h.x; s.players.p0.y = h.y;
  s.players.p1.x = h.x + 400; s.players.p1.y = h.y;
  boss.x = 1000; boss.y = 1000;
  updateGame(s, 1.3);
  assert.ok(s.players.p0.hp < 100);
  assert.equal(s.players.p1.hp, 100);
  const hp = s.players.p0.hp;
  updateGame(s, 0.1);
  assert.equal(s.players.p0.hp, hp);
});

test('co-op escala a vida do chefe e transmite fase, ataques e vitória', () => {
  const solo = bossFixture();
  const coop = bossFixture(0, 4);
  assert.ok(coop.enemies[0].maxHp > solo.enemies[0].maxHp);
  const state = JSON.parse(JSON.stringify(publicState(coop)));
  assert.equal(state.phaseStatus, 'boss');
  assert.equal(state.phaseTime, 300);
  assert.equal(state.phase, 0);
  assert.equal(state.victory, false);
  assert.deepEqual(state.hazards, []);
});

test('campanha completa atravessa seis hordas e chefes sem exceder limites', () => {
  const s = fixture();
  const p = s.players.p0;
  p.damage = 150; p.projectiles = 4; p.attackDelay = 0.2;
  p.powers = Object.fromEntries(Object.entries(POWERS).map(([id, power]) => [id, power.max]));
  const bosses = new Set();
  for (let n = 0; n < PHASES.length * (PHASE_DURATION + 240) * 30 && !s.over; n++) {
    p.invulnerableFor = 10; // Isolate campaign progression from survival skill.
    updateGame(s, 1 / 30, () => 0.25);
    if (s.phaseStatus === 'boss') bosses.add(s.phase);
    assert.ok(s.enemies.length <= LIMITS.enemies);
    assert.ok(s.shots.length <= LIMITS.shots);
    assert.ok(s.enemyShots.length <= LIMITS.enemyShots);
    assert.ok(s.gems.length <= LIMITS.drops);
    assert.ok(s.hazards.length <= LIMITS.hazards);
  }
  assert.deepEqual([...bosses], [...PHASES.keys()]);
  assert.ok(s.time >= PHASE_DURATION * PHASES.length);
  assert.equal(s.victory, true);
});

test('terceiro, quarto e quinto chefes abrem a próxima fase preservando a build', () => {
  for (const phase of [2, 3, 4]) {
    const s = bossFixture(phase, 4);
    const p = s.players.p0;
    p.level = 15;
    p.powers.arcane = 3;
    s.enemies[0].hp = 0;
    updateGame(s, 0.01);
    assert.equal(s.victory, false);
    assert.equal(s.over, false);
    assert.equal(s.phaseStatus, 'transition');
    updateGame(s, TRANSITION_DURATION + 0.01);
    assert.equal(s.phase, phase + 1);
    assert.equal(s.phaseStatus, 'horde');
    assert.equal(p.level, 15);
    assert.equal(p.powers.arcane, 3);
  }
});

test('novos chefes escalam em co-op, avisam áreas e transmitem ataques em todas as fúrias', () => {
  for (const phase of [3, 4, 5]) {
    const solo = bossFixture(phase);
    const s = bossFixture(phase, 4);
    const boss = s.enemies[0];
    assert.ok(Number.isFinite(boss.maxHp));
    assert.ok(boss.maxHp > solo.enemies[0].maxHp);
    for (const [index, ratio] of [1, 0.6, 0.3].entries()) {
      boss.hp = boss.maxHp * ratio;
      boss.attackCooldown = 0;
      boss.rangedCooldown = 0;
      s.hazards = []; s.enemyShots = [];
      updateGame(s, 0.01, () => 0.25);
      assert.equal(boss.stage, index + 1);
      assert.ok(s.hazards.length >= 5 && s.hazards.length <= LIMITS.hazards);
      assert.ok(s.enemyShots.length >= 5 && s.enemyShots.length <= LIMITS.enemyShots);
      assert.ok(s.enemies.length <= LIMITS.enemies);
      for (const h of s.hazards) {
        assert.ok(h.warning > 0 && h.ttl > h.warning && !h.fired);
        assert.ok([h.x, h.y, h.radius, h.damage].every(Number.isFinite));
      }
      const wire = decodeState(JSON.parse(JSON.stringify(encodeState(s, 'p0'))));
      assert.equal(wire.phase, phase);
      assert.equal(wire.enemies.find(e => e.boss).type, PHASES[phase].boss);
      assert.equal(wire.enemies.find(e => e.boss).stage, index + 1);
      assert.equal(wire.enemyShots.length, s.enemyShots.length);
      assert.ok(wire.enemyShots.every(shot => ['thorn', 'bolt', 'blade'].includes(shot.sprite)));
      if (index > 0) assert.ok(wire.enemies.some(e => e.type === PHASES[phase].enemies[0]));
    }
  }
});
