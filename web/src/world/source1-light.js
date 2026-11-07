// A Source 1 map's own baked light (lasers-bake source1: bake/Source1/LightmapAtlas.cs). Its glb materials carry
// the lightmap atlas in the occlusion slot (TEXCOORD_1) with extras.lightmap = "rgbm<range>"; here each becomes an
// unlit MeshBasicMaterial (Source's LightmappedGeneric is texture x lightmap, no runtime lights) whose
// ambient-occlusion read is swapped for the RGBM decode, so a texel is albedo x light (linear, 1 = as authored).
// extras.additive ($additive: lasers, glows) draws added onto what is behind. A VertexLitGeneric's self-illum, detail,
// rim light and emissive blend go on top (source1-vlg.js). One replacement per material.
import * as THREE from 'three';
import { refractMaterial } from './refract-source1.js';
import { vertexLitExtras, setLocalLights, setEnvCube } from './source1-vlg.js';

// Source's HDR tonemap scale (its auto-exposure, clamped to the map's env_tonemap_controller min / max): one value
// for the whole frame, measured and adapted every frame by exposure-source1.js (through setSource1Exposure)
export const source1Exposure = { value: 2 };
export function setSource1Exposure(v) { source1Exposure.value = Number.isFinite(v) && v > 0 ? Math.min(v, 16) : 2; }

// a converted material keeps its extra textures through clone() (render.js applyTint clones it)
class Source1Material extends THREE.MeshBasicMaterial {
  copy(src) { super.copy(src); this.s1Detail = src.s1Detail || null; this.s1Tex = src.s1Tex || null; return this; }
}

const replaced = new WeakMap(); // glb material -> its Source 1 material
const done = new WeakSet();

// a mesh from a Source 1 glb: its materials swapped for their unlit, lightmapped versions (others are left alone)
export function applySource1(o) {
  const one = (m) => {
    if (!m || done.has(m) || !(m.userData?.lightmap || m.userData?.additive)) return m;
    if (!replaced.has(m)) { const r = convert(m); done.add(r); replaced.set(m, r); }
    return replaced.get(m);
  };
  o.material = Array.isArray(o.material) ? o.material.map(one) : one(o.material);
}

function convert(src) {
  if (src.userData?.refract) return refractMaterial(src); // Source's Refract: the scene behind, warped (refract-source1.js)
  const kind = String(src.userData?.lightmap || '');
  const range = /^rgbm(\d+(\.\d+)?)$/.exec(kind)?.[1];
  const m = new Source1Material({
    name: src.name, map: src.map, color: src.color, transparent: src.transparent, opacity: src.opacity,
    // extras.alphaTest: a $translucent + $alphatest material, blended and alpha-tested as Source draws it
    alphaTest: Number(src.userData?.alphaTest) > 0 ? Math.min(1, Number(src.userData.alphaTest)) : src.alphaTest, side: src.side, depthWrite: src.depthWrite, aoMap: range ? src.aoMap : null,
    vertexColors: kind === 'vertex', // a static prop: its ambient-cube light baked into COLOR_0
  });
  m.userData = { ...src.userData };
  if (kind === 'vertex') vertexLight(m);
  else if (kind === 'cube') cubeLight(m);
  patch(m, range); // the atlas decode (rgbm only) and $additive
  // the glb's normal map rides in s1Tex from here on (a converted material has no normalMap slot)
  const tex = { ...(src.s1Tex || {}), normal: src.s1Tex?.normal || src.normalMap || null };
  vertexLitExtras(m, src.s1Detail || src.emissiveMap || null, tex, source1Exposure);
  return m;
}

// COLOR_0 is linear light (can pass 1): x the exposure, as the lightmapped surfaces are
function vertexLight(m) {
  m.onBeforeCompile = (shader) => {
    shader.uniforms.s1Exposure = source1Exposure;
    shader.fragmentShader = `uniform float s1Exposure;\n${shader.fragmentShader}`.replace('#include <color_fragment>',
      '#include <color_fragment>\n  diffuseColor.rgb *= s1Exposure;');
  };
  m.customProgramCacheKey = () => 'source1-vertex';
}

// an entity model: Source's ambient cube (+X -X +Y -Y +Z -Z, linear) at the entity, by the world normal per vertex.
// m.s1Cube holds this material's six colours (a model's material is cloned per entity: lightModel below)
function cubeLight(m) {
  m.s1Cube = { value: Array.from({ length: 6 }, () => new THREE.Vector3(0.5, 0.5, 0.5)) };
  m.onBeforeCompile = (shader) => {
    shader.uniforms.s1Cube = m.s1Cube;
    shader.uniforms.s1Exposure = source1Exposure;
    shader.vertexShader = `uniform vec3 s1Cube[6];\nvarying vec3 vS1Light;\n${shader.vertexShader}`.replace('#include <begin_vertex>',
      `#include <begin_vertex>
  #ifdef USE_SKINNING
    vec3 s1n = normalize(mat3(modelMatrix) * objectNormal); // the skinned normal (three skins it for skinned meshes)
  #else
    vec3 s1n = normalize(mat3(modelMatrix) * normal);
  #endif
  vec3 s1q = s1n * s1n;
  vS1Light = s1q.x * (s1n.x >= 0.0 ? s1Cube[0] : s1Cube[1]) + s1q.y * (s1n.y >= 0.0 ? s1Cube[2] : s1Cube[3]) + s1q.z * (s1n.z >= 0.0 ? s1Cube[4] : s1Cube[5]);`);
    shader.fragmentShader = `uniform float s1Exposure;\nvarying vec3 vS1Light;\n${shader.fragmentShader}`.replace('#include <color_fragment>',
      '#include <color_fragment>\n  diffuseColor.rgb *= vS1Light * s1Exposure;');
  };
  m.customProgramCacheKey = () => 'source1-cube';
}

// an entity model's meshes take the entity's ambient cube (kv._s1light: 18 numbers, lasers-bake source1). Materials
// are made the entity's own first (a tinted one already is: render.js applyTint)
export function lightModel(inst, kv) {
  const v = String(kv?._s1light || '').trim().split(/\s+/).map(Number);
  if (v.length !== 18 || !v.every((x) => Number.isFinite(x) && x >= 0 && x < 64)) return;
  inst.traverse((o) => {
    if (!o.isMesh || Array.isArray(o.material) || o.material?.userData?.lightmap !== 'cube') return;
    if (!o.userData.tintBase && !o.userData.s1Own) {
      o.material = convert(o.material);
      done.add(o.material);
      o.userData.s1Own = true;
    }
    const c = o.material.s1Cube?.value;
    if (c) for (let i = 0; i < 6; i++) c[i].set(v[i * 3], v[i * 3 + 1], v[i * 3 + 2]);
    setLocalLights(o.material, kv?._s1lights); // its local lights, per pixel (source1-vlg.js)
    setEnvCube(o.material, kv?._s1cube); // the cubemap an "env_cubemap" $envmap reflects
  });
}

// Source draws a model's translucent meshes in the model's own order; three sorts them by each one's bounding-sphere
// depth, which for the sub-meshes of one model flips with the view. One shared sphere (their union) gives them one
// depth, so three falls back to their ids: the glb's order. ze_lifeforms_v1_1's protozoa: the Refract membrane (it
// writes the refracted frame, alpha 1) comes before the cells and organelles inside it, as in the game, instead of
// covering them with a black disc in the dark shaft. Culling uses the union, which holds every sub-mesh.
export function keepMeshOrder(inst) {
  const meshes = [];
  inst.traverse((o) => { if (o.isMesh && (o.material?.userData?.lightmap === 'cube' || o.material?.userData?.refract)) meshes.push(o); });
  if (meshes.length < 2) return;
  inst.updateMatrixWorld(true);
  const m0 = meshes[0].matrixWorld;
  if (!meshes.every((o) => o.matrixWorld.equals(m0) && o.isSkinnedMesh === meshes[0].isSkinnedMesh)) return; // spheres in one space only
  const sphereOf = (o) => {
    if (o.isSkinnedMesh) { if (!o.boundingSphere) o.computeBoundingSphere(); return o.boundingSphere; }
    if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
    return o.geometry.boundingSphere;
  };
  const union = sphereOf(meshes[0]).clone();
  for (const o of meshes.slice(1)) union.union(sphereOf(o));
  for (const o of meshes) {
    if (o.isSkinnedMesh) o.boundingSphere = union.clone();
    else o.geometry.boundingSphere = union.clone(); // the same model's geometry: the same union in every instance
  }
}

function patch(m, range) {
  if (range && m.aoMap) {
    m.aoMap.colorSpace = THREE.NoColorSpace;
    m.aoMap.generateMipmaps = false;
    m.aoMap.minFilter = THREE.LinearFilter;
    const R = Number(range).toFixed(3);
    m.onBeforeCompile = (shader) => {
      shader.uniforms.s1Exposure = source1Exposure;
      shader.fragmentShader = `uniform float s1Exposure;\n${shader.fragmentShader}`;
      shader.fragmentShader = shader.fragmentShader.replace('#include <aomap_fragment>',
        `#ifdef USE_AOMAP
          vec4 s1lm = texture2D( aoMap, vAoMapUv );
          reflectedLight.indirectDiffuse *= s1lm.rgb * s1lm.a * ${R} * s1Exposure;
        #endif`);
    };
    m.customProgramCacheKey = () => `source1-rgbm-${R}`;
    m.needsUpdate = true;
  }
  if (m.userData?.additive) {
    m.transparent = true;
    m.blending = THREE.AdditiveBlending;
    m.depthWrite = false;
    m.needsUpdate = true;
  }
}

// the map's 2D sky (manifest sky2d: { rt, bk, lf, ft, up, dn } -> PNG URLs) as the scene background. The scene is in
// Source space (Z up); a cube is sampled Y up, so the faces go in by Source axis and the background turns Z up to Y up.
// Face per axis: ft +X, bk -X, lf +Y, rt -Y, up +Z, dn -Z (Source's skybox naming). A skybox_swapper's sky
// (manifest sky2dSets) has its faces under sky/<name>/.
export function source1Sky(sky2d, url, engine) {
  if (engine !== 'source1') return null;
  if (!sky2d || typeof sky2d !== 'object') return { source1: true, texture: null, rotation: null };
  // three's px nx py ny pz nz slots, after the Z-up -> Y-up turn below; three samples a CubeTexture mirrored (its
  // flipEnvMap), hence each axis's opposite face in its slot. Checked in the game with a coloured test cube: looking
  // +X shows ft with up above it, lf on the left and rt on the right
  const order = ['bk', 'ft', 'dn', 'up', 'lf', 'rt'];
  if (!order.every((f) => typeof sky2d[f] === 'string' && /^sky\/([a-z0-9_-]{1,64}\/)?(rt|bk|lf|ft|up|dn)\.png$/.test(sky2d[f]))) return { source1: true, texture: null, rotation: null };
  const tex = new THREE.CubeTextureLoader().load(order.map((f) => url(sky2d[f])));
  tex.colorSpace = THREE.SRGBColorSpace;
  return { source1: true, texture: tex, rotation: new THREE.Euler(-Math.PI / 2, 0, 0) };
}
