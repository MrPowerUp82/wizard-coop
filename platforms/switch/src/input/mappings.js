// @ts-check
import { HidDeviceTypeBits, HidNpadButton, HidNpadStyleTag } from '@nx.js/constants';

// Every Switch controller detail lives here: how a pad is classified, how its physical axes become
// the game's movement vector, and which physical buttons trigger each game action. Nothing outside
// platforms/switch/src/input knows about Joy-Cons.
//
// Buttons are read from `Gamepad.rawButtons` (libnx HidNpadButton bitmask), not from the Web-style
// `Gamepad.buttons[]`: nx.js only exposes 16 standard buttons there, and SL/SR — the shoulder
// buttons of a sideways Joy-Con — exist only in the raw bitmask.

/** Pads are classified from `Gamepad.styleSet` (HidNpadStyleTag bits). Order matters. */
export const KINDS = [
  { kind: 'pro', style: HidNpadStyleTag.FullKey, label: 'Pro Controller' },
  { kind: 'handheld', style: HidNpadStyleTag.Handheld, label: 'Portátil (Joy-Cons acoplados)' },
  { kind: 'joyDual', style: HidNpadStyleTag.JoyDual, label: 'Par de Joy-Cons (L+R juntos)' },
  { kind: 'joyLeft', style: HidNpadStyleTag.JoyLeft, label: 'Joy-Con L (horizontal)' },
  { kind: 'joyRight', style: HidNpadStyleTag.JoyRight, label: 'Joy-Con R (horizontal)' },
  { kind: 'gamecube', style: HidNpadStyleTag.Gc, label: 'Controle GameCube' }
];

export function classifyPad(pad) {
  const style = pad.styleSet | 0;
  const match = KINDS.find(entry => style & entry.style);
  if (match) return match;
  // Some firmwares report the style late; the device type still tells a detached Joy-Con apart.
  const device = pad.deviceType | 0;
  if (device & HidDeviceTypeBits.JoyLeft) return KINDS[3];
  if (device & HidDeviceTypeBits.JoyRight) return KINDS[4];
  return { kind: 'standard', style: 0, label: 'Controle' };
}

/**
 * How a single Joy-Con's stick reaches us when held sideways.
 * - 'device': raw stick in the Joy-Con's own (vertical) frame — rotated here in software.
 * - 'system': already rotated by the HID service (NpadJoyHoldType Horizontal) — used as is.
 * nx.js 1.0.0-beta.6 never sets the hold type, so libnx keeps its default and the raw frame is
 * expected. HARDWARE VALIDATION REQUIRED: see platforms/switch/README.md, "Validação em hardware".
 */
export const JOYCON_STICK_FRAME = 'device';

export const STICK_DEADZONE = 0.2;

function deadzone(x, y) {
  const length = Math.hypot(x, y);
  if (length < STICK_DEADZONE) return { x: 0, y: 0 };
  // Rescale so the edge of the deadzone is 0 and full tilt is 1, keeping the direction.
  const scale = Math.min(1, (length - STICK_DEADZONE) / (1 - STICK_DEADZONE)) / length;
  return { x: x * scale, y: y * scale };
}

// nx.js axes: [leftX, leftY, rightX, rightY], each -1..1, Y positive = down (Web Gamepad convention).

/** Pro Controller, handheld, Joy-Con pair, GameCube: left stick as is. */
export function normalizeStandardAxes(axes) {
  return deadzone(axes[0] || 0, axes[1] || 0);
}

/**
 * Joy-Con L held sideways: the rail (SL/SR) faces up and the stick sits under the left thumb, i.e. the
 * controller is turned 90° counter-clockwise. Pushing the stick toward the player's right is the
 * device's "down"; toward the player's top is the device's "right".
 */
export function normalizeJoyConLeftAxes(axes, frame = JOYCON_STICK_FRAME) {
  const x = axes[0] || 0, y = axes[1] || 0;
  return frame === 'system' ? deadzone(x, y) : deadzone(y, -x);
}

/**
 * Joy-Con R held sideways: turned 90° clockwise, stick under the left thumb. Its stick is the "right"
 * stick (axes 2 and 3). The player's right is the device's "up"; the player's bottom is the device's "right".
 */
export function normalizeJoyConRightAxes(axes, frame = JOYCON_STICK_FRAME) {
  const x = axes[2] || 0, y = axes[3] || 0;
  return frame === 'system' ? deadzone(x, y) : deadzone(-y, x);
}

export function normalizeAxes(kind, axes) {
  if (kind === 'joyLeft') return normalizeJoyConLeftAxes(axes);
  if (kind === 'joyRight') return normalizeJoyConRightAxes(axes);
  return normalizeStandardAxes(axes);
}

const B = HidNpadButton;

// Face buttons of a sideways Joy-Con by their position as the player sees them (device frame):
// Joy-Con L turned counter-clockwise — D-pad Down is on the right, Left at the bottom.
// Joy-Con R turned clockwise — X is on the right, A at the bottom.
const JOYCON_FACES = {
  joyLeft: { east: B.Down, south: B.Left, west: B.Up, north: B.Right },
  joyRight: { east: B.X, south: B.A, west: B.B, north: B.Y }
};

/**
 * Game actions, identical for every controller kind (labels differ):
 * - special: the character's special spell (keyboard Space)
 * - dash: dodge (keyboard Shift)
 * - pause: pause menu (keyboard Esc)
 * - confirm / cancel / alt: menus; alt rerolls power choices (keyboard R)
 * - up/down/left/right: menu navigation besides the stick
 */
const STANDARD = {
  special: B.A | B.R | B.ZR, dash: B.B | B.L | B.ZL, pause: B.Plus | B.Minus,
  confirm: B.A, cancel: B.B, alt: B.Y | B.X,
  up: B.Up, down: B.Down, left: B.Left, right: B.Right
};

export const ACTIONS = {
  standard: STANDARD, pro: STANDARD, handheld: STANDARD, joyDual: STANDARD, gamecube: STANDARD,
  joyLeft: {
    special: B.LeftSL | JOYCON_FACES.joyLeft.east, dash: B.LeftSR | JOYCON_FACES.joyLeft.south, pause: B.Minus,
    confirm: JOYCON_FACES.joyLeft.east, cancel: JOYCON_FACES.joyLeft.south, alt: JOYCON_FACES.joyLeft.north | JOYCON_FACES.joyLeft.west,
    up: 0, down: 0, left: 0, right: 0
  },
  joyRight: {
    special: B.RightSL | JOYCON_FACES.joyRight.east, dash: B.RightSR | JOYCON_FACES.joyRight.south, pause: B.Plus,
    confirm: JOYCON_FACES.joyRight.east, cancel: JOYCON_FACES.joyRight.south, alt: JOYCON_FACES.joyRight.north | JOYCON_FACES.joyRight.west,
    up: 0, down: 0, left: 0, right: 0
  }
};

/** SL+SR together: the Switch's own gesture for "this sideways Joy-Con is a player". */
export const JOIN_CHORD = { joyLeft: B.LeftSL | B.LeftSR, joyRight: B.RightSL | B.RightSR };

/** Button names shown in the split-screen panels and menus, per controller kind. */
export const LABELS = {
  standard: { special: 'A', dash: 'B', confirm: 'A', cancel: 'B', alt: 'Y', pause: '+' },
  // Sideways, the arrow printed on each D-pad button points the way the player sees it turned.
  joyLeft: { special: 'SL', dash: 'SR', confirm: '▶', cancel: '▼', alt: '▲', pause: '−' },
  joyRight: { special: 'SL', dash: 'SR', confirm: 'X', cancel: 'A', alt: 'Y', pause: '+' }
};
export const labelsFor = kind => LABELS[kind] || LABELS.standard;

/** Converts the BigInt bitmask to a Number: every mask used here fits in 31 bits. */
export const rawButtons = pad => Number(BigInt.asUintN(32, BigInt(pad.rawButtons ?? 0)) & 0x7fffffffn);

/** Co-op default: Joy-Con L is player 1 and Joy-Con R player 2 when both are held sideways. */
export const COOP_PREFERENCE = ['joyLeft', 'joyRight'];
