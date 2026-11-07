// The GLSL source1-vlg.js patches into a converted Source 1 material: Source SDK 2013's VertexLitGeneric terms
// (skin_ps20b.fxc, vertexlit_and_unlit_generic(_bump)_ps2x.fxc, common_vertexlitgeneric_dx9.h, common_vs_fxc.h,
// common_ps_fxc.h, emissive_scroll_blended_pass_ps2x.fxc). Which parts compile is chosen by S1_* defines (see
// source1-vlg.js). Everything lit is x s1Exposure (Source's TONEMAP_SCALE_LINEAR on every output).

// vertex: the world normal and position, for per-pixel light, bump, rim, specular and the envmap
export const VLG_VERTEX = `
  #ifdef USE_SKINNING
    vS1N = normalize(mat3(modelMatrix) * objectNormal);
  #else
    vS1N = normalize(mat3(modelMatrix) * normal);
  #endif
  vS1W = (modelMatrix * vec4(transformed, 1.0)).xyz;
  #ifdef S1_TANGENT
    // the VVD's tangentS (glTF TANGENT, w the binormal sign), skinned as the normal; common_vs_fxc.h
    // SkinPositionNormalAndTangentSpace: T = cross(N, S) x w, and skin_vs20 normalizes S and T
    vec3 s1s = tangent.xyz;
    #ifdef USE_SKINNING
      s1s = (skinMatrix * vec4(s1s, 0.0)).xyz;
    #endif
    s1s = mat3(modelMatrix) * s1s;
    vS1S = dot(s1s, s1s) > 1e-12 ? normalize(s1s) : vec3(0.0); // no TANGENT in the glb: zero (the fragment falls back)
    vec3 s1tt = cross(vS1N, vS1S);
    vS1T = dot(s1tt, s1tt) > 1e-12 ? normalize(s1tt) * (tangent.w < 0.0 ? -1.0 : 1.0) : vec3(0.0);
  #endif
  #include <project_vertex>`;

// declarations the vertex patch needs (three declares tangent itself only with USE_TANGENT)
export const VLG_VERTEX_HEAD = `varying vec3 vS1N; varying vec3 vS1W;
#ifdef S1_TANGENT
  varying vec3 vS1S; varying vec3 vS1T;
  #ifndef USE_TANGENT
    attribute vec4 tangent;
  #endif
#endif
`;

export const VLG_HEAD = `
uniform vec3 s1Mod; uniform float s1AlphaMul;
uniform vec3 s1SelfIllum, s1DetailMul, s1RimTint, s1ETint; uniform float s1DetailScale, s1RimBoost, s1Time; uniform vec2 s1EScroll;
uniform sampler2D s1Mask, s1Detail, s1EBase, s1ETex, s1EFlow, s1Normal, s1PhongExp, s1Warp; uniform vec4 s1SIFresnel;
uniform vec3 s1LPos[4], s1LCol[4], s1LAtt[4], s1LSpot[4]; uniform vec4 s1LDir[4]; uniform int s1LCount;
uniform vec4 s1Phong; uniform vec3 s1PhongRanges, s1PhongTint; uniform vec3 s1PhongMasks;
uniform float s1EnvRow; uniform vec3 s1EnvTint; uniform vec4 s1EnvParams; uniform int s1EnvMaskMode; uniform sampler2D s1EnvMaskTex;
// PixelShaderAmbientLight
vec3 s1AmbientCube(vec3 n) {
  vec3 q = n * n;
  return q.x * (n.x >= 0.0 ? s1Cube[0] : s1Cube[1]) + q.y * (n.y >= 0.0 ? s1Cube[2] : s1Cube[3]) + q.z * (n.z >= 0.0 ? s1Cube[4] : s1Cube[5]);
}
// VertexAttenInternal: 1 / (c + l d + q d^2), x the spot cone saturate(pow(max(1e-4, (cos - phiDot) x 1 / (thetaDot -
// phiDot)), falloff)) for a spot light (dir.w 1); L the unit vector to the light
float s1Atten(int i, vec3 P, out vec3 L) {
  vec3 d = s1LPos[i] - P;
  float d2 = max(dot(d, d), 1e-4), od = inversesqrt(d2);
  L = d * od;
  float da = 1.0 / max(dot(s1LAtt[i], vec3(1.0, d2 * od, d2)), 1e-6);
  float sa = clamp(pow(max(0.0001, (dot(s1LDir[i].xyz, -L) - s1LSpot[i].y) * s1LSpot[i].z), s1LSpot[i].x), 0.0, 1.0);
  return mix(da, da * sa, s1LDir[i].w);
}
// DiffuseTerm: half Lambert squared (skin always; else $halflambert), or the light warp's 2 x warp(halflambert)
vec3 s1Diffuse(vec3 N, vec3 L) {
  float ndl = dot(N, L);
  #if defined(S1_HALFLAMBERT) || defined(S1_WARP)
    float r = clamp(ndl * 0.5 + 0.5, 0.0, 1.0);
    #ifdef S1_WARP
      return 2.0 * texture2D(s1Warp, vec2(r, 0.5)).rgb;
    #else
      return vec3(r * r);
    #endif
  #else
    return vec3(clamp(ndl, 0.0, 1.0));
  #endif
}
#ifdef S1_WORLD
varying vec3 vS1N; varying vec3 vS1W;
#endif
#ifdef S1_TANGENT
varying vec3 vS1S; varying vec3 vS1T;
#endif
`;

// the lit colour, replacing the material's own at opaque_fragment (three's outgoingLight)
export const VLG_BODY = `
  #ifdef USE_MAP
  vec3 s1Lit = outgoingLight;
  #ifdef S1_WORLD
    vec3 s1V = normalize(cameraPosition - vS1W), s1Nv = normalize(vS1N), s1N = s1Nv;
    vec4 s1Bump = vec4(0.5, 0.5, 1.0, 1.0);
    #ifdef S1_BUMP
      s1Bump = texture2D(s1Normal, vMapUv);
      vec3 s1t = s1Bump.xyz * 2.0 - 1.0;
      vec3 s1S = vec3(0.0), s1T = vec3(0.0);
      #ifdef S1_TANGENT
        s1S = vS1S; s1T = vS1T; // skin_ps20b: worldSpaceNormal = normalize(mul(tangentSpaceTranspose, tangentSpaceNormal))
      #endif
      if (dot(s1S, s1S) < 0.25) {
        // a glb without tangents: the frame from screen derivatives, T along +u, B along +v
        vec3 s1dp1 = dFdx(vS1W), s1dp2 = dFdy(vS1W);
        vec2 s1du1 = dFdx(vMapUv), s1du2 = dFdy(vMapUv);
        vec3 s1dp2p = cross(s1dp2, s1Nv), s1dp1p = cross(s1Nv, s1dp1);
        s1S = s1dp2p * s1du1.x + s1dp1p * s1du2.x; s1T = s1dp2p * s1du1.y + s1dp1p * s1du2.y;
        float s1inv = inversesqrt(max(max(dot(s1S, s1S), dot(s1T, s1T)), 1e-20));
        s1S *= s1inv; s1T *= s1inv;
      }
      s1N = normalize(s1S * s1t.x + s1T * s1t.y + normalize(vS1N) * s1t.z);
    #endif
    #ifdef S1_CUBE
      // PixelShaderDoLighting: the ambient cube along the normal + each local light's diffuse
      vec3 s1Light = s1AmbientCube(s1N);
      for (int i = 0; i < 4; i++) {
        if (i >= s1LCount) break;
        vec3 L; float a = s1Atten(i, vS1W, L);
        s1Light += s1LCol[i] * a * s1Diffuse(s1N, L);
      }
      s1Lit = s1Albedo * s1Light * s1Exposure;
    #endif
  #endif
  #if defined(S1_DETAIL) && !defined(S1_SKIN)
    s1Lit += texture2D(s1Detail, vMapUv * s1DetailScale).rgb * s1DetailMul * s1Exposure;
  #endif
  #ifdef S1_SELFILLUM
    #ifdef S1_MASK
      vec3 s1M = texture2D(s1Mask, vMapUv).rgb;
    #else
      vec3 s1M = vec3(sampledDiffuseColor.a);
    #endif
    #ifdef S1_SIFRESNEL
      float s1sf = clamp(pow(clamp(dot(s1Nv, s1V), 0.0, 1.0), s1SIFresnel.z) * s1SIFresnel.x + s1SIFresnel.y, 0.0, 1.0);
      s1Lit = max(vec3(0.0), mix(s1Lit, s1Albedo * s1SelfIllum * s1SIFresnel.w * s1Exposure, s1M * s1sf));
    #else
      s1Lit = max(vec3(0.0), mix(s1Lit, s1Albedo * s1SelfIllum * s1Exposure, s1M));
    #endif
  #endif
  #if defined(S1_DETAIL) && defined(S1_SKIN)
    s1Lit += texture2D(s1Detail, vMapUv * s1DetailScale).rgb * s1DetailMul * s1Exposure;
  #endif
  #if defined(S1_PHONG) || defined(S1_RIM)
    // skin_ps20b: specular (and rim) from the local lights, the ambient rim, x the specular tint
    vec4 s1Exp = vec4(1.0);
    #ifdef S1_PHONGEXP
      s1Exp = texture2D(s1PhongExp, vMapUv);
    #endif
    float s1RimMask = s1PhongMasks.y > 0.5 ? s1Exp.a : 1.0;
    vec3 s1Spec = vec3(0.0), s1RimL = vec3(0.0);
    vec3 s1R = 2.0 * s1N * dot(s1N, s1V) - s1V;
    #ifdef S1_PHONG
      float s1SpecExp = s1Phong.x >= 0.0 ? s1Phong.x : 1.0 + 149.0 * s1Exp.r;
      float s1SpecMask = mix(s1Bump.a, sampledDiffuseColor.a, s1PhongMasks.x);
      float s1f = clamp(1.0 - dot(s1N, s1V), 0.0, 1.0); s1f = s1f * s1f - 0.5;
      float s1Ranges = s1PhongRanges.y + (s1f >= 0.0 ? s1PhongRanges.z : s1PhongRanges.x) * s1f;
      for (int i = 0; i < 4; i++) {
        if (i >= s1LCount) break;
        vec3 L; float a = s1Atten(i, vS1W, L);
        float ldr = clamp(dot(s1R, L), 0.0, 1.0), ndl = clamp(dot(s1N, L), 0.0, 1.0);
        s1Spec += pow(ldr, s1SpecExp) * ndl * s1LCol[i] * a;
        #ifdef S1_RIM
          s1RimL += pow(ldr, s1Phong.w) * ndl * s1LCol[i] * a;
        #endif
      }
      s1Spec *= s1SpecMask * s1Ranges * s1Phong.y;
    #endif
    #ifdef S1_RIM
      float s1F = clamp(1.0 - dot(s1N, s1V), 0.0, 1.0); s1F *= s1F; s1F *= s1F;
      float s1RimMul = s1RimMask * s1F;
      s1Spec = max(s1Spec, s1RimL * s1RimMul);
      s1Spec += s1AmbientCube(s1V) * s1RimBoost * clamp(s1RimMul * s1N.z, 0.0, 1.0);
    #endif
    vec3 s1SpecTint = s1PhongTint.r >= 0.0 ? s1PhongTint : mix(vec3(1.0), sampledDiffuseColor.rgb, s1Exp.g);
    s1Lit += s1Spec * s1SpecTint * s1Exposure;
  #endif
  #ifdef S1_ENV
    // $envmap: the cubemap along R = 2N(N.V) - V (CalcReflectionVectorUnnormalized), x the tint
    if (s1EnvRow >= 0.0 && s1CubeRows > 0.5) {
      vec3 s1Env = s1EnvCube(s1EnvRow, 2.0 * s1N * dot(s1N, s1V) - s1V) * s1EnvTint;
      #ifdef S1_SKIN
        // skin_ps20b: the base alpha, or the phong mask with $normalmapalphaenvmapmask; x lerp(1, Fresnel ranges, $envmapfresnel)
        float s1pm = mix(s1Bump.a, sampledDiffuseColor.a, s1PhongMasks.x);
        float s1em = s1EnvMaskMode == 3 ? s1pm : sampledDiffuseColor.a;
        float s1ef = clamp(1.0 - dot(s1N, s1V), 0.0, 1.0); s1ef = s1ef * s1ef - 0.5;
        float s1er = s1PhongRanges.y + (s1ef >= 0.0 ? s1PhongRanges.z : s1PhongRanges.x) * s1ef;
        s1Env *= s1em * mix(1.0, s1er, s1EnvParams.z);
      #else
        // vertexlit / lightmappedgeneric: x the mask, lerp(x, x^2, contrast), lerp(grey, x, saturation)
        vec3 s1ef3 = vec3(1.0);
        #ifdef S1_ENVMASKTEX
          s1ef3 *= texture2D(s1EnvMaskTex, vMapUv).rgb;
        #endif
        if (s1EnvMaskMode == 2) s1ef3 *= 1.0 - sampledDiffuseColor.a;
        if (s1EnvMaskMode == 3) s1ef3 *= s1Bump.a;
        s1Env *= s1ef3;
        s1Env = mix(s1Env, s1Env * s1Env, s1EnvParams.x);
        s1Env = mix(vec3(dot(s1Env, vec3(0.299, 0.587, 0.114))), s1Env, s1EnvParams.y);
        #ifdef S1_LMG
          // $fresnelreflection: (1 - N.V)^5 x (1 - fr) + fr
          float s1lf = pow(clamp(1.0 - dot(s1Nv, s1V), 0.0, 1.0), 5.0);
          s1Env *= s1lf * (1.0 - s1EnvParams.w) + s1EnvParams.w;
        #endif
      #endif
      s1Lit += s1Env * s1Exposure;
    }
  #endif
  #ifdef S1_EMISSIVE
    #ifdef S1_EFLOW
      vec2 s1Flow = texture2D(s1EFlow, vMapUv).xy;
    #else
      vec2 s1Flow = vMapUv;
    #endif
    vec3 s1E = texture2D(s1EBase, vMapUv).rgb * texture2D(s1ETex, s1Flow + s1EScroll * s1Time).rgb * s1ETint * s1Exposure;
    s1Lit += max(s1E, vec3(0.0)) / max(diffuseColor.a, 0.05); // a proxy's negative tint adds nothing (an 8-bit target clamps)
  #endif
  outgoingLight = s1Lit;
  #endif
  #include <opaque_fragment>`;
