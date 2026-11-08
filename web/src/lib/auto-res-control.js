// The auto resolution controller (app/auto-res.js wires it to the renderer and settings), kept free of the game so
// it can be driven with made-up frame times (tests, tools/).
//
//   const c = autoResControl(apply)     apply(factor): put a render resolution factor on (1 = the setting as it is)
//   c.frame(now, { live, on, capMs })   every drawn frame. live: a run is being played; on: the setting; capMs: the
//                                       fps_max frame time (0 = none): frames that slow are the cap, not the GPU
//   c.level()                           the factor applied now
//
// Frames are judged by the median of 1 s windows. Below ~45 FPS: a step down (to half at most). A step that didn't
// take 8% off the frame (slow on the CPU, not the pixels) is undone and nothing goes below it for a minute: lowering
// the picture for nothing is worse than slow. Quick again (57 FPS+): a step back up after 15 s, the wait doubling
// (to 2 min) each time that step turns out too far.
export const LEVELS = [1, 0.85, 0.72, 0.6, 0.5];
const WINDOW_MS = 1000;
const SLOW_MS = 1000 / 45, QUICK_MS = 1000 / 57;
const SETTLE_MS = 1500; // after a change: the new size's first frames (render targets reallocated) don't count
const GAP_MS = 250; // a frame this long is a tab switch / a load, not the game's pace
const PROBE_MS = 15000, PROBE_MAX_MS = 120000;
const NO_HELP = 0.92, LOCK_MS = 60000;

export function autoResControl(apply) {
  let level = 0, last = 0, windowAt = 0, samples = [];
  let settleUntil = 0, downAt = -Infinity, upAt = -Infinity, probeMs = PROBE_MS;
  let check = null; // the step down being judged: { level, median before it }
  let floor = LEVELS.length - 1, floorUntil = 0;

  const set = (l, now) => {
    level = l;
    apply(LEVELS[l]);
    settleUntil = now + SETTLE_MS;
    samples = []; windowAt = 0;
  };

  function frame(now, { live, on = true, capMs = 0 }) {
    const dt = last ? now - last : 0;
    last = now;
    if (!on) { if (level) set(0, now); check = null; return; }
    if (!live || dt <= 0 || dt > GAP_MS || now < settleUntil) { samples = []; windowAt = 0; return; }
    if (!windowAt) { windowAt = now; return; }
    samples.push(dt);
    if (now - windowAt < WINDOW_MS) return;
    samples.sort((a, b) => a - b);
    const median = samples[samples.length >> 1];
    samples = []; windowAt = now;
    const slow = Math.max(SLOW_MS, capMs * 1.15), quick = Math.max(QUICK_MS, capMs * 1.05);
    if (now > floorUntil) floor = LEVELS.length - 1;
    if (check && check.level === level) {
      const before = check.median;
      check = null;
      if (median > before * NO_HELP) { floor = level - 1; floorUntil = now + LOCK_MS; set(level - 1, now); return; }
    }
    if (median > slow && level < floor) {
      if (now - upAt < WINDOW_MS * 4) probeMs = Math.min(probeMs * 2, PROBE_MAX_MS); // the last step up was too far
      check = { level: level + 1, median };
      downAt = now;
      set(level + 1, now);
    } else if (median < quick && level > 0 && now - downAt > probeMs && now - upAt > probeMs) {
      upAt = now;
      set(level - 1, now);
    }
  }

  return { frame, level: () => LEVELS[level] };
}
