/** The animated menu background: a faint grid, drifting motes and slow rings. */
export function drawBackdrop(ctx, W, H, dpr, time) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#071117';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(101,181,157,.055)';
  for (let x = (W / 2) % 64; x < W; x += 64) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = (H / 2) % 64; y < H; y += 64) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  for (let i = 0; i < 35; i++) {
    const x = (i * 197 + time * 0.004 * (i % 3 + 1)) % (W + 100) - 50;
    const y = (i * 113) % (H + 60) - 30;
    ctx.fillStyle = `rgba(94,208,170,${0.025 + (i % 4) * 0.009})`;
    ctx.beginPath(); ctx.arc(x, y, 2 + i % 3, 0, 7); ctx.fill();
  }
  const cx = W * 0.72, cy = H * 0.52;
  ctx.strokeStyle = 'rgba(95,214,179,.08)';
  for (let radius = 140; radius < 350; radius += 48) {
    ctx.beginPath(); ctx.arc(cx, cy, radius + Math.sin(time / 1800 + radius) * 5, 0, Math.PI * 2); ctx.stroke();
  }
}
