// @ts-check

// Every PS Vita controller detail lives here: official SceCtrl constants from the VitaSDK (<psp2/ctrl.h>),
// analog normalization from 0..255 (neutral 128) to -1..1 with deadzone, and button actions.
// Nothing outside platforms/vita/src/input knows about Vita hardware internals.

/** Official SceCtrl button bitmasks from VitaSDK <psp2/ctrl.h>. */
export const SceCtrlButton = Object.freeze({
  SELECT: 0x00000001,
  START: 0x00000008,
  UP: 0x00000010,
  RIGHT: 0x00000020,
  DOWN: 0x00000040,
  LEFT: 0x00000080,
  L1: 0x00000100,
  R1: 0x00000200,
  L2: 0x00000400,
  R2: 0x00000800,
  TRIANGLE: 0x00001000,
  CIRCLE: 0x00002000,
  CROSS: 0x00004000,
  SQUARE: 0x00008000,
  L3: 0x00020000,
  R3: 0x00040000
});

/** Controller types reported by SceCtrlPadInfo / SceCtrl. */
export const SceCtrlType = Object.freeze({
  UNPAIRED: 0,
  PHY: 1,  // PS Vita physical handheld controls
  VIRT: 2, // PSTV virtual controller
  DS3: 4,  // DualShock 3
  DS4: 8   // DualShock 4
});

const B = SceCtrlButton;

export const KINDS = [
  { kind: 'ds4', type: SceCtrlType.DS4, label: 'DualShock 4' },
  { kind: 'ds3', type: SceCtrlType.DS3, label: 'DualShock 3' },
  { kind: 'vita', type: SceCtrlType.PHY, label: 'PS Vita (Portátil)' },
  { kind: 'pstv', type: SceCtrlType.VIRT, label: 'PlayStation TV' }
];

export function classifyPad(type, port = 0) {
  const match = KINDS.find(entry => entry.type === type);
  if (match) return match;
  if (port === 0) return { kind: 'vita', type: SceCtrlType.PHY, label: 'PS Vita' };
  return { kind: 'standard', type: 0, label: `Controle ${port}` };
}

export const STICK_DEADZONE = 0.18;

/**
 * Normalizes raw PS Vita analog stick axes (0..255, neutral 128) to the -1..1 range
 * with radial deadzone and smooth rescaling.
 * @param {number} rawX 0..255 (neutral 128)
 * @param {number} rawY 0..255 (neutral 128)
 */
export function normalizeAnalogAxes(rawX, rawY) {
  // Center is 128. Clamped to -1..1
  const nx = Math.max(-1, Math.min(1, (rawX - 128) / 128));
  const ny = Math.max(-1, Math.min(1, (rawY - 128) / 128));

  const length = Math.hypot(nx, ny);
  if (length < STICK_DEADZONE) return { x: 0, y: 0 };

  const scale = Math.min(1, (length - STICK_DEADZONE) / (1 - STICK_DEADZONE)) / length;
  return { x: nx * scale, y: ny * scale };
}

/**
 * Standard Vita/DualShock button mappings:
 * - special: CROSS or R1 (keyboard Space)
 * - dash: CIRCLE or L1 (keyboard Shift)
 * - pause: START (keyboard Esc)
 * - confirm / cancel / alt: menus; alt rerolls power choices (keyboard R)
 * - up/down/left/right: D-pad
 */
const STANDARD_ACTIONS = {
  special: B.CROSS | B.R1 | B.R2,
  dash: B.CIRCLE | B.L1 | B.L2,
  pause: B.START,
  confirm: B.CROSS,
  cancel: B.CIRCLE,
  alt: B.SQUARE | B.TRIANGLE,
  up: B.UP,
  down: B.DOWN,
  left: B.LEFT,
  right: B.RIGHT
};

/** Optional handheld shared-console mode (2 players on 1 physical Vita). */
const SHARED_VITA_P1 = {
  special: B.L1,
  dash: B.LEFT | B.UP,
  pause: B.START,
  confirm: B.DOWN,
  cancel: B.LEFT,
  alt: B.UP,
  up: B.UP,
  down: B.DOWN,
  left: B.LEFT,
  right: B.RIGHT
};

const SHARED_VITA_P2 = {
  special: B.CROSS | B.R1,
  dash: B.CIRCLE,
  pause: B.START,
  confirm: B.CROSS,
  cancel: B.CIRCLE,
  alt: B.TRIANGLE | B.SQUARE,
  up: B.TRIANGLE,
  down: B.CROSS,
  left: B.SQUARE,
  right: B.CIRCLE
};

export const ACTIONS = {
  standard: STANDARD_ACTIONS,
  vita: STANDARD_ACTIONS,
  ds4: STANDARD_ACTIONS,
  ds3: STANDARD_ACTIONS,
  pstv: STANDARD_ACTIONS,
  sharedVitaP1: SHARED_VITA_P1,
  sharedVitaP2: SHARED_VITA_P2
};

/** L1+R1 or CROSS: button gesture to join co-op lobby as a ready controller. */
export const JOIN_CHORD = B.L1 | B.R1 | B.CROSS;

/** Button labels for HUD and split panels. */
export const LABELS = {
  standard: { special: '✕ / R', dash: '◯ / L', confirm: '✕', cancel: '◯', alt: '▢', pause: 'START' },
  vita: { special: '✕ / R', dash: '◯ / L', confirm: '✕', cancel: '◯', alt: '▢', pause: 'START' },
  sharedVitaP1: { special: 'L', dash: '◀', confirm: '▼', cancel: '◀', alt: '▲', pause: 'START' },
  sharedVitaP2: { special: '✕', dash: '◯', confirm: '✕', cancel: '◯', alt: '△', pause: 'START' }
};

export const labelsFor = kind => LABELS[kind] || LABELS.standard;

/** Bitmask extraction guaranteed to stay within 32-bit integer. */
export const rawButtons = pad => Number(BigInt.asUintN(32, BigInt(pad.buttons ?? pad.btns ?? 0)) & 0x7fffffffn);
