// @ts-check
// Frame profiler overlay for PS Vita (debug builds only).
// Measures FPS, frame time, update and render durations, entity counts and heap memory.

export function createPerf() {
  let fps = 60, frame = 16.7, update = 0, render = 0;
  const smooth = (previous, value) => previous * 0.9 + value * 0.1;

  return {
    frame(dt) { if (dt > 0) { fps = smooth(fps, 1 / dt); frame = smooth(frame, dt * 1000); } },
    update(ms) { update = smooth(update, ms); },
    render(ms) { render = smooth(render, ms); },
    get stats() { return { fps, frame, update, render }; },
    draw(ctx, view, controllers, { split }) {
      const global = /** @type {any} */ (globalThis);
      let memText = '';
      if (global.Vita?.memoryUsage) {
        memText = `${((global.Vita.memoryUsage().usedHeapSize || 0) / 1048576).toFixed(0)}MB`;
      } else if (global.System?.get_used_memory) {
        memText = `${(global.System.get_used_memory() / 1048576).toFixed(0)}MB`;
      }

      const lines = [
        `PS Vita · FPS ${fps.toFixed(0)} · frame ${frame.toFixed(1)}ms`,
        `update ${update.toFixed(2)}ms · render ${render.toFixed(2)}ms${split ? ' (2 viewports)' : ''}`,
        `inimigos ${view?.enemies?.length ?? 0} · projéteis ${(view?.shots?.length ?? 0) + (view?.enemyShots?.length ?? 0)}`,
        `jogadores ${view ? Object.keys(view.players).length : 0} · controles ${controllers.connectedCount}`,
        memText ? `memória ${memText}` : ''
      ].filter(Boolean);

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(0, 0, 0, .75)';
      ctx.fillRect(8, 8, 310, lines.length * 16 + 8);
      ctx.font = '600 12px system-ui';
      ctx.fillStyle = '#9dffca';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      lines.forEach((value, index) => ctx.fillText(value, 14, 12 + index * 16));
      ctx.textBaseline = 'alphabetic';
    }
  };
}
