import * as THREE from 'three';
import { createSpritecardMaterial, applyControls, bindTextures, whiteTexture } from './spritecard.js';
import { spritecardControls, makeInputs } from './controls.js';
import { colorBlend, srgbToLinear, smoothstep } from './barn.js';
import { ropeV, vec } from './basis.js';
import { uploadRange as upload } from './upload.js';

// C_OP_RenderRopes / C_OP_RenderTrails: the spritecard trail combo (S_DRAW_AS_TRAIL=1, RE §6) tessellated on the
// CPU from basis.js, so the strip drawn is the one node tests check. Particles join in collection order
// (reversed with m_bReverseOrder); a closed loop wraps.

// UNSETTLED (RE §6: tessellation counts are C++ side): a fixed 8 segments per span, inside the
// renderer's own min/max. The graphics setting's reduced particle detail (app/graphics.js, Low) draws 3: a lightning
// bolt's spans are a few units long, so the curve between its points doesn't show, and it is under half the vertices.
let SEGMENTS = 8;
export function setRopeDetail(full) { SEGMENTS = full ? 8 : 3; }

// basis.js catmullRom / catmullRomTangent for one component (the same expressions; t2 = t^2, t3 = t^3)
const cmr = (a, b, c, d, t, t2, t3) => 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (3 * b - a - 3 * c + d) * t3);
const cmrT = (a, b, c, d, t, t2) => 0.5 * (c - a) + (2 * a - 5 * b + 4 * c - d) * t + 1.5 * (3 * b - a - 3 * c + d) * t2;

export class RopeRenderer {
  constructor(shared, assets) {
    this.assets = assets;
    this.geometry = new THREE.BufferGeometry();
    this.material = createSpritecardMaterial('mesh', shared, whiteTexture());
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.capacity = 0;
  }

  _ensure(verts, tris) {
    if (verts <= this.capacity) return;
    this.capacity = Math.max(verts, this.capacity * 2, 64);
    const g = this.geometry;
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.capacity * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('uv4', new THREE.BufferAttribute(new Float32Array(this.capacity * 4), 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color4', new THREE.BufferAttribute(new Float32Array(this.capacity * 4), 4).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(Math.max(tris, this.capacity * 3) * 3), 1));
  }

  update(col, p, raw, ctx, cls = 'C_OP_RenderRopes') {
    const ev = makeInputs(col);
    const ctl = spritecardControls(cls, p, raw, ev, col.time || 0);
    applyControls(this.material, ctl);
    bindTextures(this.material, ctl, this.assets);
    if (ctl.texture && this.assets.sheet(ctl.texture)) ctx.report?.('sprite sheet on a rope (sampled as the whole texture)');
    const n = col.count || 0;
    const closed = !!p.m_bClosedLoop && n > 2;
    const spans = n < 2 ? 0 : (closed ? n : n - 1);
    const S = Math.min(Math.max(SEGMENTS, p.m_nMinTesselation ?? 1), p.m_nMaxTesselation ?? 128);
    this.geometry.setDrawRange(0, 0);
    this.mesh.visible = spans > 0;
    if (!spans) return ctl;
    const verts = spans * (S + 1) * 2;
    this._ensure(verts, spans * S * 2);
    const A = col.attr || {};
    const idx = []; for (let i = 0; i < n; i++) idx.push(i);
    if (p.m_bReverseOrder) idx.reverse();
    const at = (k, i) => [A[k]?.[3 * i] ?? 0, A[k]?.[3 * i + 1] ?? 0, A[k]?.[3 * i + 2] ?? 0];
    const scale = ev.evalVec(p.m_vecColorScale, -1, [1, 1, 1]);
    const alphaScale = ev.evalFloat(p.m_flAlphaScale, -1, 1);
    const radiusScale = ev.evalFloat(p.m_flRadiusScale, -1, 1);
    const alpha2 = A[p.m_nAlpha2Field ?? 16];
    const gamma = ctl.vc.c4[2] >= 256;
    const P = idx.map((i) => at(0, i));
    const Rr = idx.map((i) => (A[3]?.[i] ?? 5) * radiusScale);
    const N = idx.map((i) => (A[21] ? at(21, i) : [0, 0, 1]));
    // COLOR0 / COLOR1, each sRGB-decoded when the gamma bit is set, then lerped (TVS:2742).
    const C = idx.map((i) => {
      const rgb = colorBlend(ctl.colorBlendType, scale, A[6] ? at(6, i) : [1, 1, 1]);
      return [...(gamma ? rgb.map(srgbToLinear) : rgb), (A[7]?.[i] ?? 1) * (alpha2 ? alpha2[i] : 1) * alphaScale];
    });
    // Running length at each particle (UNSETTLED: what feeds T2.z / T7.x, RE §1-4 #6).
    const D = [0];
    for (let j = 1; j <= n; j++) D.push(D[j - 1] + Math.hypot(...vec.sub(P[j % n], P[j - 1])));
    const wrap = (j) => (closed ? ((j % n) + n) % n : Math.min(Math.max(j, 0), n - 1));  // UNSETTLED: open ends repeat
    const cam = ctx.camPos, vc = ctl.vc;
    const pos = this.geometry.attributes.position.array, uv = this.geometry.attributes.uv4.array, colr = this.geometry.attributes.color4.array;
    const index = this.geometry.index.array;
    const rot = vc.c4[3], cr = Math.cos(rot), sr = Math.sin(rot);
    const frac = (x) => x - Math.floor(x);
    const fu = frac(vc.c5[0] + 0.5), fv = frac(vc.c5[1] + 0.5);
    // basis.js catmullRom / catmullRomTangent / ropeSide / screenSizeLimit written out on numbers below (the same
    // operations in the same order: the same vertices): this loop runs for every vertex of every rope each frame,
    // and a lightning bolt is hundreds of points x S segments. ropeSide's normal: mode 3 the particle normal, 2 up,
    // else towards the camera.
    const mode = Math.min(4, vc.orientation);
    const limit = vc.c2[2] > 0, c0 = vc.c0;
    let v = 0, t3 = 0;
    for (let s = 0; s < spans; s++) {
      const j0 = wrap(s - 1), j1 = wrap(s), j2 = wrap(s + 1), j3 = wrap(s + 2);
      const fadeDot = (a, b) => 1 - smoothstep(vc.c2[0], vc.c2[1], Math.abs(vec.dot(vec.normalize(vec.sub(P[a], P[b])), vec.normalize(vec.sub(cam, P[a])))));
      const f0 = fadeDot(j0, j1), f1 = fadeDot(j1, j2);                           // TVS:2768-2775
      const p0 = P[j0], p1 = P[j1], p2 = P[j2], p3 = P[j3], c1 = C[j1], c2 = C[j2], n1 = N[j1], n2 = N[j2];
      const base = v;
      for (let k = 0; k <= S; k++) {
        const t = k / S, tt = t * t, ttt = tt * t;
        const spx = cmr(p0[0], p1[0], p2[0], p3[0], t, tt, ttt), spy = cmr(p0[1], p1[1], p2[1], p3[1], t, tt, ttt), spz = cmr(p0[2], p1[2], p2[2], p3[2], t, tt, ttt);
        const tx = cmrT(p0[0], p1[0], p2[0], p3[0], t, tt), ty = cmrT(p0[1], p1[1], p2[1], p3[1], t, tt), tz = cmrT(p0[2], p1[2], p2[2], p3[2], t, tt);
        let w = cmr(Rr[j0], Rr[j1], Rr[j2], Rr[j3], t, tt, ttt);                  // TVS:2784
        let nx, ny, nz;
        if (mode === 3) {
          nx = n1[0] * (1 - t) + n2[0] * t; ny = n1[1] * (1 - t) + n2[1] * t; nz = n1[2] * (1 - t) + n2[2] * t;
          const l = Math.hypot(nx, ny, nz);
          if (l > 0) { const q = 1 / l; nx *= q; ny *= q; nz *= q; } else { nx = 0; ny = 0; nz = 0; }
        } else if (mode === 2) { nx = 0; ny = 0; nz = 1; } else { nx = cam[0] - spx; ny = cam[1] - spy; nz = cam[2] - spz; }
        let sx = ty * nz - tz * ny, sy = tz * nx - tx * nz, sz = tx * ny - ty * nx;
        const sl = Math.hypot(sx, sy, sz);
        if (sl > 0) { const q = 1 / sl; sx *= q; sy *= q; sz *= q; } else { sx = 0; sy = 0; sz = 0; }
        let cR = c1[0] + (c2[0] - c1[0]) * t, cG = c1[1] + (c2[1] - c1[1]) * t, cB = c1[2] + (c2[2] - c1[2]) * t, cA = c1[3] + (c2[3] - c1[3]) * t;
        cA *= f0 + (f1 - f0) * t;
        if (limit) {
          const d = Math.hypot(cam[0] - spx, cam[1] - spy, cam[2] - spz);
          let colorMul = 1;
          if (w > c0[1] * d) colorMul = w > c0[2] * d ? 0 : 1 - (w - c0[1] * d) / (d * (c0[2] - c0[1]));
          w = Math.min(Math.max(w, c0[0] * d), c0[3] * d);
          cR *= colorMul; cG *= colorMul; cB *= colorMul; cA *= colorMul;
        }
        const vv = vc.c3[3] > 0 ? ropeV(D[s], D[s + 1], t, vc.c3[2], vc.c3[3]) : 1 - t;   // TVS:173
        const v0 = vv - 0.5;
        for (let x = -1; x <= 1; x += 2) {
          const wx = w * x;
          pos[v * 3] = spx + sx * wx; pos[v * 3 + 1] = spy + sy * wx; pos[v * 3 + 2] = spz + sz * wx; // TVS:3041
          const u0 = x * 0.5 + 0.5 - 0.5;
          uv[v * 4] = (u0 * cr - v0 * sr) / vc.c5[2] + fu; uv[v * 4 + 1] = (u0 * sr + v0 * cr) / vc.c5[3] + fv; uv[v * 4 + 2] = 1; uv[v * 4 + 3] = 1;
          colr[v * 4] = cR; colr[v * 4 + 1] = cG; colr[v * 4 + 2] = cB; colr[v * 4 + 3] = cA;
          v++;
        }
      }
      for (let k = 0; k < S; k++) {
        const a = base + k * 2;
        index[t3] = a; index[t3 + 1] = a + 1; index[t3 + 2] = a + 3; index[t3 + 3] = a; index[t3 + 4] = a + 3; index[t3 + 5] = a + 2; t3 += 6;
      }
    }
    // only what was written goes up to the GPU, not the whole (doubling) buffer
    const g = this.geometry;
    for (const [name, size] of [['position', 3], ['uv4', 4], ['color4', 4]]) upload(g.attributes[name], v * size);
    upload(g.index, t3);
    g.setDrawRange(0, t3);
    return ctl;
  }

  dispose() { this.geometry.dispose(); this.material.dispose(); }
}
