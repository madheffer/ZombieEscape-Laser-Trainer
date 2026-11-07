// A Source 1 map's env_cubemaps (lasers-bake source1: manifest cubemaps -> cubemaps/cubemaps.json + .png,
// bake/Source1/CubemapBake.cs): one atlas, a row per cubemap, its faces +X -X +Y -Y +Z -Z (Source axes) side by side,
// RGBM (rgb x a x range, linear). A material's $envmap samples its row with the world reflection vector, picking the
// face and its (s, t) as D3D does (the cube-map face selection table: major axis, then sc / tc over |ma|).
// Shared by every material of the map (one map at a time).
import * as THREE from 'three';

export const source1Cubemaps = { tex: { value: null }, rows: { value: 1 }, range: { value: 16 }, origins: new Float32Array(0) };

// the cubemap nearest a world point (Source units), -1 without any: a model's "env_cubemap" as it moves
export function nearestCubemap(x, y, z) {
  const o = source1Cubemaps.origins;
  let best = -1, bd = Infinity;
  for (let i = 0; i + 2 < o.length; i += 3) {
    const d = (o[i] - x) ** 2 + (o[i + 1] - y) ** 2 + (o[i + 2] - z) ** 2;
    if (d < bd) { bd = d; best = i / 3; }
  }
  return best;
}

// load the map's atlas (or clear it for a map without one)
export async function loadSource1Cubemaps(manifest, url, fetchJson) {
  source1Cubemaps.tex.value = null;
  source1Cubemaps.origins = new Float32Array(0);
  if (manifest?.engine !== 'source1' || manifest.cubemaps !== 'cubemaps/cubemaps.json') return;
  try {
    const def = await fetchJson(url('cubemaps/cubemaps.json'));
    const rows = Array.isArray(def?.list) ? def.list.length : 0;
    if (!rows || def.file !== 'cubemaps.png') return;
    const tex = await new THREE.TextureLoader().loadAsync(url('cubemaps/cubemaps.png'));
    tex.flipY = false; // row 0 = cubemap 0, image rows top-down
    tex.colorSpace = THREE.NoColorSpace;
    tex.generateMipmaps = false;
    tex.minFilter = tex.magFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    source1Cubemaps.tex.value = tex;
    source1Cubemaps.rows.value = rows;
    source1Cubemaps.range.value = Number.isFinite(Number(def.range)) && def.range > 0 ? Number(def.range) : 16;
    source1Cubemaps.origins = Float32Array.from(def.list.flatMap((p) => (Array.isArray(p) && p.length === 3 ? p.map(Number) : [NaN, NaN, NaN])));
  } catch { /* no reflections: the rest of the map draws */ }
}

// the GLSL lookup: s1EnvCube(row, R) = the cubemap's linear colour along R
export const CUBEMAP_GLSL = `
uniform sampler2D s1Cubes; uniform float s1CubeRows, s1CubeRange;
vec3 s1EnvCube(float row, vec3 r) {
  vec3 a = abs(r); float face, sc, tc, ma;
  if (a.x >= a.y && a.x >= a.z) { ma = a.x; face = r.x >= 0.0 ? 0.0 : 1.0; sc = r.x >= 0.0 ? -r.z : r.z; tc = -r.y; }
  else if (a.y >= a.z) { ma = a.y; face = r.y >= 0.0 ? 2.0 : 3.0; sc = r.x; tc = r.y >= 0.0 ? r.z : -r.z; }
  else { ma = a.z; face = r.z >= 0.0 ? 4.0 : 5.0; sc = r.z >= 0.0 ? r.x : -r.x; tc = -r.y; }
  vec2 st = clamp((vec2(sc, tc) / max(ma, 1e-6) + 1.0) * 0.5, 0.5 / 32.0, 1.0 - 0.5 / 32.0); // inside the face: no bleed
  vec4 t = texture2D(s1Cubes, vec2((face + st.x) / 6.0, (row + st.y) / s1CubeRows));
  return t.rgb * t.a * s1CubeRange;
}`;
