// `caught`: our own rule for what a map leaves to its zombies. On a server the zombies chase the humans, so nobody
// can wait on a platform the stage has moved on from, or hold off its end for as long as they like; solo there are
// no zombies, so a stage could be stalled for hours and finished at an inflated time. A scenario names where and
// when the zombies would have caught you, and a human still there then is caught (a death, as the zombie cage is).
// Not a map edit: GFL's and our stripper edits can be turned off per player, this can't. One copy of the rule for
// the client (app/loop.js), the co-op checker and replay verification (server/coop-check.js), so they agree.
//
//   "caught": [
//     { "after": 21, "area": { "min": [x, y, z], "max": [x, y, z] }, "name": "words" },   // from 21 s into the stage
//     { "on": { "target": "lvl_2_end_checker", "input": "Enable" }, "delay": 15, "name": "words" }   // no area: anywhere
//   ]
// `after`: s since the stage started; `on` (+ `delay`): when the map's own input arrives (its first time). An `area`
// rule catches whoever is inside it (feet position) from then on; one without an area ends the run there unless won.
import { inputMatcher } from '../lib/names.js';

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const vec3 = (v) => Array.isArray(v) && v.length === 3 && v.every(finite);

function cleanRules(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const r of list.slice(0, 16)) {
    if (!r || typeof r !== 'object') continue;
    const area = r.area && vec3(r.area.min) && vec3(r.area.max) ? { min: r.area.min, max: r.area.max } : null;
    const on = r.on && typeof r.on.target === 'string' && typeof r.on.input === 'string' ? r.on : null;
    if (!on && !finite(r.after)) continue;
    out.push({ after: finite(r.after) ? r.after : null, on, delay: finite(r.delay) ? Math.max(0, r.delay) : 0, area, name: typeof r.name === 'string' ? r.name.slice(0, 80) : '' });
  }
  return out;
}

// Arm a run's rules on its engine (world/run-engine.js createRunEngine). Each rule gets `at`: the engine time it
// starts catching, once known (an `after` rule's once the stage starts, an `on` rule's when its input first arrives)
export function installCaught(engine, scenario, run) {
  const rules = cleanRules(scenario?.caught);
  run.caught = rules;
  for (const r of rules) {
    r.at = null;
    if (!r.on) continue;
    const match = inputMatcher(r.on);
    engine.hookInput((e, input, param, activator, caller) => {
      if (r.at == null && run.started && match(e.key, input, caller?.key)) r.at = engine.time + r.delay;
      return false; // watched, never swallowed
    });
  }
}

const inside = (p, a) => p[0] >= a.min[0] && p[0] <= a.max[0] && p[1] >= a.min[1] && p[1] <= a.max[1] && p[2] >= a.min[2] && p[2] <= a.max[2];

// The rule that catches a player standing at `origin` (feet) this tick, or null. Call once a tick while alive.
export function caughtBy(run, origin) {
  if (!run?.caught?.length || !run.started || run.endless) return null;
  const t = run.engine.time;
  for (const r of run.caught) {
    if (r.at == null && r.after != null) r.at = run.startTime + r.after;
    if (r.at == null || t < r.at) continue;
    if (!r.area || inside(origin, r.area)) return r;
  }
  return null;
}

// what the kill feed says (world/run-engine.js hazardName)
export const caughtText = (r) => r?.name || 'the zombies (left behind)';
