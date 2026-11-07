import * as THREE from 'three';
import { createSpritecardMaterial, applyControls, bindTextures, whiteTexture } from './spritecard.js';
import { spritecardControls, makeInputs } from './controls.js';
import { colorBlend, srgbToLinearFast as srgbToLinear } from './barn.js';
import { sheetSample } from './basis.js';
import { uploadRange } from './upload.js';

// C_OP_RenderTrails: every particle is its OWN streak, from its position back along its motion (the spritecard trail
// combo, S_DRAW_AS_TRAIL, RE §6). Ropes join particles into one strip (ropes.js); trails never do.
//
// Length (C_OP_RenderTrails vertex setup, particles.dll FUN_1802d6190 / FUN_1802d4990): the motion is
// position - attribute m_nPrevPntSource; when that is the previous position (2) and !m_bIgnoreDT it is divided by the
// frame's dt (coll +0x64), so it is a velocity; times m_flLengthScale, then capped by m_flMaxLength (both read there).
// UNSETTLED (the clamp and fade sit in the vertex writer, not decompiled): the minimum m_flMinLength, the fade in
// `length *= min(1, age / m_flLengthFadeInTime)` and m_flForwardShift moving the streak forward by that fraction of
// its length are Source 1's CTrailRenderer rules; V runs 0 at the head to 1 at the tail; one sheet frame per
// particle (frame blend not drawn). Radius: the head end x m_flRadiusHeadTaper, the tail end x m_flRadiusTaper; colour
// and alpha x the head / tail scales, lerped along the streak (TVS:2742 COLOR0 / COLOR1).
//
// Every particle of every frame goes through here, so the loop is scalar and writes straight into the buffers: no
// arrays per particle (a streak used to make ~30, the garbage collector's main load in a heavy boss attack). The side
// vector is basis.js ropeSide inlined (normalize(cross(dir, N)), 0 for a zero cross).

// a float input that is the same for every particle (evaluated once per frame instead of per particle)
const literal = (inp) => inp == null || typeof inp === 'number' || (inp.m_nType ?? 'PF_TYPE_LITERAL') === 'PF_TYPE_LITERAL' || inp.m_nType === 0;
const _box = new THREE.Box3();

// One end of a streak: two vertices, e -/+ side * w, written at o.q (advanced by 2). v: 0 tail, 1 head. The screen size
// limit (basis.js screenSizeLimit) and the colour (tint x end scale, sRGB -> linear when gamma) inlined.
function streakEnd(o, ex, ey, ez, sx, sy, sz, w, tint, cs, as, a, v, r0, r1, r2, r3) {
  const c0 = o.c0, c5 = o.c5;
  let cm = 1;
  if (o.limit) {
    const cam = o.cam, dx = cam[0] - ex, dy = cam[1] - ey, dz = cam[2] - ez;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (w > c0[1] * d) cm = w > c0[2] * d ? 0 : 1 - (w - c0[1] * d) / (d * (c0[2] - c0[1]));
    w = Math.min(Math.max(w, c0[0] * d), c0[3] * d);
  }
  let cr = tint[0] * cs[0], cg = tint[1] * cs[1], cb = tint[2] * cs[2];
  if (o.gamma) { cr = srgbToLinear(cr); cg = srgbToLinear(cg); cb = srgbToLinear(cb); }
  cr *= cm; cg *= cm; cb *= cm;
  const ca = a * as * cm, vy = r1 + ((1 - v) / c5[3] + c5[1]) * (r3 - r1);
  const pos = o.pos, uv = o.uv, colr = o.colr;
  for (let x = -1; x <= 1; x += 2) {
    const o3 = o.q * 3, o4 = o.q * 4;
    pos[o3] = ex + sx * w * x; pos[o3 + 1] = ey + sy * w * x; pos[o3 + 2] = ez + sz * w * x;
    uv[o4] = r0 + ((x * 0.5 + 0.5) / c5[2] + c5[0]) * (r2 - r0); uv[o4 + 1] = vy; uv[o4 + 2] = 1; uv[o4 + 3] = 1;
    colr[o4] = cr; colr[o4 + 1] = cg; colr[o4 + 2] = cb; colr[o4 + 3] = ca;
    o.q++;
  }
}

export class TrailRenderer {
  constructor(shared, assets) {
    this.assets = assets;
    this.geometry = new THREE.BufferGeometry();
    this.material = createSpritecardMaterial('mesh', shared, whiteTexture());
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.capacity = 0;
    this._ends = new Float32Array(0); // per particle: tail xyz, head xyz, direction xyz (NaN x: no streak)
    this._sample = {};
    this._tint = [1, 1, 1]; this._rgb = [0, 0, 0];
  }

  _ensure(n) {
    if (n <= this.capacity) return;
    this.capacity = Math.max(n, this.capacity * 2, 16);
    const g = this.geometry, v = this.capacity * 4;
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(v * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('uv4', new THREE.BufferAttribute(new Float32Array(v * 4), 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color4', new THREE.BufferAttribute(new Float32Array(v * 4), 4).setUsage(THREE.DynamicDrawUsage));
    const index = new Uint32Array(this.capacity * 6);
    for (let i = 0; i < this.capacity; i++) index.set([4 * i, 4 * i + 1, 4 * i + 3, 4 * i, 4 * i + 3, 4 * i + 2], 6 * i);
    g.setIndex(new THREE.BufferAttribute(index, 1));
    this._ends = new Float32Array(this.capacity * 9);
  }

  // ctx: { camPos, frustum? }: with a frustum, streaks wholly outside it build nothing this frame
  update(col, p, raw, ctx, cls = 'C_OP_RenderTrails') {
    const ev = makeInputs(col);
    const ctl = spritecardControls(cls, p, raw, ev, col.time || 0);
    applyControls(this.material, ctl);
    bindTextures(this.material, ctl, this.assets);
    const sheet = ctl.texture ? this.assets.sheet(ctl.texture) : null;
    const n = col.count || 0;
    if (!n) { this.mesh.visible = false; return ctl; }
    this._ensure(n);
    const A = col.attr || {};
    const vc = ctl.vc, cam = ctx.camPos;
    const P = A[0], src = p.m_nPrevPntSource ?? 2, Q = A[src] || P;
    if (!P) { this.mesh.visible = false; return ctl; }
    const perSecond = src === 2 && !p.m_bIgnoreDT && col.dt > 0 ? 1 / col.dt : 1;
    const k = perSecond * (p.m_flLengthScale ?? 1);
    const maxLen = p.m_flMaxLength ?? 2000, minLen = p.m_flMinLength ?? 0, fadeIn = p.m_flLengthFadeInTime ?? 0;
    const shift = p.m_flForwardShift ?? 0, time = col.time || 0;
    const C = A[8];

    // pass 1: each streak's ends, and the box around them
    const E = this._ends;
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity, rMax = 0;
    const R = A[3];
    for (let i = 0; i < n; i++) {
      const o = 9 * i, j = 3 * i;
      const px = P[j], py = P[j + 1], pz = P[j + 2];
      const dx = px - Q[j], dy = py - Q[j + 1], dz = pz - Q[j + 2];
      const speed = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (!(speed > 0)) { E[o] = NaN; continue; }
      const ux = dx / speed, uy = dy / speed, uz = dz / speed;
      let len = Math.min(maxLen, Math.max(minLen, speed * k));
      if (fadeIn > 0) len *= Math.min(1, Math.max(0, (time - (C?.[i] ?? 0)) / fadeIn));
      const hx = px + ux * len * shift, hy = py + uy * len * shift, hz = pz + uz * len * shift;
      const tx = hx - ux * len, ty = hy - uy * len, tz = hz - uz * len;
      E[o] = tx; E[o + 1] = ty; E[o + 2] = tz; E[o + 3] = hx; E[o + 4] = hy; E[o + 5] = hz; E[o + 6] = ux; E[o + 7] = uy; E[o + 8] = uz;
      if (tx < x0) x0 = tx; if (tx > x1) x1 = tx; if (hx < x0) x0 = hx; if (hx > x1) x1 = hx;
      if (ty < y0) y0 = ty; if (ty > y1) y1 = ty; if (hy < y0) y0 = hy; if (hy > y1) y1 = hy;
      if (tz < z0) z0 = tz; if (tz > z1) z1 = tz; if (hz < z0) z0 = hz; if (hz > z1) z1 = hz;
      if (R && R[i] > rMax) rMax = R[i];
    }
    const radiusScale = ev.evalFloat(p.m_flRadiusScale, -1, 1);
    if (ctx.frustum && Number.isFinite(x0 + x1 + y0 + y1 + z0 + z1)) {
      // the widest end: radius x scale x the larger taper (a per-particle taper counts as up to 4x), and a margin
      const tapers = [p.m_flRadiusTaper, p.m_flRadiusHeadTaper].map((t) => (literal(t) ? Math.abs(ev.evalFloat(t, -1, 1)) : 4));
      const pad = (R ? rMax : 5) * Math.abs(radiusScale) * Math.max(...tapers) + 128;
      _box.min.set(x0 - pad, y0 - pad, z0 - pad);
      _box.max.set(x1 + pad, y1 + pad, z1 + pad);
      if (!ctx.frustum.intersectsBox(_box)) { this.mesh.visible = false; return ctl; }
    }

    // pass 2: the quads
    const scale = ev.evalVec(p.m_vecColorScale, -1, [1, 1, 1]);
    const headC = ev.evalVec(p.m_vecHeadColorScale, -1, [1, 1, 1]), tailC = ev.evalVec(p.m_vecTailColorScale, -1, [1, 1, 1]);
    const alphaScale = ev.evalFloat(p.m_flAlphaScale, -1, 1);
    const alpha2 = A[p.m_nAlpha2Field ?? 16];
    const gamma = vc.c4[2] >= 256, limit = vc.c2[2] > 0, c0 = vc.c0, c5 = vc.c5;
    const rate = vc.c1[3], inFps = !!p.m_bAnimateInFPS, fitLife = vc.animationType === 1;
    const mode = Math.min(4, vc.orientation);
    const tTaperLit = literal(p.m_flRadiusTaper), hTaperLit = literal(p.m_flRadiusHeadTaper);
    const tAlphaLit = literal(p.m_flTailAlphaScale), hAlphaLit = literal(p.m_flHeadAlphaScale);
    const tTaper0 = tTaperLit ? ev.evalFloat(p.m_flRadiusTaper, -1, 1) : 0, hTaper0 = hTaperLit ? ev.evalFloat(p.m_flRadiusHeadTaper, -1, 1) : 0;
    const tAlpha0 = tAlphaLit ? ev.evalFloat(p.m_flTailAlphaScale, -1, 1) : 0, hAlpha0 = hAlphaLit ? ev.evalFloat(p.m_flHeadAlphaScale, -1, 1) : 0;
    const pos = this.geometry.attributes.position.array, uv = this.geometry.attributes.uv4.array, colr = this.geometry.attributes.color4.array;
    const COL = A[6], ALPHA = A[7], LIFE = A[1], SEQ = A[9], NRM = A[21];
    const tint = this._tint, rgb = this._rgb, smp = this._sample;
    const out = this._out ||= { pos: null, uv: null, colr: null, cam: null, c0: null, c5: null, limit: false, gamma: false, q: 0 };
    out.pos = pos; out.uv = uv; out.colr = colr; out.cam = cam; out.c0 = c0; out.c5 = c5; out.limit = limit; out.gamma = gamma; out.q = 0;
    for (let i = 0; i < n; i++) {
      const o = 9 * i;
      const tx = E[o];
      if (Number.isNaN(tx)) continue;
      const ty = E[o + 1], tz = E[o + 2], hx = E[o + 3], hy = E[o + 4], hz = E[o + 5], ux = E[o + 6], uy = E[o + 7], uz = E[o + 8];
      // ropeSide: N = the normal (mode 3), world up (mode 2), else the camera minus the streak's middle
      let nx, ny, nz;
      if (mode === 3) { nx = NRM ? NRM[3 * i] : 0; ny = NRM ? NRM[3 * i + 1] : 0; nz = NRM ? NRM[3 * i + 2] : 1; }
      else if (mode === 2) { nx = 0; ny = 0; nz = 1; }
      else { nx = cam[0] - (hx + tx) * 0.5; ny = cam[1] - (hy + ty) * 0.5; nz = cam[2] - (hz + tz) * 0.5; }
      let sx = uy * nz - uz * ny, sy = uz * nx - ux * nz, sz = ux * ny - uy * nx;
      const sl = Math.sqrt(sx * sx + sy * sy + sz * sz);
      if (sl > 0) { sx /= sl; sy /= sl; sz /= sl; } else { sx = sy = sz = 0; }
      if (!Number.isFinite(sx + sy + sz)) continue;
      const r = (R ? R[i] : 5) * radiusScale;
      if (COL) { tint[0] = COL[3 * i]; tint[1] = COL[3 * i + 1]; tint[2] = COL[3 * i + 2]; } else tint[0] = tint[1] = tint[2] = 1;
      colorBlend(ctl.colorBlendType, scale, tint, rgb);
      tint[0] = rgb[0]; tint[1] = rgb[1]; tint[2] = rgb[2];
      const a = (ALPHA ? ALPHA[i] : 1) * (alpha2 ? alpha2[i] : 1) * alphaScale;
      let r0 = 0, r1 = 0, r2 = 1, r3 = 1;
      if (sheet) {
        const age = time - (C?.[i] ?? 0), life = LIFE ? LIFE[i] : 1;
        const s = sheetSample(sheet, SEQ ? SEQ[i] : 0, fitLife ? (life > 0 ? age / life : 0) : age, rate, inFps, smp);
        if (s) { const rc = s.rect0; r0 = rc[0]; r1 = rc[1]; r2 = rc[2]; r3 = rc[3]; }
      }
      const tTaper = tTaperLit ? tTaper0 : ev.evalFloat(p.m_flRadiusTaper, i, 1);
      const tAlpha = tAlphaLit ? tAlpha0 : ev.evalFloat(p.m_flTailAlphaScale, i, 1);
      const hTaper = hTaperLit ? hTaper0 : ev.evalFloat(p.m_flRadiusHeadTaper, i, 1);
      const hAlpha = hAlphaLit ? hAlpha0 : ev.evalFloat(p.m_flHeadAlphaScale, i, 1);
      streakEnd(out, tx, ty, tz, sx, sy, sz, r * tTaper, tint, tailC, tAlpha, a, 0, r0, r1, r2, r3);
      streakEnd(out, hx, hy, hz, sx, sy, sz, r * hTaper, tint, headC, hAlpha, a, 1, r0, r1, r2, r3);
    }
    const q = out.q;
    const g = this.geometry.attributes;
    uploadRange(g.position, q * 3);
    uploadRange(g.uv4, q * 4);
    uploadRange(g.color4, q * 4);
    this.geometry.setDrawRange(0, (q / 4) * 6);
    this.mesh.visible = q > 0;
    return ctl;
  }

  dispose() { this.geometry.dispose(); this.material.dispose(); }
}
