// A pose of CS2's worldmodel skeleton: every bone's parent-space transform, 8 floats each
// [tx, ty, tz, scale, qx, qy, qz, qw] (Source units, the clip's own frame), plus what kind of pose it is.
// Blends are Esoterica's (AnimationBlender, the runtime CS2's anim graph comes from):
//   - blend: per bone slerp / lerp by weight (x the bone mask's weight)
//   - additive: rotation slerp(base, base * add, w), translation + scale base + add * w
//   - model space: rotations blended in model space for the masked bones, translations in parent space
// Quaternions are three.js order (x, y, z, w); `a * b` here is the Hamilton product (apply b, then a), so Esoterica's
// `local * parent` model-space chain is parent * local.

export const STRIDE = 8;
export const KIND = { REF: 'ref', POSE: 'pose', ADD: 'add', ZERO: 'zero' };

// --- quaternion helpers on flat arrays (a, ai) -> (o, oi)
export function qmul(a, ai, b, bi, o, oi) {
  const ax = a[ai], ay = a[ai + 1], az = a[ai + 2], aw = a[ai + 3];
  const bx = b[bi], by = b[bi + 1], bz = b[bi + 2], bw = b[bi + 3];
  o[oi] = aw * bx + ax * bw + ay * bz - az * by;
  o[oi + 1] = aw * by - ax * bz + ay * bw + az * bx;
  o[oi + 2] = aw * bz + ax * by - ay * bx + az * bw;
  o[oi + 3] = aw * bw - ax * bx - ay * by - az * bz;
}
export function qslerp(a, ai, b, bi, t, o, oi) {
  let bx = b[bi], by = b[bi + 1], bz = b[bi + 2], bw = b[bi + 3];
  const ax = a[ai], ay = a[ai + 1], az = a[ai + 2], aw = a[ai + 3];
  let cos = ax * bx + ay * by + az * bz + aw * bw;
  if (cos < 0) { cos = -cos; bx = -bx; by = -by; bz = -bz; bw = -bw; } // the short way
  let k0, k1;
  if (cos > 0.9995) { k0 = 1 - t; k1 = t; } // nearly equal: nlerp
  else {
    const th = Math.acos(cos), s = Math.sin(th);
    k0 = Math.sin((1 - t) * th) / s; k1 = Math.sin(t * th) / s;
  }
  let x = ax * k0 + bx * k1, y = ay * k0 + by * k1, z = az * k0 + bz * k1, w = aw * k0 + bw * k1;
  const n = 1 / (Math.hypot(x, y, z, w) || 1);
  o[oi] = x * n; o[oi + 1] = y * n; o[oi + 2] = z * n; o[oi + 3] = w * n;
}

export class Pose {
  constructor(skel) {
    this.skel = skel; // { count, parents: Int16Array, ref: Float32Array }
    this.t = new Float32Array(skel.count * STRIDE);
    this.kind = KIND.REF;
    this.t.set(skel.ref);
  }
  setRef() { this.t.set(this.skel.ref); this.kind = KIND.REF; return this; }
  // additive identity: no rotation, no offset, no scale change
  setZero() {
    const t = this.t;
    for (let i = 0; i < t.length; i += STRIDE) { t[i] = t[i + 1] = t[i + 2] = t[i + 3] = 0; t[i + 4] = t[i + 5] = t[i + 6] = 0; t[i + 7] = 1; }
    this.kind = KIND.ZERO;
    return this;
  }
  copy(p) { this.t.set(p.t); this.kind = p.kind; return this; }
  get isAdditive() { return this.kind === KIND.ADD || this.kind === KIND.ZERO; }
}

// parent-space blend src -> tgt by w (mask: per-bone weights or null). layered: an overlay (keeps blending at w=1)
export function blend(out, src, tgt, w, mask = null, layered = false) {
  const kind = src.isAdditive && tgt.isAdditive ? KIND.ADD : KIND.POSE;
  if (w <= 0) { if (out !== src) out.copy(src); return out; }
  if (!layered && w >= 1 && !mask) { if (out !== tgt) out.copy(tgt); return out; }
  const a = src.t, b = tgt.t, o = out.t, n = src.skel.count;
  for (let i = 0; i < n; i++) {
    const bw = mask ? w * mask[i] : w, k = i * STRIDE;
    if (bw <= 0) { if (out !== src) for (let j = 0; j < STRIDE; j++) o[k + j] = a[k + j]; continue; }
    if (!layered && bw >= 1) { for (let j = 0; j < STRIDE; j++) o[k + j] = b[k + j]; continue; }
    for (let j = 0; j < 4; j++) o[k + j] = a[k + j] + (b[k + j] - a[k + j]) * bw;
    qslerp(a, k + 4, b, k + 4, bw, o, k + 4);
  }
  out.kind = kind;
  return out;
}

const _q = new Float32Array(4);
// base + additive * w (Esoterica AdditiveBlendFunction)
export function additive(out, base, add, w, mask = null) {
  if (w <= 0) { if (out !== base) out.copy(base); return out; }
  const a = base.t, d = add.t, o = out.t, n = base.skel.count;
  for (let i = 0; i < n; i++) {
    const bw = mask ? w * mask[i] : w, k = i * STRIDE;
    if (bw <= 0) { if (out !== base) for (let j = 0; j < STRIDE; j++) o[k + j] = a[k + j]; continue; }
    for (let j = 0; j < 4; j++) o[k + j] = a[k + j] + d[k + j] * bw;
    qmul(a, k + 4, d, k + 4, _q, 0); // base then the delta, in the bone's own frame
    qslerp(a, k + 4, _q, 0, bw, o, k + 4);
  }
  out.kind = base.isAdditive && add.isAdditive ? KIND.ADD : KIND.POSE;
  return out;
}

// Esoterica Blender::ModelSpaceBlend: masked bones take the layer's model-space rotation, then the whole result is
// blended in over the base by the layer weight
const msScratch = new Map();
function scratch(n, k) { const key = `${n}:${k}`; let s = msScratch.get(key); if (!s) msScratch.set(key, s = new Float32Array(n * 4)); return s; }
export function modelSpaceBlend(out, base, layer, w, mask, tmp) {
  if (w <= 0 || !mask) { if (out !== base) out.copy(base); return out; }
  const n = base.skel.count, P = base.skel.parents, a = base.t, b = layer.t;
  const baseR = scratch(n, 0), layR = scratch(n, 1), resR = scratch(n, 2), inv = scratch(1, 3);
  for (let i = 0; i < n; i++) {
    const k = i * STRIDE, p = P[i];
    if (p < 0) { for (let j = 0; j < 4; j++) { baseR[i * 4 + j] = a[k + 4 + j]; layR[i * 4 + j] = b[k + 4 + j]; } continue; }
    qmul(baseR, p * 4, a, k + 4, baseR, i * 4);
    qmul(layR, p * 4, b, k + 4, layR, i * 4);
  }
  const r = tmp.t;
  for (let i = 0; i < n; i++) {
    const k = i * STRIDE, bw = mask[i], p = P[i];
    if (bw <= 0) {
      for (let j = 0; j < STRIDE; j++) r[k + j] = a[k + j];
      for (let j = 0; j < 4; j++) resR[i * 4 + j] = baseR[i * 4 + j];
      continue;
    }
    for (let j = 0; j < 4; j++) r[k + j] = a[k + j] + (b[k + j] - a[k + j]) * bw;
    qslerp(baseR, i * 4, layR, i * 4, bw, resR, i * 4);
    if (p < 0) { for (let j = 0; j < 4; j++) r[k + 4 + j] = resR[i * 4 + j]; continue; }
    // local = parentResult^-1 * result
    inv[0] = -resR[p * 4]; inv[1] = -resR[p * 4 + 1]; inv[2] = -resR[p * 4 + 2]; inv[3] = resR[p * 4 + 3];
    qmul(inv, 0, resR, i * 4, r, k + 4);
  }
  tmp.kind = KIND.POSE;
  return blend(out, base, tmp, w, null, true);
}
