// @ts-check
// Debug builds only: unattended measurement runs on a console or emulator. If sdmc:/arcana-autoplay.json
// exists, e.g. {"steps":[{"mode":"solo","seconds":20},{"mode":"coop","seconds":20}]}, each step starts a
// run with no input, logs the profiler once per second to sdmc:/arcana-autoplay.log, saves a screenshot
// to sdmc:/arcana-autoplay-<n>.png, and the app exits after the last step.

const LOG = 'sdmc:/arcana-autoplay.log';

// Optional per-step experiments ("disable": [...]) to find what costs render time on the console.
const EXPERIMENTS = {
  shadow: proto => overrideSetter(proto, 'shadowBlur', () => {}),
  gradients: proto => {
    const fake = () => ({ addColorStop() {} });
    return [override(proto, 'createRadialGradient', fake), override(proto, 'createLinearGradient', fake)];
  },
  text: proto => [override(proto, 'fillText', () => {}), override(proto, 'strokeText', () => {}), overrideSetter(proto, 'font', () => {})],
  roundfont: proto => overrideSetter(proto, 'font', function (set, value) { set.call(this, String(value).replace(/([\d.]+)px/, (_, px) => `${Math.round(Number(px))}px`)); }),
  terrain: proto => {
    const drawImage = proto.drawImage;
    return override(proto, 'drawImage', function (image, ...args) { if (image?.width === 256 && image?.height === 256 && args.length === 2) return; return drawImage.call(this, image, ...args); });
  },
  lighter: proto => overrideSetter(proto, 'globalCompositeOperation', function (set, value) { set.call(this, value === 'lighter' ? 'source-over' : value); })
};
function override(proto, name, fn) { const original = proto[name]; proto[name] = fn; return () => { proto[name] = original; }; }
function overrideSetter(proto, name, wrap) {
  const descriptor = Object.getOwnPropertyDescriptor(proto, name);
  Object.defineProperty(proto, name, { ...descriptor, set(value) { wrap.call(this, descriptor.set, value); } });
  return () => Object.defineProperty(proto, name, descriptor);
}

export function createAutoplay({ startRun, endGame, controllers, perf, getView }) {
  let plan = null;
  try {
    const data = Switch.readFileSync('sdmc:/arcana-autoplay.json');
    if (data) plan = JSON.parse(new TextDecoder().decode(data));
  } catch { plan = null; }
  if (!plan?.steps?.length) return null;
  Switch.writeFileSync(LOG, `autoplay ${new Date().toISOString()}\n`);
  let index = -1, elapsed = 0, second = 0, waiting = 1;
  let undo = [];
  const proto = Object.getPrototypeOf(screen.getContext('2d'));
  const log = line => Switch.appendFileSync(LOG, `${line}\n`);

  function next() {
    index++;
    if (index >= plan.steps.length) { log('done'); Switch.writeFileSync('sdmc:/arcana-autoplay.done', 'ok'); Switch.exit(); }
    const step = plan.steps[index];
    elapsed = 0; second = 0;
    undo = (step.disable || []).flatMap(name => EXPERIMENTS[name]?.(proto) || []);
    startRun({ split: step.mode === 'coop', character: step.character ?? 0, secondCharacter: 1 });
    // No controllers are held during a measurement: keep both slots on "any controller" so nothing pauses.
    controllers.setCoop(false);
    log(`step ${index} ${step.mode}${step.disable ? ` disable=${step.disable.join(',')}` : ''}`);
  }

  return {
    frame(dt) {
      if (waiting > 0) { waiting -= dt; if (waiting <= 0) next(); return; }
      elapsed += dt;
      if (elapsed >= second + 1) {
        second++;
        const { fps, frame, update, render } = perf.stats;
        const view = getView();
        const memory = Switch.memoryUsage();
        log(`t=${second}s heap=${(memory.usedHeapSize / 1048576).toFixed(1)}MB native=${(memory.nativeHeapUsed / 1048576).toFixed(1)}MB fps=${fps.toFixed(1)} frame=${frame.toFixed(1)}ms update=${update.toFixed(2)}ms render=${render.toFixed(2)}ms enemies=${view?.enemies?.length ?? 0} shots=${(view?.shots?.length ?? 0) + (view?.enemyShots?.length ?? 0)}`);
      }
      if (elapsed >= plan.steps[index].seconds) {
        const shot = index;
        screen.toBlob(async blob => { if (blob) Switch.writeFileSync(`sdmc:/arcana-autoplay-${shot}.png`, await blob.arrayBuffer()); });
        endGame();
        undo.forEach(restore => restore());
        undo = [];
        waiting = 1;
      }
    }
  };
}
