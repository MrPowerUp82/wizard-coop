import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LIMITS, POWERS, addLatePlayer, applyPower, availablePowers, createGameState, createPlayer, difficultyAt,
  rerollPowers, updateGame, xpNeeded
} from './game.js';
import { BOSS, CONTACT, DIFFICULTY, DROPS, ELITE, POWER_CHOICE_TIMEOUT } from './balance.js';
import { ENEMIES, PHASE_DURATION, enemyXp } from './phases.js';
import { META_UPGRADES, applyMeta, sanitizeMeta } from './meta.js';

const still = () => 0.9;

function fixture({ color = 0, attack = false } = {}) {
  const s = createGameState();
  const p = createPlayer('p', 'Mago', color);
  if (!attack) p.attackCooldown = 1e9;
  s.players.p = p;
  s.spawn = 1e9;
  s.scheduleCursor = 99;
  return { s, p };
}
const enemy = (s, type, x, y = 0, extra = {}) => {
  const e = { id: ++s.nextId, type, x, y, hp: ENEMIES[type].hp, maxHp: ENEMIES[type].hp, age: 0, ...extra };
  s.enemies.push(e);
  return e;
};
const tick = (s, seconds, random = still) => { for (let n = 0; n < Math.round(seconds * 30); n++) updateGame(s, 1 / 30, random); };

test('dificuldade de cada fase parte de um patamar próprio, e não do relógio global', () => {
  assert.deepEqual(difficultyAt(0, 1, 2), difficultyAt(DIFFICULTY.phaseOffsetMinutes * 120, 1, 0));
  assert.ok(difficultyAt(0, 1, 1).hpScale < difficultyAt(300, 1, 1).hpScale);
  assert.ok(difficultyAt(PHASE_DURATION, 1, 2).speedScale <= DIFFICULTY.speed.max);
});

test('cada inimigo morde no próprio ritmo: multidões ferem mais que um inimigo sozinho', () => {
  const damageFrom = count => {
    const { s, p } = fixture();
    p.maxHp = p.hp = 10000;
    for (let n = 0; n < count; n++) enemy(s, 'mushroom', 0, 0);
    tick(s, 2);
    return p.maxHp - p.hp;
  };
  const single = damageFrom(1);
  assert.ok(single > 0 && single <= Math.ceil(2 / CONTACT.enemyCooldown) * ENEMIES.mushroom.damage);
  assert.ok(damageFrom(6) > single * 3);
});

test('XP acompanha a vida do inimigo e drops acima do limite se fundem em cristais maiores', () => {
  assert.equal(enemyXp('scorpion'), 4);
  assert.equal(enemyXp('beetle'), 1);
  const { s } = fixture();
  s.gems = Array.from({ length: LIMITS.drops }, (_, n) => ({ id: n, x: 400 + n, y: 0, type: 'gem', value: 1, ttl: 20 }));
  const target = enemy(s, 'scorpion', 200, 0, { hp: 1 });
  s.shots.push({ x: 200, y: 0, vx: 0, vy: 0, ttl: 1, damage: 5, color: 0 });
  updateGame(s, 0.001, still);
  assert.equal(target.hp <= 0, true);
  assert.equal(s.gems.length, LIMITS.drops);
  assert.equal(s.gems.reduce((sum, gem) => sum + gem.value, 0), LIMITS.drops + 4);
  assert.ok(DROPS.mergeAt < LIMITS.drops);
});

test('escolha de poder expira e aplica a primeira opção para quem ficou ausente', () => {
  const { s, p } = fixture();
  p.xp = xpNeeded(1);
  updateGame(s, 0.01, still);
  const first = p.pendingPowers[0];
  tick(s, POWER_CHOICE_TIMEOUT - 1);
  assert.ok(p.pendingPowers);
  tick(s, 1.1);
  assert.equal(p.pendingPowers, null);
  assert.equal(p.powers[first], 1);
});

test('quem entra atrasado nasce perto de um aliado e recebe XP de recuperação', () => {
  const { s, p } = fixture();
  p.x = 900; p.y = -300; p.level = 10;
  const late = addLatePlayer(s, createPlayer('late', 'Atrasado', 1));
  assert.ok(Math.hypot(late.x - p.x, late.y - p.y) < 100);
  const expected = Array.from({ length: 7 }, (_, n) => xpNeeded(n + 1)).reduce((a, b) => a + b, 0);
  assert.equal(late.xp, expected);
  late.attackCooldown = 1e9;
  for (let n = 0; n < 7; n++) { updateGame(s, 0.01, still); applyPower(late, late.pendingPowers[0]); }
  assert.equal(late.level, 8);
});

test('elite surge no horário marcado e deixa baú e ímã; baú oferece poder e ímã puxa todo XP', () => {
  const { s, p } = fixture({ attack: false });
  s.scheduleCursor = 0;
  s.phaseTime = 89.99;
  updateGame(s, 0.02, () => 0.5);
  assert.ok(s.events.some(event => event.kind === 'opening' || event.kind === 'elite'));
  const elite = s.enemies.find(e => e.elite);
  assert.ok(elite);
  assert.equal(elite.maxHp, ENEMIES[elite.type].hp * difficultyAt(s.phaseTime, 1, 0).hpScale * ELITE.hp);
  s.enemies = [];
  s.gems = [
    { id: 1, x: 0, y: 0, type: 'chest', value: 1, ttl: 20 },
    { id: 2, x: 0, y: 0, type: 'magnet', value: 1, ttl: 20 },
    { id: 3, x: 1400, y: 0, type: 'gem', value: 3, ttl: 20 }
  ];
  updateGame(s, 0.01, still);
  assert.ok(s.gems.find(g => g.id === 3).pull === 'p');
  updateGame(s, 0.01, still);
  assert.ok(p.pendingPowers?.length);
  applyPower(p, p.pendingPowers[0]);
  tick(s, 3.5);
  assert.equal(p.xp, 1.5);
});

test('lodo se divide, besouro investe, olho atira à distância e morcego explode sem deixar loot', () => {
  const { s, p } = fixture();
  p.maxHp = p.hp = 1000;
  const slime = enemy(s, 'slime', 200, 0, { hp: 1 });
  s.shots.push({ x: 200, y: 0, vx: 0, vy: 0, ttl: 1, damage: 5, color: 1 });
  updateGame(s, 0.001, still);
  assert.equal(slime.hp <= 0, true);
  assert.equal(s.enemies.filter(e => e.type === 'slimelet').length, 2);

  const charger = fixture();
  const beetle = enemy(charger.s, 'beetle', 250, 0, { chargeTimer: 0 });
  updateGame(charger.s, 0.01, still);
  assert.ok(beetle.windup > 0);
  const x = beetle.x;
  tick(charger.s, 1);
  assert.ok(x - beetle.x > ENEMIES.beetle.speed, 'a investida percorre mais que a caminhada');

  const ranged = fixture();
  const eye = enemy(ranged.s, 'eye', 400, 0, { shootTimer: 0 });
  updateGame(ranged.s, 0.01, still);
  assert.equal(ranged.s.enemyShots.length, 1);
  assert.ok(ranged.s.enemyShots[0].vx < 0);
  tick(ranged.s, 3);
  assert.ok(eye.x > 200, 'o atirador mantém distância');

  const bomb = fixture();
  bomb.p.maxHp = bomb.p.hp = 100;
  enemy(bomb.s, 'bat', 40, 0);
  tick(bomb.s, 1);
  assert.ok(bomb.p.hp < 100);
  assert.equal(bomb.s.enemies.length, 0);
  assert.equal(bomb.s.gems.length, 0);
  assert.ok(bomb.s.events.some(e => e.kind === 'boom'));
});

test('armas secundárias causam dano sozinhas: orbe, aura, corrente e runa', () => {
  const setup = (power, rank, x) => {
    const { s, p } = fixture();
    p.powers[power] = rank;
    const target = enemy(s, 'scorpion', x, 0, { hp: 1e6, maxHp: 1e6 });
    return { s, p, target };
  };
  const orbit = setup('orbit', 1, 82);
  tick(orbit.s, 3);
  assert.ok(orbit.target.hp < 1e6);
  assert.ok(orbit.p.stats.damage > 0);

  const aura = setup('aura', 1, 60);
  tick(aura.s, 1.1);
  assert.ok(aura.target.hp < 1e6);

  const chain = setup('chain', 2, 200);
  enemy(chain.s, 'scorpion', 300, 0, { hp: 1e6, maxHp: 1e6 });
  tick(chain.s, 0.1);
  const zap = chain.s.events.find(e => e.kind === 'chain');
  assert.ok(zap);
  assert.equal(zap.points.length, 6);

  const runes = setup('runes', 1, 600);
  tick(runes.s, 1);
  assert.equal(runes.s.runes.length, 1);
  runes.target.x = runes.s.runes[0].x; runes.target.y = runes.s.runes[0].y;
  runes.target.slowFor = 99;
  tick(runes.s, 0.1);
  assert.equal(runes.s.runes.length, 0);
  assert.ok(runes.s.events.some(e => e.kind === 'boom'));
});

test('evoluções, assinaturas e elo aparecem só quando os requisitos são cumpridos', () => {
  const p = createPlayer('p', 'Mago', 2);
  p.level = 10;
  const all = random => availablePowers(p, random, { coop: false });
  const offered = new Set();
  for (let n = 0; n < 200; n++) for (const id of all(Math.random)) offered.add(id);
  assert.ok(offered.has('ricochet'));
  assert.ok(!offered.has('shatter') && !offered.has('bond') && !offered.has('constellation'));
  p.powers.orbit = 5; p.powers.arcane = 3;
  assert.ok(all(() => 0.99).includes('constellation'));
  assert.ok(availablePowers(p, Math.random, { coop: true }).length === 3);
  const young = createPlayer('y', 'Novato', 0);
  for (let n = 0; n < 100; n++) assert.ok(!availablePowers(young, Math.random).includes('shatter'));
  assert.ok(Object.values(POWERS).every(power => power.title && power.max >= 1));
});

test('trocar opções consome cargas do Destino e evita repetir as mesmas escolhas', () => {
  const p = createPlayer('p', 'Mago');
  assert.equal(p.rerolls, 1, 'uma troca gratuita por partida');
  p.rerolls = 0;
  p.pendingPowers = availablePowers(p, () => 0.1);
  assert.equal(rerollPowers(p, () => 0.1), false);
  p.rerolls = 1;
  const before = [...p.pendingPowers];
  assert.equal(rerollPowers(p, () => 0.1), true);
  assert.equal(p.rerolls, 0);
  assert.equal(p.pendingPowers.length, 3);
  assert.ok(p.pendingPowers.every(id => !before.includes(id)));
});

test('vida do chefe independe da build e ele muda de estágio com lacaios e onda de choque', () => {
  const bossFor = damage => {
    const { s, p } = fixture();
    p.damage = damage;
    p.invulnerableFor = 1e9;
    s.phaseTime = PHASE_DURATION - 0.01;
    updateGame(s, 0.02, still);
    return s;
  };
  const weak = bossFor(14).enemies[0];
  const strong = bossFor(400).enemies[0];
  assert.equal(weak.maxHp, BOSS.health[0]);
  assert.equal(strong.maxHp, weak.maxHp);

  const s = bossFor(14);
  const boss = s.enemies[0];
  boss.hp = boss.maxHp * 0.6;
  updateGame(s, 0.01, still);
  assert.equal(boss.stage, 2);
  assert.ok(s.enemies.filter(e => e.minion).length >= 4);
  assert.ok(s.hazards.some(h => h.radius === 210));
  assert.ok(s.events.some(e => e.kind === 'stage' && e.stage === 2));
});

test('estágios avançados trocam os padrões: lich dispara em anel e demônio investe', () => {
  const { s, p } = fixture();
  p.invulnerableFor = 1e9;
  s.phase = 1; s.phaseStatus = 'boss';
  s.enemies = [{ id: 1, type: 'lich', boss: true, x: 400, y: 0, hp: 50, maxHp: 100, stage: 2, age: 0, attackCooldown: 99, rangedCooldown: 0 }];
  updateGame(s, 0.01, still);
  assert.equal(s.enemyShots.length, 12);

  const demon = fixture();
  demon.p.invulnerableFor = 1e9;
  demon.s.phase = 2; demon.s.phaseStatus = 'boss';
  const boss = { id: 1, type: 'demon', boss: true, x: 600, y: 0, hp: 50, maxHp: 100, stage: 2, age: 0, attackCooldown: 99, rangedCooldown: 99, dashTimer: 0 };
  demon.s.enemies = [boss];
  updateGame(demon.s, 0.01, still);
  assert.ok(boss.dashWarn > 0);
  tick(demon.s, 0.85);
  const x = boss.x;
  tick(demon.s, 0.2);
  assert.ok(x - boss.x > 90);
});

test('derrotar o guardião dá uma escolha de poder gratuita no início da fase seguinte', () => {
  const { s, p } = fixture();
  p.invulnerableFor = 1e9;
  s.phaseTime = PHASE_DURATION - 0.01;
  updateGame(s, 0.02, still);
  s.enemies[0].hp = 0;
  updateGame(s, 0.01, still);
  assert.equal(s.phaseStatus, 'transition');
  tick(s, 4.2);
  assert.equal(s.phase, 1);
  assert.ok(p.pendingPowers?.length);
});

test('melhorias permanentes são validadas e aplicadas; Fênix salva uma vez', () => {
  assert.deepEqual(sanitizeMeta({ vigor: 99, might: -3, wisdom: 1.5, greed: '2', reroll: 2, phoenix: 1, hack: 5 }),
    { ...Object.fromEntries(Object.keys(META_UPGRADES).map(id => [id, 0])), vigor: META_UPGRADES.vigor.costs.length, reroll: 2, phoenix: 1 });
  const p = applyMeta(createPlayer('p', 'Mago'), { vigor: 2, might: 1, wisdom: 1, greed: 1, reroll: 2, phoenix: 1 });
  assert.equal(p.maxHp, 112); assert.equal(p.hp, 112);
  assert.equal(p.rerolls, 3);
  assert.ok(p.damage > 14 && p.xpMult > 1 && p.coinMult > 1);

  const { s } = fixture();
  const hero = createPlayer('p', 'Mago', 0, { phoenix: 1 });
  hero.attackCooldown = 1e9;
  s.players.p = hero;
  hero.hp = 1;
  enemy(s, 'brute', 0, 0);
  updateGame(s, 0.01, still);
  assert.equal(hero.alive, true);
  assert.equal(hero.phoenix, 0);
  assert.equal(hero.hp, hero.maxHp * 0.5);
  hero.invulnerableFor = 0; hero.hp = 1;
  tick(s, 1);
  assert.equal(hero.alive, false);
});

test('novas melhorias permanentes: celeridade, agilidade, égide, alcance, canalização e pacto', () => {
  const base = createPlayer('p', 'Mago');
  const p = createPlayer('p', 'Mago', 0, { celerity: 4, stride: 3, ward: 4, reach: 3, channel: 3, pact: 1 });
  assert.ok(Math.abs(p.attackDelay - base.attackDelay * 0.88) < 1e-9);
  assert.ok(Math.abs(p.speed - base.speed * 1.12) < 1e-9);
  assert.equal(p.armor, 2);
  assert.equal(p.pickupRadius, base.pickupRadius + 45);
  assert.equal(p.specialCharge, 60);
  assert.equal(p.powers.familiar, 1);
});

test('familiar arcano acompanha o dono e ataca inimigos próximos com o elemento dele', () => {
  const { s, p } = fixture({ color: 0 });
  p.powers.familiar = 1;
  const target = enemy(s, 'brute', 150, 0);
  tick(s, 2);
  assert.ok(target.hp < target.maxHp, 'o familiar causou dano');
  assert.ok(target.slowFor > 0, 'familiar do mago glacial desacelera');
  assert.ok(s.events.some(event => event.kind === 'familiar' && event.points.length === 2));
  assert.ok(Math.hypot(p.familiar.x - p.x, p.familiar.y - p.y) < 200);
  p.x += 2000;
  tick(s, 0.1);
  assert.ok(Math.hypot(p.familiar.x - p.x, p.familiar.y - p.y) < 200, 'teleporta de volta ao dono distante');
});

test('pacto ancestral faz o familiar atingir mais alvos', () => {
  const { s, p } = fixture({ color: 1 });
  p.powers.familiar = 5; p.powers.covenant = 1;
  for (let n = 0; n < 6; n++) enemy(s, 'brute', 100 + n * 20, 30);
  tick(s, 1);
  const hits = s.events.filter(event => event.kind === 'familiar').map(event => event.points.length / 2);
  assert.ok(hits.length && Math.max(...hits) === 5);
});

test('assinaturas: estilhaço, chão em chamas, ricochete e lua crescente', () => {
  const blue = fixture({ color: 0 });
  blue.p.powers.shatter = 1;
  enemy(blue.s, 'mushroom', 200, 0, { hp: 1, slowFor: 1 });
  blue.s.shots.push({ x: 200, y: 0, vx: 0, vy: 0, ttl: 1, damage: 5, color: 0, owner: 'p' });
  updateGame(blue.s, 0.001, still);
  assert.equal(blue.s.shots.filter(shot => shot.shard).length, 4);

  const red = fixture({ color: 1 });
  red.p.powers.burn = 1;
  const burning = enemy(red.s, 'scorpion', 200, 0, { hp: 1000, maxHp: 1000 });
  red.s.shots.push({ x: 200, y: 0, vx: 0, vy: 0, ttl: 1, damage: 5, color: 1, owner: 'p' });
  updateGame(red.s, 0.001, still);
  assert.equal(red.s.zones.length, 1);
  const hp = burning.hp;
  tick(red.s, 0.5);
  assert.ok(burning.hp < hp);

  const green = fixture({ color: 2 });
  green.p.powers.ricochet = 1;
  enemy(green.s, 'scorpion', 200, 0, { hp: 1000, maxHp: 1000 });
  enemy(green.s, 'scorpion', 200, 150, { hp: 1000, maxHp: 1000 });
  const thorn = { x: 200, y: 0, vx: 560, vy: 0, ttl: 1, damage: 5, color: 2, owner: 'p' };
  green.s.shots.push(thorn);
  updateGame(green.s, 0.0001, still);
  assert.ok(thorn.vy > 500);

  const purple = fixture({ color: 3, attack: true });
  purple.p.powers.boomerang = 1;
  enemy(purple.s, 'scorpion', purple.p.x + 250, 0, { hp: 1e6, maxHp: 1e6 });
  updateGame(purple.s, 0.01, still);
  const blade = purple.s.shots[0];
  assert.equal(blade.boomerang, true);
  tick(purple.s, 0.8);
  assert.equal(blade.returning, true);
  assert.ok(blade.vx < 0);
});
