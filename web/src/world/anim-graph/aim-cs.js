// CS2's Aim IK (CNmAimCSNode / CNmAimCSTask, client.dll game/shared/csgo/animgraph2/tasks/animtask_aim_cs.cpp,
// client 2026-10-15): the upper body bends to where the player looks. Read from the task:
//   - class (task +0x88) from weapon_category (+ a sub-type +0x89 from weapon_type), task ctor FUN_180705390
//   - limits (TrySetupSolverData FUN_18070d0f0): defaults, then per-class overrides; crouch (move_crouch_amount)
//     scales some of them
//   - spine pitch (FUN_1807061e0): the aim pitch mapped from [-90, 90] onto [min, max] (negative half onto min, positive
//     onto max, linearly) and spread over spine_0..spine_3 by weights, each a rotation about the bone's local Z
//   - neck / head: the pitch mapped onto the head range, x 0.35 on neck_0 and x 0.65 on head_0, about local Z
//   - yaw first (FUN_1807061e0's first half): aim_angle_yaw (the aim against the body yaw, anim-state.js) mapped the
//     same way onto [-55, 65] and spread over spine_0..3 by 0.1 / 0.2 / 0.3 / 0.4, each a turn about the MODEL's up
//     axis at that bone (its children carried along): the chest ends up facing the aim
//   - the solver's defaults are the execute's local block (FUN_180709650): yaw [-55, 65], pitch [-12.5, 10], yaw
//     weights, pitch weights, [-90, 90], head [-45, 35], neck / head 0.35 / 0.65
// Not ported (UNSETTLED): the per-class weapon / hand solves and the two-bone hand IK (CS2 turns hand IK off for knives,
// grenades and the healthshot anyway), weapon drop, defuse. In their place the weapon bone keeps its pre-aim offset
// to hand_R, so a held weapon stays in the hand while the spine bends.
import { STRIDE, qmul } from './pose.js';

const BASE = { yaw: [-55, 65], spine: [-12.5, 10], head: [-45, 35], yawW: [0.1, 0.2, 0.3, 0.4], spineW: [0.125, 0.225, 0.25, 0.4], headW: [0.35, 0.65] };
// [class, sub] from category / type (FUN_180705390)
function classOf(cat, type) {
  switch (cat) {
    case 'weapon_category_knife': return [1, 0];
    case 'weapon_category_pistol': return [2, 0];
    case 'weapon_category_grenade': return [4, 0];
    case 'weapon_category_equipment': return [5, type === 'weapon_c4' ? 9 : 0];
    case 'weapon_category_smg':
      return { weapon_mp5sd: [2, 1], weapon_mp9: [3, 2], weapon_p90: [3, 3], weapon_bizon: [3, 4], weapon_ump45: [3, 0] }[type] || [2, 0];
    case 'weapon_category_shotgun': return [3, { weapon_sawedoff: 5, weapon_mag7: 6 }[type] || 0];
    case 'weapon_category_rifle': case 'weapon_category_sniper': return [3, type === 'weapon_famas' ? 7 : 0];
    case 'weapon_category_machinegun': return [3, 8];
    default: return [0, 0];
  }
}
// the spine / head pitch ranges per class (the rest of TrySetupSolverData feeds the unported hand solves)
function limits(cls, crouch) {
  switch (cls) {
    case 1: return { spine: [-15.5, 25], head: [-35, 20] };
    case 2: return { spine: [crouch * -10 - 25.5, 10], head: [crouch * 10 - 35, BASE.head[1]] }; // head max: not decoded (default kept)
    case 3: return { spine: [-25.5, 25], head: [-35, 20] };
    case 5: return { spine: [-15.5, 15], head: [-35, 20] };
    default: return { spine: BASE.spine, head: BASE.head };
  }
}
// CS2's [-90, 90] -> [min, max] remap
function remap(pitch, [min, max]) {
  if (Math.abs(min - max) <= 1.192e-7) return min;
  if (pitch >= 0) return Math.abs(max) > 1.192e-7 ? Math.min(1, Math.max(0, pitch / 90)) * max : 0;
  return Math.abs(min) > 1.192e-7 ? min + Math.min(1, Math.max(0, (pitch + 90) / 90)) * (0 - min) : min;
}

const _d = new Float32Array(4);
// local rotation of bone i *= rotation about local Z by deg
function bendZ(t, i, deg) {
  if (!deg) return;
  const h = (deg * Math.PI) / 360, k = i * STRIDE + 4;
  _d[0] = 0; _d[1] = 0; _d[2] = Math.sin(h); _d[3] = Math.cos(h);
  qmul(t, k, _d, 0, t, k);
}

// bone i turned by deg about the model's up axis (Z) at the bone: local' = inv(P) * Rz * P * local, P its parent's
// model rotation (as posed now)
function turnModelZ(skel, t, i, deg) {
  if (!deg) return;
  const h = (deg * Math.PI) / 360, rz = [0, 0, Math.sin(h), Math.cos(h)];
  const par = skel.parents[i] >= 0 ? model(skel, t, skel.parents[i], new Map()).q : [0, 0, 0, 1];
  const k = i * STRIDE, q = [t[k + 4], t[k + 5], t[k + 6], t[k + 7]];
  const out = mul(mul(inv(par), mul(rz, par)), q);
  t[k + 4] = out[0]; t[k + 5] = out[1]; t[k + 6] = out[2]; t[k + 7] = out[3];
}

// model-space transforms of the bones on the path to i (memo per pose)
function model(skel, t, i, memo) {
  if (memo.has(i)) return memo.get(i);
  const p = skel.parents[i], k = i * STRIDE;
  let out;
  if (p < 0) out = { p: [t[k], t[k + 1], t[k + 2]], q: [t[k + 4], t[k + 5], t[k + 6], t[k + 7]] };
  else {
    const par = model(skel, t, p, memo);
    const lq = [t[k + 4], t[k + 5], t[k + 6], t[k + 7]], lp = [t[k], t[k + 1], t[k + 2]];
    out = { p: add(par.p, rot(par.q, lp)), q: mul(par.q, lq) };
  }
  memo.set(i, out);
  return out;
}
const mul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const inv = (q) => [-q[0], -q[1], -q[2], q[3]];
const rot = (q, v) => { const r = mul(mul(q, [v[0], v[1], v[2], 0]), inv(q)); return [r[0], r[1], r[2]]; };
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

export class AimSolver {
  constructor(skel) {
    const ix = (n) => skel.index.get(n) ?? -1;
    this.skel = skel;
    this.spine = ['spine_0', 'spine_1', 'spine_2', 'spine_3'].map(ix);
    this.neck = ix('neck_0'); this.head = ix('head_0');
    this.hand = ix('hand_R'); this.wpn = ix('wpn'); this.pivot = ix('wpnPivot');
    this.ok = this.spine.every((i) => i >= 0) && this.neck >= 0 && this.head >= 0;
  }

  // pose: the child's pose (modified in place); p: { pitch, yaw, crouch, category, type }
  apply(pose, p) {
    if (!this.ok) return;
    const t = pose.t, skel = this.skel;
    const [cls] = classOf(p.category, p.type);
    const L = limits(cls, p.crouch || 0);
    const pitch = p.pitch || 0;
    // the weapon's place in the hand before the bend
    const keep = this.hand >= 0 && this.wpn >= 0 && this.pivot >= 0;
    let rel = null;
    if (keep) {
      const m = new Map(), h = model(skel, t, this.hand, m), w = model(skel, t, this.wpn, m);
      rel = { p: rot(inv(h.q), sub(w.p, h.p)), q: mul(inv(h.q), w.q) };
    }
    const yaw = p.yaw || 0;
    if (Math.abs(yaw) > 0.001) {
      const y = remap(yaw, BASE.yaw);
      this.spine.forEach((b, i) => turnModelZ(skel, t, b, y * BASE.yawW[i]));
    }
    const s = remap(pitch, L.spine);
    this.spine.forEach((b, i) => bendZ(t, b, s * BASE.spineW[i]));
    const hd = remap(pitch, L.head);
    bendZ(t, this.neck, hd * BASE.headW[0]);
    bendZ(t, this.head, hd * BASE.headW[1]);
    if (keep) {
      // wpnPivot (a root_motion child) placed so that wpn lands where the hand now holds it
      const m = new Map(), h = model(skel, t, this.hand, m);
      const wq = mul(h.q, rel.q), wp = add(h.p, rot(h.q, rel.p));
      const k = this.wpn * STRIDE, wl = { p: [t[k], t[k + 1], t[k + 2]], q: [t[k + 4], t[k + 5], t[k + 6], t[k + 7]] };
      const pq = mul(wq, inv(wl.q)), pp = sub(wp, rot(pq, wl.p)); // pivot model transform
      const par = model(skel, t, skel.parents[this.pivot], m);
      const lq = mul(inv(par.q), pq), lp = rot(inv(par.q), sub(pp, par.p));
      const kp = this.pivot * STRIDE;
      t[kp] = lp[0]; t[kp + 1] = lp[1]; t[kp + 2] = lp[2];
      t[kp + 4] = lq[0]; t[kp + 5] = lq[1]; t[kp + 6] = lq[2]; t[kp + 7] = lq[3];
    }
  }
}
