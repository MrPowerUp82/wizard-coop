// @ts-check
// Debug builds only: automated measurement on PS Vita or Vita3K emulator.
// If ux0:/data/arcana-autoplay.json exists, e.g. {"steps":[{"mode":"solo","seconds":15},{"mode":"coop","seconds":15}]},
// it records FPS and frame time to ux0:/data/arcana-autoplay.log and exits cleanly.

const LOG = 'ux0:/data/arcana-autoplay.log';

export function createAutoplay({ startRun, endGame: _endGame, controllers, perf, getView }) {
  const global = /** @type {any} */ (globalThis);
  let plan = null;
  try {
    if (global.Vita?.readFile) {
      const data = global.Vita.readFile('ux0:data/ArcanaSurvivors/autoplay.json');
      if (data) plan = JSON.parse(typeof data === 'string' ? data : new TextDecoder().decode(data));
    }
  } catch {
    plan = null;
  }
  if (!plan?.steps?.length) return null;

  let index = -1, elapsed = 0, second = 0, waiting = 1;
  const log = line => {
    try {
      if (global.Vita?.appendFile) global.Vita.appendFile(LOG, `${line}\n`);
      else console.log(`[AUTOPLAY] ${line}`);
    } catch { /* ignore */ }
  };

  function next() {
    if (global.Vita?.capture) global.Vita.capture(index);
    index++;
    if (index >= plan.steps.length) {
      log('done');
      if (global.Vita?.exit) global.Vita.exit();
      return;
    }
    const step = plan.steps[index];
    elapsed = 0;
    second = 0;
    startRun({ split: step.mode === 'coop', character: step.character ?? 0, secondCharacter: 1 });
    controllers.setCoop(false);
    log(`step ${index} ${step.mode}`);
  }

  return {
    frame(dt) {
      if (waiting > 0) {
        waiting -= dt;
        if (waiting <= 0) next();
        return;
      }
      elapsed += dt;
      if (elapsed >= second + 1) {
        second = Math.floor(elapsed);
        const stats = perf.stats;
        const view = getView();
        log(`sec=${second} fps=${stats.fps.toFixed(1)} frame=${stats.frame.toFixed(2)}ms update=${stats.update.toFixed(2)}ms render=${stats.render.toFixed(2)}ms enemies=${view?.enemies?.length ?? 0}`);
      }
      if (elapsed >= plan.steps[index].seconds) next();
    }
  };
}
