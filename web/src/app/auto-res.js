// Auto resolution: while a run is being played and frames are slow, the render resolution steps down (to half of the
// setting at most) and later tries its way back up (lib/auto-res-control.js has the rules). The pixels a frame draws
// are what a weak GPU runs out of first (app/graphics.js), so this keeps a slow PC playable without a preset change
// and never touches a fast one. Settings > Graphics > Auto resolution turns it off.
//
//   autoResFrame(now, { live })   every drawn frame (app/loop.js), live as app/perf.js counts it
//   autoResLevel()                the factor applied now (1 = full)
import { settings } from './settings.js';
import { G } from './state.js';
import { autoResControl } from '../lib/auto-res-control.js';

const control = autoResControl((f) => G.renderer?.setAutoScale(f));

export const autoResLevel = () => control.level();

export function autoResFrame(now, { live }) {
  control.frame(now, {
    live: live && !document.hidden,
    on: settings.autoRes,
    capMs: settings.fpsMax > 0 ? 1000 / settings.fpsMax : 0, // fps_max -1 (the screen's refresh) is no cap here
  });
}
