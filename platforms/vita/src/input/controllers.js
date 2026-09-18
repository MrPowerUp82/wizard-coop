// @ts-check
import { ACTIONS, JOIN_CHORD, classifyPad, labelsFor, normalizeAnalogAxes, rawButtons } from './mappings.js';

// PS Vita counterpart of src/input.js: implements the exact contract the existing game loop already consumes —
// `read(slot)` returns a normalized movement vector and onSpecial/onDash(slot)/onPause fire on press.
// It decides which physical controller port feeds which local slot; the players, the co-op run and
// the split screen are the shared ones in src/localCoop.js.
//
// Solo: every connected controller drives slot 0 (like the web accepting WASD and arrow keys).
// Co-op: each slot is bound to one physical controller port. A slot whose controller drops is
// reported as missing until that controller — or any free one pressing CROSS / L1+R1 — returns.

const NAV_THRESHOLD = 0.55;
const NAV_DELAY = 0.34, NAV_REPEAT = 0.11;
const DIRECTIONS = ['up', 'down', 'left', 'right'];
const EMPTY = { x: 0, y: 0 };

function padState(port) {
  return {
    port,
    id: `port-${port}`,
    kind: 'vita',
    label: port === 0 ? 'PS Vita' : `Controle ${port}`,
    connected: false,
    raw: 0,
    previous: 0,
    lx: 128,
    ly: 128,
    rx: 128,
    ry: 128,
    move: EMPTY,
    held: '',
    heldFor: 0,
    lastUsed: 0
  };
}

/**
 * @param {{
 *   onSpecial: (slot: number) => void,
 *   onDash: (slot: number) => void,
 *   onPause: (slot: number) => void,
 *   isPlaying: () => boolean,
 *   getPads?: () => any[]
 * }} options
 */
export function createControllers({
  onSpecial,
  onDash,
  onPause,
  isPlaying,
  getPads = () => {
    // Default runtime reader: check global Pads or Vita
    const list = [];
    const globalPads = /** @type {any} */ (globalThis).Pads;
    if (globalPads && typeof globalPads.read === 'function') {
      for (let port = 0; port < 6; port++) {
        try {
          const sample = globalPads.read(port);
          if (sample) list.push(sample);
        } catch { /* disconnected or invalid port */ }
      }
    }
    return list;
  }
}) {
  const pads = Array.from({ length: 6 }, (_, port) => padState(port));
  /** Co-op bindings by slot: controller port (0..5) */
  const bindings = [null, null];
  let coop = false;
  let sharedHandheldMode = false;
  let clock = 0;
  let events = [];
  let changes = [];

  const bound = slot => {
    const port = bindings[slot];
    return port !== null ? pads.find(p => p.connected && p.port === port) || null : null;
  };

  const slotOf = pad => (!coop ? 0 : bindings.findIndex(port => port !== null && port === pad.port));
  const pressed = (pad, action) => (pad.raw & ~pad.previous & (ACTIONS[pad.kind] || ACTIONS.standard)[action]) !== 0;
  const holding = (pad, mask) => mask !== 0 && (pad.raw & mask) === mask;

  function navigation(pad, dt) {
    const map = ACTIONS[pad.kind] || ACTIONS.standard;
    const { x, y } = pad.move;
    let direction = '';
    for (const dir of DIRECTIONS) if (pad.raw & map[dir]) direction = dir;
    if (!direction && Math.max(Math.abs(x), Math.abs(y)) > NAV_THRESHOLD) {
      direction = Math.abs(x) > Math.abs(y) ? (x > 0 ? 'right' : 'left') : (y > 0 ? 'down' : 'up');
    }
    if (direction !== pad.held) { pad.held = direction; pad.heldFor = 0; return direction; }
    if (!direction) return '';
    const before = pad.heldFor;
    pad.heldFor += dt;
    if (before < NAV_DELAY && pad.heldFor >= NAV_DELAY) return direction;
    if (pad.heldFor > NAV_DELAY && Math.floor((pad.heldFor - NAV_DELAY) / NAV_REPEAT) > Math.floor((before - NAV_DELAY) / NAV_REPEAT)) return direction;
    return '';
  }

  function update(pad, sample) {
    const wasConnected = pad.connected;
    pad.previous = pad.raw;
    if (!sample || sample.connected === false) {
      if (wasConnected) changes.push({ type: 'disconnected', pad: { ...pad } });
      Object.assign(pad, { connected: false, raw: 0, previous: 0, move: EMPTY, held: '', heldFor: 0 });
      return;
    }
    const { kind, label } = classifyPad(sample.type || 0, pad.port);
    const lx = typeof sample.lx === 'number' ? sample.lx : 128;
    const ly = typeof sample.ly === 'number' ? sample.ly : 128;
    const rx = typeof sample.rx === 'number' ? sample.rx : 128;
    const ry = typeof sample.ry === 'number' ? sample.ry : 128;

    Object.assign(pad, {
      connected: true,
      kind,
      label: sample.label || label,
      raw: rawButtons(sample),
      lx, ly, rx, ry
    });

    pad.move = normalizeAnalogAxes(lx, ly);
    if (!wasConnected) {
      pad.previous = pad.raw;
      changes.push({ type: 'connected', pad: { ...pad } });
    }
    if (pad.raw || pad.move.x || pad.move.y) pad.lastUsed = clock;
  }

  return {
    pads,
    poll(dt = 1 / 60) {
      clock += dt;
      events = [];
      changes = [];
      const list = getPads() || [];
      for (let port = 0; port < 6; port++) update(pads[port], list[port]);

      for (const change of changes) {
        const slot = bindings.indexOf(change.pad.port);
        if (coop && slot >= 0) {
          events.push({ action: change.type === 'connected' ? 'reconnected' : 'lost', slot, pad: change.pad });
        }
      }

      for (const pad of pads) {
        if (!pad.connected) continue;
        const slot = slotOf(pad);
        const direction = navigation(pad, dt);
        if (direction) events.push({ action: direction, slot, pad });
        for (const action of ['confirm', 'cancel', 'alt', 'pause']) {
          if (pressed(pad, action)) events.push({ action, slot, pad });
        }
        if (holding(pad, JOIN_CHORD) && !holding({ raw: pad.previous }, JOIN_CHORD)) {
          events.push({ action: 'join', slot, pad });
        }
        if (slot < 0 || !isPlaying()) continue;
        if (pressed(pad, 'special')) onSpecial(slot);
        if (pressed(pad, 'dash')) onDash(slot);
        if (pressed(pad, 'pause')) onPause(slot);
      }
    },
    get events() { return events; },
    read(slot = 0) {
      if (sharedHandheldMode && slot === 1 && pads[0].connected) {
        // Player 2 reading from right analog on the same handheld
        return normalizeAnalogAxes(pads[0].rx, pads[0].ry);
      }
      if (coop) return bound(slot)?.move || EMPTY;
      let best = null;
      for (const pad of pads) {
        if (pad.connected && (pad.move.x || pad.move.y) && (!best || pad.lastUsed >= best.lastUsed)) best = pad;
      }
      return best ? best.move : EMPTY;
    },
    reset() {
      for (const pad of pads) {
        pad.previous = pad.raw = pad.connected ? pad.raw : 0;
        pad.held = '';
      }
    },
    get coop() { return coop; },
    setCoop(value) { coop = value; },
    get sharedHandheldMode() { return sharedHandheldMode; },
    setSharedHandheldMode(value) { sharedHandheldMode = value; },
    bindings,
    bind(slot, pad) {
      const port = pad.port;
      const other = bindings.indexOf(port);
      if (other >= 0 && other !== slot) bindings[other] = bindings[slot];
      bindings[slot] = port;
    },
    unbind(slot) { bindings[slot] = null; },
    swap() { bindings.reverse(); },
    autoAssign() {
      // In PS TV or with DS4, controllers on ports 1 and 2 take slots 0 and 1.
      // If port 0 is the only one connected (handheld), it binds to slot 0.
      const free = pads.filter(p => p.connected && !bindings.includes(p.port));
      for (let slot = 0; slot < bindings.length; slot++) {
        if (bindings[slot] !== null && pads.some(p => p.connected && p.port === bindings[slot])) continue;
        const pick = free.shift();
        if (!pick) continue;
        bindings[slot] = pick.port;
      }
    },
    padFor: bound,
    missing(slot) { return coop && !bound(slot); },
    isFree: pad => !bindings.includes(pad.port),
    labels(slot) {
      if (sharedHandheldMode) return labelsFor(slot === 0 ? 'sharedVitaP1' : 'sharedVitaP2');
      const pad = coop ? bound(slot) || pads.find(p => bindings[slot] !== null && p.port === bindings[slot])
        : pads.filter(p => p.connected).sort((a, b) => b.lastUsed - a.lastUsed)[0];
      return labelsFor(pad?.kind);
    },
    get connectedCount() { return pads.filter(p => p.connected).length; }
  };
}
