// What a Source 1 VertexLitGeneric model draws beyond albedo x light (bake/Source1/Materials.cs Glow), patched into
// a converted Source 1 material (source1-light.js) after its own light. From Source SDK 2013's stdshaders, which CS:GO's
// VertexLitGeneric descends from (the GLSL: source1-vlg-glsl.js):
//   light        an ambient-cube model (an entity's) is lit per pixel: the cube along the (bumped) normal plus up to 3
//                local lights (the entity's _s1lights, AmbientLight.cs), each colour x falloff x DiffuseTerm (Lambert,
//                half Lambert squared in the skin shader or with $halflambert, 2 x $lightwarptexture(halflambert))
//   self-illum   diffuse = lerp(diffuse, $selfillumtint x albedo, mask): mask the base alpha, or $selfillummask's rgb;
//                then max(0, diffuse). With it on, the surface's alpha is the modulation alpha alone (no base alpha).
//                $selfillumfresnel: the mask x saturate(pow(saturate(Nvertex.V), exp) x scale + bias), toward tint x
//                albedo x brightness
//   detail 5     diffuse += detail x $detailtint x $detailblendfactor (TextureCombinePostLighting): after the
//                self-illum lerp in the skin shader (extras.skin), before it in plain VertexLitGeneric
//   specular     (skin) each local light's pow(saturate(R.L), exponent) x saturate(N.L), x the phong mask (the bump
//                alpha, or the base alpha with $basemapalphaphongmask) x the Fresnel ranges x $phongboost
//   rim light    (skin) the local lights' pow(R.L, $rimlightexponent) x N.L x mask x Fresnel4 (max'd with the
//                specular), + the ambient cube along the eye x $rimlightboost x saturate(mask x Fresnel4 x N.z); the
//                specular sum x $phongtint (white unset; $phongalbedotint: lerp(1, base, exponent map green))
//   emissive     a second pass added ONE, ONE: base x emissive(flow.xy + scroll x t) x tint x strength (t mod 1000)
//   envmap       $envmap: the map's cubemap (source1-cubemaps.js; a brush's own, a model's nearest: the entity's
//                _s1cube) along the reflection, x $envmaptint; skin: x the base alpha (or the phong mask with
//                $normalmapalphaenvmapmask) x lerp(1, Fresnel ranges, $envmapfresnel); else x $envmapmask / 1 - base
//                alpha / the bump alpha, $envmapcontrast, $envmapsaturation, LightmappedGeneric's $fresnelreflection
//   bump map     the $bumpmap's normal through the VVD's own tangent frame (the glb's TANGENT: S, w the binormal sign;
//                T = cross(N, S) x w, N' = normalize(S n.x + T n.y + N n.z) as skin_vs20 / skin_ps20b build it); a glb
//                without tangents falls back to a frame from screen derivatives
//   proxies      the VMT's material proxies (source1-proxies.js), run once a frame before the material draws: $color x
//                $color2 (the modulation) and $alpha multiply in, $selfillumtint, $emissiveblendtint x
//                $emissiveblendstrength and $basetexturetransform (the base texture's matrix) replace the baked values
// Albedo (s1Albedo) carries $color x $color2 x rendercolor, as the shaders' g_DiffuseModulation.
// UNSETTLED: a plain VertexLitGeneric
// lights per vertex in Source (per pixel here); an emissive blend with no flow map samples at the base UVs; on a
// blended surface the emissive pass is divided by the alpha to stay un-blended.
import * as THREE from 'three';
import { ProxySet } from './source1-proxies.js';
import { VLG_VERTEX, VLG_VERTEX_HEAD, VLG_HEAD, VLG_BODY } from './source1-vlg-glsl.js';
import { source1Cubemaps, nearestCubemap, CUBEMAP_GLSL } from './source1-cubemaps.js';

const time = { get value() { return (performance.now() / 1000) % 1000; } }; // read by three at each draw

const num = (v, dflt) => (Number.isFinite(Number(v)) ? Number(v) : dflt);
const vec3Of = (v, dflt = null) => (Array.isArray(v) && v.length === 3 && v.every((x) => Number.isFinite(Number(x)))
  ? new THREE.Vector3(...v.map((x) => Math.min(64, Math.max(0, Number(x))))) : dflt);
const vecs = (n) => Array.from({ length: n }, () => new THREE.Vector3());

function repeat(t) { if (t) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.needsUpdate = true; } return t; }

// m: the converted material (its userData = the glb's extras, m.s1Cube for an ambient-cube model); textures: the
// detail (the glb's emissive slot) and tex (source1-textures.js + the glb's normal map); exposure: source1-light.js's
export function vertexLitExtras(m, detail, tex, exposure) {
  const u = m.userData || {};
  const cube = !!m.s1Cube;
  const tint = vec3Of(u.selfillum);
  const mask = tint && tex?.selfIllumMask ? tex.selfIllumMask : null;
  const d = u.detailAdd && typeof u.detailAdd === 'object' ? u.detailAdd : null;
  const add = detail && m.map && d ? d : null;
  const skin = u.skin === true;
  const rim = skin && cube && u.rim && typeof u.rim === 'object' ? u.rim : null;
  const ph = skin && cube && u.phong && typeof u.phong === 'object' ? u.phong : null;
  const e = u.emissiveBlend && typeof u.emissiveBlend === 'object' && tex?.emissiveBase && tex?.emissive && m.map ? u.emissiveBlend : null;
  const bump = m.map && tex?.normal ? tex.normal : null;
  const sf = tint && Array.isArray(u.selfillumFresnel) && u.selfillumFresnel.length === 4 ? u.selfillumFresnel.map((x) => num(x, 0)) : null;
  const px = u.s1Proxies && typeof u.s1Proxies === 'object' ? new ProxySet(u.s1Proxies) : null;
  const proxies = px && px.writes.size ? px : null;
  const warp = skin && cube && tex?.lightWarp ? tex.lightWarp : null;
  const expMap = ph && tex?.phongExponent ? tex.phongExponent : null;
  const env = u.envmap && typeof u.envmap === 'object' && m.map ? u.envmap : null;
  const envMask = env && tex?.envmapMask ? tex.envmapMask : null;
  if (!tint && !add && !rim && !e && !bump && !proxies && !(cube && m.map) && !env) return;
  if (envMask) { envMask.colorSpace = THREE.NoColorSpace; repeat(envMask); }
  if (bump) { bump.colorSpace = THREE.NoColorSpace; repeat(bump); }
  if (expMap) { expMap.colorSpace = THREE.NoColorSpace; repeat(expMap); }
  if (warp) { warp.wrapS = warp.wrapT = THREE.ClampToEdgeWrapping; warp.needsUpdate = true; }
  const world = !!(cube || rim || bump || sf || env);
  m.s1Detail = add ? repeat(detail) : null;
  m.s1Tex = tex || null;
  const sc = Array.isArray(e?.scroll) ? e.scroll : [];
  const fr = Array.isArray(ph?.fresnel) ? ph.fresnel.map((x) => num(x, 0)) : [1, 0.5, 1];
  const phTint = Array.isArray(ph?.tint) ? vec3Of(ph.tint, new THREE.Vector3(1, 1, 1)) : ph?.albedoTint ? new THREE.Vector3(-1, -1, -1) : new THREE.Vector3(1, 1, 1);
  const uniforms = {
    s1Exposure: exposure,
    s1SelfIllum: { value: tint || new THREE.Vector3() },
    s1Mask: { value: mask },
    s1Detail: { value: add ? detail : null },
    s1DetailScale: { value: add ? num(add.scale, 4) : 1 },
    s1DetailMul: { value: vec3Of(add?.tint, new THREE.Vector3(1, 1, 1)).multiplyScalar(add ? Math.min(16, Math.max(0, num(add.factor, 1))) : 0) },
    s1RimBoost: { value: rim ? Math.min(256, Math.max(0, num(rim.boost, 1))) : 0 },
    s1RimTint: { value: new THREE.Vector3(1, 1, 1) },
    s1Cube: m.s1Cube || { value: vecs(6) },
    s1EBase: { value: e ? tex.emissiveBase : null },
    s1ETex: { value: e ? tex.emissive : null },
    s1EFlow: { value: e ? tex.emissiveFlow || null : null },
    s1EScroll: { value: new THREE.Vector2(num(sc[0], 0.11), num(sc[1], 0.124)) },
    s1ETint: { value: vec3Of(e?.tint, new THREE.Vector3(1, 1, 1)).multiplyScalar(e ? Math.min(1, Math.max(0, num(e.strength, 0))) : 0) },
    s1Time: time,
    s1Normal: { value: bump },
    s1Mod: { value: new THREE.Vector3(1, 1, 1) },
    s1AlphaMul: { value: 1 },
    s1SIFresnel: { value: new THREE.Vector4(...(sf || [1, 0, 1, 1])) },
    // local lights (lightModel fills them per entity), the phong terms
    s1LPos: { value: vecs(4) }, s1LCol: { value: vecs(4) }, s1LAtt: { value: vecs(4) }, s1LSpot: { value: vecs(4) },
    s1LDir: { value: Array.from({ length: 4 }, () => new THREE.Vector4()) }, s1LCount: { value: 0 },
    s1Phong: { value: new THREE.Vector4(ph ? num(ph.exponent, -1) : 1, ph ? Math.min(256, Math.max(0, num(ph.boost, 1))) : 0, 0, ph ? Math.max(1, num(ph.rimExponent, 4)) : 4) },
    s1PhongRanges: { value: new THREE.Vector3(...fr) },
    s1PhongTint: { value: phTint },
    s1PhongMasks: { value: new THREE.Vector3(ph?.baseAlphaMask ? 1 : 0, ph?.rimMask ? 1 : 0, 0) },
    s1PhongExp: { value: expMap },
    s1Warp: { value: warp },
    s1Cubes: source1Cubemaps.tex, s1CubeRows: source1Cubemaps.rows, s1CubeRange: source1Cubemaps.range,
    s1EnvRow: { value: env ? num(env.cube, -1) : -1 },
    s1EnvTint: { value: vec3Of(env?.tint, new THREE.Vector3(1, 1, 1)) },
    s1EnvParams: { value: new THREE.Vector4(env ? num(env.contrast, 0) : 0, env ? num(env.saturation, 1) : 1, env ? num(env.fresnel, 0) : 0, env ? num(env.lmFresnel, 1) : 1) },
    s1EnvMaskMode: { value: env ? Math.trunc(num(env.mask, 0)) : 0 },
    s1EnvMaskTex: { value: envMask },
  };
  // an "env_cubemap" $envmap takes the cubemap nearest the model where it is as it draws (the engine picks a model's
  // per frame; setEnvCube's bake-time pick stands until the first draw); a brush's names its own
  if (env && num(env.cube, -1) < 0) {
    m.s1EnvRow = uniforms.s1EnvRow;
    const prevDraw = m.onBeforeRender;
    m.onBeforeRender = function (renderer, scene, camera, geometry, object, ...rest) {
      prevDraw.call(this, renderer, scene, camera, geometry, object, ...rest);
      const e = object.matrixWorld.elements, i = nearestCubemap(e[12], e[13], e[14]);
      if (i >= 0) uniforms.s1EnvRow.value = i;
    };
  }
  if (cube) m.s1Lights = { pos: uniforms.s1LPos.value, col: uniforms.s1LCol.value, att: uniforms.s1LAtt.value, spot: uniforms.s1LSpot.value, dir: uniforms.s1LDir.value, count: uniforms.s1LCount };
  const defs = [tint && 'S1_SELFILLUM', mask && 'S1_MASK', add && 'S1_DETAIL', skin && 'S1_SKIN', rim && 'S1_RIM', e && 'S1_EMISSIVE',
    e && tex.emissiveFlow && 'S1_EFLOW', bump && 'S1_BUMP', bump && 'S1_TANGENT', cube && 'S1_CUBE', sf && 'S1_SIFRESNEL', world && 'S1_WORLD',
    ph && 'S1_PHONG', expMap && 'S1_PHONGEXP', env && 'S1_ENV', envMask && 'S1_ENVMASKTEX', env && /^rgbm/.test(String(u.lightmap || '')) && 'S1_LMG', warp && 'S1_WARP', ((skin && cube) || u.halfLambert === true) && 'S1_HALFLAMBERT']
    .filter(Boolean).map((x) => `#define ${x}`).join('\n');
  const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey;
  m.onBeforeCompile = (shader, r) => {
    prev.call(m, shader, r);
    Object.assign(shader.uniforms, uniforms);
    if (world) shader.vertexShader = `${defs}\n${VLG_VERTEX_HEAD}${shader.vertexShader}`.replace('#include <project_vertex>', VLG_VERTEX);
    const head = `${defs}
${shader.fragmentShader.includes('uniform float s1Exposure;') ? '' : 'uniform float s1Exposure;'}
${shader.fragmentShader.includes('uniform vec3 s1Cube[6];') ? '' : 'uniform vec3 s1Cube[6];'}
${CUBEMAP_GLSL}
${VLG_HEAD}`;
    shader.fragmentShader = head + shader.fragmentShader
      // the albedo before the light (cube / vertex light multiply it in at color_fragment); the proxies' modulation
      // ($color x $color2) is part of it, as g_DiffuseModulation is
      .replace('#include <color_fragment>', 'diffuseColor.rgb *= s1Mod;\n  vec3 s1Albedo = diffuseColor.rgb;\n  #include <color_fragment>')
      // with $selfillum on, the base alpha is the mask only: the alpha is the modulation's
      .replace('#include <alphamap_fragment>', '#ifdef S1_SELFILLUM\n  diffuseColor.a = opacity;\n  #endif\n  diffuseColor.a *= s1AlphaMul;\n  #include <alphamap_fragment>')
      .replace('#include <opaque_fragment>', VLG_BODY);
  };
  if (proxies) driveByProxies(m, proxies, uniforms, tint, e);
  m.customProgramCacheKey = () => `${prevKey.call(m)}-vlg|${defs.replace(/#define S1_|\n/g, '')}`;
  m.needsUpdate = true;
}

// an entity's local lights (kv._s1lights: 16 numbers per light, AmbientLight.cs LitCube) onto a converted material's
// uniforms: Source's LightDesc_t for a world light (thetaDot = stopdot, phiDot = stopdot2, lightdesc.cpp
// RecalculateDerivedValues: 1 / (thetaDot - phiDot), 1 when they're equal)
export function setLocalLights(m, raw) {
  const L = m?.s1Lights;
  if (!L) return;
  const v = String(raw || '').trim().split(/\s+/).map(Number);
  const n = v.length >= 16 && v.length % 16 === 0 && v.every(Number.isFinite) ? Math.min(4, v.length / 16) : 0;
  for (let i = 0; i < n; i++) {
    const o = i * 16, spot = v[o + 9] === 2;
    L.pos[i].set(v[o], v[o + 1], v[o + 2]);
    L.col[i].set(...[v[o + 3], v[o + 4], v[o + 5]].map((x) => Math.min(1e4, Math.max(0, x))));
    L.dir[i].set(v[o + 6], v[o + 7], v[o + 8], spot ? 1 : 0);
    L.att[i].set(v[o + 10], v[o + 11], v[o + 12]);
    const spread = v[o + 13] - v[o + 14];
    L.spot[i].set(spot ? Math.max(0, v[o + 15]) || 1 : 1, v[o + 14], spread > 1e-10 ? 1 / spread : 1);
  }
  L.count.value = n;
}

// an entity's nearest env_cubemap (kv._s1cube, CubemapBake.cs) for a material whose $envmap is "env_cubemap"
export function setEnvCube(m, raw) {
  const i = Number(raw);
  if (m?.s1EnvRow && Number.isInteger(i) && i >= 0 && i < 4096) m.s1EnvRow.value = i;
}

// the proxies' vars onto the uniforms, once a frame (Material.onBeforeRender runs per draw: ProxySet.run is cached)
function driveByProxies(m, px, uniforms, tint, e) {
  const baseTint = tint ? tint.clone() : null, eTint = e ? vec3Of(e.tint, new THREE.Vector3(1, 1, 1)) : null;
  const eStrength = e ? Math.min(1, Math.max(0, num(e.strength, 0))) : 0;
  const xf = px.writes.has('$basetexturetransform') && m.map;
  if (xf) { m.map = m.map.clone(); m.map.matrixAutoUpdate = false; }
  const prev = m.onBeforeRender;
  m.onBeforeRender = function (...args) {
    prev.apply(this, args);
    px.run(Math.round(performance.now()) / 1000);
    if (px.writes.has('$color') || px.writes.has('$color2')) {
      const c1 = px.vec('$color', 3), c2 = px.vec('$color2', 3);
      uniforms.s1Mod.value.set(c1[0] * c2[0], c1[1] * c2[1], c1[2] * c2[2]);
    }
    const a = px.num('$alpha');
    if (a !== null) uniforms.s1AlphaMul.value = Math.min(1, Math.max(0, a));
    const si = px.rgb('$selfillumtint');
    if (si && baseTint) uniforms.s1SelfIllum.value.set(...si);
    if (e && (px.writes.has('$emissiveblendtint') || px.writes.has('$emissiveblendstrength'))) {
      const t = px.rgb('$emissiveblendtint') || eTint.toArray(), st = px.num('$emissiveblendstrength');
      uniforms.s1ETint.value.set(...t).multiplyScalar(st === null ? eStrength : Math.min(1, Math.max(0, st)));
    }
    const mx = xf && px.matrix('$basetexturetransform');
    if (mx) m.map.matrix.set(mx[0], mx[1], mx[2], mx[3], mx[4], mx[5], 0, 0, 1);
  };
}
