// Pointer actions also accept secondary fingers while the joystick is held.
export function bindActionButton(button, action) {
  button.addEventListener('pointerdown', event => {
    if (event.button !== 0 || button.disabled) return;
    event.preventDefault();
    action();
  });
  button.addEventListener('click', event => {
    // Pointer input already fired on press; keep keyboard/assistive activation.
    if (event.detail === 0 && !button.disabled) action();
  });
}

// Movement keys per local player. Solo play accepts both sets; split screen gives each player their own.
const MOVE_KEYS = [
  { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD' },
  { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' }
];

// Keyboard and virtual joystick merged into one normalized movement vector per local player.
// onSpecial/onDash receive the player slot (0 or 1) that pressed the key.
export function createInput({ joystick, onPause, onSpecial, onDash, isPlaying, isSplit = () => false }) {
  const knob = joystick.querySelector('i');
  const keys = new Set();
  let touch = null;
  let activePointer = null;

  addEventListener('keydown', event => {
    if (event.target instanceof HTMLInputElement) return;
    const key = event.key.toLowerCase();
    const split = isSplit();
    if (isPlaying() && (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(key) || (split && key === 'enter'))) event.preventDefault();
    if (key === 'escape' && !event.repeat) onPause();
    if (key === ' ' && !event.repeat) onSpecial(0);
    if (split && key === 'enter' && !event.repeat) onSpecial(1);
    if (key === 'shift' && !event.repeat) { event.preventDefault(); onDash?.(split && event.code === 'ShiftRight' ? 1 : 0); }
    keys.add(event.code || key);
  });
  addEventListener('keyup', event => keys.delete(event.code || event.key.toLowerCase()));

  function touchMove(event) {
    if (!touch || event.pointerId !== activePointer) return;
    const rect = joystick.getBoundingClientRect();
    const dx = event.clientX - (rect.left + rect.width / 2), dy = event.clientY - (rect.top + rect.height / 2);
    const length = Math.hypot(dx, dy), movement = Math.min((rect.width - knob.offsetWidth) / 2, length);
    const x = length ? dx / length : 0, y = length ? dy / length : 0;
    knob.style.transform = `translate(${x * movement}px,${y * movement}px)`;
    // A small dead zone keeps a resting thumb from drifting the character.
    touch = length < 8 ? { x: 0, y: 0 } : { x, y };
  }
  joystick.addEventListener('pointerdown', event => {
    if (activePointer !== null || !isPlaying()) return;
    activePointer = event.pointerId;
    touch = { x: 0, y: 0 };
    joystick.setPointerCapture(event.pointerId);
    touchMove(event);
  });
  joystick.addEventListener('pointermove', touchMove);
  const release = () => { activePointer = null; touch = null; knob.style.transform = ''; };
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    joystick.addEventListener(type, event => { if (event.pointerId === activePointer) release(); });
  }
  // Rotation or a backgrounded app must never leave movement held down.
  addEventListener('resize', release);
  addEventListener('blur', () => { keys.clear(); release(); });

  function axes(slot) {
    const k = MOVE_KEYS[slot];
    return [(keys.has(k.right) ? 1 : 0) - (keys.has(k.left) ? 1 : 0), (keys.has(k.down) ? 1 : 0) - (keys.has(k.up) ? 1 : 0)];
  }

  return {
    read(slot = 0) {
      let [x, y] = axes(slot);
      if (slot === 0 && !isSplit() && !x && !y) [x, y] = axes(1);
      if (x || y) { const length = Math.hypot(x, y); return { x: x / length, y: y / length }; }
      return slot === 0 && touch ? { ...touch } : { x: 0, y: 0 };
    },
    reset() { keys.clear(); release(); }
  };
}
