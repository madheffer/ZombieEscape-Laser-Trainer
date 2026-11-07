// CS2's first-person legs (cl_firstperson_legs 1): your own pawn, the full model at its own origin, drawn in a
// "Firstperson Legs" render pass, with its upper body pushed off the bottom of the screen by the character shader's
// vertex stage. Read from CS2 (client.dll 2026-10-15 + csgo_character_vulkan_50_vs.vcs, decompiled with VRF):
//   - the pass is skipped unless the view looks down past r_csgo_gpu_opt_firstpersonlegs_visible_angle (40 deg):
//     forward . (0, 0, -1) >= cos(40 deg), i.e. pitch >= 50 deg (client FUN_1811d7f70) -> legsVisible()
//   - csgo_character VS, when g_flFirstpersonLegsFade > 0 and !g_bDisableFirstpersonLegsDistortion:
//       f = pow(saturate((vPositionOs.z + 1) * 0.0125) * 0.5 * pow(saturate(-viewForward.z), 2), 1.5)
//       clip.xy *= 1 + 5f;  clip.y -= 200f;  clip.z -= 40f;  normalWs = normalize(normalWs + (0, 0, 0.5) * sign(f))
//     vPositionOs is the vertex's model-space position AS POSED (CS2 skins characters before this stage; the VS
//     only applies the instance transform), inches, Z up: the higher the vertex stands and the further down you
//     look, the further it is thrown down and out (the chest, arms and head leave the screen, the feet barely move).
//   - the pixel shader never reads the fade (no dither / alpha): it only switches the warp on.
// Here: three's clip z spans [-w, w] (D3D/Vulkan's [0, w]), so CS2's -40 is -80; VRF's glb is metres with Source's Z
// as its Y, so vPositionOs.z = the skinned position's y x 39.3701 (three's `transformed`, after skinning).
import { chainBeforeCompile } from '../lib/shader.js';

const VISIBLE_COS = Math.cos(40 * Math.PI / 180);

// the pass runs (CS2 draws your legs) for a view pitch in degrees (Source: positive looks down)
export function legsVisible(pitchDeg) {
  return Math.sin(pitchDeg * Math.PI / 180) >= VISIBLE_COS;
}

// one set per body: fade 0 = an ordinary model (third person, teammates); 1 = your first-person legs
export function legsUniforms() {
  return { cs2LegsFade: { value: 0 }, cs2ViewFwdZ: { value: 0 } };
}

const PARS = /* glsl */`
uniform float cs2LegsFade;
uniform float cs2ViewFwdZ;
float cs2LegsWarp(vec3 posed) {
  if (cs2LegsFade <= 0.0) return 0.0;
  float zOs = posed.y * 39.3701;
  return pow(clamp((zOs + 1.0) * 0.0125, 0.0, 1.0) * 0.5 * pow(clamp(-cs2ViewFwdZ, 0.0, 1.0), 2.0), 1.5);
}
`;

// patch a body's materials once (they then follow its uniforms)
export function patchLegs(root, uniforms) {
  const done = new Set(); // a material shared by two meshes (the gloves) is patched once
  root.traverse((o) => {
    if (!o.isMesh) return;
    for (const mat of [].concat(o.material)) {
      if (done.has(mat)) continue;
      done.add(mat);
      chainBeforeCompile(mat, (shader) => {
        Object.assign(shader.uniforms, uniforms);
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', `#include <common>\n${PARS}`)
          .replace('#include <defaultnormal_vertex>', `#include <defaultnormal_vertex>
  if (cs2LegsFade > 0.0 && cs2ViewFwdZ < 0.0) transformedNormal = normalize(transformedNormal + (viewMatrix * vec4(0.0, 0.0, 0.5, 0.0)).xyz);`)
          .replace('#include <project_vertex>', `#include <project_vertex>
  float cs2Legs = cs2LegsWarp(transformed);
  if (cs2Legs > 0.0) {
    gl_Position.xy *= 1.0 + 5.0 * cs2Legs;
    gl_Position.y -= 200.0 * cs2Legs;
    gl_Position.z -= 80.0 * cs2Legs;
  }`);
      }, 'cs2legs');
    }
  });
}
