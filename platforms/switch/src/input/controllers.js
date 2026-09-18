// @ts-check
import { ACTIONS, COOP_PREFERENCE, JOIN_CHORD, classifyPad, labelsFor, normalizeAxes, rawButtons } from './mappings.js';

// Switch counterpart of src/input.js: the same contract the existing game loop already consumes —
// `read(slot)` returns a normalized movement vector and onSpecial/onDash(slot)/onPause fire on press.
// It only decides which physical controller feeds which local slot; the players, the co-op run and
// the split screen are the shared ones in src/localCoop.js.
//
// Solo: every connected controller drives slot 0 (like the web accepting WASD and the arrows).
// Co-op: each slot is bound to one physical controller by `Gamepad.id` (name + serial on firmware
// 5.0.0+, so the same Joy-Con is recognised when it reconnects). A slot whose controller drops is
// reported as missing until that controller — or any free one pressing SL+SR / confirm — returns.

const NAV_THRESHOLD = 0.6;
const NAV_DELAY = 0.34, NAV_REPEAT = 0.11;
const DIRECTIONS = ['up', 'down', 'left', 'right'];
const EMPTY = { x: 0, y: 0 };

function padState(index) {
  return { index, id: '', kind: 'standard', label: '', connected: false, raw: 0, previous: 0, axes: [0, 0, 0, 0],
    move: EMPTY, styleSet: 0, deviceType: 0, rawBig: 0n, held: '', heldFor: 0, lastUsed: 0 };
}

/**
 * @param {{ onSpecial: (slot: number) => void, onDash: (slot: number) => void, onPause: (slot: number) => void,
 *   isPlaying: () => boolean, getGamepads?: () => any[] }} options
 */
export function createControllers({ onSpecial, onDash, onPause, isPlaying, getGamepads = () => navigator.getGamepads() }) {
  const pads = Array.from({ length: 8 }, (_, index) => padState(index));
  /** Co-op bindings by slot: the Gamepad.id of the controller that plays that slot. */
  const bindings = [null, null];
  let coop = false;
  let clock = 0;
  let events = [];
  let changes = [];

  const bound = slot => pads.find(p => p.connected && bindings[slot] && p.id === bindings[slot]) || null;
  const slotOf = pad => (!coop ? 0 : bindings.findIndex(id => id && id === pad.id));
  const pressed = (pad, action) => (pad.raw & ~pad.previous & (ACTIONS[pad.kind] || ACTIONS.standard)[action]) !== 0;
  const holding = (pad, mask) => mask !== 0 && (pad.raw & mask) === mask;

  function navigation(pad, dt) {
    // Stick or D-pad directions, with keyboard-like auto repeat, for menus.
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

  function update(pad, gamepad) {
    const wasConnected = pad.connected;
    pad.previous = pad.raw;
    if (!gamepad || !gamepad.connected) {
      if (wasConnected) changes.push({ type: 'disconnected', pad: { ...pad } });
      Object.assign(pad, { connected: false, raw: 0, previous: 0, move: EMPTY, held: '', heldFor: 0 });
      return;
    }
    const { kind, label } = classifyPad(gamepad);
    Object.assign(pad, { connected: true, id: String(gamepad.id), kind, label, styleSet: gamepad.styleSet | 0,
      deviceType: gamepad.deviceType | 0, rawBig: gamepad.rawButtons ?? 0n, raw: rawButtons(gamepad), axes: [...gamepad.axes] });
    pad.move = normalizeAxes(kind, pad.axes);
    if (!wasConnected) { pad.previous = pad.raw; changes.push({ type: 'connected', pad: { ...pad } }); }
    if (pad.raw || pad.move.x || pad.move.y) pad.lastUsed = clock;
  }

  return {
    pads,
    /** Reads every controller once per frame and fires gameplay callbacks. */
    poll(dt = 1 / 60) {
      clock += dt;
      events = [];
      changes = [];
      const list = getGamepads() || [];
      for (let i = 0; i < 8; i++) update(pads[i], list[i]);
      // A returning controller takes its slot back; nothing about the player changes.
      for (const change of changes) {
        const slot = bindings.indexOf(change.pad.id);
        if (coop && slot >= 0) events.push({ action: change.type === 'connected' ? 'reconnected' : 'lost', slot, pad: change.pad });
      }
      for (const pad of pads) {
        if (!pad.connected) continue;
        const slot = slotOf(pad);
        const direction = navigation(pad, dt);
        if (direction) events.push({ action: direction, slot, pad });
        for (const action of ['confirm', 'cancel', 'alt', 'pause']) if (pressed(pad, action)) events.push({ action, slot, pad });
        const chord = JOIN_CHORD[pad.kind];
        if (chord && holding(pad, chord) && !holding({ raw: pad.previous }, chord)) events.push({ action: 'join', slot, pad });
        if (slot < 0 || !isPlaying()) continue;
        if (pressed(pad, 'special')) onSpecial(slot);
        if (pressed(pad, 'dash')) onDash(slot);
        if (pressed(pad, 'pause')) onPause(slot);
      }
    },
    /** Menu-facing presses of this frame: { action, slot, pad }. */
    get events() { return events; },
    /** Normalized movement for a local slot (the same contract as the web input's read(slot)). */
    read(slot = 0) {
      if (coop) return bound(slot)?.move || EMPTY;
      // Solo accepts any controller; the most recently used one wins when several are held.
      let best = null;
      for (const pad of pads) if (pad.connected && (pad.move.x || pad.move.y) && (!best || pad.lastUsed >= best.lastUsed)) best = pad;
      return best ? best.move : EMPTY;
    },
    /** Forget held buttons so nothing held across a menu or pause fires again. */
    reset() { for (const pad of pads) { pad.previous = pad.raw = pad.connected ? pad.raw : 0; pad.held = ''; } },
    get coop() { return coop; },
    /** Solo (false) or co-op slot bindings (true). Co-op bindings survive until changed. */
    setCoop(value) { coop = value; },
    bindings,
    bind(slot, pad) {
      const other = bindings.indexOf(pad.id);
      if (other >= 0 && other !== slot) bindings[other] = bindings[slot];
      bindings[slot] = pad.id;
    },
    unbind(slot) { bindings[slot] = null; },
    swap() { bindings.reverse(); },
    /** Fills empty co-op slots: Joy-Con L → slot 0 and Joy-Con R → slot 1 when present, then by console order. */
    autoAssign() {
      const free = pads.filter(p => p.connected && !bindings.includes(p.id));
      for (let slot = 0; slot < bindings.length; slot++) {
        if (bindings[slot] && pads.some(p => p.connected && p.id === bindings[slot])) continue;
        // Never take the controller the other slot prefers when something else is available.
        const other = COOP_PREFERENCE[1 - slot];
        const pick = free.find(p => p.kind === COOP_PREFERENCE[slot]) || free.find(p => p.kind !== other) || free[0];
        if (!pick) continue;
        bindings[slot] = pick.id;
        free.splice(free.indexOf(pick), 1);
      }
    },
    /** The controller currently playing a slot (null while it is disconnected or unassigned). */
    padFor: bound,
    missing(slot) { return coop && !bound(slot); },
    /** A connected controller that no slot uses, e.g. to claim a slot whose controller dropped. */
    isFree: pad => !bindings.includes(pad.id),
    /** Button captions for the split HUD panel of a slot (a dropped controller keeps its captions). */
    labels(slot) {
      const pad = coop ? bound(slot) || pads.find(p => bindings[slot] && p.id === bindings[slot])
        : pads.filter(p => p.connected).sort((a, b) => b.lastUsed - a.lastUsed)[0];
      return labelsFor(pad?.kind);
    },
    get connectedCount() { return pads.filter(p => p.connected).length; }
  };
}
