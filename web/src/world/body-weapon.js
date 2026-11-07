// The weapon a player's body holds (world/body.js): its world model riding the stock skeleton's `wpn` bone through the
// model's own `weapon` mount bone (the authored mount, as the knife always did).
//
// The models: CS2 draws a gun with ONE vmdl in first and third person (weapons/models/<gun>/weapon_*.vmdl), so a
// gun is the viewmodel's own copy of it (public/weapons/fp/classes/<chassis>/weapon_stock.glb, the chassis from
// lib/weapons.js); the knife is the player bake's (`lasers-bake --player`). One holder per weapon per body, loaded
// the first time that body holds it (the viewmodel already fetched your own guns, so those come from the cache).
import * as THREE from 'three';
import { loadGltf, unwrapToSourceSpace } from '../weapons/fp/util.js';
import { firearm } from '../lib/weapons.js';
import { isMapName } from '../lib/paths.js';

const ROOT = import.meta.env?.BASE_URL ?? '/';
const KNIFE_URL = `${ROOT}player/knife_default_ct/weapon_knife_default_ct.glb`;
const MOUNT_BONES = ['weapon', 'weapon_offset'];
const ONE = new THREE.Vector3(1, 1, 1);

const isKnife = (w) => /^weapon_(knife|bayonet)/.test(w || 'weapon_knife');

// a weapon's world model url, or null (a weapon nothing is baked for: grenades, the taser, a map's own items)
export function weaponModelUrl(weapon) {
  if (isKnife(weapon)) return KNIFE_URL;
  const chassis = firearm(weapon)?.chassis;
  return chassis && isMapName(chassis) ? `${ROOT}weapons/fp/classes/${chassis}/weapon_stock.glb` : null;
}

export class BodyWeapon {
  // place: the body's group (feet at the origin, Source units); log: (msg) => {}
  constructor(place, log = () => {}) {
    this.place = place;
    this.log = log;
    this.models = new Map(); // url -> { holder, mountInv } | null (failed) | Promise (loading)
    this.current = null;
    this._p = new THREE.Vector3(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3();
  }

  // the held weapon (vdata name), drawn or not (first person: the viewmodel holds it)
  set(weapon, drawn) {
    const url = weaponModelUrl(weapon);
    const m = url ? this.models.get(url) : null;
    if (url && m === undefined) this.models.set(url, this._load(url).then((r) => { this.models.set(url, r); return r; },
      (e) => { this.log(`body: no world model for ${weapon} (${e.message || e})`); this.models.set(url, null); return null; }));
    const ready = m && !(m instanceof Promise) ? m : null; // until it arrives the hands stay empty, as in CS2
    if (this.current && this.current !== ready) this.current.holder.visible = false;
    this.current = ready;
    if (ready) ready.holder.visible = !!drawn;
  }

  // wpn: the stock `wpn` bone's matrix in the body's space (holder is a child of `place`, so it is its local one)
  pose(wpn) {
    if (this.current && wpn) this.current.holder.matrix.multiplyMatrices(wpn, this.current.mountInv);
  }

  async _load(url) {
    const g = await loadGltf(url);
    const holder = new THREE.Group();
    holder.matrixAutoUpdate = false;
    holder.visible = false;
    holder.add(unwrapToSourceSpace(g.scene));
    holder.updateMatrixWorld(true);
    let mount = null;
    for (const n of MOUNT_BONES) if (!mount) g.scene.traverse((o) => { if (!mount && o.name === n) mount = o; });
    if (!mount) throw new Error('no weapon mount bone');
    g.scene.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
    // where the mount bone sits in the holder, position + rotation only (the glb's own scale is the item's size)
    mount.matrixWorld.decompose(this._p, this._q, this._s);
    const mountInv = new THREE.Matrix4().compose(this._p, this._q, ONE).invert();
    this.place.add(holder);
    return { holder, mountInv };
  }
}
