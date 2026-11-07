// Endless mode: the stage keeps going until you die, for the longest survival time.
//
// A scenario opts in with an `endless` block, which says how to keep the map's own logic running instead of
// letting the stage end:
//   endless: {
//     repeat: 30,                       // re-fire the stage's `start` inputs every N s (attack drills)
//     cancel: [{ target, input }],      // swallow these inputs (e.g. the timer Disable and the nuke that end it)
//     noBossDamage: true,               // the boss can't die (the team stops shooting), so its attacks continue
//     chain: [{ on: { target, input }, fire: [{ target, input, param, delay }] }],
//                                       // when `on` arrives (seen even if cancelled), fire the map's own inputs:
//                                       // a cycle the map runs once (x1 outputs), kept going. ze_lifeforms' rising
//                                       // platform: each Close sends it back down, then up again
//   }
// Everything else (lasers, balls, damage) is the map's, unchanged.
import { inputMatcher } from '../lib/names.js';

const MAX_CHAIN_FIRES = 16; // a chain entry fires at most this many inputs

export function endlessSpec(scenario) {
  return scenario?.endless || null;
}

// Wire endless behaviour into a freshly started run. Returns a per-tick function.
export function installEndless(engine, scenario, fireStart) {
  const spec = endlessSpec(scenario) || {};
  const cancelled = inputMatcher(spec.cancel);
  if (cancelled.size) engine.hookInput((e, input) => cancelled(e.key, input));
  // installed after `cancel`, so it runs first (engine.hookInput: the last hook sees an input first)
  for (const c of Array.isArray(spec.chain) ? spec.chain : []) {
    const on = inputMatcher(c?.on);
    const fire = (Array.isArray(c?.fire) ? c.fire : []).filter((f) => f && f.target && f.input).slice(0, MAX_CHAIN_FIRES);
    if (!on.size || !fire.length) continue;
    engine.hookInput((e, input) => {
      if (on(e.key, input)) for (const f of fire) engine.fire(f.target, f.input, f.param || '', Math.max(0, Number(f.delay) || 0), engine.playerEnt, null);
      return false; // watched, never swallowed
    });
  }
  let next = spec.repeat ? spec.repeat : Infinity;
  let elapsed = 0;
  return (dt) => {
    elapsed += dt;
    if (elapsed >= next) { next += spec.repeat; fireStart(); }
  };
}
