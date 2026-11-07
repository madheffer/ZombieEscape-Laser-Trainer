// A player's body (your own third person, your first-person legs, teammates): the stock CT agent where they stand,
// facing their body yaw (which trails the view: anim-graph/anim-state.js), every bone driven by CS2's own player anim graph (world/anim-graph/: the compiled
// worldmodel.vnmgraph and the graphs it references, run by a port of the runtime they come from) from the player's
// movement (anim-graph/params.js).
//
// How the pose reaches the model is vpkstuff's previewer (frontend/previewer/tp.js):
//   - CS2 applies a clip's translation channel on every bone, so the pose is built on the clip's own STOCK skeleton
//     (anim/skeleton.json) and copied onto the model in world space. The model's bind translations never drive
//     anything (they only feed the inverse bind), exactly as in game.
//   - The agent's _TWIST bones take a share of their target's roll (its CTiltTwistConstraints, tp.js's solve).
//   - The held weapon rides the stock skeleton's `wpn` bone through its own `weapon` root bone (body-weapon.js).
//   - First person (CS2's legs when you look down): this whole body where you stand, its upper half thrown off the
//     bottom of the screen by CS2's own vertex warp, drawn only when you look down past 50 deg (world/body-legs.js,
//     read from client.dll + the csgo_character shader). No knife (the viewmodel holds it).
//
// Assets (public/player/, gitignored, Valve content): `lasers-bake --player` writes the two glbs;
// `node tools/tp-graph.mjs` the anim graphs (README "The player's body").
import * as THREE from 'three';
import { loadGltf, unwrapToSourceSpace } from '../weapons/fp/util.js';
import { fetchJson } from '../lib/fetch.js';
import { clamp01 } from '../lib/math.js';
import { DEG } from './entities/math.js';
import { GraphInstance, Context } from './anim-graph/graph.js';
import { PawnParams } from './anim-graph/params.js';
import { AnimLibrary } from './anim-graph/library.js';
import { legsVisible, legsUniforms, patchLegs } from './body-legs.js';
import { BodyWeapon } from './body-weapon.js';
import { BodyActions } from './body-actions.js';

const BASE = `${import.meta.env?.BASE_URL ?? '/'}player/`;
const FILES = {
  body: 'ctm_sas/ctm_sas.glb',
  constraints: 'ctm_sas/ctm_sas.constraints.json',
};
// The agent glb carries every mesh group: only the third-person body + gloves are drawn (first-person arms and
// sleeves, the defuse kit a ZE human never carries, and VRF's empty skeleton reference mesh stay hidden).
const DRAWN = /thirdperson/i;
// one anim library for every body on the page (your own, teammates): the graphs and clips are shared, read-only
let library = null;
function animLibrary(log) {
  return (library ||= new AnimLibrary(log).load(['worldmodel_locomotion+knife', 'worldmodel_knife+default_ct']));
}
const AXES = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
const ONE = new THREE.Vector3(1, 1, 1);

// tp.js swingTwist: the part of q that rotates about `axis`
function swingTwist(q, axis, out) {
  const d = q.x * axis.x + q.y * axis.y + q.z * axis.z;
  out.set(axis.x * d, axis.y * d, axis.z * d, q.w);
  if (out.lengthSq() < 1e-12) out.set(0, 0, 0, 1); else out.normalize();
  return out;
}

export class PlayerBody {
  // onModel(root): once loaded (main.js: the particle lights, world/lighting.js patchDynamic)
  // lazy: load on the first update that shows it (main.js: your own body), instead of a load() call
  constructor(scene, { log = () => {}, onModel = null, lazy = false } = {}) {
    this.log = log;
    this.lazy = lazy;
    this.onModel = onModel;
    this.place = new THREE.Group(); // feet at the origin, turned by yaw (Source units, Z up)
    this.place.visible = false;
    this.place.name = 'player-body';
    scene.add(this.place);
    this.ready = false;
    this.legs = legsUniforms(); // first person's warp (world/body-legs.js), off for third person and teammates
    this._m = new THREE.Matrix4(); this._w = new THREE.Matrix4(); this._inv = new THREE.Matrix4();
    this._p = new THREE.Vector3(); this._p2 = new THREE.Vector3(); this._s = new THREE.Vector3();
    this._q = new THREE.Quaternion(); this._q2 = new THREE.Quaternion();
    this._tq = new THREE.Quaternion(); this._pq = new THREE.Quaternion(); this._rel = new THREE.Quaternion();
    this._twist = new THREE.Quaternion(); this._dq = new THREE.Quaternion();
  }

  // once (a failed load is not retried every frame)
  load() { return (this.loading ||= this._load()); }

  async _load() {
    const [gltf, lib] = await Promise.all([loadGltf(BASE + FILES.body), animLibrary(this.log)]);
    // CS2's player anim graph drives every bone (world/anim-graph/): one instance per body
    const sk = lib.skel;
    this.skeleton = Object.fromEntries(sk.bones.map((b, i) => [b, { index: i, parent: sk.parents[i] >= 0 ? sk.bones[sk.parents[i]] : null }]));
    this.graph = new GraphInstance(lib.root, lib);
    this.ctx = new Context(sk);
    this.params = new PawnParams();
    this.order = this._parentFirst(this.skeleton);
    this.stockWorld = new Map(this.order.map((n) => [n, new THREE.Matrix4()]));

    this.root = gltf.scene;
    this.place.add(unwrapToSourceSpace(this.root));
    this.joints = new Map();
    this.root.traverse((o) => {
      if (o.isBone) this.joints.set(o.name, o);
      if (o.isMesh) {
        o.visible = DRAWN.test(`${o.name}/${o.parent?.name ?? ''}`);
        o.frustumCulled = false; // posed far from its bind bounds; it is one character
      }
    });
    const missing = this.order.filter((n) => n !== 'camera' && !n.startsWith('attach') && !this.joints.has(n)); // attach*: IK targets, not skinned
    if (missing.length) this.log(`body: ${missing.length} stance bones not on the model (${missing.slice(0, 4).join(', ')})`);

    this.twists = [];
    try {
      const c = await fetchJson(BASE + FILES.constraints);
      for (const t of c.twists || []) {
        const slave = this.joints.get(t.slave), target = this.joints.get(t.target);
        if (!slave || !target) continue;
        this.twists.push({ slave, target, weight: Number(t.weight) || 0, slaveBind: slave.quaternion.clone(),
          targetAxis: AXES[t.targetAxis] || AXES[0], slaveAxis: AXES[t.slaveAxis] || AXES[0] });
      }
    } catch (e) { this.log(`body: no twist constraints (${e.message})`); }

    this.weapon = new BodyWeapon(this.place, this.log); // the held weapon's world model (body-weapon.js)
    this.actions = new BodyActions(); // shots and reloads (body-actions.js)
    patchLegs(this.root, this.legs);
    this.onModel?.(this.place);
    this.ready = true;
    this.log(`body: ctm_sas, ${this.joints.size} bones, ${this.twists.length} twist constraints, CS2's player anim graph`);
  }

  // state: { visible, origin (feet, Source units), yaw (deg, the view's), ducked, duckAmount (0..1), onGround, ladder,
  //   velocity [x, y, z], walking, wish [forward, side] (the keys, side + = right; null = unknown), maxSpeed, weapon (vdata name), action, shots / attack / reloading / clip (body-actions.js), firstPerson, pitch (deg, the view's: first person draws only looking down),
  //   dt (s since the last frame) }
  update(state) {
    // your own body loads the first time it is shown (third person, a replay's camera): ~15 MB of model and
    // textures nobody in first person needs at page start
    if (!this.ready) { if (state.visible && this.lazy) this.load().catch((e) => this.log(`body: ${e.message || e} (third person shows no body)`)); return; }
    const fp = !!state.firstPerson;
    const pitch = state.pitch || 0;
    // the pose (and the locomotion clock) keeps running while the legs are out of view
    this.place.visible = !!state.visible && (!fp || legsVisible(pitch));
    if (!state.visible) return;
    const o = state.origin;
    this.place.position.set(o[0], o[1], o[2]);
    this.fp = fp;
    this.weapon.set(state.weapon || 'weapon_knife', !fp); // first person: the viewmodel holds it
    this.legs.cs2LegsFade.value = fp ? 1 : 0;
    this.legs.cs2ViewFwdZ.value = -Math.sin(pitch * DEG); // the view's forward z (Source: pitch down is positive)
    const duck = clamp01(state.duckAmount ?? (state.ducked ? 1 : 0));
    const dt = Math.min(0.1, Math.max(0, state.dt ?? 1 / 60));
    const p = this.params.update({ velocity: state.velocity, yaw: state.yaw, pitch, duck, onGround: state.onGround !== false,
      ladder: state.ladder, walking: state.walking, wish: state.wish, maxSpeed: state.maxSpeed, weapon: state.weapon, action: state.action, dt });
    // the body faces its own yaw, which trails the view (CS2's CCSPlayerAnimationState; Aim IK turns the spine the rest)
    this.place.rotation.set(0, 0, this.params.bodyYaw * DEG);
    const a = this.actions.update({ shots: state.shots, attack: state.attack, reloading: state.reloading, clip: state.clip, dt });
    for (const k in p) this.graph.set(k, p[k]);
    for (const k in a) this.graph.set(k, a[k]); // a shot / reload wins over the deploy and idle
    this.pose = this.graph.update(this.ctx, dt);
    this._pose();
  }

  // parent-first order of the stock skeleton, so world matrices accumulate in one pass
  _parentFirst(skel) {
    const order = [], seen = new Set();
    const visit = (n, depth) => {
      if (seen.has(n) || depth > 64 || !skel[n]) return;
      if (skel[n].parent) visit(skel[n].parent, depth + 1);
      if (!seen.has(n)) { seen.add(n); order.push(n); }
    };
    for (const n of Object.keys(skel)) visit(n, 0);
    return order;
  }

  // one bone's parent-space transform from this frame's graph pose
  _local(name, q, p) {
    const k = this.skeleton[name].index * 8, t = this.pose.t;
    p.set(t[k], t[k + 1], t[k + 2]);
    q.set(t[k + 4], t[k + 5], t[k + 6], t[k + 7]);
  }

  _pose() {
    this.place.updateMatrixWorld(true);
    const align = this.place.matrixWorld;
    // 1. CS2's skeleton for this frame's pose, in the body's own space
    for (const n of this.order) {
      this._local(n, this._q, this._p);
      const local = this._m.compose(this._p, this._q, ONE);
      const par = this.skeleton[n].parent && this.stockWorld.get(this.skeleton[n].parent);
      const out = this.stockWorld.get(n);
      if (par) out.multiplyMatrices(par, local); else out.copy(local);
    }
    // 2. copied onto the model in world space (scale dropped: the bind's metre->inch scale stays in the parents)
    for (const n of this.order) {
      const o = this.joints.get(n);
      if (!o) continue;
      this._w.multiplyMatrices(align, this.stockWorld.get(n));
      this._m.copy(o.parent.matrixWorld).invert().multiply(this._w).decompose(this._p, this._q, this._s);
      o.position.copy(this._p);
      o.quaternion.copy(this._q);
      o.updateMatrix();
      o.matrixWorld.multiplyMatrices(o.parent.matrixWorld, o.matrix);
    }
    this.root.updateMatrixWorld(true);
    // 3. twist bones: a share of the target's roll about the constraint axis, on top of their authored local
    for (const c of this.twists) {
      c.target.matrixWorld.decompose(this._p, this._tq, this._s);
      c.target.parent.matrixWorld.decompose(this._p, this._pq, this._s);
      this._rel.copy(this._pq).invert().multiply(this._tq);
      swingTwist(this._rel, c.targetAxis, this._twist);
      let angle = 2 * Math.acos(Math.min(1, Math.abs(this._twist.w)));
      if (this._twist.x * c.targetAxis.x + this._twist.y * c.targetAxis.y + this._twist.z * c.targetAxis.z < 0) angle = -angle;
      this._dq.setFromAxisAngle(c.slaveAxis, angle * c.weight);
      c.slave.quaternion.copy(c.slaveBind).multiply(this._dq);
      c.slave.updateMatrix();
      c.slave.updateMatrixWorld(true);
    }
    // 4. the held weapon on the stock `wpn`
    this.weapon.pose(this.stockWorld.get('wpn'));
  }
}
