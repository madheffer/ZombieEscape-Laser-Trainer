// The other players in a co-op / versus round: a CT body each where they stand (world/body.js, the same agent
// as your own third person, animated by CS2's player anim graph from how they move; a plain capsule until it has loaded, or if it can't) and a name tag above them.
//
// Where each is drawn, and when, is world/peer-track.js: CS2's interpolation (a little in the past, between their
// tick samples) on a clock that eases instead of jumping. The spectator camera and the radar read the same tracks.
import * as THREE from 'three';
import { PlayerBody } from './body.js';
import { PeerTrack } from './peer-track.js';
import { CS } from './movement.js';
import { unwrapCount, stabOrSwing } from '../lib/weapon-action.js';
import { GUN_ATTACK } from './body-actions.js';

const TAG_HEIGHT = 84; // name tag this far above the feet

export class Peers {
  constructor(scene, { log = () => {}, onModel = null } = {}) {
    this.scene = scene;
    this.log = log;
    this.onModel = onModel; // handed to each body (world/body.js)
    this.list = new Map(); // id -> { name, track (world/peer-track.js), body, capsule, tag, alive }
    this.tags = document.createElement('div');
    this.tags.id = 'nametags';
    document.body.append(this.tags);
    this._v = new THREE.Vector3();
    this.now = null; // this frame's run time (frame())
    this.wall = 0; // and its wall clock (ms)
  }

  // the round's other players: [{id, name}]
  set(members) {
    const want = new Set(members.map((m) => m.id));
    for (const [id, p] of this.list) if (!want.has(id)) this._remove(id, p);
    for (const m of members) {
      const p = this.list.get(m.id);
      if (p) { p.name = m.name; p.tag.textContent = m.name; continue; }
      this._add(m);
    }
  }

  clear() { for (const [id, p] of this.list) this._remove(id, p); }

  _add(m) {
    const capsule = new THREE.Mesh(
      new THREE.CylinderGeometry(14, 14, 72, 12),
      new THREE.MeshStandardMaterial({ color: 0x5d79ae, roughness: 0.8 }));
    capsule.rotation.x = Math.PI / 2; // three's cylinder stands on Y; Source is Z up
    capsule.visible = false;
    this.scene.add(capsule);
    const tag = document.createElement('div');
    tag.className = 'nametag';
    tag.textContent = m.name; // textContent: a player's name is untrusted
    this.tags.append(tag);
    const p = { name: m.name, track: new PeerTrack(), body: null, capsule, tag, alive: true };
    this.list.set(m.id, p);
    const body = new PlayerBody(this.scene, { log: () => {}, onModel: this.onModel });
    body.load().then(() => {
      if (this.list.get(m.id) !== p) { body.place.removeFromParent(); return; }
      p.body = body;
    }, (e) => this.log(`peer body: ${e.message || e} (a capsule stands in)`));
  }

  _remove(id, p) {
    p.capsule.removeFromParent();
    p.capsule.geometry.dispose();
    p.capsule.material.dispose();
    p.body?.place.removeFromParent();
    p.tag.remove();
    this.list.delete(id);
  }

  // a batch from the network (validated by app/coop.js): world/peer-track.js push; now = your run time as it arrived
  pushBatch(id, batch, now) {
    const p = this.list.get(id);
    if (!p) return;
    p.track.push(batch, now);
    if (batch.weapon) p.weapon = batch.weapon; // the newest: a swap shows as soon as it arrives
    p.keys = batch.keys || null; // their move keys (their body's plant and turn; null from an older client)
    // their shots / swings / reload (lib/weapon-action.js), played by their body as the batch arrives
    const a = batch.action;
    if (a) { p.shots = unwrapCount(p.shots, a.f); p.reloading = !!a.rl; p.attack = /knife|bayonet/.test(p.weapon || '') ? stabOrSwing(a.fs) : GUN_ATTACK; }
  }

  // every frame, first: your run time this frame, between ticks (null = not in a round). Everything drawn this
  // frame (bodies, the spectator camera, the radar) reads the players at the same moment
  frame(now) { this.now = now; this.wall = performance.now(); }

  setAlive(id, alive) { const p = this.list.get(id); if (p) p.alive = alive; }

  // where a player is drawn this frame (frame()), or their newest sample outside a round
  sample(id) { return this.list.get(id)?.track.sample(this.now, this.wall) ?? null; }

  // their eye this frame, for the spectator camera
  eye(id) {
    const s = this.sample(id);
    if (!s) return null;
    return { id, eye: [s.o[0], s.o[1], s.o[2] + CS.viewStand + (CS.viewDuck - CS.viewStand) * s.duck], yaw: s.yaw, pitch: s.pitch, hp: s.hp };
  }

  // every frame, after frame(): hide = the player you watch (their eyes are the camera)
  update(camera, hide) {
    const now = this.now;
    const w = innerWidth, h = innerHeight;
    for (const [id, p] of this.list) {
      const s = now == null || !p.alive ? null : this.sample(id);
      const show = !!s && id !== hide;
      if (p.body) {
        p.capsule.visible = false;
        if (show) {
          // their velocity from where they're drawn frame to frame (the track carries positions, not velocities)
          const dt = p.lastWall ? (this.wall - p.lastWall) / 1000 : 0;
          const vel = p.lastO && dt > 0 ? [0, 1, 2].map((i) => (s.o[i] - p.lastO[i]) / dt) : [0, 0, 0];
          const k = p.vel ? Math.min(1, dt / 0.1) : 1; // smoothed over ~0.1 s (their samples come in steps)
          p.vel = p.vel ? p.vel.map((v, i) => v + (vel[i] - v) * k) : vel;
          p.lastO = [...s.o];
          p.lastWall = this.wall;
          p.body.update({ visible: true, origin: s.o, yaw: s.yaw, pitch: s.pitch, duckAmount: s.duck, velocity: p.vel,
            onGround: Math.abs(p.vel[2]) < 40, wish: p.keys, weapon: p.weapon, shots: p.shots, attack: p.attack, reloading: p.reloading, dt: Math.min(0.1, dt) });
        } else { p.lastO = null; p.body.update({ visible: false }); }
      } else {
        p.capsule.visible = show;
        if (show) p.capsule.position.set(s.o[0], s.o[1], s.o[2] + 36 - 9 * s.duck);
      }
      if (!show) { p.tag.hidden = true; continue; }
      const v = this._v.set(s.o[0], s.o[1], s.o[2] + TAG_HEIGHT - 18 * s.duck).project(camera);
      if (v.z > 1 || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1) { p.tag.hidden = true; continue; }
      p.tag.hidden = false;
      p.tag.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px) translate(-50%, -100%)`;
    }
  }
}
