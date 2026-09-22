// Exports protocol fixtures for the native C++ client (wizard_coop_cpp): real matches are encoded with
// encodeState() and decoded with decodeState(), so the C++ decoder can be checked field by field.
// Usage: node scripts/export-protocol-fixtures.mjs <out.json>   (npm run fixtures:cpp)
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { activateDash, activateSpecial, applyPower, createGameState, createPlayer, sendSignal, updateGame } from '../server/game.js';
import { DROP_TYPES, ENCOUNTER_KINDS, ENEMY_TYPES, PROTOCOL_VERSION, SPRITES, STATUSES, decodeState, encodeState } from '../server/protocol.js';

const TICK = 1 / 30;

function seeded(seed) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
}

/** Circles around, takes the first power offered, fires specials when charged and dodges now and then. */
function drive(s, random) {
  Object.values(s.players).forEach((p, i) => {
    const a = s.time * 0.7 + i * 1.6;
    p.input = { x: Math.cos(a) * 0.8, y: Math.sin(a) * 0.8 };
    if (p.pendingPowers?.length) applyPower(p, p.pendingPowers[0]);
    if (p.specialCharge >= 100) activateSpecial(s, p.id, random);
    if (random() < 0.01) activateDash(s, p.id, p.input);
  });
}

function play({ players, campaign = 'quick', curses = [], seconds, seed }) {
  const random = seeded(seed);
  const s = createGameState(campaign, { curses });
  for (let i = 0; i < players; i++) {
    const p = createPlayer(`p${i + 1}`, `Arcanista ${i + 1}`, i);
    s.players[p.id] = p;
  }
  for (let t = 0; t < seconds && !s.over; t += TICK) {
    drive(s, random);
    updateGame(s, TICK, random);
  }
  return s;
}

export function buildFixtures() {
  const cases = [];
  const add = (name, s, viewer) => {
    const encoded = JSON.parse(JSON.stringify(encodeState(s, viewer)));
    cases.push({ name, viewer, encoded, decoded: JSON.parse(JSON.stringify(decodeState(encoded))) });
  };
  add('solo-start', play({ players: 1, seconds: 3, seed: 1 }), 'p1');
  add('solo-horde', play({ players: 1, seconds: 90, seed: 2 }), 'p1');
  add('solo-boss', play({ players: 1, seconds: 135, seed: 129 }), 'p1'); // quick hordes last 120 s; seed 129 survives to see the boss
  const coop = play({ players: 4, campaign: 'classic', curses: ['swarm', 'tyrant'], seconds: 100, seed: 4 }); // shorter than seed 4's ~119 s wipe so sendSignal still works
  sendSignal(coop, 'p2', 'help');
  sendSignal(coop, 'p3', 'look', { x: coop.players.p3.x + 200, y: coop.players.p3.y });
  add('coop4-viewer-p1', coop, 'p1');
  add('coop4-viewer-p3', coop, 'p3');
  add('coop4-spectator', coop, 'nobody');
  const over = play({ players: 2, seconds: 20, seed: 5 });
  for (const p of Object.values(over.players)) { p.hp = 0; p.alive = false; p.phoenix = 0; }
  for (let i = 0; i < 10 && !over.over; i++) updateGame(over, TICK);
  add('coop2-over', over, 'p1');
  return {
    version: PROTOCOL_VERSION,
    tables: { enemyTypes: ENEMY_TYPES, dropTypes: DROP_TYPES, sprites: SPRITES, statuses: STATUSES, encounterKinds: ENCOUNTER_KINDS },
    cases
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const out = process.argv[2];
  if (!out) { console.error('uso: node scripts/export-protocol-fixtures.mjs <saida.json>'); process.exit(1); }
  const fixtures = buildFixtures();
  fs.writeFileSync(out, JSON.stringify(fixtures));
  console.log(`${fixtures.cases.length} casos gravados em ${out}`);
}
