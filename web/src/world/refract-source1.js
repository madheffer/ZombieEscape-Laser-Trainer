// Source 1's Refract shader for a CS:GO map's brushes (lasers-bake: bake/Source1/Materials.cs RefractInfo -> the glb
// material's normalTexture + extras.refract { amount, blur, tint, scroll: [rate, angle] }): clear glass that shows the
// scene behind it warped by a scrolling normal map. ze_luciddreams_b5 wraps its falling-balls room in one
// (luciddreams/waterfall/waterfallfull_1024_nrm_clear: $refractamount .085, $bluramount 1, TextureScroll on
// $bumpTransform at 1.3 / s, 270 degrees); drawn as an opaque white wall before, it hid the room.
// What Source does (refract_ps2x, as the SDK 2013 shader reads): the frame behind is sampled at the pixel's screen
// position offset by the bumped normal x $refractamount, blurred by $bluramount, times $refracttint. The scroll is
// the TextureScroll proxy: the normal map's UVs move rate x t along (cos angle, sin angle).
// UNSETTLED: the offset's exact space and scale (the view-space normal's xy x amount here, in screen UVs) and the
// blur kernel (a 5-tap cross bluramount texels wide) are not decompiled from CS:GO's shaders.
// The frame behind is the scene copy (scenecopy.js): the opaque pass, so another transparent behind it is not seen.
import * as THREE from 'three';
import { sceneCopyUniforms } from './scenecopy.js';

const clock = { get value() { return performance.now() / 1000; } }; // read by three at each draw
let lastDrawn = -Infinity;
let frame = 0;

// does a Refract surface want the scene copy this frame (one was drawn in the last few frames)
export function refractWanted() { frame++; return frame - lastDrawn <= 3; }

const VS = `varying vec2 vUv; varying vec3 vViewPos;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vViewPos = mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;

const FS = `uniform sampler2D tNormal; uniform sampler2D uSceneColor; uniform vec2 uViewport;
uniform float uAmount, uBlur, uTime, uHasNormal; uniform vec3 uTint; uniform vec2 uScroll;
varying vec2 vUv; varying vec3 vViewPos;
void main() {
  vec2 uv = vUv + uScroll * uTime;
  vec3 n = uHasNormal > 0.5 ? texture2D(tNormal, uv).xyz * 2.0 - 1.0 : vec3(0.0, 0.0, 1.0);
  // the surface's tangent frame from screen derivatives (no tangents in the glb)
  vec3 dp1 = dFdx(vViewPos), dp2 = dFdy(vViewPos);
  vec2 du1 = dFdx(vUv), du2 = dFdy(vUv);
  vec3 N = normalize(cross(dp1, dp2));
  vec3 dp2p = cross(dp2, N), dp1p = cross(N, dp1);
  vec3 T = dp2p * du1.x + dp1p * du2.x, B = dp2p * du1.y + dp1p * du2.y;
  float inv = inversesqrt(max(max(dot(T, T), dot(B, B)), 1e-12));
  vec3 vn = normalize(T * inv * n.x + B * inv * n.y + N * n.z);
  vec2 screen = gl_FragCoord.xy / uViewport;
  vec2 at = screen + vn.xy * uAmount;
  vec2 px = uBlur / uViewport;
  vec3 c = texture2D(uSceneColor, at).rgb * 0.4
    + (texture2D(uSceneColor, at + vec2(px.x, 0.0)).rgb + texture2D(uSceneColor, at - vec2(px.x, 0.0)).rgb
     + texture2D(uSceneColor, at + vec2(0.0, px.y)).rgb + texture2D(uSceneColor, at - vec2(0.0, px.y)).rgb) * 0.15;
  gl_FragColor = vec4(c * uTint, 1.0);
}`;

const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

// a glb material with userData.refract -> its Refract material (src.normalMap: the glb's normalTexture)
export function refractMaterial(src) {
  const r = src.userData.refract || {};
  const tint = Array.isArray(r.tint) ? r.tint.map((v) => Math.max(0, num(v, 1))) : [1, 1, 1];
  const [rate, angle] = Array.isArray(r.scroll) ? r.scroll.map((v) => num(v, 0)) : [0, 0];
  const a = (angle * Math.PI) / 180;
  const m = new THREE.ShaderMaterial({
    name: src.name,
    uniforms: {
      tNormal: { value: src.normalMap || null }, uHasNormal: { value: src.normalMap ? 1 : 0 },
      uSceneColor: sceneCopyUniforms.uSceneColor, uViewport: sceneCopyUniforms.uViewport,
      uAmount: { value: Math.min(1, Math.max(0, num(r.amount, 0.5))) },
      uBlur: { value: Math.min(8, Math.max(0, num(r.blur, 1))) },
      uTint: { value: new THREE.Vector3(...tint) },
      uScroll: { value: new THREE.Vector2(Math.cos(a) * rate, Math.sin(a) * rate) },
      uTime: clock,
    },
    vertexShader: VS, fragmentShader: FS,
    transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
  });
  if (src.normalMap) { src.normalMap.wrapS = src.normalMap.wrapT = THREE.RepeatWrapping; src.normalMap.colorSpace = THREE.NoColorSpace; src.normalMap.needsUpdate = true; }
  m.userData = { ...src.userData };
  m.onBeforeRender = () => { lastDrawn = frame; };
  return m;
}
