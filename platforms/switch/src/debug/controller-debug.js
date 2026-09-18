// @ts-check
import { Button, HidDeviceTypeBits, HidNpadButton, HidNpadStyleTag } from '@nx.js/constants';

// CONTROLLER DEBUG (debug builds only: `npm run switch:build:debug` or DEBUG_CONTROLLERS=true).
// Shows, live, exactly what nx.js reports for every controller slot — styleSet, deviceType, raw axes,
// Web-style buttons, the raw HID bitmask including SL/SR — next to the normalized moveX/moveY the
// game receives. It exists to validate on real hardware how sideways Joy-Cons are reported.

const RAW_BUTTONS = ['A', 'B', 'X', 'Y', 'L', 'R', 'ZL', 'ZR', 'Plus', 'Minus', 'StickL', 'StickR', 'Up', 'Down', 'Left', 'Right',
  'LeftSL', 'LeftSR', 'RightSL', 'RightSR'];

const bitNames = (Enum, value) => Object.entries(Enum)
  .filter(([name, bit]) => typeof bit === 'number' && bit > 0 && Number.isNaN(Number(name)) && (value & bit) === bit && (bit & (bit - 1)) === 0)
  .map(([name]) => name).join('|') || '—';
const fixed = value => (value >= 0 ? ' ' : '') + value.toFixed(2);

export function drawControllerDebug(ctx, controllers, W, H) {
  const gamepads = navigator.getGamepads();
  const rows = controllers.pads.filter(pad => pad.connected);
  const width = 430, x = W - width - 8;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = 'rgba(0, 0, 0, .78)';
  ctx.fillRect(x, 8, width, Math.min(H - 16, 34 + rows.length * 176));
  ctx.font = '600 13px system-ui';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  let y = 14;
  const line = (value, color = '#e6f5ef') => { ctx.fillStyle = color; ctx.fillText(value, x + 10, y, width - 20); y += 16; };
  line(`CONTROLLER DEBUG · ${rows.length} conectado(s) · modo ${controllers.coop ? 'co-op' : 'solo'}`, '#ffd36b');
  if (!rows.length) line('Nenhum controle conectado', '#819796');
  for (const pad of rows) {
    const gamepad = gamepads[pad.index];
    const slot = controllers.coop ? controllers.bindings.indexOf(pad.id) : 0;
    y += 4;
    line(`Controller ${pad.index} · ${pad.label}${slot >= 0 ? ` · Jogador ${slot + 1}` : ' · sem jogador'}`, '#83e1c4');
    line(`id: ${pad.id}`);
    line(`style: ${pad.styleSet} (${bitNames(HidNpadStyleTag, pad.styleSet)})  type: ${pad.deviceType} (${bitNames(HidDeviceTypeBits, pad.deviceType)})`);
    line(`connected: ${pad.connected}  rawButtons: 0x${BigInt(pad.rawBig).toString(16)}`);
    line(`axes 0:${fixed(pad.axes[0])} 1:${fixed(pad.axes[1])} 2:${fixed(pad.axes[2])} 3:${fixed(pad.axes[3])}`);
    line(`moveX:${fixed(pad.move.x)}  moveY:${fixed(pad.move.y)}  (normalizado)`, '#ffd36b');
    const raw = RAW_BUTTONS.filter(name => pad.raw & HidNpadButton[name]);
    line(`raw: ${raw.join(' ') || '—'}`);
    const standard = gamepad ? gamepad.buttons.map((b, i) => (b.pressed ? Button[i] : '')).filter(Boolean) : [];
    line(`buttons[]: ${standard.join(' ') || '—'}`);
    line(`SL: ${(pad.raw & HidNpadButton.AnySL) ? '●' : '○'}  SR: ${(pad.raw & HidNpadButton.AnySR) ? '●' : '○'}  Plus: ${(pad.raw & HidNpadButton.Plus) ? '●' : '○'}  Minus: ${(pad.raw & HidNpadButton.Minus) ? '●' : '○'}`);
  }
  ctx.textBaseline = 'alphabetic';
}
