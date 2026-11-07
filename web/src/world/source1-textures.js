// A GLTFLoader plugin for Source 1 glbs (lasers-bake source1, bake/Source1/Glb.cs): textures a VertexLitGeneric /
// LightmappedGeneric material needs that glTF has no slot for are named by file in its extras.s1Textures
// ({ selfIllumMask, envmapMask, phongExponent, lightWarp, emissiveBase, emissive, emissiveFlow } -> a PNG beside the
// glb: an index into the glb's textures would not survive tools/chunk-world.mjs' prune). Each is loaded once per map
// through the glb's loading manager (the map's version on the URL) and set on the meshes' materials as m.s1Tex.
// The meshes are walked, not the parser's materials: GLTFLoader hands each mesh a clone (derivative tangents), which
// keeps the extras (userData) but nothing set on the original.
// As Source loads them (emissive_scroll_blended_pass_helper.cpp, skin_dx9_helper.cpp, vertexlitgeneric_dx9_helper.cpp):
// the emissive base and the emissive texture sRGB; the flow map, masks, exponent map and light warp linear.
import * as THREE from 'three';

const SRGB = new Set(['emissiveBase', 'emissive']);
const KEYS = new Set(['selfIllumMask', 'envmapMask', 'phongExponent', 'lightWarp', 'emissiveBase', 'emissive', 'emissiveFlow']);
const SAFE = /^[A-Za-z0-9_.-]{1,120}\.png$/; // the bake's own file names (Materials.cs FileName): nothing that leaves the folder

export class Source1Textures {
  constructor(parser) { this.parser = parser; this.name = 'lasers_source1_textures'; }

  async afterRoot(result) {
    const p = this.parser;
    if (!(p.json.materials || []).some((d) => d?.extras?.s1Textures)) return;
    const manager = p.options.manager;
    const loader = new THREE.TextureLoader(manager);
    const cache = (manager.s1TexCache ||= new Map()); // one load per file for every glb of the map
    const load = (k, file) => {
      const url = THREE.LoaderUtils.resolveURL(file, p.options.path);
      const id = `${url}|${SRGB.has(k) ? 's' : 'l'}`;
      if (!cache.has(id)) {
        cache.set(id, loader.loadAsync(url).then((t) => {
          t.flipY = false; // glTF's UV convention, as the glb's own textures
          t.colorSpace = SRGB.has(k) ? THREE.SRGBColorSpace : THREE.NoColorSpace;
          t.wrapS = t.wrapT = THREE.RepeatWrapping;
          t.needsUpdate = true;
          return t;
        }, () => null));
      }
      return cache.get(id);
    };
    const jobs = [];
    for (const scene of result.scenes || [result.scene]) {
      scene?.traverse((o) => {
        if (!o.isMesh) return;
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          const refs = m?.userData?.s1Textures;
          if (!refs || typeof refs !== 'object' || m.s1Tex) continue;
          m.s1Tex = {};
          for (const [k, file] of Object.entries(refs)) {
            if (!KEYS.has(k) || typeof file !== 'string' || !SAFE.test(file)) continue;
            jobs.push(load(k, file).then((t) => { if (t) m.s1Tex[k] = t; }));
          }
        }
      });
    }
    await Promise.all(jobs);
  }
}
