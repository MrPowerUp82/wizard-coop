// @ts-check
// Frame profiler overlay (debug builds only). Measures before optimizing: update and render time,
// entity counts and FPS, so split screen cost can be compared against solo on real hardware.

export function createPerf() {
  let fps = 60, frame = 16.7, update = 0, render = 0;
  let elapsed = 0, frames = 0;
  const smooth = (previous, value) => previous * 0.9 + value * 0.1;
  return {
    frame(dt) {
      if (!(dt > 0)) return;
      elapsed += dt; frames++;
      if (elapsed >= 1) {
        fps = frames / elapsed;
        frame = elapsed * 1000 / frames;
        elapsed = 0; frames = 0;
      }
    },
    update(ms) { update = smooth(update, ms); },
    render(ms) { render = smooth(render, ms); },
    get stats() { return { fps, frame, update, render }; },
    draw(ctx, view, controllers, { split }) {
      const lines = [
        `FPS ${fps.toFixed(0)} · frame ${frame.toFixed(1)}ms`,
        `update ${update.toFixed(2)}ms · render ${render.toFixed(2)}ms${split ? ' (2 viewports)' : ''}`,
        `inimigos ${view?.enemies?.length ?? 0} · projéteis ${(view?.shots?.length ?? 0) + (view?.enemyShots?.length ?? 0)}`,
        `jogadores ${view ? Object.keys(view.players).length : 0} · controles ${controllers.connectedCount}`,
        `heap JS ${((Switch.memoryUsage?.().usedHeapSize || 0) / 1048576).toFixed(0)}MB`
      ];
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(0, 0, 0, .7)';
      ctx.fillRect(8, 8, 330, lines.length * 17 + 10);
      ctx.font = '600 13px system-ui';
      ctx.fillStyle = '#9dffca';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      lines.forEach((value, index) => ctx.fillText(value, 16, 13 + index * 17));
      ctx.textBaseline = 'alphabetic';
    }
  };
}
