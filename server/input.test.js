import test from 'node:test';
import assert from 'node:assert/strict';
import { bindActionButton, createInput } from '../src/input.js';

class Control extends EventTarget {
  disabled = false;
  style = {};
  offsetWidth = 40;
  knob = null;
  querySelector() { return this.knob; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 110, height: 110 }; }
  setPointerCapture() {}
}

function fire(target, type, properties = {}) {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, { button: 0, detail: 0, ...properties });
  target.dispatchEvent(event);
  return event;
}

test('segundo dedo usa esquiva e especial sem interromper o joystick', t => {
  const window = new EventTarget();
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'addEventListener');
  globalThis.addEventListener = window.addEventListener.bind(window);
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'addEventListener', descriptor);
    else delete globalThis.addEventListener;
  });
  const joystick = new Control();
  joystick.knob = new Control();
  const input = createInput({ joystick, isPlaying: () => true, onPause() {}, onSpecial() {}, onDash() {} });
  fire(joystick, 'pointerdown', { pointerId: 1, clientX: 95, clientY: 55 });
  assert.deepEqual(input.read(), { x: 1, y: 0 });
  for (const name of ['esquiva', 'especial']) {
    const button = new Control();
    let count = 0;
    bindActionButton(button, () => {
      count++;
      assert.deepEqual(input.read(), { x: 1, y: 0 }, name);
    });
    const press = fire(button, 'pointerdown', { pointerId: 2, pointerType: 'touch', isPrimary: false });
    assert.equal(press.defaultPrevented, true);
    assert.equal(count, 1);
    fire(button, 'pointerup', { pointerId: 2 });
    fire(button, 'click', { detail: 1 });
    assert.equal(count, 1, 'clique sintetizado não repete a ação');
    assert.deepEqual(input.read(), { x: 1, y: 0 });
  }
  fire(joystick, 'pointermove', { pointerId: 1, clientX: 55, clientY: 95 });
  assert.deepEqual(input.read(), { x: 0, y: 1 });
  fire(joystick, 'pointercancel', { pointerId: 1 });
  assert.deepEqual(input.read(), { x: 0, y: 0 });
});

test('ações preservam teclado e mouse e respeitam botão desabilitado', () => {
  const button = new Control();
  let count = 0;
  bindActionButton(button, () => count++);
  fire(button, 'click');
  assert.equal(count, 1);
  fire(button, 'pointerdown', { pointerType: 'mouse' });
  fire(button, 'click', { detail: 1 });
  assert.equal(count, 2);
  fire(button, 'pointerdown', { button: 2 });
  assert.equal(count, 2);
  button.disabled = true;
  fire(button, 'pointerdown', { pointerType: 'touch' });
  fire(button, 'click');
  assert.equal(count, 2);
});
