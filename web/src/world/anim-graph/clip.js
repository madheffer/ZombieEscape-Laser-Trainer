// One of CS2's compiled animation clips (tools/tp-graph.mjs keeps them in CS2's own compressed form), decoded the way
// CS2 samples it (Esoterica AnimationClip::GetPose + Quantization):
//   - per frame, per bone: rotation 3 x uint16 (2 bits: which component was dropped, 3 x 15-bit components in
//     [-1/sqrt2, 1/sqrt2]), translation 3 x uint16 in the track's ranges, scale 1 x uint16; static channels are
//     stored once in the track definition instead
//   - a time between frames: lerp / slerp of the two neighbouring frames (frame = percentage x (frames - 1))
import { STRIDE, KIND, qslerp } from './pose.js';
import { SyncTrack } from './sync-track.js';

const R = Math.SQRT1_2, L = 2 * R, Q15 = 1 / 0x7fff;

function b64(s) {
  const bin = atob(s), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export class Clip {
  // data: tp-graph.mjs packClip(); boneCount: the skeleton's (tracks beyond it are ignored, missing ones stay ref)
  constructor(path, data, boneCount) {
    this.path = path;
    this.duration = data.duration;
    this.frames = Math.max(1, data.frames | 0);
    this.additive = !!data.additive;
    this.events = (data.events || []).slice().sort((a, b) => a.t - b.t);
    this.sync = new SyncTrack((data.sync || []).map(([id, start, duration]) => ({ id, start, duration })), data.syncOffset || 0);
    this.boneCount = boneCount;
    this._data = data;
    this._decoded = null;
  }
  get singleFrame() { return this.frames <= 1; }

  // every frame decoded once, on first use: Float32Array(frames x bones x 8)
  decode() {
    if (this._decoded) return this._decoded;
    const d = this._data, n = this.boneCount, tracks = d.tracks;
    const bytes = b64(d.data || '');
    const u16 = new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 1);
    const out = new Float32Array(this.frames * n * STRIDE);
    for (let f = 0; f < this.frames; f++) {
      let p = d.offsets[f] ?? 0;
      const base = f * n * STRIDE;
      for (let i = 0; i < tracks.length; i++) {
        const t = tracks[i], flags = t[0], k = base + i * STRIDE, write = i < n;
        // [flags, qx, qy, qz, qw, tx0, txL, ty0, tyL, tz0, tzL, s0, sL]
        if (flags & 1) { if (write) { out[k + 4] = t[1]; out[k + 5] = t[2]; out[k + 6] = t[3]; out[k + 7] = t[4]; } }
        else {
          const a = u16[p], b = u16[p + 1], c = u16[p + 2];
          p += 3;
          if (write) {
            const x = (a & 0x7fff) * Q15 * L - R, y = (b & 0x7fff) * Q15 * L - R, z = c * Q15 * L - R;
            const w = Math.sqrt(Math.max(0, 1 - x * x - y * y - z * z));
            const largest = ((a >> 14) & 2) | (b >> 15);
            const q = largest === 0 ? [w, x, y, z] : largest === 1 ? [x, w, y, z] : largest === 2 ? [x, y, w, z] : [x, y, z, w];
            out[k + 4] = q[0]; out[k + 5] = q[1]; out[k + 6] = q[2]; out[k + 7] = q[3];
          }
        }
        if (flags & 2) { if (write) { out[k] = t[5]; out[k + 1] = t[7]; out[k + 2] = t[9]; } }
        else {
          if (write) {
            out[k] = u16[p] / 65535 * t[6] + t[5];
            out[k + 1] = u16[p + 1] / 65535 * t[8] + t[7];
            out[k + 2] = u16[p + 2] / 65535 * t[10] + t[9];
          }
          p += 3;
        }
        if (flags & 4) { if (write) out[k + 3] = t[11]; }
        else { if (write) out[k + 3] = u16[p] / 65535 * t[12] + t[11]; p += 1; }
      }
    }
    this._data = null; // the compressed copy is no longer needed
    return (this._decoded = out);
  }

  // the pose at a percentage through the clip into `pose`
  sample(pct, pose) {
    const fr = this.decode(), n = this.boneCount, o = pose.t;
    const f = this.singleFrame ? 0 : Math.min(1, Math.max(0, pct)) * (this.frames - 1);
    const f0 = Math.floor(f), f1 = Math.min(this.frames - 1, f0 + 1), t = f - f0;
    const a = f0 * n * STRIDE, b = f1 * n * STRIDE;
    if (t < 1e-6 || f0 === f1) o.set(fr.subarray(a, a + n * STRIDE));
    else {
      for (let i = 0; i < n; i++) {
        const k = i * STRIDE;
        for (let j = 0; j < 4; j++) o[k + j] = fr[a + k + j] + (fr[b + k + j] - fr[a + k + j]) * t;
        qslerp(fr, a + k + 4, fr, b + k + 4, t, o, k + 4);
      }
    }
    pose.kind = this.additive ? KIND.ADD : KIND.POSE;
    return pose;
  }
}
