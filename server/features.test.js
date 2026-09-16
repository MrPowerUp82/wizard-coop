import test from 'node:test';
import assert from 'node:assert/strict';
import { activateSpecial, createGameState, createPlayer, difficultyAt, sendSignal, updateGame, publicState } from './game.js';
import { COOP, ENCOUNTERS, SIGNAL, WEAPONS } from './balance.js';
import { CURSES, curseReward, dailyChallenge, sanitizeCurses, seededRandom } from './curses.js';
import { hurt } from './combat.js';
import { ENEMIES, PHASES } from './phases.js';
import { decodeState, encodeState } from './protocol.js';
import { summonBoss } from './bosses.js';

const still = () => 0.9;
const tick = (s, seconds, random = still) => { for (let n = 0; n < Math.round(seconds * 30); n++) updateGame(s, 1 / 30, random); };

function fixture({ color = 0, curses = [], campaign = 'classic', players = 1, meta = null, loadout = null } = {}) {
  const s = createGameState(campaign, { curses });
  for (let n = 0; n < players; n++) {
    const id = n ? `p${n}` : 'p';
    const p = createPlayer(id, id, (color + n) % 4, meta, loadout);
    p.attackCooldown = 1e9;
    p.x = n * 40;
    s.players[id] = p;
  }
  s.spawn = 1e9;
  s.scheduleCursor = 99;
  s.altarSpawned = true;
  s.encounterSpawned = true;
  return { s, p: s.players.p };
}
const enemy = (s, type, x, y = 0, extra = {}) => {
  const e = { id: ++s.nextId, type, x, y, hp: ENEMIES[type].hp, maxHp: ENEMIES[type].hp, age: 0, ...extra };
  s.enemies.push(e);
  return e;
};

test('maldições: só ids válidos, sem repetição, e pagam moedas extras', () => {
  assert.deepEqual(sanitizeCurses(['swarm', 'swarm', 'hack', 3, 'tyrant']), ['swarm', 'tyrant']);
  assert.deepEqual(sanitizeCurses('swarm'), []);
  const { s } = fixture({ curses: ['swarm', 'tyrant'] });
  assert.equal(curseReward(s), 1 + CURSES.swarm.reward + CURSES.tyrant.reward);
});

test('maldições alteram dano recebido, cura, velocidade, ondas, elites e chefes', () => {
  const plain = fixture().p, brittle = fixture({ curses: ['brittle'] });
  plain.hp = brittle.p.hp = 100;
  hurt(plain, 20, null); hurt(brittle.p, 20, brittle.s);
  assert.equal(100 - brittle.p.hp, 25);
  assert.equal(100 - plain.hp, 20);

  const famine = fixture({ curses: ['famine'] });
  famine.p.hp = 10;
  famine.s.gems.push({ id: 1, x: 0, y: 0, type: 'heart', value: 24, ttl: 20 });
  updateGame(famine.s, 1 / 30, still);
  assert.equal(famine.p.hp, 22);

  const base = difficultyAt(120, 1, 2), cursed = difficultyAt(120, 1, 2, { curses: ['frenzy', 'swarm'] });
  assert.ok(cursed.speedScale > base.speedScale);
  assert.ok(cursed.spawnCount > base.spawnCount);

  const tyrant = fixture({ curses: ['tyrant'] }), normal = fixture();
  summonBoss(tyrant.s, [tyrant.p]); summonBoss(normal.s, [normal.p]);
  assert.ok(Math.abs(tyrant.s.enemies[0].maxHp / normal.s.enemies[0].maxHp - 1.4) < 1e-9);

  const nobility = fixture({ curses: ['nobility'] });
  nobility.s.scheduleCursor = 1;
  nobility.s.phaseTime = 90;
  updateGame(nobility.s, 1 / 30, still);
  assert.equal(nobility.s.enemies.filter(e => e.elite).length, 2);
});

test('desafio diário é determinístico por data e sorteia duas maldições diferentes', () => {
  const a = dailyChallenge(new Date('2026-09-16T10:00:00Z')), b = dailyChallenge(new Date('2026-09-16T23:00:00Z'));
  assert.deepEqual(a, b);
  assert.equal(a.curses.length, 2);
  assert.notEqual(a.curses[0], a.curses[1]);
  assert.notDeepEqual(dailyChallenge(new Date('2026-09-17T10:00:00Z')).seed, a.seed);
  const r1 = seededRandom(a.seed), r2 = seededRandom(a.seed);
  assert.deepEqual([r1(), r1(), r1()], [r2(), r2(), r2()]);
});

test('ritual infinito volta ao primeiro reino mais difícil depois do último guardião', () => {
  const { s, p } = fixture({ campaign: 'endless' });
  p.invulnerableFor = 1e9;
  s.phase = PHASES.length - 1;
  summonBoss(s, [p]);
  const firstLapHp = s.enemies[0].maxHp;
  s.enemies[0].hp = 0;
  updateGame(s, 1 / 30, still);
  assert.equal(s.over, false);
  assert.equal(s.phaseStatus, 'transition');
  tick(s, 4.2);
  assert.equal(s.phase, 0);
  assert.equal(s.loop, 1);
  assert.ok(s.events.some(event => event.kind === 'loop'));
  s.phase = PHASES.length - 1;
  summonBoss(s, [p]);
  assert.ok(s.enemies[0].maxHp > firstLapHp);
  assert.ok(difficultyAt(0, 1, 0, s).hpScale > difficultyAt(0, 1, 0).hpScale);
});

test('arsenal e segundo feitiço só valem quando desbloqueados', () => {
  const locked = createPlayer('a', 'A', 0, {}, { weapon: 'chain', special: 1 });
  assert.equal(locked.powers.chain, undefined);
  assert.equal(locked.specialVariant, 0);
  const unlocked = createPlayer('b', 'B', 0, { arsenal: 1, secondSpell: 1 }, { weapon: 'chain', special: 1 });
  assert.equal(unlocked.powers.chain, 1);
  assert.equal(unlocked.specialVariant, 1);
  assert.equal(createPlayer('c', 'C', 0, { arsenal: 1 }, { weapon: 'constellation' }).powers.constellation, undefined);
});

test('especiais alternativos: granizo, égide, florescer e eclipse', () => {
  const alt = { meta: { secondSpell: 1 }, loadout: { special: 1 } };
  const blue = fixture({ color: 0, ...alt });
  blue.p.specialCharge = 100;
  const frozen = enemy(blue.s, 'brute', 100, 0);
  assert.equal(activateSpecial(blue.s, 'p', still), true);
  tick(blue.s, 0.5);
  assert.equal(blue.s.zones[0].kind, 'hail');
  assert.ok(frozen.hp < frozen.maxHp && frozen.slowFor > 0);

  const red = fixture({ color: 1, ...alt });
  red.p.specialCharge = 100;
  activateSpecial(red.s, 'p', still);
  red.s.enemyShots.push({ x: 60, y: 0, vx: 0, vy: 0, sprite: 'bolt', ttl: 4, damage: 5, radius: 12 });
  red.p.x = 40;
  tick(red.s, 0.1);
  assert.equal(red.s.zones[0].kind, 'flameshield');
  assert.equal(red.s.zones[0].x, red.p.x);
  assert.equal(red.s.enemyShots.length, 0);

  const green = fixture({ color: 2, players: 2, ...alt });
  const ally = green.s.players.p1;
  ally.hp = 10;
  green.p.specialCharge = 100;
  activateSpecial(green.s, 'p', still);
  assert.equal(ally.hp, 10 + ally.maxHp * 0.3);
  assert.equal(green.s.shots.length, 16);

  const purple = fixture({ color: 3, ...alt });
  purple.p.specialCharge = 100;
  const pulled = enemy(purple.s, 'brute', 200, 0);
  const far = enemy(purple.s, 'brute', 380, 0);
  activateSpecial(purple.s, 'p', still);
  const vortex = purple.s.zones[0];
  const before = Math.hypot(far.x - vortex.x, far.y - vortex.y);
  tick(purple.s, 0.5);
  assert.ok(Math.hypot(far.x - vortex.x, far.y - vortex.y) < before, 'vórtice puxa');
  tick(purple.s, 2);
  assert.equal(purple.s.zones.length, 0);
  assert.ok(purple.s.events.some(event => event.kind === 'boom' && event.color === 3));
  assert.ok(pulled.hp <= pulled.maxHp - purple.p.damage * 8 || pulled.hp <= 0);
});

test('novas evoluções mudam suas armas', () => {
  const red = fixture({ color: 1 });
  red.p.powers = { burn: 1, hellfire: 1 };
  red.p.attackCooldown = 0;
  enemy(red.s, 'brute', 120, 0);
  tick(red.s, 1);
  assert.ok(red.s.zones.some(zone => zone.radius === WEAPONS.evolutions.hellfire.radius));

  const green = fixture({ color: 2 });
  green.p.powers = { ricochet: 1, bramble: 1 };
  green.p.attackCooldown = 0;
  enemy(green.s, 'brute', 300, 0);
  updateGame(green.s, 1 / 30, still);
  assert.equal(green.s.shots[0].pierce, 3 + WEAPONS.evolutions.bramble.pierce);

  const runes = fixture();
  runes.p.powers = { runes: 3, stormrunes: 1 };
  runes.s.runes.push({ id: 99, x: 200, y: 0, owner: 'p', color: 0, radius: 60, damage: 1, ttl: 5, arm: 0 });
  enemy(runes.s, 'brute', 200, 0);
  enemy(runes.s, 'brute', 320, 0);
  updateGame(runes.s, 1 / 30, still);
  assert.ok(runes.s.events.some(event => event.kind === 'chain' && event.points.length >= 4));

  const solar = fixture();
  solar.p.powers = { orbit: 3, aura: 3, solarcrown: 1 };
  const burning = enemy(solar.s, 'brute', 90, 0, { hp: 1e6, maxHp: 1e6 });
  for (let n = 0; n < 60 && !solar.p.stats.by.orbit; n++) updateGame(solar.s, 1 / 30, still);
  assert.ok(solar.p.stats.by.orbit > 0);
  assert.ok(burning.burningFor > 0, 'coroa solar incendeia');

  const blue = fixture({ color: 0 });
  blue.p.powers = { shatter: 1, avalanche: 1 };
  blue.p.attackCooldown = 0;
  const victim = enemy(blue.s, 'mushroom', 150, 0, { hp: 1, slowFor: 5 });
  for (let n = 0; n < 30 && victim.hp > 0; n++) updateGame(blue.s, 1 / 30, still);
  assert.ok(victim.hp <= 0);
  assert.equal(blue.s.shots.filter(shot => shot.shard).length, WEAPONS.evolutions.avalanche.shards);
});

test('dano é registrado por fonte para o resumo final', () => {
  const { s, p } = fixture();
  p.powers = { aura: 2, familiar: 1 };
  enemy(s, 'brute', 60, 0, { hp: 1e6, maxHp: 1e6 });
  tick(s, 3);
  assert.ok(p.stats.by.aura > 0 && p.stats.by.familiar > 0);
  const total = Object.values(p.stats.by).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(total - p.stats.damage) < 1e-6);
  const live = decodeState(JSON.parse(JSON.stringify(encodeState(s, 'p'))));
  assert.equal(live.players.p.stats.by, undefined, 'fontes só viajam no fim');
  s.over = true;
  const done = decodeState(JSON.parse(JSON.stringify(encodeState(s, 'p'))));
  assert.ok(done.players.p.stats.by.aura > 0);
});

test('mercador troca moedas da partida por um poder', () => {
  const { s, p } = fixture();
  p.coins = ENCOUNTERS.merchant.cost + 5;
  s.encounterSpawned = false;
  s.phaseTime = 184;
  updateGame(s, 1 / 30, () => 0.1); // 0.1 → merchant
  assert.equal(s.encounter.kind, 'merchant');
  p.x = s.encounter.x; p.y = s.encounter.y;
  tick(s, ENCOUNTERS.merchant.seconds + 0.2, () => 0.1);
  assert.equal(p.coins, 5);
  assert.ok(p.pendingPowers?.length || p.pendingChests > 0);
  assert.equal(s.encounter.status, 'complete');
});

test('santuário amaldiçoado dá poder e moedas, mas inimigos ferem mais até o fim do reino', () => {
  const { s, p } = fixture();
  s.encounterSpawned = false;
  s.phaseTime = 184;
  updateGame(s, 1 / 30, () => 0.5); // 0.5 → shrine
  assert.equal(s.encounter.kind, 'shrine');
  p.x = s.encounter.x; p.y = s.encounter.y;
  const coins = p.coins;
  tick(s, ENCOUNTERS.shrine.seconds + 0.2, () => 0.5);
  assert.equal(s.bloodPact, true);
  assert.equal(p.coins, coins + ENCOUNTERS.shrine.coins);
  p.pendingPowers = null; p.invulnerableFor = 0; p.hitCooldown = 0; p.hp = 100;
  hurt(p, 20, s);
  assert.equal(100 - p.hp, 20 * ENCOUNTERS.shrine.enemyDamage);
});

test('ladrão foge com o tesouro: escapa no tempo ou derrama moedas ao morrer', () => {
  const { s, p } = fixture();
  s.encounterSpawned = false;
  s.phaseTime = 184;
  updateGame(s, 1 / 30, () => 0.95); // 0.95 → thief
  assert.equal(s.encounter.kind, 'thief');
  const thief = s.enemies.find(e => e.thief);
  const start = Math.hypot(thief.x - p.x, thief.y - p.y);
  tick(s, 1, () => 0.95);
  assert.ok(Math.hypot(thief.x - p.x, thief.y - p.y) > start, 'foge do jogador');
  thief.hp = 1;
  p.attackCooldown = 0;
  p.x = thief.x - 60; p.y = thief.y;
  for (let n = 0; n < 30 && thief.hp > 0; n++) updateGame(s, 1 / 30, () => 0.95);
  assert.equal(s.encounter.status, 'complete');
  assert.ok(s.events.some(event => event.kind === 'thiefDown'));
  assert.ok(s.gems.filter(gem => gem.type === 'coin').length >= ENCOUNTERS.thief.purses);

  const escape = fixture();
  escape.s.encounterSpawned = false;
  escape.s.phaseTime = 184;
  updateGame(escape.s, 1 / 30, () => 0.95);
  escape.s.encounter.ttl = 0.01;
  tick(escape.s, 0.1, () => 0.95);
  assert.equal(escape.s.encounter.status, 'expired');
  assert.equal(escape.s.enemies.some(e => e.thief), false);
});

test('combo em equipe: status de um jogador finalizado por outro dá mais dano e carga', () => {
  const { s } = fixture({ players: 2, color: 0 });
  const [blue, red] = [s.players.p, s.players.p1];
  red.color = 1;
  const target = enemy(s, 'brute', 300, 0, { hp: 1e6, maxHp: 1e6, slowFor: 2, slowBy: blue.id });
  s.shots.push({ x: 300, y: 0, vx: 1, vy: 0, ttl: 1, color: 1, damage: 10, pierce: 1, hitIds: [], owner: red.id });
  updateGame(s, 1 / 30, still);
  const combo = s.events.find(event => event.kind === 'combo');
  assert.equal(combo.team, 1);
  assert.equal(blue.specialCharge, COOP.teamCombo.charge);
  assert.ok(target.maxHp - target.hp >= red.damage * COOP.teamCombo.damage);
});

test('convergência: dois especiais próximos em sequência explodem entre os jogadores', () => {
  const { s } = fixture({ players: 2 });
  const [a, b] = [s.players.p, s.players.p1];
  const victim = enemy(s, 'brute', 20, 60, { hp: 1e6, maxHp: 1e6 });
  a.specialCharge = b.specialCharge = 100;
  activateSpecial(s, a.id, still);
  s.time += 0.5;
  activateSpecial(s, b.id, still);
  assert.ok(s.events.some(event => event.kind === 'convergence'));
  assert.ok(victim.maxHp - victim.hp >= (a.damage + b.damage) * COOP.convergence.damage);
});

test('vínculo vital cura aliados e guardião acelera o resgate', () => {
  const { s } = fixture({ players: 2 });
  const [healer, ally] = [s.players.p, s.players.p1];
  healer.powers.lifelink = 2;
  ally.hp = 50;
  tick(s, 0.1);
  assert.equal(ally.hp, 50 + 2 * COOP.lifelink.healPerRank);

  const revive = (rank) => {
    const f = fixture({ players: 2 });
    f.s.players.p.powers.guardian = rank;
    const fallen = f.s.players.p1;
    fallen.alive = false; fallen.hp = 0;
    let t = 0;
    while (!fallen.alive && t < 10) { updateGame(f.s, 1 / 30, still); t += 1 / 30; }
    return t;
  };
  assert.ok(revive(2) < revive(0) * 0.6);
});

test('sinalizações têm limite de frequência e alcance', () => {
  const { s } = fixture({ players: 2 });
  assert.equal(sendSignal(s, 'p', 'help'), true);
  assert.equal(sendSignal(s, 'p', 'help'), false, 'cooldown');
  assert.equal(sendSignal(s, 'p1', 'nope'), false, 'tipo inválido');
  assert.equal(sendSignal(s, 'p1', 'look', { x: SIGNAL.range * 2, y: 0 }), false, 'longe demais');
  assert.equal(sendSignal(s, 'p1', 'look', { x: 300, y: 10 }), true);
  const signals = s.events.filter(event => event.kind === 'signal');
  assert.deepEqual(signals.map(event => event.signal), ['help', 'look']);
  assert.equal(signals[1].x, 300);
});

test('snapshot compacto leva maldições, volta, encontro e ladrão', () => {
  const { s } = fixture({ curses: ['swarm'], campaign: 'endless' });
  s.loop = 2;
  s.encounterSpawned = false;
  s.phaseTime = 74;
  updateGame(s, 1 / 30, () => 0.95);
  const decoded = decodeState(JSON.parse(JSON.stringify(encodeState(s, 'p'))));
  const local = publicState(s);
  assert.deepEqual(decoded.curses, ['swarm']);
  assert.equal(decoded.loop, 2);
  assert.equal(decoded.encounter.kind, 'thief');
  assert.equal(decoded.encounter.status, local.encounter.status);
  assert.equal(decoded.enemies.find(e => e.thief)?.thief, true);
});
