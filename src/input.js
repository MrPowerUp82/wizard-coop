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

// Keyboard and virtual joystick merged into one normalized movement vector.
export function createInput({ joystick, onPause, onSpecial, onDash, isPlaying }) {
  const knob = joystick.querySelector('i');
  const keys = new Set();
  let touch = null;
  let activePointer = null;

  addEventListener('keydown', event => {
    if (event.target instanceof HTMLInputElement) return;
    const key = event.key.toLowerCase();
    if (isPlaying() && ['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(key)) event.preventDefault();
    if (key === 'escape' && !event.repeat) onPause();
    if (key === ' ' && !event.repeat) onSpecial();
    if (key === 'shift' && !event.repeat) { event.preventDefault(); onDash?.(); }
    keys.add(key);
  });
  addEventListener('keyup', event => keys.delete(event.key.toLowerCase()));

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

  return {
    read() {
      const x = (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0);
      const y = (keys.has('s') || keys.has('arrowdown') ? 1 : 0) - (keys.has('w') || keys.has('arrowup') ? 1 : 0);
      if (x || y) { const length = Math.hypot(x, y); return { x: x / length, y: y / length }; }
      return touch ? { ...touch } : { x: 0, y: 0 };
    },
    reset() { keys.clear(); release(); }
  };
}
