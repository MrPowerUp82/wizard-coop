// @ts-check
import { SceCtrlButton } from '../input/mappings.js';

// Visual overlay showing raw Vita/SceCtrl pad state and normalized axes for debugging.

const BUTTON_NAMES = [
  ['✕', SceCtrlButton.CROSS],
  ['◯', SceCtrlButton.CIRCLE],
  ['▢', SceCtrlButton.SQUARE],
  ['△', SceCtrlButton.TRIANGLE],
  ['L1', SceCtrlButton.L1],
  ['R1', SceCtrlButton.R1],
  ['L2', SceCtrlButton.L2],
  ['R2', SceCtrlButton.R2],
  ['START', SceCtrlButton.START],
  ['SELECT', SceCtrlButton.SELECT],
  ['▲', SceCtrlButton.UP],
  ['▼', SceCtrlButton.DOWN],
  ['◀', SceCtrlButton.LEFT],
  ['▶', SceCtrlButton.RIGHT]
];

export function drawControllerDebug(ctx, pads, W, _H) {
  const list = Array.isArray(pads) ? pads : (pads?.pads || []);
  const connected = list.filter(p => p.connected);
  if (!connected.length) return;

  const width = 280;
  const startX = W - width - 10;
  let startY = 10;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;

  for (const pad of connected) {
    const pressed = BUTTON_NAMES.filter(([, mask]) => (pad.raw & Number(mask)) !== 0).map(([name]) => name).join(' ');
    const lines = [
      `Porta ${pad.port} · ${pad.label}`,
      `LX: ${pad.lx} LY: ${pad.ly} | RX: ${pad.rx} RY: ${pad.ry}`,
      `Move: (${pad.move.x.toFixed(2)}, ${pad.move.y.toFixed(2)})`,
      `Botões: ${pressed || '—'}`
    ];

    const boxH = lines.length * 15 + 8;
    ctx.fillStyle = 'rgba(0, 0, 0, .75)';
    ctx.fillRect(startX, startY, width, boxH);
    ctx.font = '600 11px system-ui';
    ctx.fillStyle = '#ffd36b';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    lines.forEach((line, i) => ctx.fillText(line, startX + 8, startY + 5 + i * 15));
    startY += boxH + 6;
  }
  ctx.textBaseline = 'alphabetic';
}
