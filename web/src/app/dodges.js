// What came at you in a run and what you got past: the end-of-run report's "lasers dodged" (app/console/run-report.js).
// Not a CS2 number (CS2 counts nothing like it), so here is exactly what it counts:
//
//   A pass: a damaging trigger_hurt (damage > 0, enabled, not in a 3D skybox) whose hull comes within NEAR units of your
//   hull, until it is out of that range again (or gone, or disabled). It is DODGED if it moved during the pass (so a
//   still hurt wall you walk past doesn't count) and never hurt you during it; it is a HIT if it hurt you.
//   What it is: its name first (laser / beam, ball / orb ...), else its shape: long and thin is a laser, about as wide
//   as it is long is a ball, anything else a hazard.
// Damage taken is kept per hazard, by its name in words (world/run-engine.js hazardName), with fall damage as its own.
// env_laser beams and point_hurt (classes/beams.js) aren't volumes: their damage counts, a near miss doesn't.
import { boxTouchesHull } from '../world/collision.js';

const NEAR = 64; // units between your hull and the hazard's that count as "it came at you"
const LASER_NAME = /laser|beam/;
const BALL_NAME = /ball|orb|sphere/;

export class DodgeTracker {
  // name(source) -> the hazard in words (session.js hazardName)
  constructor(name) {
    this.name = name;
    this.passes = new Map(); // ent -> { stamp, moved, hurt, kind }
    this.kinds = new WeakMap(); // ent -> 'laser' | 'ball' | 'hazard'
    this.dodged = { laser: 0, ball: 0, hazard: 0 };
    this.hit = { laser: 0, ball: 0, hazard: 0 };
    this.taken = new Map(); // hazard name -> { damage, hits }
    this.near = [0, 0, 0];
    this.topSpeed = 0; // horizontal, u/s
  }

  // one tick: engine.updateTriggers' events (already returned); live = the stage clock runs and the run isn't over
  observe(engine, player, events, live) {
    if (!live) { this.passes.clear(); return; }
    this.topSpeed = Math.max(this.topSpeed, Math.hypot(player.velocity[0], player.velocity[1]));
    const hurtBy = new Set();
    for (const ev of events) {
      if (ev.type !== 'hurt') continue;
      hurtBy.add(ev.ent);
      this.damage(ev.ent, ev.damage, ev.first);
    }
    const set = engine.byClass.get('trigger_hurt');
    const c = player.centre(), h = player.half();
    const near = this.near;
    for (let i = 0; i < 3; i++) near[i] = h[i] + NEAR;
    const seen = new Set();
    if (set) {
      for (const e of set) {
        if (!e.alive || !e.enabled || e.sky || !(parseFloat(e.kv.damage) > 0)) continue;
        const hulls = e.hulls();
        if (!hulls?.some((hull) => boxTouchesHull(c, near, hull))) continue;
        seen.add(e);
        const stamp = engine.moveStamp(e);
        let pass = this.passes.get(e);
        if (!pass) this.passes.set(e, pass = { stamp, moved: false, hurt: false, kind: this.kindOf(engine, e) });
        if (stamp !== pass.stamp) pass.moved = true;
        if (hurtBy.has(e)) pass.hurt = true;
      }
    }
    for (const [e, pass] of this.passes) {
      if (seen.has(e)) continue;
      this.passes.delete(e);
      if (pass.hurt) this.hit[pass.kind]++;
      else if (pass.moved) this.dodged[pass.kind]++;
    }
  }

  // the run ended (often on the very hit that ended it): a pass still open that hurt you counts as a hit; one that
  // didn't is left out (it never got past you)
  settle() {
    for (const pass of this.passes.values()) if (pass.hurt) this.hit[pass.kind]++;
    this.passes.clear();
  }

  // damage you took (also fall damage: session.js), by what did it; first = a new hit, not the same touch again
  damage(source, dmg, first = true) {
    const key = this.name(source);
    const t = this.taken.get(key) || { damage: 0, hits: 0 };
    t.damage += dmg;
    if (first) t.hits++;
    this.taken.set(key, t);
  }

  kindOf(engine, e) {
    let k = this.kinds.get(e);
    if (k) return k;
    const n = `${e.name || ''} ${e.parent?.name || ''}`.toLowerCase();
    k = LASER_NAME.test(n) ? 'laser' : BALL_NAME.test(n) ? 'ball' : shapeKind(engine.assets.hulls[e.model]);
    this.kinds.set(e, k);
    return k;
  }
}

// the model-space bounds of its hulls: long and thin (the longest side 4x the shortest, and 96 u or more) is a laser,
// near cubic (2.5x at most) a ball
function shapeKind(src) {
  if (!src?.length) return 'hazard';
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const hull of src) {
    const v = hull.verts;
    if (!v) continue;
    for (let i = 0; i < v.length; i += 3) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], v[i + a]); hi[a] = Math.max(hi[a], v[i + a]); }
  }
  const d = [0, 1, 2].map((a) => hi[a] - lo[a]).sort((x, y) => x - y);
  if (!Number.isFinite(d[0])) return 'hazard';
  const short = Math.max(d[0], 1);
  if (d[2] >= 96 && d[2] >= 4 * short) return 'laser';
  if (d[2] <= 2.5 * short) return 'ball';
  return 'hazard';
}
