// A static model's meshes joined by material, once when its glb loads (world/assets.js getModel), so every copy the
// map spawns draws one mesh per material instead of one per glTF primitive.
//
// Why: a CS2 brush entity (func_rotating, func_movelinear, func_door...) exports each of its draw pieces as its own
// glTF node. ze_neochrome's boss rotator is 462 nodes of ~12 vertices over 3 materials, so one entity cost 462 draw
// calls (each a full material bind in three), which a slow PC's CPU can't submit at 60 FPS. CS2 draws such a model
// in a few batched draws per material; the picture is the same either way (same vertices, same material, same
// probe: the renderer picks one probe per entity, world/lighting.js).
//
// Left alone: skinned or animated models (their nodes move), morph targets, multi-material meshes, a mirrored node
// (its winding flips), meshes with children (an attachment hangs off them), and a model with nothing to join.
//
//   mergeStaticModel(scene) -> scene (joined in place; returns its argument for promise chains)
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const _rel = new THREE.Matrix4(), _inv = new THREE.Matrix4();

// every attribute as plain non-interleaved Float32 (normalized / quantized / interleaved data read through getX)
function floatAttributes(geo) {
  for (const name of Object.keys(geo.attributes)) {
    const a = geo.attributes[name];
    if (a.isInterleavedBufferAttribute || !(a.array instanceof Float32Array) || a.normalized) {
      const n = a.count, k = a.itemSize, out = new Float32Array(n * k);
      for (let i = 0; i < n; i++) for (let j = 0; j < k; j++) out[i * k + j] = a.getComponent(i, j);
      geo.setAttribute(name, new THREE.BufferAttribute(out, k));
    }
  }
  return geo;
}

const signature = (m) => {
  const g = m.geometry;
  const attrs = Object.keys(g.attributes).sort().map((n) => `${n}:${g.attributes[n].itemSize}`).join(',');
  return `${m.material.uuid}|${attrs}|${g.index ? 'i' : 'n'}|${m.renderOrder}|${m.castShadow}|${m.receiveShadow}`;
};

export function mergeStaticModel(scene) {
  if (!scene || scene.animations?.length) return scene;
  let movable = false;
  scene.traverse((o) => { if (o.isSkinnedMesh || o.isInstancedMesh || o.isBone || o.morphTargetInfluences) movable = true; });
  if (movable) return scene;
  scene.updateMatrixWorld(true);
  _inv.copy(scene.matrixWorld).invert();
  const groups = new Map();
  scene.traverse((o) => {
    if (!o.isMesh || o.children.length || Array.isArray(o.material) || !o.material || Object.keys(o.geometry.morphAttributes).length) return;
    _rel.multiplyMatrices(_inv, o.matrixWorld);
    if (_rel.determinant() <= 0) return;
    const key = signature(o);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(o);
  });
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const geos = list.map((o) => {
      _rel.multiplyMatrices(_inv, o.matrixWorld);
      const g = floatAttributes(o.geometry.clone());
      g.morphAttributes = {};
      g.clearGroups();
      return g.applyMatrix4(_rel);
    });
    let merged = null;
    try { merged = mergeGeometries(geos, false); } catch { merged = null; }
    for (const g of geos) g.dispose();
    if (!merged) continue; // incompatible after all: keep them as they were
    const first = list[0];
    const mesh = new THREE.Mesh(merged, first.material);
    mesh.name = first.name;
    mesh.renderOrder = first.renderOrder;
    mesh.castShadow = first.castShadow;
    mesh.receiveShadow = first.receiveShadow;
    mesh.userData = { ...first.userData, merged: list.length };
    mesh.matrixAutoUpdate = false; // the joined vertices are already in the scene's own space
    for (const o of list) o.removeFromParent(); // their geometry may be shared with a node left alone: not disposed
    scene.add(mesh);
  }
  // groups that only held joined meshes (a multi-primitive glTF node), innermost first
  for (let found = true; found;) {
    const empty = [];
    scene.traverse((o) => { if (o !== scene && o.type === 'Group' && !o.children.length) empty.push(o); });
    for (const o of empty) o.removeFromParent();
    found = empty.length > 0;
  }
  scene.updateMatrixWorld(true);
  return scene;
}
